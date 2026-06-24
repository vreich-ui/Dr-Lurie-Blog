# Tool schema notes

The standalone MCP package mirrors the production workflow tool names.

Publication tools expose only `save_json_blob_publish_by_time` for timestamp-based publishing. Publication control is `input.publication.published_time`:

- `null` or missing: not live
- future ISO timestamp: scheduled
- current/past ISO timestamp: due/live

Publishing reads `content.article_body` only.
