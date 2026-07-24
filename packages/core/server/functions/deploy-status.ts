import { PLATFORM_ENV_NAMES, readBoundEnv, type SiteBinding } from '../lib/site-binding.js';
import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { getHeader } from '../lib/admin-auth.js';
import {
  getDeployReceiptByCommit,
  getDeployReceiptByDeployId,
  getPublishedProductionDeploy,
  isNetlifyDeployLookupConfigured,
  type DeployReceipt,
} from '../lib/netlify-deploys.js';

type LambdaEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type QueuedDeployReceipt = Partial<Omit<DeployReceipt, 'deployStatus'>> & {
  deployStatus: 'queued';
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const requestSchema = z
  .object({
    commit: z.string().trim().min(1).optional(),
    deployId: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.commit || value.deployId), {
    message: 'At least one of commit or deployId is required.',
    path: ['commit'],
  });

const jsonResponse = (status: number, body: Record<string, unknown>) => ({
  statusCode: status,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: status >= 200 && status < 300, status, ...body }),
});

const safeJsonParse = (event: LambdaEvent) => {
  if (!event.body) return { ok: false as const };

  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

    return { ok: true as const, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false as const };
  }
};

const secretsMatch = (provided: string, expected: string) => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
};

const verifyPublishKey = (event: LambdaEvent) => {
  const provided = getHeader(event.headers, 'x-publish-key').trim();
  const expected = readBoundEnv(PLATFORM_ENV_NAMES.publishSecret) ?? '';

  if (!provided || !expected || !secretsMatch(provided, expected)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  return undefined;
};

const getQueuedReceipt = ({
  commit,
  deployId,
  errorMessage,
}: {
  commit?: string;
  deployId?: string;
  errorMessage?: string;
}): QueuedDeployReceipt => ({
  ...(commit ? { commit } : {}),
  ...(deployId ? { deployId } : {}),
  deployStatus: 'queued',
  ...(errorMessage ? { errorMessage } : {}),
});

const handlerImpl = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const contentType = getHeader(event.headers, 'content-type').toLowerCase();
  if (!contentType.includes('application/json')) {
    return jsonResponse(415, { error: 'Content-Type must be application/json.' });
  }

  const authFailure = verifyPublishKey(event);
  if (authFailure) return authFailure;

  const parsedJson = safeJsonParse(event);
  if (!parsedJson.ok) return jsonResponse(400, { error: 'Invalid request body.' });

  const parsedBody = requestSchema.safeParse(parsedJson.value);
  if (!parsedBody.success) {
    return jsonResponse(400, { error: 'Invalid request fields.', issues: parsedBody.error.issues });
  }

  const { commit, deployId } = parsedBody.data;

  if (!isNetlifyDeployLookupConfigured()) {
    return jsonResponse(
      200,
      getQueuedReceipt({ commit, deployId, errorMessage: 'Netlify deploy lookup is not configured.' })
    );
  }

  try {
    const receipt = commit ? await getDeployReceiptByCommit(commit) : await getDeployReceiptByDeployId(deployId ?? '');

    // The published deploy is what production actually serves — a "ready"
    // receipt alone can be a ready-but-unpublished deploy under locked Auto
    // Publishing. Absent fields (site lookup unavailable) mean "unknown",
    // never "not live".
    const publishedDeploy = await getPublishedProductionDeploy();
    const productionConfirmed = publishedDeploy
      ? Boolean((commit && publishedDeploy.commit === commit) || (deployId && publishedDeploy.deployId === deployId))
      : undefined;

    return jsonResponse(200, {
      ...(receipt ?? getQueuedReceipt({ commit, deployId })),
      ...(publishedDeploy ? { publishedDeploy, productionConfirmed } : {}),
    });
  } catch (error) {
    console.warn('Netlify deploy status lookup failed.', { commit, deployId, error });

    return jsonResponse(200, getQueuedReceipt({ commit, deployId }));
  }
};

/** W11 T11.4: per-site factory — the site shim instantiates this with its binding. */
export const createHandler = (_binding: SiteBinding) => handlerImpl;
