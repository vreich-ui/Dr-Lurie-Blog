# save-json-blob MCP server

Private stdio MCP package for Agent Builder / local MCP usage. It wraps:

```text
${SAVE_JSON_BLOB_BASE_URL}/.netlify/functions/save-json-blob
```

Full tool schemas, versioning rules, sample calls, and deployment notes live in [`docs/tool-schema.md`](./docs/tool-schema.md).

## Required environment

- `NETLIFY_PUBLISH_SECRET` - sent only as the `x-publish-key` header. Never pass it as a tool argument.
- `SAVE_JSON_BLOB_BASE_URL` - production site root without a path or trailing slash, for example `https://example.netlify.app`.

## Run locally

This package is private and is not published to npm:

```sh
npm install
npm start
```

Startup diagnostics are written to `stderr` and include only whether the base URL and publish secret are present, plus the registered tool names. The secret value is never printed.

## Tool names

Core tools:

- `save_json_blob_create_request`
- `save_json_blob_get_request`
- `save_json_blob_list_pending_requests`
- `save_json_blob_patch_agent_output`
- `save_json_blob_mark_agent_complete`

Stage helpers:

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

Backend action payloads are unchanged; the MCP tool names are underscore-only to avoid clients that treat dots as path separators.

## Versioning summary

- First `expected_agent_version` for a stage output write is `0`.
- `<stage>_update_output` defaults omitted `expected_agent_version` to `0`.
- `save_json_blob_mark_agent_complete` and `<stage>_mark_complete` always require `expected_record_version` from the latest record snapshot.

## Test

```sh
npm test
```

The integration test requires `NETLIFY_PUBLISH_SECRET` and `SAVE_JSON_BLOB_BASE_URL`; Node reports it as skipped if either variable is missing.
