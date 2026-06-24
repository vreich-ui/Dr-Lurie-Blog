# MCP article body v1

`content.article_body` with `schema_version: "article_body.v1"` is the canonical article body. Publishing reads only this structured body.

Agents may continuously edit `article_body.nodes` while holding a workflow lock. Reader-visible content belongs in node `public` fields; `private`, `commercial`, and `rendering` fields remain structured metadata.

Publication control is timestamp-only through `input.publication.published_time`:

- omit or set `null` to keep/unpublish the article
- set a future ISO timestamp to schedule publication
- call `save_json_blob_publish_by_time` with no timestamp, or with an ISO timestamp at/before server time, to publish now

No agent should store a derived article state. Markdown may be generated as a build artifact, but only from `content.article_body`.
