/**
 * Function name: Save_JSON_Blob
 * Required method: POST
 * Required header: x-publish-key
 * Store name: workflows
 * Primary record key: workflows/by-id/{request_id}.json
 *
 * Supported actions and example payloads:
 * - create_request: { "action": "create_request", "request_id": "req_123", "input": { "record_type": "content_source", "schema_version": "content_source.v1", "content": { "title": "Skin barrier" } } }
 * - get_request: { "action": "get_request", "request_id": "req_123" }
 * - list_pending_requests: { "action": "list_pending_requests", "stage": "research", "status": "pending", "limit": 50 }
 * - patch_agent_output: { "action": "patch_agent_output", "request_id": "req_123", "agent_name": "research", "expected_agent_version": 0, "lock_token": "lock_123", "output": { "notes": [] } }
 * - mark_agent_complete: { "action": "mark_agent_complete", "request_id": "req_123", "agent_name": "research", "expected_record_version": 2, "lock_token": "lock_123", "next_agent": "angle", "workflow_status": "in_progress" }
 * - checkout_request: { "action": "checkout_request", "request_id": "req_123", "owner_id": "agent_1", "owner_label": "Draft agent", "lease_seconds": 900 }
 * - refresh_lock: { "action": "refresh_lock", "request_id": "req_123", "lock_token": "lock_123", "lease_seconds": 900 }
 * - checkin_request: { "action": "checkin_request", "request_id": "req_123", "lock_token": "lock_123" }
 * - force_unlock: { "action": "force_unlock", "request_id": "req_123" }
 * - mark_published: { "action": "mark_published", "request_id": "req_123", "expected_record_version": 4, "lock_token": "lock_123", "commit_metadata": { "commit": "abc123", "articlePath": "src/data/post/example.md" } }
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { getHeader } from '../lib/admin-auth.js';
import { collectBlobListItems, type BlobListResult } from '../lib/blob-list.js';
import { getWorkflowBlobStore } from '../lib/blob-store.js';
import { parseContentSourceV1, type ContentSourceV1 } from '../../src/schema/schema-v1.js';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export type AllowedAgentName = 'reader_insight' | 'research' | 'angle' | 'draft' | 'final_article';

export const allowedAgents = new Set<AllowedAgentName>([
  'reader_insight',
  'research',
  'angle',
  'draft',
  'final_article',
]);

export type WorkflowStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'published';

const allowedStatuses = new Set<WorkflowStatus>(['pending', 'in_progress', 'completed', 'failed', 'published']);

export type WorkflowRecord = {
  request_id: string;
  created_at: string;
  updated_at: string;
  workflow_status: WorkflowStatus;
  current_stage: AllowedAgentName | null;
  next_agent: AllowedAgentName | null;
  completed_agents: AllowedAgentName[];
  failed_agents: AllowedAgentName[];
  last_error: string | null;
  needs_review: boolean;
  input: ContentSourceV1;
  agent_outputs: Partial<Record<AllowedAgentName, AgentOutputRecord>>;
  lock?: WorkflowLockRecord;
  history: WorkflowHistoryEntry[];
  version: number;
};

type AgentOutputRecord = {
  version: number;
  updated_at: string;
  output: unknown;
  expected_agent_version: number;
};

type WorkflowLockRecord = {
  token: string;
  owner_id: string;
  owner_label: string;
  acquired_at: string;
  expires_at: string;
};

type WorkflowHistoryEntry = {
  at: string;
  action: WorkflowAction;
  agent_name?: AllowedAgentName;
  details?: Record<string, unknown>;
};

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
    action: z.enum([
      'create_request',
      'get_request',
      'list_pending_requests',
      'patch_agent_output',
      'mark_agent_complete',
      'checkout_request',
      'refresh_lock',
      'checkin_request',
      'force_unlock',
      'mark_published',
    ]),
    request_id: z.string().min(1).optional(),
    input: z.unknown().optional(),
    expected_record_version: z.number().int().nonnegative().optional(),
    expected_agent_version: z.number().int().nonnegative().optional(),
    agent_name: z.string().min(1).optional(),
    output: z.unknown().optional(),
    merge: z.unknown().optional(),
    stage: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    current_agent: z.string().min(1).optional(),
    current_stage: z.string().min(1).nullable().optional(),
    next_agent: z.string().min(1).nullable().optional(),
    workflow_status: z.string().min(1).optional(),
    last_error: z.string().nullable().optional(),
    needs_review: z.boolean().optional(),
    limit: z.number().int().positive().max(1000).optional(),
    lock_token: z.string().min(1).optional(),
    owner_id: z.string().min(1).optional(),
    owner_label: z.string().min(1).optional(),
    lease_seconds: z.number().int().positive().optional(),
    commit_metadata: z.record(z.string(), z.unknown()).optional(),
    commit: z.string().min(1).optional(),
    commit_sha: z.string().min(1).optional(),
    commit_url: z.string().min(1).optional(),
    article_path: z.string().min(1).optional(),
    articlePath: z.string().min(1).optional(),
    deploy_status: z.string().min(1).optional(),
    deployStatus: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
  })
  .strict();

type WorkflowRequest = z.infer<typeof requestSchema>;
type WorkflowAction = WorkflowRequest['action'];

const nowIso = () => new Date().toISOString();

const jsonResponse = (status: number, body: Record<string, unknown>) => {
  return {
    statusCode: status,
    headers: jsonHeaders,
    body: JSON.stringify({ ok: status >= 200 && status < 300, status, ...body }),
  };
};

const safeJsonParse = (event: LambdaEvent) => {
  if (!event.body) return { ok: false as const, error: 'missing_body' };

  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

    return { ok: true as const, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false as const, error: 'invalid_json' };
  }
};

const secretsMatch = (provided: string, expected: string) => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
};

const verifyPublishKey = (event: LambdaEvent, action?: WorkflowAction) => {
  const provided = getHeader(event.headers, 'x-publish-key');
  const expected = process.env.NETLIFY_PUBLISH_SECRET || process.env.PUBLISH_SECRET || '';

  if (!provided || !expected || !secretsMatch(provided, expected)) {
    return jsonResponse(401, { action, error: 'Unauthorized' });
  }

  return undefined;
};

const recordKey = (requestId: string) => `workflows/by-id/${requestId}.json`;
const stageIndexKey = (nextAgent: string, requestId: string) => `workflows/index/by-stage/${nextAgent}/${requestId}`;
const statusIndexKey = (status: string, requestId: string) => `workflows/index/by-status/${status}/${requestId}`;
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_LOCK_LEASE_SECONDS = 15 * 60;
const CHECKOUT_NOT_FOUND_MAX_RETRIES = 3;
const CHECKOUT_NOT_FOUND_RETRY_DELAY_MS = 50;
const CHECKOUT_NOT_FOUND_MAX_ATTEMPTS = CHECKOUT_NOT_FOUND_MAX_RETRIES + 1;
const MARK_COMPLETE_STALE_READ_MAX_RETRIES = 3;
const MARK_COMPLETE_STALE_READ_RETRY_DELAY_MS = 25;
const CHECKIN_STALE_READ_RETRY_DELAY_MS = 25;
const GET_REQUEST_STALE_READ_RETRY_DELAY_MS = 25;
const WORKFLOW_MUTATION_MAX_RETRIES = 3;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object');

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const valuesEqual = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right);

const parseAgentName = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string' || !allowedAgents.has(value as AllowedAgentName)) return undefined;

  return value as AllowedAgentName;
};

const parseOptionalAgentName = (value: unknown, fieldName: string) => {
  if (value === null) return { ok: true as const, value: null };
  if (value === undefined) return { ok: true as const, value: undefined };

  const agentName = parseAgentName(value);
  if (!agentName) return { ok: false as const, error: `Invalid ${fieldName}.` };

  return { ok: true as const, value: agentName };
};

const parseRequiredAgentName = (value: unknown) => {
  const agentName = parseAgentName(value);
  if (!agentName) return undefined;

  return agentName;
};

const parseWorkflowStatus = (value: unknown) => {
  if (typeof value !== 'string' || !allowedStatuses.has(value as WorkflowStatus)) return undefined;

  return value as WorkflowStatus;
};

const parseOptionalWorkflowStatus = (value: unknown) => {
  if (value === undefined) return { ok: true as const, value: undefined };

  const status = parseWorkflowStatus(value);
  if (!status) return { ok: false as const, error: 'Invalid workflow_status.' };

  return { ok: true as const, value: status };
};

const requireStringField = (body: WorkflowRequest, fieldName: 'lock_token' | 'owner_id' | 'owner_label') => {
  const value = body[fieldName];
  if (!value) return jsonResponse(400, { action: body.action, error: `${fieldName} is required.` });

  return undefined;
};

const getLeaseSeconds = (body: WorkflowRequest) => body.lease_seconds ?? DEFAULT_LOCK_LEASE_SECONDS;

const addSecondsIso = (fromMs: number, seconds: number) => new Date(fromMs + seconds * 1000).toISOString();

const getLockExpirationMs = (lock: WorkflowLockRecord) => {
  const expiresAtMs = Date.parse(lock.expires_at);

  return Number.isFinite(expiresAtMs) ? expiresAtMs : 0;
};

const getLockTimestampDiagnostics = (lock: WorkflowLockRecord, nowMs: number) => {
  const expiresAtMs = getLockExpirationMs(lock);
  const acquiredAtMs = Date.parse(lock.acquired_at);
  const finiteExpiresAtMs = Number.isFinite(expiresAtMs) && expiresAtMs > 0;
  const finiteAcquiredAtMs = Number.isFinite(acquiredAtMs);

  return {
    nowISO: new Date(nowMs).toISOString(),
    acquiredAtISO: finiteAcquiredAtMs ? new Date(acquiredAtMs).toISOString() : lock.acquired_at,
    expiresAtISO: finiteExpiresAtMs ? new Date(expiresAtMs).toISOString() : lock.expires_at,
    deltaMs: finiteExpiresAtMs ? expiresAtMs - nowMs : null,
  };
};

const isLockActive = (lock: WorkflowLockRecord | undefined, nowMs: number) =>
  Boolean(lock && getLockExpirationMs(lock) > nowMs);

const lockExpiredResponse = (body: WorkflowRequest, lock?: WorkflowLockRecord, nowMs = Date.now()) =>
  jsonResponse(423, {
    action: body.action,
    error: 'lock_expired',
    lock_expired: true,
    ...(lock ? { diagnostics: getLockTimestampDiagnostics(lock, nowMs) } : {}),
  });

const validateMutationLock = (record: WorkflowRecord, body: WorkflowRequest) => {
  const nowMs = Date.now();

  if (!body.lock_token || !record.lock) return lockExpiredResponse(body, record.lock, nowMs);
  if (record.lock.token !== body.lock_token) return lockExpiredResponse(body, record.lock, nowMs);
  if (!isLockActive(record.lock, nowMs)) return lockExpiredResponse(body, record.lock, nowMs);

  return undefined;
};

const commitMetadataFields = [
  'commit',
  'commit_sha',
  'commit_url',
  'article_path',
  'articlePath',
  'deploy_status',
  'deployStatus',
  'message',
] as const;

const getCommitMetadata = (body: WorkflowRequest) => {
  const metadata: Record<string, unknown> = { ...(body.commit_metadata ?? {}) };

  for (const field of commitMetadataFields) {
    if (body[field] !== undefined) metadata[field] = body[field];
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

const loadRecord = async (store: WorkflowBlobStore, requestId: string) => {
  const value = await store.get(recordKey(requestId));

  if (!value) return undefined;

  return JSON.parse(value) as WorkflowRecord;
};

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const checkoutDiagnostics = (requestId: string, attempts: number) => ({
  request_id: requestId,
  attempts,
  max_retries: CHECKOUT_NOT_FOUND_MAX_RETRIES,
  max_attempts: CHECKOUT_NOT_FOUND_MAX_ATTEMPTS,
});

const loadRecordForCheckout = async (store: WorkflowBlobStore, requestId: string) => {
  for (let retryIndex = 0; retryIndex <= CHECKOUT_NOT_FOUND_MAX_RETRIES; retryIndex += 1) {
    const attempt = retryIndex + 1;
    const record = await loadRecord(store, requestId);

    if (record) return { record, attempts: attempt };

    if (retryIndex < CHECKOUT_NOT_FOUND_MAX_RETRIES) {
      console.warn('checkout_request record fetch returned 404; retrying.', {
        ...checkoutDiagnostics(requestId, attempt),
        next_attempt: attempt + 1,
      });
      await delay(CHECKOUT_NOT_FOUND_RETRY_DELAY_MS);
    }
  }

  console.warn('checkout_request record fetch returned 404 after retries exhausted.', {
    ...checkoutDiagnostics(requestId, CHECKOUT_NOT_FOUND_MAX_ATTEMPTS),
  });

  return { record: undefined, attempts: CHECKOUT_NOT_FOUND_MAX_ATTEMPTS };
};

const saveRecord = async (store: WorkflowBlobStore, record: WorkflowRecord) => {
  await store.setJSON(recordKey(record.request_id), record);
};

const saveRecordIfVersionUnchanged = async (
  store: WorkflowBlobStore,
  expectedRecord: WorkflowRecord,
  nextRecord: WorkflowRecord
) => {
  const latestRecord = await loadRecord(store, expectedRecord.request_id);

  if (!latestRecord) return { saved: false as const, notFound: true as const };
  if (latestRecord.version !== expectedRecord.version) return { saved: false as const, latestRecord };

  await saveRecord(store, nextRecord);
  await updateIndexes(store, latestRecord, nextRecord);

  return { saved: true as const };
};

const hasHistoryAction = (record: WorkflowRecord, action: WorkflowAction) => {
  return record.history.some((entry) => entry.action === action);
};

const isPreferredCheckinCandidate = (candidate: WorkflowRecord, current: WorkflowRecord) => {
  if (candidate.version !== current.version) return candidate.version > current.version;
  if (!hasHistoryAction(current, 'mark_published') && hasHistoryAction(candidate, 'mark_published')) return true;

  return candidate.history.length > current.history.length;
};

const loadLatestRecordForCheckin = async (store: WorkflowBlobStore, requestId: string) => {
  let latestRecord: WorkflowRecord | undefined;

  for (let attempt = 0; attempt < WORKFLOW_MUTATION_MAX_RETRIES; attempt += 1) {
    const candidate = await loadRecord(store, requestId);

    if (candidate && (!latestRecord || isPreferredCheckinCandidate(candidate, latestRecord))) {
      latestRecord = candidate;
    }

    if (attempt < WORKFLOW_MUTATION_MAX_RETRIES - 1) {
      await delay(CHECKIN_STALE_READ_RETRY_DELAY_MS);
    }
  }

  return latestRecord;
};

const loadLatestRecordForGetRequest = async (store: WorkflowBlobStore, requestId: string) => {
  let latestRecord: WorkflowRecord | undefined;

  for (let attempt = 0; attempt < WORKFLOW_MUTATION_MAX_RETRIES; attempt += 1) {
    const candidate = await loadRecord(store, requestId);

    if (candidate && (!latestRecord || isPreferredCheckinCandidate(candidate, latestRecord))) {
      latestRecord = candidate;
    }

    if (attempt < WORKFLOW_MUTATION_MAX_RETRIES - 1) {
      await delay(GET_REQUEST_STALE_READ_RETRY_DELAY_MS);
    }
  }

  return latestRecord;
};

const saveCheckinIfLatestRecordUnchanged = async (
  store: WorkflowBlobStore,
  expectedRecord: WorkflowRecord,
  nextRecord: WorkflowRecord
) => {
  const latestRecord = await loadLatestRecordForCheckin(store, expectedRecord.request_id);

  if (!latestRecord) return { saved: false as const, notFound: true as const };
  if (latestRecord.version !== expectedRecord.version) return { saved: false as const, latestRecord };

  await saveRecord(store, nextRecord);
  await updateIndexes(store, latestRecord, nextRecord);

  return { saved: true as const };
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

const listIndexRequestIds = async (store: WorkflowBlobStore, prefix: string) => {
  if (typeof store.list !== 'function') {
    throw new Error('Workflow blob store does not support listing index keys.');
  }

  const result = await store.list({ prefix, directories: false, paginate: true });
  const blobs = await collectBlobListItems(result);

  return new Set(blobs.map((blob) => blob.key.slice(prefix.length)).filter(Boolean));
};

const validateBodyFields = (body: WorkflowRequest) => {
  if (body.agent_name !== undefined && !parseRequiredAgentName(body.agent_name)) {
    return jsonResponse(400, { action: body.action, error: 'Invalid agent_name.' });
  }

  if (body.stage !== undefined && !parseRequiredAgentName(body.stage)) {
    return jsonResponse(400, { action: body.action, error: 'Invalid stage.' });
  }

  if (body.status !== undefined && !parseWorkflowStatus(body.status)) {
    return jsonResponse(400, { action: body.action, error: 'Invalid status.' });
  }

  const currentStage = parseOptionalAgentName(body.current_stage, 'current_stage');
  if (!currentStage.ok) return jsonResponse(400, { action: body.action, error: currentStage.error });

  const nextAgent = parseOptionalAgentName(body.next_agent, 'next_agent');
  if (!nextAgent.ok) return jsonResponse(400, { action: body.action, error: nextAgent.error });

  const workflowStatus = parseOptionalWorkflowStatus(body.workflow_status);
  if (!workflowStatus.ok) return jsonResponse(400, { action: body.action, error: workflowStatus.error });

  return undefined;
};

const requireRequestId = (body: WorkflowRequest) => {
  if (!body.request_id) return jsonResponse(400, { action: body.action, error: 'request_id is required.' });

  return undefined;
};

export const createRequest = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;

  const parsedInput = parseContentSourceV1(body.input);
  if (!parsedInput.success) {
    return jsonResponse(400, {
      action: body.action,
      error: 'Invalid content_source.v1 input.',
      issues: parsedInput.error.issues,
    });
  }

  const existingRecord = await loadRecord(store, body.request_id as string);

  if (existingRecord) {
    if (valuesEqual(existingRecord.input, parsedInput.data)) {
      return jsonResponse(200, { action: body.action, record: existingRecord, idempotent: true });
    }

    return jsonResponse(409, { action: body.action, conflict: true, error: 'A workflow record already exists.' });
  }

  const currentAgent = parseOptionalAgentName(
    body.current_agent ?? body.current_stage ?? parsedInput.data.workflow?.current_agent,
    'current_agent'
  );
  if (!currentAgent.ok) return jsonResponse(400, { action: body.action, error: currentAgent.error });

  const nextAgent = parseOptionalAgentName(
    body.next_agent !== undefined ? body.next_agent : parsedInput.data.workflow?.next_agent,
    'next_agent'
  );
  if (!nextAgent.ok) return jsonResponse(400, { action: body.action, error: nextAgent.error });

  const timestamp = nowIso();
  const record: WorkflowRecord = {
    request_id: body.request_id as string,
    created_at: timestamp,
    updated_at: timestamp,
    workflow_status: 'pending',
    current_stage: currentAgent.value ?? null,
    next_agent: nextAgent.value !== undefined ? nextAgent.value : 'reader_insight',
    completed_agents: [],
    failed_agents: [],
    last_error: null,
    needs_review: false,
    input: parsedInput.data,
    agent_outputs: {},
    history: [{ at: timestamp, action: body.action }],
    version: 1,
  };

  await saveRecord(store, record);
  await updateIndexes(store, undefined, record);

  return jsonResponse(201, { action: body.action, record });
};

export const getRequest = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;

  const record = await loadLatestRecordForGetRequest(store, body.request_id as string);

  if (!record) return jsonResponse(404, { action: body.action, not_found: true });

  return jsonResponse(200, { action: body.action, record });
};

const listPendingRequests = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const status = body.status === undefined ? 'pending' : parseWorkflowStatus(body.status);
  if (!status) return jsonResponse(400, { action: body.action, error: 'Invalid status.' });

  const stageValue = body.stage ?? body.agent_name;
  const stage = stageValue === undefined ? undefined : parseRequiredAgentName(stageValue);
  if (stageValue !== undefined && !stage) return jsonResponse(400, { action: body.action, error: 'Invalid stage.' });

  const limit = body.limit ?? DEFAULT_LIST_LIMIT;
  const statusIds = await listIndexRequestIds(store, `workflows/index/by-status/${status}/`);
  const stageIds = stage ? await listIndexRequestIds(store, `workflows/index/by-stage/${stage}/`) : undefined;
  const requestIds = [...statusIds].filter((requestId) => !stageIds || stageIds.has(requestId));
  const records = await Promise.all(requestIds.map((requestId) => loadRecord(store, requestId)));
  const summaries = records
    .filter((record): record is WorkflowRecord => Boolean(record))
    .filter((record) => record.workflow_status === status && (!stage || record.next_agent === stage))
    .map((record) => ({
      request_id: record.request_id,
      workflow_status: record.workflow_status,
      next_agent: record.next_agent,
      updated_at: record.updated_at,
    }))
    .sort(
      (left, right) =>
        right.updated_at.localeCompare(left.updated_at) || right.request_id.localeCompare(left.request_id)
    )
    .slice(0, limit);

  return jsonResponse(200, { action: body.action, records: summaries });
};

export const patchAgentOutput = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;
  if (body.expected_agent_version === undefined) {
    return jsonResponse(400, { action: body.action, error: 'expected_agent_version is required.' });
  }

  const agentName = parseRequiredAgentName(body.agent_name);
  if (!agentName) return jsonResponse(400, { action: body.action, error: 'Invalid agent_name.' });

  const previousRecord = await loadRecord(store, body.request_id as string);
  if (!previousRecord) return jsonResponse(404, { action: body.action, not_found: true });

  const lockFailure = validateMutationLock(previousRecord, body);
  if (lockFailure) return lockFailure;

  const existingOutput = previousRecord.agent_outputs[agentName];
  const existingVersion = existingOutput?.version ?? 0;

  if (existingVersion !== body.expected_agent_version) {
    if (
      existingOutput?.expected_agent_version === body.expected_agent_version &&
      valuesEqual(existingOutput.output, body.output)
    ) {
      return jsonResponse(200, { action: body.action, record: previousRecord, idempotent: true });
    }

    return jsonResponse(409, { action: body.action, conflict: true });
  }

  const timestamp = nowIso();
  const nextRecord: WorkflowRecord = {
    ...previousRecord,
    updated_at: timestamp,
    agent_outputs: {
      ...previousRecord.agent_outputs,
      [agentName]: {
        version: existingVersion + 1,
        updated_at: timestamp,
        output: body.output,
        expected_agent_version: body.expected_agent_version,
      },
    },
    history: [
      ...previousRecord.history,
      {
        at: timestamp,
        action: body.action,
        agent_name: agentName,
        details: { agent_output_version: existingVersion + 1 },
      },
    ],
    version: previousRecord.version + 1,
  };

  await saveRecord(store, nextRecord);
  await updateIndexes(store, previousRecord, nextRecord);

  return jsonResponse(200, { action: body.action, record: nextRecord });
};

const completionAlreadyReflected = (record: WorkflowRecord, agentName: AllowedAgentName, body: WorkflowRequest) => {
  if (!record.completed_agents.includes(agentName)) return false;
  if (record.failed_agents.includes(agentName)) return false;

  const currentStage = parseOptionalAgentName(body.current_stage, 'current_stage');
  const nextAgent = parseOptionalAgentName(body.next_agent, 'next_agent');
  const workflowStatus = parseOptionalWorkflowStatus(body.workflow_status);

  if (!currentStage.ok || !nextAgent.ok || !workflowStatus.ok) return false;
  if (currentStage.value !== undefined && record.current_stage !== currentStage.value) return false;
  if (nextAgent.value !== undefined && record.next_agent !== nextAgent.value) return false;
  if (workflowStatus.value !== undefined && record.workflow_status !== workflowStatus.value) return false;
  if (body.needs_review !== undefined && record.needs_review !== body.needs_review) return false;
  if (body.last_error !== undefined && record.last_error !== body.last_error) return false;

  return true;
};

const loadRecordAtExpectedVersion = async (
  store: WorkflowBlobStore,
  body: WorkflowRequest,
  previousRecord: WorkflowRecord
) => {
  let latestRecord = previousRecord;

  for (let retryIndex = 0; retryIndex < MARK_COMPLETE_STALE_READ_MAX_RETRIES; retryIndex += 1) {
    await delay(MARK_COMPLETE_STALE_READ_RETRY_DELAY_MS);

    const retryRecord = await loadRecord(store, body.request_id as string);
    if (!retryRecord) return { notFound: true as const };

    latestRecord = retryRecord;
    if (latestRecord.version >= (body.expected_record_version as number)) break;
  }

  return { record: latestRecord };
};

export const markAgentComplete = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;
  if (body.expected_record_version === undefined) {
    return jsonResponse(400, { action: body.action, error: 'expected_record_version is required.' });
  }

  const agentName = parseRequiredAgentName(body.agent_name);
  if (!agentName) return jsonResponse(400, { action: body.action, error: 'Invalid agent_name.' });

  const currentStage = parseOptionalAgentName(body.current_stage, 'current_stage');
  if (!currentStage.ok) return jsonResponse(400, { action: body.action, error: currentStage.error });

  const nextAgent = parseOptionalAgentName(body.next_agent, 'next_agent');
  if (!nextAgent.ok) return jsonResponse(400, { action: body.action, error: nextAgent.error });

  const workflowStatus = parseOptionalWorkflowStatus(body.workflow_status);
  if (!workflowStatus.ok) return jsonResponse(400, { action: body.action, error: workflowStatus.error });

  let previousRecord = await loadRecord(store, body.request_id as string);
  if (!previousRecord) return jsonResponse(404, { action: body.action, not_found: true });

  let lockFailure = validateMutationLock(previousRecord, body);
  if (lockFailure) return lockFailure;

  if (previousRecord.version !== body.expected_record_version) {
    if (completionAlreadyReflected(previousRecord, agentName, body)) {
      return jsonResponse(200, { action: body.action, record: previousRecord, idempotent: true });
    }

    if (previousRecord.version < body.expected_record_version) {
      const stabilizedRead = await loadRecordAtExpectedVersion(store, body, previousRecord);
      if ('notFound' in stabilizedRead) return jsonResponse(404, { action: body.action, not_found: true });

      previousRecord = stabilizedRead.record;
      lockFailure = validateMutationLock(previousRecord, body);
      if (lockFailure) return lockFailure;

      if (completionAlreadyReflected(previousRecord, agentName, body)) {
        return jsonResponse(200, { action: body.action, record: previousRecord, idempotent: true });
      }
    }

    if (previousRecord.version !== body.expected_record_version) {
      return jsonResponse(409, { action: body.action, conflict: true });
    }
  }

  const timestamp = nowIso();
  const completedAgents = previousRecord.completed_agents.includes(agentName)
    ? previousRecord.completed_agents
    : [...previousRecord.completed_agents, agentName];
  const failedAgents = previousRecord.failed_agents.filter((failedAgent) => failedAgent !== agentName);
  const nextRecord: WorkflowRecord = {
    ...previousRecord,
    updated_at: timestamp,
    current_stage: currentStage.value !== undefined ? currentStage.value : previousRecord.current_stage,
    next_agent: nextAgent.value !== undefined ? nextAgent.value : previousRecord.next_agent,
    workflow_status: workflowStatus.value ?? previousRecord.workflow_status,
    completed_agents: completedAgents,
    failed_agents: failedAgents,
    last_error: body.last_error !== undefined ? body.last_error : previousRecord.last_error,
    needs_review: body.needs_review ?? previousRecord.needs_review,
    history: [...previousRecord.history, { at: timestamp, action: body.action, agent_name: agentName }],
    version: previousRecord.version + 1,
  };

  await saveRecord(store, nextRecord);
  await updateIndexes(store, previousRecord, nextRecord);

  return jsonResponse(200, { action: body.action, record: nextRecord });
};

export const checkoutRequest = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;

  const missingOwnerId = requireStringField(body, 'owner_id');
  if (missingOwnerId) return missingOwnerId;

  const missingOwnerLabel = requireStringField(body, 'owner_label');
  if (missingOwnerLabel) return missingOwnerLabel;

  const requestId = body.request_id as string;
  const checkoutLoad = await loadRecordForCheckout(store, requestId);
  const previousRecord = checkoutLoad.record;
  const diagnostics = checkoutDiagnostics(requestId, checkoutLoad.attempts);

  if (!previousRecord) {
    return jsonResponse(404, { action: body.action, not_found: true, diagnostics });
  }

  const timestampMs = Date.now();
  const timestamp = new Date(timestampMs).toISOString();
  if (isLockActive(previousRecord.lock, timestampMs)) {
    return jsonResponse(423, { action: body.action, locked: true, lock: previousRecord.lock, diagnostics });
  }

  const nextRecord: WorkflowRecord = {
    ...previousRecord,
    updated_at: timestamp,
    lock: {
      token: randomUUID(),
      owner_id: body.owner_id as string,
      owner_label: body.owner_label as string,
      acquired_at: timestamp,
      expires_at: addSecondsIso(timestampMs, getLeaseSeconds(body)),
    },
    history: [
      ...previousRecord.history,
      {
        at: timestamp,
        action: body.action,
        details: {
          owner_id: body.owner_id,
          owner_label: body.owner_label,
          lease_seconds: getLeaseSeconds(body),
          replaced_expired_lock: Boolean(previousRecord.lock),
        },
      },
    ],
    version: previousRecord.version + 1,
  };

  await saveRecord(store, nextRecord);
  await updateIndexes(store, previousRecord, nextRecord);

  return jsonResponse(200, {
    action: body.action,
    record: nextRecord,
    diagnostics,
  });
};

const refreshLock = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;

  const missingLockToken = requireStringField(body, 'lock_token');
  if (missingLockToken) return missingLockToken;

  const previousRecord = await loadRecord(store, body.request_id as string);
  if (!previousRecord) return jsonResponse(404, { action: body.action, not_found: true });
  if (!previousRecord.lock) return jsonResponse(409, { action: body.action, error: 'No lock is currently held.' });
  if (previousRecord.lock.token !== body.lock_token) {
    return jsonResponse(423, { action: body.action, locked: true, lock: previousRecord.lock });
  }

  const timestampMs = Date.now();
  const timestamp = new Date(timestampMs).toISOString();
  if (!isLockActive(previousRecord.lock, timestampMs)) {
    return jsonResponse(409, {
      action: body.action,
      error: 'Lock has expired.',
      lock: previousRecord.lock,
      diagnostics: getLockTimestampDiagnostics(previousRecord.lock, timestampMs),
    });
  }

  const leaseSeconds = getLeaseSeconds(body);
  const nextRecord: WorkflowRecord = {
    ...previousRecord,
    updated_at: timestamp,
    lock: {
      ...previousRecord.lock,
      expires_at: addSecondsIso(getLockExpirationMs(previousRecord.lock), leaseSeconds),
    },
    history: [
      ...previousRecord.history,
      {
        at: timestamp,
        action: body.action,
        details: {
          owner_id: previousRecord.lock.owner_id,
          owner_label: previousRecord.lock.owner_label,
          lease_seconds: leaseSeconds,
        },
      },
    ],
    version: previousRecord.version + 1,
  };

  await saveRecord(store, nextRecord);
  await updateIndexes(store, previousRecord, nextRecord);

  return jsonResponse(200, { action: body.action, record: nextRecord });
};

export const checkinRequest = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;

  const missingLockToken = requireStringField(body, 'lock_token');
  if (missingLockToken) return missingLockToken;

  for (let attempt = 0; attempt < WORKFLOW_MUTATION_MAX_RETRIES; attempt += 1) {
    const latestRecord = await loadLatestRecordForCheckin(store, body.request_id as string);
    if (!latestRecord) return jsonResponse(404, { action: body.action, not_found: true });

    if (!latestRecord.lock) return jsonResponse(200, { action: body.action, record: latestRecord, idempotent: true });

    if (latestRecord.lock.token !== body.lock_token) {
      return jsonResponse(423, { action: body.action, locked: true, lock: latestRecord.lock });
    }

    const timestamp = nowIso();
    const nextRecord: WorkflowRecord = {
      ...latestRecord,
      updated_at: timestamp,
      lock: undefined,
      history: [
        ...latestRecord.history,
        {
          at: timestamp,
          action: body.action,
          details: {
            owner_id: latestRecord.lock.owner_id,
            owner_label: latestRecord.lock.owner_label,
          },
        },
      ],
      version: latestRecord.version + 1,
    };

    const saveResult = await saveCheckinIfLatestRecordUnchanged(store, latestRecord, nextRecord);

    if (saveResult.saved) return jsonResponse(200, { action: body.action, record: nextRecord });
    if (saveResult.notFound) return jsonResponse(404, { action: body.action, not_found: true });
  }

  return jsonResponse(409, { action: body.action, conflict: true });
};

const forceUnlock = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;

  const previousRecord = await loadRecord(store, body.request_id as string);
  if (!previousRecord) return jsonResponse(404, { action: body.action, not_found: true });

  if (!previousRecord.lock) return jsonResponse(200, { action: body.action, record: previousRecord, idempotent: true });

  const timestamp = nowIso();
  const nextRecord: WorkflowRecord = {
    ...previousRecord,
    updated_at: timestamp,
    lock: undefined,
    history: [
      ...previousRecord.history,
      {
        at: timestamp,
        action: body.action,
        details: {
          owner_id: previousRecord.lock.owner_id,
          owner_label: previousRecord.lock.owner_label,
          forced: true,
        },
      },
    ],
    version: previousRecord.version + 1,
  };

  await saveRecord(store, nextRecord);
  await updateIndexes(store, previousRecord, nextRecord);

  return jsonResponse(200, { action: body.action, record: nextRecord });
};

const getPublishPreconditionFailure = (record: WorkflowRecord) => {
  if (record.workflow_status !== 'completed') return 'Workflow must be completed before publishing.';
  if (!record.completed_agents.includes('final_article')) return 'final_article must be completed before publishing.';
  if (!record.agent_outputs.final_article) return 'final_article output must be present before publishing.';
  if (record.current_stage !== null) return 'current_stage must be null before publishing the completed final article.';

  return undefined;
};

export const markPublished = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;

  for (let attempt = 0; attempt < WORKFLOW_MUTATION_MAX_RETRIES; attempt += 1) {
    let latestRecord = await loadRecord(store, body.request_id as string);
    if (!latestRecord) return jsonResponse(404, { action: body.action, not_found: true });

    if (
      body.expected_record_version !== undefined &&
      latestRecord.version < body.expected_record_version &&
      latestRecord.workflow_status !== 'published'
    ) {
      const stabilizedRead = await loadRecordAtExpectedVersion(store, body, latestRecord);
      if ('notFound' in stabilizedRead) return jsonResponse(404, { action: body.action, not_found: true });

      latestRecord = stabilizedRead.record;
    }

    const lockFailure = validateMutationLock(latestRecord, body);
    if (lockFailure) return lockFailure;

    if (latestRecord.workflow_status === 'published') {
      return jsonResponse(200, { action: body.action, record: latestRecord, idempotent: true });
    }

    if (body.expected_record_version !== undefined && latestRecord.version < body.expected_record_version) {
      return jsonResponse(409, { action: body.action, conflict: true });
    }

    const preconditionFailure = getPublishPreconditionFailure(latestRecord);
    if (preconditionFailure) {
      return jsonResponse(409, { action: body.action, conflict: true, error: preconditionFailure });
    }

    const timestamp = nowIso();
    const commitMetadata = getCommitMetadata(body);
    const nextRecord: WorkflowRecord = {
      ...latestRecord,
      updated_at: timestamp,
      workflow_status: 'published',
      history: [
        ...latestRecord.history,
        {
          at: timestamp,
          action: body.action,
          details: {
            owner_id: latestRecord.lock?.owner_id,
            owner_label: latestRecord.lock?.owner_label,
            ...(commitMetadata ? { commit_metadata: commitMetadata } : {}),
          },
        },
      ],
      version: latestRecord.version + 1,
    };

    const saveResult = await saveRecordIfVersionUnchanged(store, latestRecord, nextRecord);

    if (saveResult.saved) return jsonResponse(200, { action: body.action, record: nextRecord });
    if (saveResult.notFound) return jsonResponse(404, { action: body.action, not_found: true });
  }

  return jsonResponse(409, { action: body.action, conflict: true });
};

const handleAction = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  switch (body.action) {
    case 'create_request':
      return createRequest(store, body);
    case 'get_request':
      return getRequest(store, body);
    case 'list_pending_requests':
      return listPendingRequests(store, body);
    case 'patch_agent_output':
      return patchAgentOutput(store, body);
    case 'mark_agent_complete':
      return markAgentComplete(store, body);
    case 'checkout_request':
      return checkoutRequest(store, body);
    case 'refresh_lock':
      return refreshLock(store, body);
    case 'checkin_request':
      return checkinRequest(store, body);
    case 'force_unlock':
      return forceUnlock(store, body);
    case 'mark_published':
      return markPublished(store, body);
  }
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const parsedJson = safeJsonParse(event);
  if (!parsedJson.ok) return jsonResponse(400, { error: 'Invalid request body.' });

  const parsedBody = requestSchema.safeParse(parsedJson.value);
  if (!parsedBody.success) {
    return jsonResponse(400, { error: 'Invalid request fields.', issues: parsedBody.error.issues });
  }

  const authFailure = verifyPublishKey(event, parsedBody.data.action);
  if (authFailure) return authFailure;

  const fieldFailure = validateBodyFields(parsedBody.data);
  if (fieldFailure) return fieldFailure;

  try {
    const store = await getWorkflowBlobStore(event);

    return await handleAction(store, parsedBody.data);
  } catch (error) {
    console.error('Failed to save workflow JSON blob.', error);

    return jsonResponse(500, { action: parsedBody.data.action, error: 'Workflow request could not be processed.' });
  }
};
