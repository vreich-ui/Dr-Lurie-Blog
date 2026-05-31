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

## Core tools

- `save_json_blob.create_request(input: any, request_id?: string)` calls `create_request` and returns `record`.
- `save_json_blob.get_request(request_id: string)` calls `get_request` and returns `record`.
- `save_json_blob.list_pending_requests(stage?: string, status?: string)` calls `list_pending_requests` and returns `records`.
- `save_json_blob.patch_agent_output(request_id: string, agent_name: string, expected_agent_version: number, output: any)` calls `patch_agent_output` and returns `record`.
- `save_json_blob.mark_agent_complete(request_id: string, agent_name: string, expected_record_version: number, current_stage?: string | null, next_agent?: string | null, workflow_status?: string, needs_review?: boolean, last_error?: string | null)` calls `mark_agent_complete` and returns `record`.

Agent names in the core tools are normalized to the backend allow-list:

```text
reader_insight|research|angle|draft|final_article
```

For example, `reader insight`, `reader-insight`, and `Reader_Insight` normalize to `reader_insight`.

## Stage helper tools

The server also registers two helper tools for every allowed stage (`reader_insight`, `research`, `angle`, `draft`, and `final_article`):

- `<stage>.update_output(request_id: string, output: any, expected_agent_version?: number)` calls `patch_agent_output` with the stage hardcoded as `agent_name`. If `expected_agent_version` is omitted, it defaults to `0` for the first write.
- `<stage>.mark_complete(request_id: string, expected_record_version: number, next_agent?: string | null)` calls `mark_agent_complete` with the stage hardcoded as `agent_name`. `next_agent` is optional and normalized to the backend allow-list when provided.

Registered helper tool names:

- `reader_insight.update_output`
- `reader_insight.mark_complete`
- `research.update_output`
- `research.mark_complete`
- `angle.update_output`
- `angle.mark_complete`
- `draft.update_output`
- `draft.mark_complete`
- `final_article.update_output`
- `final_article.mark_complete`

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
