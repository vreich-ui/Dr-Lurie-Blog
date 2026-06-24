# save-json-blob MCP server

Standalone MCP mirror for the Dr. Lurie save-json-blob workflow tools.

Article publication is timestamp-based. The exposed publishing tool is `save_json_blob_publish_by_time`; it accepts `request_id`, `lock_token`, and optional `published_time`.

Publishing input is always `input.content.article_body` with `schema_version: "article_body.v1"`. Markdown output is an artifact derived from that structured body, not a source of truth.
