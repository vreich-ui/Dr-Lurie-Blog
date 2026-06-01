# save-json-blob MCP server

Minimal stdio MCP server that wraps the Netlify workflow function at:

```text
${SAVE_JSON_BLOB_BASE_URL}/.netlify/functions/save-json-blob
```

This package is intended for Agent Builder / local MCP usage. It exposes one tool per backend workflow action, plus stage-specific helper tools that reduce versioning mistakes.

## Agent Builder tool-name decision

Agent Builder expects underscore-only tool names. Use the registered underscore-only names documented in [`docs/tool-schema.md`](docs/tool-schema.md); ignore any legacy prompt examples or older notes that use dotted names such as `save_json_blob.create_request`.

Core registered tool names:

- `save_json_blob_create_request`
- `save_json_blob_get_request`
- `save_json_blob_list_pending_requests`
- `save_json_blob_patch_agent_output`
- `save_json_blob_mark_agent_complete`

For full tool schemas, versioning rules, helper tool names, and sample calls, see [`docs/tool-schema.md`](docs/tool-schema.md).

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

## Deployment notes

- Configure `SAVE_JSON_BLOB_BASE_URL` as the production site root, without a path or trailing slash. Example: `https://example.netlify.app`, not `https://example.netlify.app/` or `https://example.netlify.app/.netlify/functions/save-json-blob`.
- The server currently normalizes a trailing slash defensively before appending `/.netlify/functions/save-json-blob`, but deployment configuration should still use the root URL without the trailing slash for clarity.
- Keep `NETLIFY_PUBLISH_SECRET` in the MCP runtime environment only; do not place it in Agent Builder tool schemas, prompts, sample calls, or checked-in configuration.

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
