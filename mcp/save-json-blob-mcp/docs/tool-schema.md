# save-json-blob MCP tool schema

Agent Builder requires underscore-only tool names. The MCP server registers these core workflow tools, and any legacy dotted examples such as `save_json_blob.create_request` must be ignored.

## Core tools

### `save_json_blob_create_request`

Calls backend action `create_request` and returns `record`.

Required fields:

- `input: any`

Optional fields:

- `request_id: string` - generated as `req_<uuid>` by the MCP server when omitted.

### `save_json_blob_get_request`

Calls backend action `get_request` and returns `record`.

Required fields:

- `request_id: string`

### `save_json_blob_list_pending_requests`

Calls backend action `list_pending_requests` and returns `records`.

Optional fields:

- `stage: string` - normalized to the supported agent-name allow-list when provided.
- `status: string` - backend workflow status filter. The backend defaults to `pending` when omitted.

### `save_json_blob_patch_agent_output`

Calls backend action `patch_agent_output` and returns `record`.

Required fields:

- `request_id: string`
- `agent_name: string` - normalized to the supported agent-name allow-list.
- `expected_agent_version: number` - nonnegative integer. Use `0` for the first write for that agent.
- `output: any`

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
