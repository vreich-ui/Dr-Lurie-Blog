# save-json-blob MCP server

Minimal stdio MCP server that wraps the Netlify workflow function at:

```text
${SAVE_JSON_BLOB_BASE_URL}/.netlify/functions/save-json-blob
```

This package is intended for Agent Builder / local MCP usage. It exposes one tool per backend workflow action, plus stage-specific helper tools that reduce versioning mistakes.

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

## Supported agent/stage names

The backend allow-list is:

```text
reader_insight|research|angle|draft|final_article
```

Core tool fields that accept an agent/stage name are normalized before the backend call. For example, `reader insight`, `reader-insight`, and `Reader_Insight` normalize to `reader_insight`.

## Versioning rules

- `patch_agent_output` uses per-agent output versions. If an agent has not written output yet, the backend treats the existing output version as `0` before incrementing it.
- Therefore, the first `expected_agent_version` for an agent output write must be `0`.
- Stage helper tools (`<stage>_update_output`) default omitted `expected_agent_version` to `0` to make first writes safer.
- Replaying the exact same `patch_agent_output` payload can be idempotent and return the existing record with `idempotent: true`, depending on backend state.
- `mark_agent_complete` always requires `expected_record_version`. Use the `version` from the latest record snapshot returned by `create_request`, `get_request`, `patch_agent_output`, or a previous completion call.
- If `expected_record_version` is stale and the completion is not already reflected in the record, the backend returns HTTP `409` and the MCP tool returns `conflict`.

## Core tool schema

### `save_json_blob_create_request`

Calls backend action `create_request` and returns `record`.

Required fields:

- `input: any`

Optional fields:

- `request_id: string` - generated as `req_<uuid>` by the MCP server when omitted.

Sample backend request body:

```json
{
  "action": "create_request",
  "request_id": "req_123",
  "input": { "topic": "Skin barrier" }
}
```

### `save_json_blob_get_request`

Calls backend action `get_request` and returns `record`.

Required fields:

- `request_id: string`

Sample backend request body:

```json
{
  "action": "get_request",
  "request_id": "req_123"
}
```

### `save_json_blob_list_pending_requests`

Calls backend action `list_pending_requests` and returns `records`.

Optional fields:

- `stage: string` - normalized to the supported agent-name allow-list when provided.
- `status: string` - backend workflow status filter. The backend defaults to `pending` when omitted.

Sample backend request body:

```json
{
  "action": "list_pending_requests",
  "stage": "research",
  "status": "pending"
}
```

### `save_json_blob_patch_agent_output`

Calls backend action `patch_agent_output` and returns `record`.

Required fields:

- `request_id: string`
- `agent_name: string` - normalized to the supported agent-name allow-list.
- `expected_agent_version: number` - nonnegative integer. Use `0` for the first write for that agent.
- `output: any`

Sample backend request body:

```json
{
  "action": "patch_agent_output",
  "request_id": "req_123",
  "agent_name": "research",
  "expected_agent_version": 0,
  "output": { "notes": [] }
}
```

### `save_json_blob_mark_agent_complete`

Calls backend action `mark_agent_complete` and returns `record`.

Required fields:

- `request_id: string`
- `agent_name: string` - normalized to the supported agent-name allow-list.
- `expected_record_version: number` - nonnegative integer from the latest record snapshot.

Optional fields:

- `current_stage: string | null` - normalized when provided.
- `next_agent: string | null` - normalized when provided.
- `workflow_status: string`
- `needs_review: boolean`
- `last_error: string | null`

Sample backend request body:

```json
{
  "action": "mark_agent_complete",
  "request_id": "req_123",
  "agent_name": "research",
  "expected_record_version": 2,
  "next_agent": "angle",
  "workflow_status": "in_progress"
}
```

## Stage helper tools

The server also registers two helper tools for every allowed stage (`reader_insight`, `research`, `angle`, `draft`, and `final_article`):

- `<stage>_update_output(request_id: string, output: any, expected_agent_version?: number)` calls `patch_agent_output` with the stage hardcoded as `agent_name`. If `expected_agent_version` is omitted, it defaults to `0` for the first write.
- `<stage>_mark_complete(request_id: string, expected_record_version: number, next_agent?: string | null)` calls `mark_agent_complete` with the stage hardcoded as `agent_name`. `next_agent` is optional and normalized to the backend allow-list when provided.

Registered helper tool names:

- `reader_insight_update_output`
- `reader_insight_mark_complete`
- `research_update_output`
- `research_mark_complete`
- `angle_update_output`
- `angle_mark_complete`
- `draft_update_output`
- `draft_mark_complete`
- `final_article_update_output`
- `final_article_mark_complete`

### Stage helper sample tool calls

First write for reader insight output using the helper default version of `0`:

```json
{
  "tool": "reader_insight_update_output",
  "arguments": {
    "request_id": "req_123",
    "output": { "reader_need": "Clear explanation for sensitive aging skin." }
  }
}
```

Complete reader insight and route to research using the latest record snapshot version:

```json
{
  "tool": "reader_insight_mark_complete",
  "arguments": {
    "request_id": "req_123",
    "expected_record_version": 2,
    "next_agent": "research"
  }
}
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
