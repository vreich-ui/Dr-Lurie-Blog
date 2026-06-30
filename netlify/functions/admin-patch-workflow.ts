/**
 * Admin-authenticated workflow patch endpoint.
 *
 * Handles two actions needed by the browser admin UI:
 *   patch_canonical_input  — writes promote_publish_payload into the record
 *   set_published_time     — marks the record's publication timestamp
 *
 * Auth: Bearer Netlify Identity admin token verified via GoTrue.
 * This replaces direct browser calls to save-json-blob, which requires the
 * server-side PUBLISH_SECRET that must never be sent to the browser.
 *
 * Artifact-ref validation is re-implemented here to enforce the same rules as
 * save-json-blob's patch_canonical_input: no arbitrary remote URLs, no data
 * URIs, no legacy repo paths — only trusted Major Key artifact references.
 */
import { z } from 'zod';

import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
import { getWorkflowBlobStore } from '../lib/blob-store.js';
import { publishPayloadSchema } from '../../src/schema/schema-v1.js';
import type { WorkflowRecord } from '../../src/schema/schema-v1.js';

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

type LambdaEvent = {
  blobs?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const bodySchema = z
  .object({
    action: z.enum(['patch_canonical_input', 'set_published_time']),
    request_id: z.string().min(1),
    lock_token: z.string().min(1),
    expected_record_version: z.number().int().nonnegative().optional(),
    promote_publish_payload: z.unknown().optional(),
    published_time: z.string().nullable().optional(),
  })
  .strict();

type AdminPatchBody = z.infer<typeof bodySchema>;
type Store = Awaited<ReturnType<typeof getWorkflowBlobStore>>;

const recordKey = (requestId: string) => `workflows/by-id/${requestId}.json`;
const nowIso = () => new Date().toISOString();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

// ─── artifact-ref validation (mirrors save-json-blob rules) ───────────────────

const MAJOR_KEY_ARTIFACT_REF_RE = /^(image|pdf)\/[^/]+\/[0-9a-f]{64}\.[a-z]+$/i;
const BASE64_DATA_URI_RE = /^data:/i;
const LEGACY_REPO_PATH_RE = /^src\/assets\//;
const REMOTE_URL_RE = /^https?:\/\//i;

const gatherTrustedArtifactRefs = (record: WorkflowRecord): Set<string> => {
  const refs = new Set<string>();
  for (const agentOutput of Object.values(record.agent_outputs)) {
    if (!agentOutput) continue;
    const out = agentOutput.output;
    if (!isRecord(out)) continue;
    const refs_ = out.artifactReferences;
    if (!Array.isArray(refs_)) continue;
    for (const ref of refs_) {
      if (isRecord(ref) && typeof ref.blobKey === 'string' && MAJOR_KEY_ARTIFACT_REF_RE.test(ref.blobKey)) {
        refs.add(ref.blobKey);
      }
    }
  }
  return refs;
};

const validateImageRef = (path: string, value: string, trustedRefs: Set<string>): string | undefined => {
  if (BASE64_DATA_URI_RE.test(value)) return `${path} must not be a data URI.`;
  if (LEGACY_REPO_PATH_RE.test(value)) return `${path} is a legacy repo path. Provide a Major Key artifact reference.`;
  if (REMOTE_URL_RE.test(value))
    return `${path} is an arbitrary remote URL. Provide a Major Key artifact reference instead.`;
  if (!MAJOR_KEY_ARTIFACT_REF_RE.test(value))
    return `${path} must be a Major Key artifact reference ({image|pdf}/{id}/{sha256}.{ext}).`;
  if (!trustedRefs.has(value)) return `${path} "${value}" is not in the agent artifact index for this record.`;
  return undefined;
};

const validatePayloadImageRefs = (payload: Record<string, unknown>, trustedRefs: Set<string>): string | undefined => {
  for (const field of ['featuredImage', 'existingFeaturedImagePath']) {
    const value = payload[field];
    if (typeof value !== 'string' || !value) continue;
    const err = validateImageRef(`promote_publish_payload.${field}`, value, trustedRefs);
    if (err) return err;
  }

  for (const arrayField of ['images', 'mediaEntries']) {
    const items = payload[arrayField];
    if (!Array.isArray(items)) continue;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!isRecord(item)) continue;
      for (const subField of ['src', 'url', 'blobKey']) {
        const value = item[subField];
        if (typeof value !== 'string' || !value) continue;
        const err = validateImageRef(`promote_publish_payload.${arrayField}[${i}].${subField}`, value, trustedRefs);
        if (err) return err;
      }
    }
  }

  const artifactRefs = payload['artifactReferences'];
  if (Array.isArray(artifactRefs)) {
    for (let i = 0; i < artifactRefs.length; i += 1) {
      const item = artifactRefs[i];
      if (!isRecord(item)) continue;
      const blobKey = item['blobKey'];
      if (typeof blobKey !== 'string' || !blobKey) continue;
      const err = validateImageRef(`promote_publish_payload.artifactReferences[${i}].blobKey`, blobKey, trustedRefs);
      if (err) return err;
    }
  }

  return undefined;
};

// ─── lock validation ──────────────────────────────────────────────────────────

const validateLock = (record: WorkflowRecord, lockToken: string) => {
  const nowMs = Date.now();
  if (!record.lock) return 'lock_expired' as const;
  if (record.lock.token !== lockToken) return 'lock_mismatch' as const;
  if (Date.parse(record.lock.expires_at) <= nowMs) return 'lock_expired' as const;
  return undefined;
};

const lockErrorResponse = (action: string, record: WorkflowRecord, kind: 'lock_expired' | 'lock_mismatch') =>
  jsonResponse(
    423,
    kind === 'lock_mismatch' && record.lock
      ? {
          action,
          error: 'lock_mismatch',
          locked: true,
          lock: {
            owner_id: record.lock.owner_id,
            owner_label: record.lock.owner_label,
            expires_at: record.lock.expires_at,
          },
        }
      : { action, error: kind, lock_expired: true }
  );

// ─── action handlers ──────────────────────────────────────────────────────────

export const handlePatchCanonicalInput = async (store: Store, body: AdminPatchBody) => {
  if (!body.promote_publish_payload) {
    return jsonResponse(400, {
      action: body.action,
      error: 'promote_publish_payload is required for patch_canonical_input.',
    });
  }

  const parsedPayload = publishPayloadSchema.safeParse(body.promote_publish_payload);
  if (!parsedPayload.success) {
    return jsonResponse(400, {
      action: body.action,
      error: 'promote_publish_payload is not a valid PublishPayload.',
      issues: parsedPayload.error.issues,
    });
  }
  const validatedPayload = parsedPayload.data;

  const raw = await store.get(recordKey(body.request_id));
  if (!raw) return jsonResponse(404, { action: body.action, not_found: true });

  const record = JSON.parse(raw) as WorkflowRecord;

  const lockErr = validateLock(record, body.lock_token);
  if (lockErr) return lockErrorResponse(body.action, record, lockErr);

  if (body.expected_record_version !== undefined && record.version !== body.expected_record_version) {
    return jsonResponse(409, { action: body.action, conflict: true });
  }

  if (isRecord(validatedPayload)) {
    const trustedRefs = gatherTrustedArtifactRefs(record);
    const imgErr = validatePayloadImageRefs(validatedPayload as Record<string, unknown>, trustedRefs);
    if (imgErr) return jsonResponse(400, { action: body.action, error: imgErr });
  }

  const timestamp = nowIso();
  const nextRecord: WorkflowRecord = {
    ...record,
    updated_at: timestamp,
    input: {
      ...record.input,
      publication: {
        ...(record.input.publication ?? {}),
        schema_version: 'publication.v2',
        publish_payload: validatedPayload,
      },
    },
    history: [
      ...record.history,
      {
        at: timestamp,
        action: 'patch_canonical_input',
        details: {
          path: 'input.publication.publish_payload',
          previousPayload: record.input.publication?.publish_payload ?? null,
          nextPayload: validatedPayload,
        },
      },
    ],
    version: record.version + 1,
  };

  await store.setJSON(recordKey(body.request_id), nextRecord);
  return jsonResponse(200, { action: body.action, record: { version: nextRecord.version } });
};

export const handleSetPublishedTime = async (store: Store, body: AdminPatchBody) => {
  if (
    body.published_time !== null &&
    body.published_time !== undefined &&
    Number.isNaN(Date.parse(body.published_time))
  ) {
    return jsonResponse(400, {
      action: body.action,
      error: 'published_time must be null or a valid ISO timestamp.',
    });
  }

  const raw = await store.get(recordKey(body.request_id));
  if (!raw) return jsonResponse(404, { action: body.action, not_found: true });

  const record = JSON.parse(raw) as WorkflowRecord;

  const lockErr = validateLock(record, body.lock_token);
  if (lockErr) return lockErrorResponse(body.action, record, lockErr);

  const timestamp = nowIso();
  const nextRecord: WorkflowRecord = {
    ...record,
    updated_at: timestamp,
    input: {
      ...record.input,
      publication: {
        ...(record.input.publication ?? {}),
        schema_version: 'publication.v2',
        published_time: body.published_time ?? null,
      },
    },
    history: [
      ...record.history,
      {
        at: timestamp,
        action: 'set_published_time',
        details: { published_time: body.published_time ?? null },
      },
    ],
    version: record.version + 1,
  };

  await store.setJSON(recordKey(body.request_id), nextRecord);
  return jsonResponse(200, { action: body.action, record: { version: nextRecord.version } });
};

// ─── handler ──────────────────────────────────────────────────────────────────

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const adminState = await getAdminStateFromEvent(event, context);
  if (!adminState.authenticated) return jsonResponse(401, { error: adminState.error ?? 'Authentication is required.' });
  if (!adminState.isAdmin) return jsonResponse(403, { error: 'Admin access required.' });

  let rawBody: unknown;
  try {
    const text =
      event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body ?? '');
    rawBody = JSON.parse(text);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body.' });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return jsonResponse(400, { error: 'Invalid request fields.', issues: parsed.error.issues });

  const body = parsed.data;

  try {
    const store = await getWorkflowBlobStore(event);
    return body.action === 'patch_canonical_input'
      ? await handlePatchCanonicalInput(store, body)
      : await handleSetPublishedTime(store, body);
  } catch (error) {
    console.error('admin-patch-workflow failed', { action: body.action, error });
    return jsonResponse(500, { error: 'Workflow patch could not be completed.' });
  }
};
