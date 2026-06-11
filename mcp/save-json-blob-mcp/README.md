# save-json-blob MCP server

Minimal MCP server that wraps the Netlify workflow function at:

```text
${SAVE_JSON_BLOB_BASE_URL}/.netlify/functions/save-json-blob
```

This package is intended for Agent Builder / local MCP usage. It exposes one tool per backend workflow action, plus stage-specific helper tools that reduce versioning mistakes. The existing stdio entrypoint remains available for local tests, and `src/http.js` exposes the same `createServer()` over MCP Streamable HTTP for remote Agent Builder connections.

## Agent Builder tool-name decision

Agent Builder expects underscore-only tool names. Use the registered underscore-only names documented in [`docs/tool-schema.md`](docs/tool-schema.md); ignore any legacy prompt examples or older notes that use dotted names such as `save_json_blob.create_request`.

Core registered tool names:

- `save_json_blob_create_request`
- `save_json_blob_get_request`
- `save_json_blob_list_pending_requests`
- `save_json_blob_patch_agent_output`
- `save_json_blob_mark_agent_complete`
- `ping`

Production `/mcp` also registers artifact tools (`save_artifact`, `save_artifact_chunk`, and `list_artifacts_for_request`); see the schema document for the compact agent-facing descriptions.

For full tool schemas, versioning rules, helper tool names, and sample calls, see [`docs/tool-schema.md`](docs/tool-schema.md).

## Admin-publish draft contract

For MCP-created admin-publish article drafts, call `save_json_blob_create_request` with `validation_mode: "admin_publish_draft"`. The backend then validates the `content_source.v1` input before writing a workflow record. Agents should provide:

- `publication.publish_payload.slug` (the current validator can still compute a slug from `content.title` for backwards compatibility).
- `publication.publish_payload.title` (the current validator can still use `content.title` for backwards compatibility).
- `publication.publish_payload.author`.
- Body markdown/content in the implemented precedence order: `publication.publish_payload.markdown`, then `publication.publish_payload.content`, then `editorial.draft_markdown`, then markdown blocks in `content.blocks` where `block_type === "markdown"`.

Keep workflow/routing fields such as `current_agent`, `next_agent`, and `workflow.workflow_id` optional unless the backend validator starts requiring them.

## Environment and secret handling

Both variables are required at runtime:

- `NETLIFY_PUBLISH_SECRET` - required. Sent only as the `x-publish-key` request header to the Netlify function.
- `SAVE_JSON_BLOB_BASE_URL` - required. Site root origin without a path or trailing slash, for example `https://example.netlify.app`.

Secret handling rules:

- The publish secret is read from `process.env.NETLIFY_PUBLISH_SECRET` at call time.
- The secret is never accepted as a tool argument, returned in tool output, or included in mapped error messages.
- Backend response headers are not exposed to MCP clients.
- For non-2xx responses other than the explicit mapped statuses, the tool error includes only the numeric HTTP status and raw response text.

## Install and run

This package is private and intended to run from this repository, not from the public npm registry. Install dependencies in this folder and start the stdio server locally:

```sh
npm install
npm start
```

Start the remote MCP Streamable HTTP server with:

```sh
npm run start:http
```

By default, the HTTP server listens on `PORT` or `MCP_HTTP_PORT` (falling back to `3000`) and binds to `HOST` or `MCP_HTTP_HOST` (falling back to `0.0.0.0`).

Remote endpoints:

- MCP endpoint for Agent Builder: `https://<your-public-host>/mcp`
- Health endpoint: `https://<your-public-host>/health`

If you set `MCP_HTTP_PATH`, connect Agent Builder to `https://<your-public-host><MCP_HTTP_PATH>` instead of `/mcp`. If you set `MCP_HTTP_HEALTH_PATH`, use that path instead of `/health` for health checks.

The HTTP transport is stateless Streamable HTTP. Each MCP POST request receives a fresh `createServer()` instance with the same 16 registered tool names used by the stdio server.

Optional remote access token:

- Set `MCP_HTTP_AUTH_TOKEN` to require `Authorization: Bearer <token>` on the MCP endpoint.
- Do not use `NETLIFY_PUBLISH_SECRET` as this token. `NETLIFY_PUBLISH_SECRET` must remain only in the server runtime environment and is used solely when the MCP tool calls the Netlify function.

## Verify tool registration with MCP Inspector

Use the official MCP Inspector to confirm that the server starts, registers tools, and exposes the diagnostic `ping` tool. The startup logs are written to stderr and include the registered tool count and registered tool names without printing environment variable values or secrets.

From this package directory, run:

```sh
NETLIFY_PUBLISH_SECRET='replace-with-local-secret' \
SAVE_JSON_BLOB_BASE_URL='https://example.netlify.app' \
npx @modelcontextprotocol/inspector node src/index.js
```

In Inspector:

1. Open the **Tools** section.
2. Click **List Tools** and verify that `ping` plus the save-json-blob tools appear.
3. Run `ping` and confirm it returns:

```json
{
  "ok": true,
  "server": "Dr_Lurie_Science_MCP"
}
```

If zero tools are registered, the MCP server throws a fatal startup error instead of continuing.

## Deployment notes

Production ChatGPT/Atlas uses the site-level Netlify Function at `netlify/functions/mcp.ts`, reached through the `/mcp` rewrite in the root `netlify.toml`. Keep that route as the production MCP entry point for `https://drluriescience.netlify.app/mcp` and connector name `Dr_Lurie_MCP_Server`.

This package remains the local/standalone MCP implementation for stdio and HTTP smoke tests. Do not assume `npm run start:http` in this package is automatically deployed by Netlify; Netlify serves functions from the root `netlify/functions` directory.

- Configure `SAVE_JSON_BLOB_BASE_URL` as the production site root, without a path or trailing slash. Example: `https://example.netlify.app`, not `https://example.netlify.app/` or `https://example.netlify.app/.netlify/functions/save-json-blob`.
- The server currently normalizes a trailing slash defensively before appending `/.netlify/functions/save-json-blob`, but deployment configuration should still use the root URL without the trailing slash for clarity.
- Keep `NETLIFY_PUBLISH_SECRET` in the MCP runtime environment only; do not place it in Agent Builder tool schemas, prompts, sample calls, HTTP client configuration, or checked-in configuration.
- Keep `SAVE_JSON_BLOB_BASE_URL` in the MCP runtime environment; MCP clients only need the public MCP endpoint path such as `/mcp`, not the backend Netlify function URL.

## Testing

```sh
npm test
```

The integration test requires `NETLIFY_PUBLISH_SECRET` and `SAVE_JSON_BLOB_BASE_URL`. When either variable is missing, Node's test runner reports the integration case as skipped.

## Error mapping

The server maps backend non-2xx responses to tool errors without exposing response headers:

- HTTP 400 -> `invalid request`
- HTTP 401 -> `Unauthorized`
- HTTP 404 -> `not found`
- HTTP 409 -> `conflict`
- Other non-2xx responses -> `HTTP <status>: <raw response text>`

For unmapped statuses, the raw backend response text is intentionally surfaced for debugging. Avoid returning secrets or sensitive details from the backend response body because the MCP tool error will show that text to the agent client.
