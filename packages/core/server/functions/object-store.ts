/**
 * Function name: Object_Store
 * Required method: POST
 * Required header: x-publish-key
 * Store name: site-objects
 * Primary record key: objects/{object_type}/by-id/{object_id}.json
 *
 * The publish-key entry point to the generic object verbs (T0.8), for agents
 * and scripts. Actions: get | list | create | checkout | refresh_lock |
 * checkin | patch | validate. (submit / publish / review arrive in P1.)
 *
 * All action logic lives in netlify/lib/object-verbs.ts and is shared with the
 * Netlify-Identity mirror (admin-object.ts); this file only authenticates the
 * shared publish key and builds the self-declared agent Principal (today's
 * trust model, C§2.0 — per-agent credentials are OQ-3, not built here).
 */
import { timingSafeEqual } from 'node:crypto';
import { PLATFORM_ENV_NAMES, readBoundEnv, type SiteBinding } from '../lib/site-binding.js';

import { getHeader } from '../lib/admin-auth.js';
import type { ArtifactIndexStore } from '../lib/artifact-index.js';
import { getArtifactIndexBlobStore, getSiteObjectsBlobStore } from '../lib/blob-store.js';
import { handleObjectVerb, objectVerbRequestSchema, type ObjectVerbStore } from '../lib/object-verbs.js';
import { buildStoreValidationContext } from '../lib/object-validation-context.js';
import type { ObjectType } from '../../schema/object-record-v1.js';
import type { Principal } from '../../schema/object-record-v1.js';

type LambdaEvent = {
  httpMethod?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
};

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const jsonResponse = (status: number, body: Record<string, unknown>) => ({
  statusCode: status,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: status >= 200 && status < 300, status, ...body }),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const safeJsonParse = (event: LambdaEvent): { ok: true; value: unknown } | { ok: false } => {
  if (!event.body) return { ok: false };
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
};

const secretsMatch = (provided: string, expected: string): boolean => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
};

const verifyPublishKey = (event: LambdaEvent) => {
  const provided = getHeader(event.headers, 'x-publish-key');
  const expected = readBoundEnv(PLATFORM_ENV_NAMES.publishSecret) ?? '';
  if (!provided || !expected || !secretsMatch(provided, expected)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }
  return undefined;
};

const agentPrincipal = (payload: unknown): Principal => {
  const declared = isRecord(payload) && typeof payload.agent_name === 'string' ? payload.agent_name.trim() : '';
  return { kind: 'agent', agent_name: declared || 'unattributed-agent', auth: 'publish_key' };
};

const handlerImpl = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const authFailure = verifyPublishKey(event);
  if (authFailure) return authFailure;

  const parsed = safeJsonParse(event);
  if (!parsed.ok) return jsonResponse(400, { error: 'Invalid request body.' });

  const request = objectVerbRequestSchema.safeParse(parsed.value);
  if (!request.success) return jsonResponse(400, { error: 'Invalid request fields.', issues: request.error.issues });

  try {
    const store = (await getSiteObjectsBlobStore(event)) as unknown as ObjectVerbStore;
    // Wire the store-backed validation context so reference integrity, PageType
    // section rules, route uniqueness, and taxonomy resolution are enforced live
    // (not the previous no-context degradation to `optional`). Flows to create,
    // patch, validate, and publish.
    const requestData = request.data as {
      object_id?: string;
      object_type?: ObjectType;
      target?: { kind?: string; page_id?: string };
    };
    // instantiate_section (W8.2) validates the TARGET page under its own id —
    // without the self ref, route uniqueness would flag the page's own route.
    const targetPageId = requestData.target?.kind === 'page' ? requestData.target.page_id : undefined;
    // Artifact existence checks (Fix: asset refs were shape-only in production).
    // An unavailable index store degrades to "existence not verified", never a
    // failed write.
    const artifactIndexStore = (await getArtifactIndexBlobStore(event).catch(() => undefined)) as unknown as
      | ArtifactIndexStore
      | undefined;
    const validationContext = await buildStoreValidationContext(store, {
      selfObjectId: requestData.object_id ?? targetPageId,
      selfObjectType: requestData.object_type ?? (targetPageId ? 'page' : undefined),
      ...(artifactIndexStore ? { artifactIndexStore } : {}),
      artifactRefSources: [parsed.value],
    });
    const result = await handleObjectVerb(store, request.data, agentPrincipal(parsed.value), { validationContext });
    return jsonResponse(result.status, result.body);
  } catch (error) {
    console.error('Object_Store request failed.', error);
    return jsonResponse(500, { action: request.data.action, error: 'Object request could not be processed.' });
  }
};

/** W11 T11.4: per-site factory — the site shim instantiates this with its binding. */
export const createHandler = (_binding: SiteBinding) => handlerImpl;
