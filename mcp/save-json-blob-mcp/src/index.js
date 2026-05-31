#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './server.js';

const { registeredToolNames, server } = createServer();

console.error('MCP server starting');
console.error(`base URL present: ${Boolean(process.env.SAVE_JSON_BLOB_BASE_URL)}`);
console.error(`publish secret present: ${Boolean(process.env.NETLIFY_PUBLISH_SECRET)}`);
console.error('registered tool names array:', registeredToolNames);

const transport = new StdioServerTransport();
await server.connect(transport);
