#!/usr/bin/env node
import { createServer as createNodeHttpServer } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createServer as createMcpServer } from './server.js';

const DEFAULT_MCP_PATH = '/mcp';
const DEFAULT_HEALTH_PATH = '/health';

const getPathname = (req) => {
  const host = req.headers.host ?? 'localhost';
  return new URL(req.url ?? '/', `http://${host}`).pathname;
};

const writeJson = (res, statusCode, payload, extraHeaders = {}) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
};

const writeJsonRpcError = (res, statusCode, code, message, extraHeaders = {}) => {
  writeJson(
    res,
    statusCode,
    {
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    },
    extraHeaders
  );
};

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

const isAuthorized = (req) => {
  const token = process.env.MCP_HTTP_AUTH_TOKEN;

  if (!token) {
    return true;
  }

  return req.headers.authorization === `Bearer ${token}`;
};

const closeQuietly = async (server, transport) => {
  await Promise.allSettled([transport.close(), server.close()]);
};

const handleMcpRequest = async (req, res) => {
  if (!isAuthorized(req)) {
    writeJsonRpcError(res, 401, -32001, 'Unauthorized', corsHeaders);
    return;
  }

  if (req.method !== 'POST') {
    writeJsonRpcError(res, 405, -32000, 'Method not allowed.', { ...corsHeaders, Allow: 'POST' });
    return;
  }

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  let closed = false;
  const cleanup = () => {
    if (closed) {
      return;
    }

    closed = true;
    void closeQuietly(server, transport);
  };

  res.once('close', cleanup);

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling MCP HTTP request:', error);

    if (!res.headersSent) {
      writeJsonRpcError(res, 500, -32603, 'Internal server error', corsHeaders);
    }
  } finally {
    if (res.writableEnded) {
      cleanup();
    }
  }
};

export const createHttpServer = ({ mcpPath = DEFAULT_MCP_PATH, healthPath = DEFAULT_HEALTH_PATH } = {}) =>
  createNodeHttpServer(async (req, res) => {
    const pathname = getPathname(req);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (pathname === healthPath) {
      if (req.method !== 'GET') {
        writeJson(res, 405, { ok: false, error: 'Method not allowed.' }, { ...corsHeaders, Allow: 'GET' });
        return;
      }

      writeJson(
        res,
        200,
        {
          ok: true,
          name: 'save-json-blob-mcp',
          transport: 'streamable-http',
          mcpPath,
        },
        corsHeaders
      );
      return;
    }

    if (pathname === mcpPath) {
      await handleMcpRequest(req, res);
      return;
    }

    writeJson(res, 404, { ok: false, error: 'Not found.' }, corsHeaders);
  });

const isMainModule = () => import.meta.url === `file://${process.argv[1]}`;

if (isMainModule()) {
  const port = Number.parseInt(process.env.PORT ?? process.env.MCP_HTTP_PORT ?? '3000', 10);
  const host = process.env.HOST ?? process.env.MCP_HTTP_HOST ?? '0.0.0.0';
  const mcpPath = process.env.MCP_HTTP_PATH ?? DEFAULT_MCP_PATH;
  const healthPath = process.env.MCP_HTTP_HEALTH_PATH ?? DEFAULT_HEALTH_PATH;
  const httpServer = createHttpServer({ mcpPath, healthPath });

  httpServer.listen(port, host, () => {
    console.error(`save-json-blob MCP HTTP server listening on http://${host}:${port}${mcpPath}`);
    console.error(`Health endpoint available at http://${host}:${port}${healthPath}`);
  });
}
