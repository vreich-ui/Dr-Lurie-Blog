# save-json-blob MCP tool schema

Agent Builder requires underscore-only tool names. The MCP server registers the core workflow tools and helper tools below, and any legacy dotted examples such as `save_json_blob.create_request` must be ignored.

## Agent context / production endpoint

Use this file as the compact context document for agents that need to understand the Dr. Lurie MCP server tools.

Production ChatGPT/Atlas connector details:

- Public MCP endpoint: `https://drluriescience.netlify.app/mcp`
- Expected connector/server name: `Dr_Lurie_MCP_Server`
- Production Netlify entry point: `netlify/functions/mcp.ts`, reached through the root `netlify.toml` `/mcp` rewrite.
- Local/standalone package implementation: `mcp/save-json-blob-mcp/src/server.js` with stdio and standalone HTTP helpers.

Security/context rules for agents:

- Do not ask users for `NETLIFY_PUBLISH_SECRET`, `PUBLISH_SECRET`, or `SAVE_JSON_BLOB_BASE_URL`.
- Do not include secrets in tool arguments, prompts, schemas, checked-in config, or browser/client code.
- Tool calls should use the public MCP endpoint only; backend publish credentials remain server-side.
- Use underscore-only tool names from this document. Ignore legacy dotted examples such as `save_json_blob.create_request`.

## Supported agent/stage names

The backend allow-list is:

```text
reader_insight|research|angle|draft|final_article
```

Core tool fields that accept an agent/stage name are normalized before the backend call. For example, `reader insight`, `reader-insight`, and `Reader_Insight` normalize to `reader_insight`.

## Locking and recommended agent sequence

Mutating tools require a workflow lock. Agents should use this sequence:

1. Create or fetch the request.
2. Call `save_json_blob_checkout_request` with `request_id`, `owner_id`, and `owner_label`; copy `record.lock.token`.
3. Patch output with `save_json_blob_patch_agent_output` or `<stage>_update_output`, passing the copied `lock_token`.
4. Mark the agent complete with `save_json_blob_mark_agent_complete` or `<stage>_mark_complete`, passing the same `lock_token` and the latest `record.version`.
5. Call `save_json_blob_checkin_request` with the same `lock_token` to release the lock, or call `save_json_blob_refresh_lock` before expiry if more time is needed.

Admin-only emergency force unlock is intentionally gated by `MCP_ENABLE_ADMIN_TOOLS=true` in local/standalone MCP and production `/mcp`; prefer normal check-in whenever a valid `lock_token` is available.

## Versioning rules

- `patch_agent_output` uses per-agent output versions. If an agent has not written output yet, the backend treats the existing output version as `0` before incrementing it.
- Therefore, the first `expected_agent_version` for an agent output write must be `0`.
- Stage helper tools (`<stage>_update_output`) default omitted `expected_agent_version` to `0` to make first writes safer.
- `patch_agent_output` also requires the active `lock_token` from checkout. Replaying the exact same `patch_agent_output` payload can be idempotent and return the existing record with `idempotent: true`, depending on backend state.
- `mark_agent_complete` always requires the active `lock_token` and `expected_record_version`. Use the `version` from the latest record snapshot returned by `create_request`, `get_request`, `patch_agent_output`, or a previous completion call.
- If `expected_record_version` is stale and the completion is not already reflected in the record, the backend returns HTTP `409` and the MCP tool returns `conflict`.

## Core tools

Registered core tool names:

- `save_json_blob_create_request`
- `save_json_blob_get_request`
- `save_json_blob_list_pending_requests`
- `save_json_blob_patch_agent_output`
- `save_json_blob_mark_agent_complete`
- `save_json_blob_checkout_request`
- `save_json_blob_refresh_lock`
- `save_json_blob_checkin_request`
- `save_json_blob_force_unlock` (admin-only, registered only when `MCP_ENABLE_ADMIN_TOOLS=true`)
- `save_artifact`
- `save_artifact_chunk`
- `list_artifacts_for_request`
- `ping`

## Artifact tools

Artifact tools are registered by the production Netlify `/mcp` entry point. They store binary bytes in the artifact blob store and keep workflow state/reference metadata in MCP-managed indexes.

### `save_artifact`

Single-shot byte upload. Agents must call this immediately after creating image, audio, video, binary, or markdown bytes, then store only the returned `ArtifactReference`; never invent deterministic `blobKey` values, URLs, or repo paths. Writes the final artifact blob and a request artifact index entry.

Required fields:

- `requestId: string` - workflow request id that owns the artifact.
- `artifactKind: "image" | "audio" | "video" | "binary" | "markdown"` - storage routing kind.
- `contentType: string` - MIME type for the artifact bytes.
- `payload: string` - artifact bytes, base64 by default.

Optional fields:

- `filename: string` - used only for the final blob extension.
- `encoding: "base64" | "binary"` - defaults to `base64`.
- `metadata: object` - saved in the returned `ArtifactReference`.

Success returns the same shape as the upload function: `ok`, `complete: true`, `deduped`, and `artifact`. If bytes already exist for the checksum, `deduped: true` is a successful response and bytes are not rewritten.

### `save_artifact_chunk`

Chunked byte upload. Agents must call this immediately for large created artifacts, then store only the final returned `ArtifactReference`; never invent deterministic `blobKey` values, URLs, or repo paths. Writes one chunk blob to the upload session. When all chunks exist, the server assembles the final artifact blob and writes the request artifact index.

Required fields:

- `requestId: string` - workflow request id that owns the artifact.
- `artifactKind: "image" | "audio" | "video" | "binary" | "markdown"` - storage routing kind.
- `contentType: string` - MIME type for the complete artifact bytes.
- `clientUploadId: string` - stable UUID shared by every chunk in this upload.
- `chunkIndex: integer` - zero-based chunk index.
- `totalChunks: integer` - total chunks in the upload.
- `payload: string` - chunk bytes, base64 by default.

Optional fields: `filename`, `encoding`, and `metadata` match `save_artifact`.

Success returns `complete: false` until all chunks are present. The final chunk returns `complete: true`, `deduped`, and `artifact`. Re-sending chunks or re-finalizing is safe; checksum dedup returns success and does not rewrite final bytes.

### `list_artifacts_for_request`

Lists request artifact references from the artifact index only. This tool reads metadata and does not read or write artifact bytes.

Required fields:

- `requestId: string` - workflow request id whose artifact references should be listed.

Success returns `artifacts: ArtifactReference[]`.

### `save_json_blob_create_request`

Calls backend action `create_request` and returns `record`.

Required fields:

- `input: content_source.v1` - structured workflow input with required discriminators `record_type: "content_source"` and `schema_version: "content_source.v1"`.

Optional fields:

- `request_id: string` - generated as `req_<uuid>` by the MCP server when omitted.

The production Netlify `/mcp` `inputSchema` exposes a structured `content_source.v1` object for `input`, not a generic payload. The top-level schema allows these sections only:

- `ids`
- `publication_context`
- `content`
- `taxonomy`
- `seo`
- `media`
- `editorial`
- `sources`
- `claims`
- `compliance`
- `commercial`
- `approvals`
- `publication`
- `workflow`
- `revision_control`
- `versioning`

Important agent-facing field descriptions:

- `content.title`: working or final article title agents should use for the content source.
- `editorial.draft_markdown`: Markdown draft body agents can pass between drafting, revision, and publishing steps.
- `publication.publish_payload`: publication payload used by the publishing step; include `slug`, `title`, and article body fields when ready to publish.
- `workflow.workflow_id`: workflow identifier agents should preserve across handoffs and backend workflow records.
- `versioning.record_version`: content-source record version agents should increment or preserve for revision tracking.

`additionalProperties` is disabled for the MCP-exposed structured objects unless extension data is intentionally open, such as agent-generated block payloads, media planning fields, image prompt registers, claims, compliance requirements, commercial offers, and revision-control item arrays.

Minimum sample backend request body:

```json
{
  "action": "create_request",
  "request_id": "req_123",
  "input": {
    "record_type": "content_source",
    "schema_version": "content_source.v1",
    "content": {
      "schema_version": "content_blocks.v1",
      "title": "Skin barrier basics"
    },
    "editorial": {
      "schema_version": "editorial.v1",
      "draft_markdown": "# Skin barrier basics\n\nDraft body..."
    },
    "workflow": {
      "schema_version": "content_workflow.v1",
      "workflow_id": "req_123"
    },
    "versioning": {
      "schema_version": "versioning.v1",
      "record_version": 1
    }
  }
}
```

Publication-ready sample fragment:

```json
{
  "publication": {
    "schema_version": "publication.v1",
    "publication_status": "ready",
    "publish_payload": {
      "slug": "skin-barrier-basics",
      "title": "Skin Barrier Basics",
      "markdown": "# Skin Barrier Basics\n\nArticle body...",
      "description": "A practical explanation of the skin barrier."
    }
  }
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

### `save_json_blob_checkout_request`

Calls backend action `checkout_request` and returns `record` containing `record.lock.token`. Call this before any output patch or completion mutation.

Required fields:

- `request_id: string`
- `owner_id: string` - stable id for the agent or process holding the lock.
- `owner_label: string` - human-readable owner label.

Optional fields:

- `lease_seconds: number` - positive integer; backend default applies when omitted.

Sample backend request body:

```json
{
  "action": "checkout_request",
  "request_id": "req_123",
  "owner_id": "agent_1",
  "owner_label": "Research agent",
  "lease_seconds": 900
}
```

### `save_json_blob_refresh_lock`

Calls backend action `refresh_lock` and returns `record`. Use this before the lock expires if the agent needs more time before patching, marking complete, or checking in.

Required fields:

- `request_id: string`
- `lock_token: string` - token returned by checkout.

Optional fields:

- `lease_seconds: number` - positive integer; backend default applies when omitted.

Sample backend request body:

```json
{
  "action": "refresh_lock",
  "request_id": "req_123",
  "lock_token": "lock_123",
  "lease_seconds": 900
}
```

### `save_json_blob_checkin_request`

Calls backend action `checkin_request` and returns `record`. Use this after patching output and marking complete to release the lock.

Required fields:

- `request_id: string`
- `lock_token: string` - token returned by checkout.

Sample backend request body:

```json
{
  "action": "checkin_request",
  "request_id": "req_123",
  "lock_token": "lock_123"
}
```

### `save_json_blob_force_unlock`

Admin-only emergency tool registered only when `MCP_ENABLE_ADMIN_TOOLS=true`. Calls backend action `force_unlock` and returns `record`. Prefer `save_json_blob_checkin_request` when a valid `lock_token` exists.

Required fields:

- `request_id: string`

Sample backend request body:

```json
{
  "action": "force_unlock",
  "request_id": "req_123"
}
```

### `save_json_blob_patch_agent_output`

Calls backend action `patch_agent_output` and returns `record`.

Required fields:

- `request_id: string`
- `agent_name: string` - normalized to the supported agent-name allow-list.
- `expected_agent_version: number` - nonnegative integer. Use `0` for the first write for that agent.
- `lock_token: string` - token returned by checkout.
- `output: any`

Sample backend request body:

```json
{
  "action": "patch_agent_output",
  "request_id": "req_123",
  "agent_name": "research",
  "expected_agent_version": 0,
  "lock_token": "lock_123",
  "output": { "notes": [] }
}
```

### `save_json_blob_mark_agent_complete`

Calls backend action `mark_agent_complete` and returns `record`.

Required fields:

- `request_id: string`
- `agent_name: string` - normalized to the supported agent-name allow-list.
- `expected_record_version: number` - nonnegative integer from the latest record snapshot.
- `lock_token: string` - token returned by checkout.

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
  "lock_token": "lock_123",
  "next_agent": "angle",
  "workflow_status": "in_progress"
}
```

### `ping`

Diagnostic tool that confirms the MCP server is reachable.

Required fields: none.

Sample tool result:

```json
{
  "ok": true,
  "server": "Dr_Lurie_Science_MCP"
}
```

## Stage helper tools

The server also registers underscore-only helper tools for every allowed stage (`reader_insight`, `research`, `angle`, `draft`, and `final_article`):

- `<stage>_update_output(request_id: string, output: any, lock_token: string, expected_agent_version?: number)` calls `patch_agent_output` with the stage hardcoded as `agent_name`. If `expected_agent_version` is omitted, it defaults to `0` for the first write.
- `<stage>_mark_complete(request_id: string, expected_record_version: number, current_stage?: string | null, next_agent?: string | null, workflow_status?: string, needs_review?: boolean, last_error?: string | null, lock_token?: string)` calls `mark_agent_complete` with the stage hardcoded as `agent_name`. `current_stage` and `next_agent` are optional and normalized to the backend allow-list when provided. Pass the active `lock_token` from checkout for successful backend mutation.

Common helper transitions:

- `reader_insight_mark_complete`: set `next_agent` to `research`.
- `research_mark_complete`: set `next_agent` to `angle`.
- `angle_mark_complete`: set `next_agent` to `draft`.
- `draft_mark_complete`: set `next_agent` to `final_article`.
- `final_article_mark_complete`: set `next_agent` to `null` with `workflow_status: "completed"`.

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
    "lock_token": "lock_123",
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
    "lock_token": "lock_123",
    "next_agent": "research"
  }
}
```

Complete final article and close the workflow with no next agent:

```json
{
  "tool": "final_article_mark_complete",
  "arguments": {
    "request_id": "req_123",
    "expected_record_version": 10,
    "lock_token": "lock_123",
    "current_stage": "final_article",
    "next_agent": null,
    "workflow_status": "completed",
    "needs_review": false,
    "last_error": null
  }
}
```
