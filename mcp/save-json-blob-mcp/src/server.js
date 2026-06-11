#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const FUNCTION_PATH = '/.netlify/functions/save-json-blob';
const SERVER_DIAGNOSTIC_NAME = 'Dr_Lurie_Science_MCP';
const REQUIRED_ENV = ['NETLIFY_PUBLISH_SECRET', 'SAVE_JSON_BLOB_BASE_URL'];

const ALLOWED_AGENTS = ['reader_insight', 'research', 'angle', 'draft', 'final_article'];
const ALLOWED_AGENT_SET = new Set(ALLOWED_AGENTS);
const ADMIN_TOOLS_ENABLED = process.env.MCP_ENABLE_ADMIN_TOOLS === 'true';

const agentList = () => ALLOWED_AGENTS.join('|');

const workflowLockInstruction =
  'Agents must call checkout first to acquire a lock_token, then patch output with that lock_token, then mark complete with that lock_token, then check in when done or refresh the lock before it expires as needed.';

const STAGE_TRANSITIONS = {
  reader_insight: { nextAgent: 'research' },
  research: { nextAgent: 'angle' },
  angle: { nextAgent: 'draft' },
  draft: { nextAgent: 'final_article' },
  final_article: { nextAgent: null, workflowStatus: 'completed' },
};

const stageTransitionDescription = (agentName) => {
  const transition = STAGE_TRANSITIONS[agentName];
  const nextAgent = transition.nextAgent === null ? 'null' : transition.nextAgent;
  const workflowStatus = transition.workflowStatus ? ` with workflow_status: "${transition.workflowStatus}"` : '';

  return `Common transition: ${agentName} → ${nextAgent}${workflowStatus}.`;
};

const normalizeAgentName = (value, fieldName) => {
  if (value === null || value === undefined) {
    return value;
  }

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

const normalizeOptionalAgentName = (value, fieldName) => {
  if (value === undefined || value === null) {
    return value;
  }

  return normalizeAgentName(value, fieldName);
};

const createRequestId = () => `req_${randomUUID()}`;

const logStartup = (message, metadata = {}) => {
  const suffix = Object.keys(metadata).length ? ` ${JSON.stringify(metadata)}` : '';
  console.error(`[${SERVER_DIAGNOSTIC_NAME}] ${message}${suffix}`);
};

const validateEnvironmentForStartup = () => {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);

  logStartup('Environment validation complete.', {
    required: REQUIRED_ENV,
    missing,
    ok: missing.length === 0,
  });
};

const installRequestLogging = (server, getRegisteredToolNames) => {
  const originalSetRequestHandler = server.server.setRequestHandler.bind(server.server);

  server.server.setRequestHandler = (requestSchema, handler) => {
    if (requestSchema === ListToolsRequestSchema) {
      return originalSetRequestHandler(requestSchema, async (request, extra) => {
        const result = await handler(request, extra);
        const toolNames = result.tools.map((tool) => tool.name);

        logStartup('ListTools request.', {
          registeredToolCount: toolNames.length,
          registeredToolNames: toolNames,
        });

        return result;
      });
    }

    if (requestSchema === CallToolRequestSchema) {
      return originalSetRequestHandler(requestSchema, async (request, extra) => {
        logStartup('CallTool request.', {
          toolName: request.params.name,
          registeredToolCount: getRegisteredToolNames().length,
          registeredToolNames: getRegisteredToolNames(),
        });

        return handler(request, extra);
      });
    }

    return originalSetRequestHandler(requestSchema, handler);
  };
};

const requiredEnv = (name) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
};

const getFunctionUrl = () => {
  const baseUrl = requiredEnv('SAVE_JSON_BLOB_BASE_URL');
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  return `${normalizedBaseUrl}${FUNCTION_PATH}`;
};

const mapHttpError = (status, responseText) => {
  switch (status) {
    case 400:
      return 'invalid request';
    case 401:
      return 'Unauthorized';
    case 404:
      return 'not found';
    case 409:
      return 'conflict';
    default:
      return `HTTP ${status}: ${responseText}`;
  }
};

const toolError = (message) => ({
  isError: true,
  content: [{ type: 'text', text: message }],
});

const toolJson = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  structuredContent: payload,
});

const postAction = async (payload) => {
  const publishSecret = requiredEnv('NETLIFY_PUBLISH_SECRET');
  const response = await fetch(getFunctionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-publish-key': publishSecret,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();

  if (!response.ok) {
    return { ok: false, error: mapHttpError(response.status, responseText) };
  }

  if (!responseText) {
    return { ok: true, body: {} };
  }

  try {
    return { ok: true, body: JSON.parse(responseText) };
  } catch {
    return { ok: false, error: `HTTP ${response.status}: ${responseText}` };
  }
};

const callAction = async (payload, resultKey) => {
  try {
    const result = await postAction(payload);

    if (!result.ok) {
      return toolError(result.error);
    }

    return toolJson({ [resultKey]: result.body[resultKey] });
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
};

const callNormalizedAction = async (createPayload, resultKey) => {
  try {
    return await callAction(createPayload(), resultKey);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
};

const createMarkAgentCompletePayload = (input, agentName) => ({
  action: 'mark_agent_complete',
  ...input,
  agent_name: agentName,
  current_stage: normalizeOptionalAgentName(input.current_stage, 'current_stage'),
  next_agent: normalizeOptionalAgentName(input.next_agent, 'next_agent'),
});

export const createServer = () => {
  logStartup('Server startup.');
  validateEnvironmentForStartup();

  const registeredToolNames = [];
  const server = new McpServer({
    name: 'save-json-blob-mcp',
    version: '0.1.0',
  });

  installRequestLogging(server, () => [...registeredToolNames]);

  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = (name, config, callback) => {
    const registeredTool = originalRegisterTool(name, config, callback);
    registeredToolNames.push(name);
    logStartup('Tool registered.', {
      toolName: name,
      registeredToolCount: registeredToolNames.length,
      registeredToolNames: [...registeredToolNames],
    });

    return registeredTool;
  };

  server.registerTool(
    'save_json_blob_create_request',
    {
      description:
        'Create a save-json-blob workflow request and return its record. MCP-created admin-publish article drafts should pass validation_mode: "admin_publish_draft" so the backend rejects skeletal drafts before workflow creation.',
      inputSchema: {
        input: z.any(),
        request_id: z.string().min(1).optional(),
        validation_mode: z
          .enum(['admin_publish_draft'])
          .optional()
          .describe('Required validation mode for MCP-created admin-publish article drafts.'),
      },
    },
    async ({ input, request_id, validation_mode }) =>
      callAction(
        { action: 'create_request', input, request_id: request_id ?? createRequestId(), validation_mode },
        'record'
      )
  );

  server.registerTool(
    'save_json_blob_get_request',
    {
      description: 'Fetch a save-json-blob workflow request record by request_id.',
      inputSchema: {
        request_id: z.string().min(1),
      },
    },
    async ({ request_id }) => callAction({ action: 'get_request', request_id }, 'record')
  );

  server.registerTool(
    'save_json_blob_list_pending_requests',
    {
      description: 'List pending save-json-blob workflow request summaries, optionally filtered by stage and status.',
      inputSchema: {
        stage: z.string().min(1).optional(),
        status: z.string().min(1).optional(),
        limit: z.number().int().positive().max(1000).optional(),
      },
    },
    async ({ stage, status, limit }) =>
      callNormalizedAction(
        () => ({ action: 'list_pending_requests', stage: normalizeOptionalAgentName(stage, 'stage'), status, limit }),
        'records'
      )
  );

  server.registerTool(
    'save_json_blob_patch_agent_output',
    {
      description: `Patch one agent output for a save-json-blob workflow request and return its record. ${workflowLockInstruction}`,
      inputSchema: {
        request_id: z.string().min(1),
        agent_name: z.string().min(1),
        expected_agent_version: z.number().int().nonnegative(),
        lock_token: z.string().min(1),
        output: z.any(),
      },
    },
    async ({ request_id, agent_name, expected_agent_version, lock_token, output }) =>
      callNormalizedAction(
        () => ({
          action: 'patch_agent_output',
          request_id,
          agent_name: normalizeAgentName(agent_name, 'agent_name'),
          expected_agent_version,
          lock_token,
          output,
        }),
        'record'
      )
  );

  server.registerTool(
    'save_json_blob_mark_agent_complete',
    {
      description: `Mark one agent complete for a save-json-blob workflow request and return its record. ${workflowLockInstruction}`,
      inputSchema: {
        request_id: z.string().min(1),
        agent_name: z.string().min(1),
        expected_record_version: z.number().int().nonnegative(),
        lock_token: z.string().min(1),
        current_stage: z.string().min(1).nullable().optional(),
        next_agent: z.string().min(1).nullable().optional(),
        workflow_status: z.string().min(1).optional(),
        needs_review: z.boolean().optional(),
        last_error: z.string().nullable().optional(),
      },
    },
    async (input) =>
      callNormalizedAction(
        () => createMarkAgentCompletePayload(input, normalizeAgentName(input.agent_name, 'agent_name')),
        'record'
      )
  );

  server.registerTool(
    'save_json_blob_checkout_request',
    {
      description: `Checkout a save-json-blob workflow request and acquire a lock_token before patching output. ${workflowLockInstruction}`,
      inputSchema: {
        request_id: z.string().min(1),
        owner_id: z.string().min(1),
        owner_label: z.string().min(1),
        lease_seconds: z.number().int().positive().optional(),
      },
    },
    async ({ request_id, owner_id, owner_label, lease_seconds }) =>
      callAction({ action: 'checkout_request', request_id, owner_id, owner_label, lease_seconds }, 'record')
  );

  server.registerTool(
    'save_json_blob_refresh_lock',
    {
      description: `Refresh an active workflow lock before it expires when more time is needed. ${workflowLockInstruction}`,
      inputSchema: {
        request_id: z.string().min(1),
        lock_token: z.string().min(1),
        lease_seconds: z.number().int().positive().optional(),
      },
    },
    async ({ request_id, lock_token, lease_seconds }) =>
      callAction({ action: 'refresh_lock', request_id, lock_token, lease_seconds }, 'record')
  );

  server.registerTool(
    'save_json_blob_checkin_request',
    {
      description: `Check in a workflow request to release the lock after patching output and marking complete. ${workflowLockInstruction}`,
      inputSchema: {
        request_id: z.string().min(1),
        lock_token: z.string().min(1),
      },
    },
    async ({ request_id, lock_token }) => callAction({ action: 'checkin_request', request_id, lock_token }, 'record')
  );

  if (ADMIN_TOOLS_ENABLED) {
    server.registerTool(
      'save_json_blob_force_unlock',
      {
        description:
          'Admin-only emergency tool that forcefully releases a workflow lock. Prefer checkin_request with the valid lock_token whenever possible.',
        inputSchema: {
          request_id: z.string().min(1),
        },
      },
      async ({ request_id }) => callAction({ action: 'force_unlock', request_id }, 'record')
    );
  }

  server.registerTool(
    'ping',
    {
      description: 'Diagnostic tool that confirms the MCP server is reachable.',
      inputSchema: {},
    },
    async () => toolJson({ ok: true, server: SERVER_DIAGNOSTIC_NAME })
  );

  for (const agentName of ALLOWED_AGENTS) {
    server.registerTool(
      `${agentName}_update_output`,
      {
        description: `Patch ${agentName} output with a lock_token and default expected_agent_version to 0 for the first write. ${workflowLockInstruction}`,
        inputSchema: {
          request_id: z.string().min(1),
          output: z.any(),
          expected_agent_version: z.number().int().nonnegative().optional(),
          lock_token: z.string().min(1),
        },
      },
      async ({ request_id, output, expected_agent_version, lock_token }) =>
        callAction(
          {
            action: 'patch_agent_output',
            request_id,
            agent_name: agentName,
            expected_agent_version: expected_agent_version ?? 0,
            lock_token,
            output,
          },
          'record'
        )
    );

    server.registerTool(
      `${agentName}_mark_complete`,
      {
        description: `Mark ${agentName} complete with the agent name hardcoded and optional current_stage, next_agent, workflow_status, needs_review, last_error, and lock_token forwarded to the backend. ${stageTransitionDescription(agentName)} ${workflowLockInstruction}`,
        inputSchema: {
          request_id: z.string().min(1),
          expected_record_version: z.number().int().nonnegative(),
          lock_token: z.string().min(1),
          current_stage: z.string().min(1).nullable().optional(),
          next_agent: z.string().min(1).nullable().optional(),
          workflow_status: z.string().min(1).optional(),
          needs_review: z.boolean().optional(),
          last_error: z.string().nullable().optional(),
        },
      },
      async (input) => callNormalizedAction(() => createMarkAgentCompletePayload(input, agentName), 'record')
    );
  }

  if (registeredToolNames.length === 0) {
    throw new Error('Fatal startup error: no MCP tools were registered.');
  }

  logStartup('Tool registration complete.', {
    registeredToolCount: registeredToolNames.length,
    registeredToolNames,
  });

  return server;
};
