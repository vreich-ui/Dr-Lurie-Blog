import { randomUUID } from 'node:crypto';

import { handler as saveJsonBlobHandler } from './save-json-blob.js';

type LambdaEvent = {
  blobs?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const SERVER_NAME = 'Dr_Lurie_MCP_Server';
const SERVER_DIAGNOSTIC_NAME = 'Dr_Lurie_Science_MCP';
const PROTOCOL_VERSION = '2025-06-18';
const ALLOWED_AGENTS = ['reader_insight', 'research', 'angle', 'draft', 'final_article'] as const;
const ALLOWED_AGENT_SET = new Set<string>(ALLOWED_AGENTS);

const jsonHeaders = {
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'mcp-session-id',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

const textContent = (text: string) => [{ type: 'text', text }];

const toolResult = (payload: Record<string, unknown>) => ({
  content: textContent(JSON.stringify(payload, null, 2)),
  structuredContent: payload,
});

const toolError = (message: string) => ({
  isError: true,
  content: textContent(message),
});

const agentList = () => ALLOWED_AGENTS.join('|');

const normalizeAgentName = (value: unknown, fieldName: string) => {
  if (value === null || value === undefined) return value;

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be one of ${agentList()}.`);
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (!ALLOWED_AGENT_SET.has(normalized)) {
    throw new Error(`${fieldName} must be one of ${agentList()}.`);
  }

  return normalized;
};

const normalizeOptionalAgentName = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null) return value;

  return normalizeAgentName(value, fieldName);
};

const createRequestId = () => `req_${randomUUID()}`;

const stringSchema = (description?: string) => ({
  type: 'string',
  minLength: 1,
  ...(description ? { description } : {}),
});
const intSchema = (description?: string) => ({ type: 'integer', minimum: 0, ...(description ? { description } : {}) });
const nullableStringSchema = (description?: string) => ({
  anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
  ...(description ? { description } : {}),
});

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
  description?: string
): Record<string, unknown> => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required,
  additionalProperties: false,
});

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'save_json_blob_create_request',
    description: 'Create a save-json-blob workflow request and return its record.',
    inputSchema: objectSchema(
      {
        input: { description: 'Workflow input payload.' },
        request_id: stringSchema('Optional request id. A UUID-based id is generated when omitted.'),
      },
      ['input']
    ),
  },
  {
    name: 'save_json_blob_get_request',
    description: 'Fetch a save-json-blob workflow request record by request_id.',
    inputSchema: objectSchema({ request_id: stringSchema() }, ['request_id']),
  },
  {
    name: 'save_json_blob_list_pending_requests',
    description: 'List pending save-json-blob workflow request summaries, optionally filtered by stage and status.',
    inputSchema: objectSchema({
      stage: stringSchema(),
      status: stringSchema(),
      limit: { type: 'integer', minimum: 1, maximum: 1000 },
    }),
  },
  {
    name: 'save_json_blob_patch_agent_output',
    description: 'Patch one agent output for a save-json-blob workflow request and return its record.',
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        agent_name: stringSchema(),
        expected_agent_version: intSchema(),
        output: { description: 'Agent output payload.' },
      },
      ['request_id', 'agent_name', 'expected_agent_version', 'output']
    ),
  },
  {
    name: 'save_json_blob_mark_agent_complete',
    description: 'Mark one agent complete for a save-json-blob workflow request and return its record.',
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        agent_name: stringSchema(),
        expected_record_version: intSchema(),
        current_stage: nullableStringSchema(),
        next_agent: nullableStringSchema(),
        workflow_status: stringSchema(),
        needs_review: { type: 'boolean' },
        last_error: nullableStringSchema(),
      },
      ['request_id', 'agent_name', 'expected_record_version']
    ),
  },
  {
    name: 'ping',
    description: 'Diagnostic tool that confirms the MCP server is reachable.',
    inputSchema: objectSchema({}),
  },
  ...ALLOWED_AGENTS.flatMap<ToolDefinition>((agentName) => [
    {
      name: `${agentName}_update_output`,
      description: `Patch ${agentName} output and default expected_agent_version to 0 for the first write.`,
      inputSchema: objectSchema(
        {
          request_id: stringSchema(),
          output: { description: 'Agent output payload.' },
          expected_agent_version: intSchema(),
        },
        ['request_id', 'output']
      ),
    },
    {
      name: `${agentName}_mark_complete`,
      description: `Mark ${agentName} complete with the agent name hardcoded and optional next_agent normalized.`,
      inputSchema: objectSchema(
        {
          request_id: stringSchema(),
          expected_record_version: intSchema(),
          next_agent: nullableStringSchema(),
        },
        ['request_id', 'expected_record_version']
      ),
    },
  ]),
];

const response = (statusCode: number, body: unknown, headers: Record<string, string> = jsonHeaders) => ({
  statusCode,
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const emptyResponse = (statusCode: number) => ({
  statusCode,
  headers: { ...jsonHeaders, 'Content-Type': 'text/plain' },
  body: '',
});

const rpcResponse = (id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  result,
});

const rpcError = (id: JsonRpcRequest['id'], code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

const parseBody = (event: LambdaEvent) => {
  if (!event.body) throw new Error('Missing request body.');

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  return JSON.parse(rawBody) as JsonRpcRequest | JsonRpcRequest[];
};

const isAuthorized = (event: LambdaEvent) => {
  const token = process.env.MCP_HTTP_AUTH_TOKEN;
  if (!token) return true;

  const authorization = event.headers?.authorization ?? event.headers?.Authorization;

  return authorization === `Bearer ${token}`;
};

const invokeSaveJsonBlob = async (event: LambdaEvent, payload: Record<string, unknown>) => {
  const publishSecret = process.env.NETLIFY_PUBLISH_SECRET || process.env.PUBLISH_SECRET;

  if (!publishSecret) {
    return toolError('NETLIFY_PUBLISH_SECRET is required.');
  }

  const saveResponse = await saveJsonBlobHandler({
    blobs: event.blobs,
    httpMethod: 'POST',
    headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const bodyText = saveResponse.body ?? '';
  let parsedBody: Record<string, unknown> = {};

  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return toolError(`HTTP ${saveResponse.statusCode}: ${bodyText}`);
    }
  }

  if (saveResponse.statusCode < 200 || saveResponse.statusCode >= 300) {
    return toolError(
      typeof parsedBody.error === 'string' ? parsedBody.error : `HTTP ${saveResponse.statusCode}: ${bodyText}`
    );
  }

  return parsedBody;
};

const callAction = async (event: LambdaEvent, payload: Record<string, unknown>, resultKey: string) => {
  const result = await invokeSaveJsonBlob(event, payload);

  if ('isError' in result) return result;

  return toolResult({ [resultKey]: result[resultKey] });
};

const callNormalizedAction = async (
  event: LambdaEvent,
  createPayload: () => Record<string, unknown>,
  resultKey: string
) => {
  try {
    return await callAction(event, createPayload(), resultKey);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
};

const callTool = async (event: LambdaEvent, name: unknown, args: unknown) => {
  const input = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};

  switch (name) {
    case 'ping':
      return toolResult({ ok: true, server: SERVER_DIAGNOSTIC_NAME });
    case 'save_json_blob_create_request':
      return callAction(
        event,
        { action: 'create_request', input: input.input, request_id: input.request_id ?? createRequestId() },
        'record'
      );
    case 'save_json_blob_get_request':
      return callAction(event, { action: 'get_request', request_id: input.request_id }, 'record');
    case 'save_json_blob_list_pending_requests':
      return callNormalizedAction(
        event,
        () => ({
          action: 'list_pending_requests',
          stage: normalizeOptionalAgentName(input.stage, 'stage'),
          status: input.status,
          limit: input.limit,
        }),
        'records'
      );
    case 'save_json_blob_patch_agent_output':
      return callNormalizedAction(
        event,
        () => ({
          action: 'patch_agent_output',
          request_id: input.request_id,
          agent_name: normalizeAgentName(input.agent_name, 'agent_name'),
          expected_agent_version: input.expected_agent_version,
          output: input.output,
        }),
        'record'
      );
    case 'save_json_blob_mark_agent_complete':
      return callNormalizedAction(
        event,
        () => ({
          action: 'mark_agent_complete',
          ...input,
          agent_name: normalizeAgentName(input.agent_name, 'agent_name'),
          current_stage: normalizeOptionalAgentName(input.current_stage, 'current_stage'),
          next_agent: normalizeOptionalAgentName(input.next_agent, 'next_agent'),
        }),
        'record'
      );
    default:
      break;
  }

  if (typeof name === 'string') {
    const updateAgent = ALLOWED_AGENTS.find((agentName) => name === `${agentName}_update_output`);
    if (updateAgent) {
      return callAction(
        event,
        {
          action: 'patch_agent_output',
          request_id: input.request_id,
          agent_name: updateAgent,
          expected_agent_version: input.expected_agent_version ?? 0,
          output: input.output,
        },
        'record'
      );
    }

    const completeAgent = ALLOWED_AGENTS.find((agentName) => name === `${agentName}_mark_complete`);
    if (completeAgent) {
      return callNormalizedAction(
        event,
        () => ({
          action: 'mark_agent_complete',
          request_id: input.request_id,
          agent_name: completeAgent,
          expected_record_version: input.expected_record_version,
          next_agent: normalizeOptionalAgentName(input.next_agent, 'next_agent'),
        }),
        'record'
      );
    }
  }

  return toolError(`Unknown tool: ${String(name)}`);
};

const handleRpcRequest = async (event: LambdaEvent, request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> => {
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return rpcError(request.id, -32600, 'Invalid Request');
  }

  const isNotification = !Object.hasOwn(request, 'id');

  if (request.method === 'notifications/initialized') {
    return undefined;
  }

  if (isNotification) {
    return undefined;
  }

  switch (request.method) {
    case 'initialize':
      return rpcResponse(request.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: '0.1.0' },
      });
    case 'tools/list':
      return rpcResponse(request.id, { tools: TOOL_DEFINITIONS });
    case 'tools/call':
      return rpcResponse(request.id, await callTool(event, request.params?.name, request.params?.arguments));
    default:
      return rpcError(request.id, -32601, `Method not found: ${request.method}`);
  }
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return emptyResponse(204);
  }

  if (event.httpMethod !== 'POST') {
    return response(405, rpcError(null, -32000, 'Method not allowed.'), { ...jsonHeaders, Allow: 'POST' });
  }

  if (!isAuthorized(event)) {
    return response(401, rpcError(null, -32001, 'Unauthorized'));
  }

  try {
    const body = parseBody(event);
    const requests = Array.isArray(body) ? body : [body];
    const results = (await Promise.all(requests.map((request) => handleRpcRequest(event, request)))).filter(
      (result): result is JsonRpcResponse => Boolean(result)
    );

    if (results.length === 0) {
      return emptyResponse(202);
    }

    return response(200, Array.isArray(body) ? results : results[0]);
  } catch (error) {
    return response(400, rpcError(null, -32700, 'Parse error', error instanceof Error ? error.message : String(error)));
  }
};
