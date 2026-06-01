/**
 * Function name: Save_JSON_Blob
 * Required method: POST
 * Required header: x-publish-key
 * Store name: workflows
 * Primary record key: workflows/by-id/{request_id}.json
 *
 * Supported actions and example payloads:
 * - create_request: { "action": "create_request", "request_id": "req_123", "input": { "topic": "Skin barrier" } }
 * - get_request: { "action": "get_request", "request_id": "req_123" }
 * - list_pending_requests: { "action": "list_pending_requests", "stage": "research", "status": "pending", "limit": 50 }
 * - patch_agent_output: { "action": "patch_agent_output", "request_id": "req_123", "agent_name": "research", "expected_agent_version": 0, "output": { "notes": [] } }
 * - mark_agent_complete: { "action": "mark_agent_complete", "request_id": "req_123", "agent_name": "research", "expected_record_version": 2, "next_agent": "angle", "workflow_status": "in_progress" }
 */
import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { getHeader } from '../lib/admin-auth.js';
import { getWorkflowBlobStore } from '../lib/blob-store.js';

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

export type WorkflowStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

const allowedStatuses = new Set<WorkflowStatus>(['pending', 'in_progress', 'completed', 'failed']);

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
  input: unknown;
  agent_outputs: Partial<Record<AllowedAgentName, AgentOutputRecord>>;
  history: WorkflowHistoryEntry[];
  version: number;
};

type AgentOutputRecord = {
  version: number;
  updated_at: string;
  output: unknown;
  expected_agent_version: number;
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

type BlobListResult = {
  blobs: Array<{ key: string }>;
  directories?: string[];
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
    current_stage: z.string().min(1).nullable().optional(),
    next_agent: z.string().min(1).nullable().optional(),
    workflow_status: z.string().min(1).optional(),
    last_error: z.string().nullable().optional(),
    needs_review: z.boolean().optional(),
    limit: z.number().int().positive().max(1000).optional(),
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

const listIndexRequestIds = async (store: WorkflowBlobStore, prefix: string) => {
  if (typeof store.list !== 'function') {
    throw new Error('Workflow blob store does not support listing index keys.');
  }

  const result = await store.list({ prefix, directories: false, paginate: true });
  const blobs: Array<{ key: string }> = [];

  if (Symbol.asyncIterator in Object(result)) {
    for await (const page of result as unknown as AsyncIterable<BlobListResult>) {
      blobs.push(...page.blobs);
    }
  } else {
    blobs.push(...(result as BlobListResult).blobs);
  }

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

const createRequest = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;

  const existingRecord = await loadRecord(store, body.request_id as string);

  if (existingRecord) {
    if (valuesEqual(existingRecord.input, body.input)) {
      return jsonResponse(200, { action: body.action, record: existingRecord, idempotent: true });
    }

    return jsonResponse(409, { action: body.action, conflict: true, error: 'A workflow record already exists.' });
  }

  const timestamp = nowIso();
  const record: WorkflowRecord = {
    request_id: body.request_id as string,
    created_at: timestamp,
    updated_at: timestamp,
    workflow_status: 'pending',
    current_stage: null,
    next_agent: 'reader_insight',
    completed_agents: [],
    failed_agents: [],
    last_error: null,
    needs_review: false,
    input: body.input,
    agent_outputs: {},
    history: [{ at: timestamp, action: body.action }],
    version: 1,
  };

  await saveRecord(store, record);
  await updateIndexes(store, undefined, record);

  return jsonResponse(201, { action: body.action, record });
};

const getRequest = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;

  const record = await loadRecord(store, body.request_id as string);

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

const patchAgentOutput = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
  const missingRequestId = requireRequestId(body);
  if (missingRequestId) return missingRequestId;
  if (body.expected_agent_version === undefined) {
    return jsonResponse(400, { action: body.action, error: 'expected_agent_version is required.' });
  }

  const agentName = parseRequiredAgentName(body.agent_name);
  if (!agentName) return jsonResponse(400, { action: body.action, error: 'Invalid agent_name.' });

  const previousRecord = await loadRecord(store, body.request_id as string);
  if (!previousRecord) return jsonResponse(404, { action: body.action, not_found: true });

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

const markAgentComplete = async (store: WorkflowBlobStore, body: WorkflowRequest) => {
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

  const previousRecord = await loadRecord(store, body.request_id as string);
  if (!previousRecord) return jsonResponse(404, { action: body.action, not_found: true });

  if (previousRecord.version !== body.expected_record_version) {
    if (completionAlreadyReflected(previousRecord, agentName, body)) {
      return jsonResponse(200, { action: body.action, record: previousRecord, idempotent: true });
    }

    return jsonResponse(409, { action: body.action, conflict: true });
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
