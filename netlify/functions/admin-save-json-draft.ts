import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import type { BlobListResult } from '../lib/blob-list.js';
import { getWorkflowBlobStore } from '../lib/blob-store.js';
import { workflowStatuses, type WorkflowStatus } from '../../src/schema/workflow-contract.js';
import {
  parseContentSourceV1,
  type ContentSourceV1,
  type PublishPayload,
  type WorkflowRecord,
} from '../../src/schema/schema-v1.js';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const draftError = 'Title, slug, and author are required to save JSON draft.';
const missingLockTokenMessage = 'lock_token is required to update a checked-out draft.';
const lockExpiredMessage = 'The workflow lock has expired. Check out the draft again and retry.';
const lockMismatchMessage = 'The provided lock_token does not match the active workflow lock.';
const notFoundMessage = 'Workflow record was not found.';
const draftWorkflowStatuses = new Set<WorkflowStatus>(
  workflowStatuses.filter((status) => status === 'pending' || status === 'in_progress')
);

type LambdaEvent = {
  blobs?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type WorkflowBlobStore = Awaited<ReturnType<typeof getWorkflowBlobStore>> & {
  delete?: (key: string) => Promise<void>;
  list?: (options?: {
    prefix?: string;
    directories?: boolean;
    paginate?: boolean;
  }) => Promise<BlobListResult> | AsyncIterable<BlobListResult>;
};

const requestSchema = z
  .object({
    request_id: z.string().min(1).optional(),
    lock_token: z.string().min(1).optional(),
    input: z.unknown(),
  })
  .strict();

type AdminDraftRequest = z.infer<typeof requestSchema>;

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const safeJsonParse = (event: LambdaEvent) => {
  if (!event.body) return { ok: false as const, error: 'missing_body' };

  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

    return { ok: true as const, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false as const, error: 'invalid_json' };
  }
};

const nowIso = () => new Date().toISOString();
const recordKey = (requestId: string) => `workflows/by-id/${requestId}.json`;
const stageIndexKey = (nextAgent: string, requestId: string) => `workflows/index/by-stage/${nextAgent}/${requestId}`;
const statusIndexKey = (status: string, requestId: string) => `workflows/index/by-status/${status}/${requestId}`;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const loadRecord = async (store: WorkflowBlobStore, requestId: string) => {
  const value = await store.get(recordKey(requestId));

  if (!value) return undefined;

  return JSON.parse(value) as WorkflowRecord;
};

const saveRecord = async (store: WorkflowBlobStore, record: WorkflowRecord) => {
  await store.setJSON(recordKey(record.request_id), record);
};

const deleteBlob = async (store: WorkflowBlobStore, key: string) => {
  if (typeof store.delete === 'function') {
    await store.delete(key);
    return;
  }

  await store.del(key);
};

const updateIndexes = async (
  store: WorkflowBlobStore,
  previousRecord: WorkflowRecord | undefined,
  nextRecord: WorkflowRecord
) => {
  if (previousRecord?.next_agent && previousRecord.next_agent !== nextRecord.next_agent) {
    await deleteBlob(store, stageIndexKey(previousRecord.next_agent, previousRecord.request_id));
  }

  if (previousRecord && previousRecord.workflow_status !== nextRecord.workflow_status) {
    await deleteBlob(store, statusIndexKey(previousRecord.workflow_status, previousRecord.request_id));
  }

  if (nextRecord.next_agent) {
    await store.set(stageIndexKey(nextRecord.next_agent, nextRecord.request_id), '');
  }

  await store.set(statusIndexKey(nextRecord.workflow_status, nextRecord.request_id), '');
};

const getPublishPayload = (input: ContentSourceV1) => input.publication?.publish_payload;

const hasRequiredDraftFields = (input: ContentSourceV1) => {
  const payload = getPublishPayload(input);
  const title = payload?.title?.trim() || input.content?.title?.trim() || '';
  const slug = payload?.slug?.trim() || slugify(title);
  const author = payload?.author?.trim() || '';

  return Boolean(title && slug && author);
};

const withDraftPublication = (input: ContentSourceV1, previousInput?: ContentSourceV1): ContentSourceV1 => {
  const incomingPublication = input.publication ?? {};
  const previousPublication = previousInput?.publication ?? {};
  const incomingPayload: Partial<PublishPayload> = incomingPublication.publish_payload ?? {};
  const previousPayload: Partial<PublishPayload> = previousPublication.publish_payload ?? {};
  const title = incomingPayload.title?.trim() || input.content?.title?.trim() || previousPayload.title;
  const slug = incomingPayload.slug?.trim() || (title ? slugify(title) : previousPayload.slug);

  return {
    ...previousInput,
    ...input,
    publication: {
      ...previousPublication,
      ...incomingPublication,
      schema_version: 'publication.v1',
      publication_status: 'draft',
      publish_payload: {
        ...previousPayload,
        ...incomingPayload,
        slug: slug ?? '',
        title: title ?? '',
        draft: true,
      },
    },
  };
};

const getLockExpirationMs = (expiresAt: string) => {
  const expiresAtMs = Date.parse(expiresAt);

  return Number.isFinite(expiresAtMs) ? expiresAtMs : 0;
};

const missingLockTokenResponse = () =>
  jsonResponse(400, {
    error: missingLockTokenMessage,
    error_code: 'missing_lock_token',
    message: missingLockTokenMessage,
  });

const sanitizeWorkflowLock = (lock: WorkflowRecord['lock']) => {
  if (!lock) return undefined;

  return {
    owner_id: lock.owner_id,
    owner_label: lock.owner_label,
    acquired_at: lock.acquired_at,
    expires_at: lock.expires_at,
  };
};

const lockExpiredResponse = (lock?: WorkflowRecord['lock']) =>
  jsonResponse(423, {
    error: 'lock_expired',
    error_code: 'lock_expired',
    message: lockExpiredMessage,
    lock_expired: true,
    ...(lock ? { lock: sanitizeWorkflowLock(lock) } : {}),
  });

const lockMismatchResponse = (lock?: WorkflowRecord['lock']) =>
  jsonResponse(423, {
    error: 'lock_token_mismatch',
    error_code: 'lock_token_mismatch',
    message: lockMismatchMessage,
    locked: true,
    ...(lock ? { lock: sanitizeWorkflowLock(lock) } : {}),
  });

const notFoundResponse = () =>
  jsonResponse(404, {
    error: 'not_found',
    error_code: 'not_found',
    message: notFoundMessage,
    not_found: true,
  });

const validateActiveLock = (record: WorkflowRecord, lockToken: string) => {
  if (!record.lock || getLockExpirationMs(record.lock.expires_at) <= Date.now())
    return lockExpiredResponse(record.lock);
  if (record.lock.token !== lockToken) return lockMismatchResponse(record.lock);

  return undefined;
};

export const saveAdminJsonDraft = async (store: WorkflowBlobStore, body: AdminDraftRequest) => {
  const parsedInput = parseContentSourceV1(body.input);
  if (!parsedInput.success) {
    return jsonResponse(400, {
      error: 'Invalid content_source.v1 input.',
      issues: parsedInput.error.issues,
    });
  }

  if (!hasRequiredDraftFields(parsedInput.data)) {
    return jsonResponse(400, { error: draftError });
  }

  const timestamp = nowIso();

  if (body.request_id) {
    if (!body.lock_token) return missingLockTokenResponse();

    const previousRecord = await loadRecord(store, body.request_id);
    if (!previousRecord) return notFoundResponse();

    const lockFailure = validateActiveLock(previousRecord, body.lock_token);
    if (lockFailure) return lockFailure;

    const nextRecord: WorkflowRecord = {
      ...previousRecord,
      updated_at: timestamp,
      workflow_status: draftWorkflowStatuses.has(previousRecord.workflow_status)
        ? previousRecord.workflow_status
        : 'in_progress',
      input: withDraftPublication(parsedInput.data, previousRecord.input),
      lock: previousRecord.lock,
      history: [
        ...previousRecord.history,
        {
          at: timestamp,
          action: 'admin_save_draft',
          details: {
            checked_in: false,
            owner_id: previousRecord.lock?.owner_id,
            owner_label: previousRecord.lock?.owner_label,
          },
        },
      ],
      version: previousRecord.version + 1,
    };

    await saveRecord(store, nextRecord);
    await updateIndexes(store, previousRecord, nextRecord);

    return jsonResponse(200, { action: 'admin_save_draft', record: nextRecord, checked_in: false });
  }

  const requestId = `admin-draft-${randomUUID()}`;
  const draftInput = withDraftPublication(parsedInput.data);
  const record: WorkflowRecord = {
    request_id: requestId,
    created_at: timestamp,
    updated_at: timestamp,
    workflow_status: 'pending',
    current_stage: null,
    next_agent: 'reader_insight',
    completed_agents: [],
    failed_agents: [],
    last_error: null,
    needs_review: false,
    input: draftInput,
    agent_outputs: {},
    history: [{ at: timestamp, action: 'admin_save_draft', details: { created_by_admin: true } }],
    version: 1,
  };

  await saveRecord(store, record);
  await updateIndexes(store, undefined, record);

  return jsonResponse(201, { action: 'admin_save_draft', record, created: true });
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const adminState = await getAdminStateFromEvent(event);
  if (!adminState.authenticated) {
    return jsonResponse(adminState.error === 'Clerk authentication is not configured.' ? 500 : 401, {
      error: adminState.error || 'A valid Clerk session token is required.',
    });
  }

  if (!adminState.isAdmin) {
    return jsonResponse(403, { error: 'This Clerk user is not authorized to save JSON drafts.' });
  }

  const parsedJson = safeJsonParse(event);
  if (!parsedJson.ok) return jsonResponse(400, { error: 'Invalid request body.' });

  const parsedBody = requestSchema.safeParse(parsedJson.value);
  if (!parsedBody.success) {
    return jsonResponse(400, { error: 'Invalid request fields.', issues: parsedBody.error.issues });
  }

  try {
    const store = await getWorkflowBlobStore(event);

    return await saveAdminJsonDraft(store, parsedBody.data);
  } catch (error) {
    console.error('Failed to save admin JSON draft.', error);

    return jsonResponse(500, { error: 'JSON draft could not be saved.' });
  }
};
