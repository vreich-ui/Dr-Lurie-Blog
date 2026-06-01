#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const FUNCTION_PATH = '/.netlify/functions/save-json-blob';

const ALLOWED_AGENTS = ['reader_insight', 'research', 'angle', 'draft', 'final_article'];
const ALLOWED_AGENT_SET = new Set(ALLOWED_AGENTS);

const agentList = () => ALLOWED_AGENTS.join('|');

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

export const createServer = () => {
  const server = new McpServer({
    name: 'save-json-blob-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'save_json_blob_create_request',
    {
      description: 'Create a save-json-blob workflow request and return its record.',
      inputSchema: {
        input: z.any(),
        request_id: z.string().min(1).optional(),
      },
    },
    async ({ input, request_id }) =>
      callAction({ action: 'create_request', input, request_id: request_id ?? createRequestId() }, 'record')
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
      },
    },
    async ({ stage, status }) =>
      callNormalizedAction(
        () => ({ action: 'list_pending_requests', stage: normalizeOptionalAgentName(stage, 'stage'), status }),
        'records'
      )
  );

  server.registerTool(
    'save_json_blob_patch_agent_output',
    {
      description: 'Patch one agent output for a save-json-blob workflow request and return its record.',
      inputSchema: {
        request_id: z.string().min(1),
        agent_name: z.string().min(1),
        expected_agent_version: z.number().int().nonnegative(),
        output: z.any(),
      },
    },
    async ({ request_id, agent_name, expected_agent_version, output }) =>
      callNormalizedAction(
        () => ({
          action: 'patch_agent_output',
          request_id,
          agent_name: normalizeAgentName(agent_name, 'agent_name'),
          expected_agent_version,
          output,
        }),
        'record'
      )
  );

  server.registerTool(
    'save_json_blob_mark_agent_complete',
    {
      description: 'Mark one agent complete for a save-json-blob workflow request and return its record.',
      inputSchema: {
        request_id: z.string().min(1),
        agent_name: z.string().min(1),
        expected_record_version: z.number().int().nonnegative(),
        current_stage: z.string().min(1).nullable().optional(),
        next_agent: z.string().min(1).nullable().optional(),
        workflow_status: z.string().min(1).optional(),
        needs_review: z.boolean().optional(),
        last_error: z.string().nullable().optional(),
      },
    },
    async (input) =>
      callNormalizedAction(
        () => ({
          action: 'mark_agent_complete',
          ...input,
          agent_name: normalizeAgentName(input.agent_name, 'agent_name'),
          current_stage: normalizeOptionalAgentName(input.current_stage, 'current_stage'),
          next_agent: normalizeOptionalAgentName(input.next_agent, 'next_agent'),
        }),
        'record'
      )
  );

  for (const agentName of ALLOWED_AGENTS) {
    server.registerTool(
      `${agentName}_update_output`,
      {
        description: `Patch ${agentName} output and default expected_agent_version to 0 for the first write.`,
        inputSchema: {
          request_id: z.string().min(1),
          output: z.any(),
          expected_agent_version: z.number().int().nonnegative().optional(),
        },
      },
      async ({ request_id, output, expected_agent_version }) =>
        callAction(
          {
            action: 'patch_agent_output',
            request_id,
            agent_name: agentName,
            expected_agent_version: expected_agent_version ?? 0,
            output,
          },
          'record'
        )
    );

    server.registerTool(
      `${agentName}_mark_complete`,
      {
        description: `Mark ${agentName} complete with the agent name hardcoded and optional next_agent normalized.`,
        inputSchema: {
          request_id: z.string().min(1),
          expected_record_version: z.number().int().nonnegative(),
          next_agent: z.string().min(1).nullable().optional(),
        },
      },
      async ({ request_id, expected_record_version, next_agent }) =>
        callNormalizedAction(
          () => ({
            action: 'mark_agent_complete',
            request_id,
            agent_name: agentName,
            expected_record_version,
            next_agent: normalizeOptionalAgentName(next_agent, 'next_agent'),
          }),
          'record'
        )
    );
  }

  return server;
};

