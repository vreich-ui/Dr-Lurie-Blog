# save-json-blob MCP tool schema

Agent Builder requires underscore-only tool names. The MCP server registers the core workflow tools and helper tools below, and any legacy dotted examples such as `save_json_blob.create_request` must be ignored.

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

## Core tools

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

Calls backend action `list_pending_requests` and returns `records` sorted by `updated_at` descending (newest first).

Optional fields:

- `stage: string` - normalized to the supported agent-name allow-list when provided.
- `status: string` - backend workflow status filter. The backend defaults to `pending` when omitted.
- `limit: number` - positive integer result limit. Defaults to `50` when omitted.

Sample backend request body:

```json
{
  "action": "list_pending_requests",
  "stage": "research",
  "status": "pending",
  "limit": 50
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

The server also registers underscore-only helper tools for every allowed stage (`reader_insight`, `research`, `angle`, `draft`, and `final_article`):

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
