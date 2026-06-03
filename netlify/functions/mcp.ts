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
const ADMIN_TOOLS_ENABLED = process.env.MCP_ENABLE_ADMIN_TOOLS === 'true';

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

const workflowLockInstruction =
  'Agents must call checkout first to acquire a lock_token, then patch output with that lock_token, then mark complete with that lock_token, then check in when done or refresh the lock before it expires as needed.';

const STAGE_TRANSITIONS: Record<
  (typeof ALLOWED_AGENTS)[number],
  { nextAgent: string | null; workflowStatus?: string }
> = {
  reader_insight: { nextAgent: 'research' },
  research: { nextAgent: 'angle' },
  angle: { nextAgent: 'draft' },
  draft: { nextAgent: 'final_article' },
  final_article: { nextAgent: null, workflowStatus: 'completed' },
};

const stageTransitionDescription = (agentName: (typeof ALLOWED_AGENTS)[number]) => {
  const transition = STAGE_TRANSITIONS[agentName];
  const nextAgent = transition.nextAgent === null ? 'null' : transition.nextAgent;
  const workflowStatus = transition.workflowStatus ? ` with workflow_status: "${transition.workflowStatus}"` : '';

  return `Common transition: ${agentName} → ${nextAgent}${workflowStatus}.`;
};

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
const constStringSchema = (value: string, description?: string) => ({
  type: 'string',
  const: value,
  ...(description ? { description } : {}),
});

const lockTokenSchema = stringSchema(
  'Lock token returned by checkout_request; required for mutating workflow records.'
);
const ownerIdSchema = stringSchema('Stable owner id for the agent or process acquiring the workflow lock.');
const ownerLabelSchema = stringSchema(
  'Human-readable owner label for the agent or process acquiring the workflow lock.'
);
const leaseSecondsSchema = {
  type: 'integer',
  minimum: 1,
  description: 'Optional lock lease duration in seconds; backend default applies when omitted.',
};

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

const arraySchema = (items: Record<string, unknown>, description?: string) => ({
  type: 'array',
  items,
  ...(description ? { description } : {}),
});

const stringArraySchema = (description?: string) => arraySchema({ type: 'string' }, description);
const extensionRegisterSchema = (description: string) => ({
  type: 'object',
  description,
  additionalProperties: true,
});

const publishPayloadJsonSchema = objectSchema(
  {
    slug: stringSchema('Destination slug for the published article.'),
    title: stringSchema('Published article title.'),
    markdown: stringSchema('Markdown body to publish.'),
    content: stringSchema('Alternate article body content to publish.'),
    description: stringSchema('Published article summary or meta description.'),
    publishDate: stringSchema('Publish date string.'),
    author: stringSchema('Article author name.'),
    tags: stringArraySchema('Article tags.'),
    images: arraySchema({}, 'Image metadata or asset references.'),
    overwrite: { type: 'boolean', description: 'Whether an existing article at the slug may be overwritten.' },
  },
  ['slug', 'title'],
  'Publication payload used by the publishing step; include slug, title, and article body fields when ready to publish.'
);

const contentBlockJsonSchema = objectSchema(
  {
    block_id: stringSchema('Stable block identifier.'),
    block_type: stringSchema('Block kind such as markdown, image, cta, or quiz.'),
    payload: { description: 'Block payload. Intentionally open for agent-generated block data.' },
    section_id: stringSchema('Optional section id this block belongs to.'),
  },
  ['block_id', 'block_type']
);

const contentSourceV1JsonSchema = objectSchema(
  {
    record_type: constStringSchema('content_source', 'Required discriminator for workflow content-source records.'),
    schema_version: constStringSchema('content_source.v1', 'Required schema version discriminator.'),
    ids: objectSchema({
      content_id: stringSchema('Stable content id.'),
      publication_id: stringSchema('Publication id.'),
      source_version_id: stringSchema('Source version id.'),
      parent_content_id: nullableStringSchema('Parent content id, if this record derives from another content item.'),
      workflow_id: stringSchema('Workflow id associated with this content source.'),
    }),
    publication_context: objectSchema({
      publication_name: stringSchema('Publication name.'),
      domain: stringSchema('Publication domain.'),
      topic_scope: stringSchema('Topic scope or editorial lane.'),
    }),
    content: objectSchema({
      schema_version: constStringSchema('content_blocks.v1'),
      title: stringSchema('Working or final article title agents should use for the content source.'),
      deck: stringSchema('Short deck or subtitle.'),
      description: stringSchema('Brief content description.'),
      structure: objectSchema({
        schema_version: constStringSchema('content_structure.v1'),
        sections: arraySchema(
          objectSchema(
            {
              section_id: stringSchema('Stable section identifier.'),
              role: stringSchema('Section role, such as intro, body, or conclusion.'),
              name: stringSchema('Human-readable section name.'),
              block_refs: stringArraySchema('Block ids included in this section.'),
            },
            ['section_id']
          )
        ),
      }),
      blocks: arraySchema(contentBlockJsonSchema, 'Structured content blocks.'),
    }),
    taxonomy: objectSchema({
      schema_version: constStringSchema('taxonomy.v1'),
      tags: stringArraySchema('Taxonomy tags.'),
    }),
    seo: objectSchema({
      schema_version: constStringSchema('seo.v1'),
      meta_title: stringSchema('SEO meta title.'),
      meta_description: stringSchema('SEO meta description.'),
      canonical_url: stringSchema('Canonical URL.'),
    }),
    media: objectSchema({
      schema_version: constStringSchema('media.v1'),
      visual_strategy: { description: 'Visual strategy. Intentionally open for agent-generated media planning data.' },
      image_prompt_register: extensionRegisterSchema(
        'Agent-generated image prompts keyed by prompt id; extension keys are intentionally allowed.'
      ),
      image_generation_runs: arraySchema({}, 'Image generation run records.'),
      image_asset_register: arraySchema({}, 'Image asset records.'),
      image_sets: arraySchema({}, 'Image set records.'),
      media_revision_summary: { description: 'Media revision summary. Intentionally open for agent-generated data.' },
    }),
    editorial: objectSchema({
      schema_version: constStringSchema('editorial.v1'),
      writer_notes: stringSchema('Notes for writers and editors.'),
      draft_markdown: stringSchema(
        'Markdown draft body agents can pass between drafting, revision, and publishing steps.'
      ),
    }),
    sources: objectSchema({
      schema_version: constStringSchema('sources.v1'),
      source_list: arraySchema(
        objectSchema(
          {
            source_id: stringSchema('Stable source id.'),
            name: stringSchema('Source name.'),
            url: stringSchema('Source URL.'),
            publisher: stringSchema('Source publisher.'),
            accessed_at: stringSchema('Access timestamp.'),
          },
          ['name', 'url']
        ),
        'Cited sources.'
      ),
    }),
    claims: objectSchema({
      schema_version: constStringSchema('claims.v1'),
      claim_list: arraySchema({}, 'Fact claims. Items are intentionally open for agent-generated claim objects.'),
    }),
    compliance: objectSchema({
      schema_version: constStringSchema('compliance.v1'),
      requirements: arraySchema(
        {},
        'Compliance requirements. Items are intentionally open for policy-specific objects.'
      ),
    }),
    commercial: objectSchema({
      schema_version: constStringSchema('commercial.v1'),
      offers: arraySchema({}, 'Commercial offer records. Items are intentionally open for offer-specific objects.'),
    }),
    approvals: objectSchema({
      schema_version: constStringSchema('approvals.v1'),
      approval_status: stringSchema('Approval status.'),
    }),
    publication: objectSchema({
      schema_version: constStringSchema('publication.v1'),
      publication_status: stringSchema('Publication status separate from workflow_status.'),
      publish_payload: publishPayloadJsonSchema,
    }),
    workflow: objectSchema({
      schema_version: constStringSchema('content_workflow.v1'),
      workflow_id: stringSchema(
        'Workflow identifier agents should preserve across handoffs and backend workflow records.'
      ),
    }),
    revision_control: objectSchema({
      schema_version: constStringSchema('revision_control.v1'),
      audit_findings: arraySchema({}, 'Audit findings. Items are intentionally open for agent-generated findings.'),
      routing_decisions: arraySchema(
        {},
        'Routing decisions. Items are intentionally open for agent-generated decisions.'
      ),
      revision_requests: arraySchema(
        {},
        'Revision requests. Items are intentionally open for agent-generated requests.'
      ),
      change_assessments: arraySchema(
        {},
        'Change assessments. Items are intentionally open for agent-generated assessments.'
      ),
    }),
    versioning: objectSchema({
      schema_version: constStringSchema('versioning.v1'),
      record_version: intSchema(
        'Content-source record version agents should increment or preserve for revision tracking.'
      ),
      previous_version_refs: stringArraySchema('Previous content-source version references.'),
    }),
  },
  ['record_type', 'schema_version'],
  'Structured content_source.v1 workflow input.'
);

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'save_json_blob_create_request',
    description: 'Create a save-json-blob workflow request and return its record.',
    inputSchema: objectSchema(
      {
        input: contentSourceV1JsonSchema,
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
    description: `Patch one agent output for a save-json-blob workflow request and return its record. ${workflowLockInstruction}`,
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        agent_name: stringSchema(),
        expected_agent_version: intSchema(),
        lock_token: lockTokenSchema,
        output: { description: 'Agent output payload.' },
      },
      ['request_id', 'agent_name', 'expected_agent_version', 'lock_token', 'output']
    ),
  },
  {
    name: 'save_json_blob_mark_agent_complete',
    description: `Mark one agent complete for a save-json-blob workflow request and return its record. ${workflowLockInstruction}`,
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        agent_name: stringSchema(),
        expected_record_version: intSchema(),
        lock_token: lockTokenSchema,
        current_stage: nullableStringSchema(),
        next_agent: nullableStringSchema(),
        workflow_status: stringSchema(),
        needs_review: { type: 'boolean' },
        last_error: nullableStringSchema(),
      },
      ['request_id', 'agent_name', 'expected_record_version', 'lock_token']
    ),
  },
  {
    name: 'save_json_blob_checkout_request',
    description: `Checkout a save-json-blob workflow request and acquire a lock_token before patching output. ${workflowLockInstruction}`,
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        owner_id: ownerIdSchema,
        owner_label: ownerLabelSchema,
        lease_seconds: leaseSecondsSchema,
      },
      ['request_id', 'owner_id', 'owner_label']
    ),
  },
  {
    name: 'save_json_blob_refresh_lock',
    description: `Refresh an active workflow lock before it expires when more time is needed. ${workflowLockInstruction}`,
    inputSchema: objectSchema(
      { request_id: stringSchema(), lock_token: lockTokenSchema, lease_seconds: leaseSecondsSchema },
      ['request_id', 'lock_token']
    ),
  },
  {
    name: 'save_json_blob_checkin_request',
    description: `Check in a workflow request to release the lock after patching output and marking complete. ${workflowLockInstruction}`,
    inputSchema: objectSchema({ request_id: stringSchema(), lock_token: lockTokenSchema }, [
      'request_id',
      'lock_token',
    ]),
  },
  ...(ADMIN_TOOLS_ENABLED
    ? [
        {
          name: 'save_json_blob_force_unlock',
          description:
            'Admin-only emergency tool that forcefully releases a workflow lock. Prefer checkin_request with the valid lock_token whenever possible.',
          inputSchema: objectSchema({ request_id: stringSchema() }, ['request_id']),
        },
      ]
    : []),
  {
    name: 'ping',
    description: 'Diagnostic tool that confirms the MCP server is reachable.',
    inputSchema: objectSchema({}),
  },
  ...ALLOWED_AGENTS.flatMap<ToolDefinition>((agentName) => [
    {
      name: `${agentName}_update_output`,
      description: `Patch ${agentName} output with a lock_token and default expected_agent_version to 0 for the first write. ${workflowLockInstruction}`,
      inputSchema: objectSchema(
        {
          request_id: stringSchema(),
          output: { description: 'Agent output payload.' },
          expected_agent_version: intSchema(),
          lock_token: lockTokenSchema,
        },
        ['request_id', 'output', 'lock_token']
      ),
    },
    {
      name: `${agentName}_mark_complete`,
      description: `Mark ${agentName} complete with the agent name hardcoded and optional current_stage, next_agent, workflow_status, needs_review, last_error, and lock_token forwarded to the backend. ${stageTransitionDescription(agentName)} ${workflowLockInstruction}`,
      inputSchema: objectSchema(
        {
          request_id: stringSchema(),
          expected_record_version: intSchema(),
          lock_token: lockTokenSchema,
          current_stage: nullableStringSchema(),
          next_agent: nullableStringSchema(),
          workflow_status: stringSchema(),
          needs_review: { type: 'boolean' },
          last_error: nullableStringSchema(),
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
    case 'save_json_blob_checkout_request':
      return callAction(
        event,
        {
          action: 'checkout_request',
          request_id: input.request_id,
          owner_id: input.owner_id,
          owner_label: input.owner_label,
          lease_seconds: input.lease_seconds,
        },
        'record'
      );
    case 'save_json_blob_refresh_lock':
      return callAction(
        event,
        {
          action: 'refresh_lock',
          request_id: input.request_id,
          lock_token: input.lock_token,
          lease_seconds: input.lease_seconds,
        },
        'record'
      );
    case 'save_json_blob_checkin_request':
      return callAction(
        event,
        { action: 'checkin_request', request_id: input.request_id, lock_token: input.lock_token },
        'record'
      );
    case 'save_json_blob_force_unlock':
      if (!ADMIN_TOOLS_ENABLED) return toolError('Admin tools are not enabled.');
      return callAction(event, { action: 'force_unlock', request_id: input.request_id }, 'record');
    case 'save_json_blob_patch_agent_output':
      return callNormalizedAction(
        event,
        () => ({
          action: 'patch_agent_output',
          request_id: input.request_id,
          agent_name: normalizeAgentName(input.agent_name, 'agent_name'),
          expected_agent_version: input.expected_agent_version,
          lock_token: input.lock_token,
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
          lock_token: input.lock_token,
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
          lock_token: input.lock_token,
          current_stage: normalizeOptionalAgentName(input.current_stage, 'current_stage'),
          next_agent: normalizeOptionalAgentName(input.next_agent, 'next_agent'),
          workflow_status: input.workflow_status,
          needs_review: input.needs_review,
          last_error: input.last_error,
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
