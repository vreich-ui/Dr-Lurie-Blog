# save-json-blob MCP server

Minimal stdio MCP server that wraps the Netlify workflow function at:

```text
${SAVE_JSON_BLOB_BASE_URL}/.netlify/functions/save-json-blob
```

## Environment

Both variables are required at runtime:

- `NETLIFY_PUBLISH_SECRET` - sent as the `x-publish-key` request header.
- `SAVE_JSON_BLOB_BASE_URL` - site/function origin, for example `https://example.netlify.app`.

## Install and run

```sh
npm install
npm start
```

Or run directly after install:

```sh
npx save-json-blob-mcp
```

## Tools

- `save_json_blob.create_request(input: any, request_id?: string)` calls `create_request` and returns `record`.
- `save_json_blob.get_request(request_id: string)` calls `get_request` and returns `record`.
- `save_json_blob.list_pending_requests(stage?: string, status?: string)` calls `list_pending_requests` and returns `records`.
- `save_json_blob.patch_agent_output(request_id: string, agent_name: string, expected_agent_version: number, output: any)` calls `patch_agent_output` and returns `record`.
- `save_json_blob.mark_agent_complete(request_id: string, agent_name: string, expected_record_version: number, current_stage?: string | null, next_agent?: string | null, workflow_status?: string, needs_review?: boolean, last_error?: string | null)` calls `mark_agent_complete` and returns `record`.

## Error mapping

The server maps backend non-2xx responses to tool errors without exposing response headers:

- HTTP 400 -> `invalid request`
- HTTP 401 -> `Unauthorized`
- HTTP 404 -> `not found`
- HTTP 409 -> `conflict`
- Other non-2xx responses -> `HTTP <status>: <raw response text>`
