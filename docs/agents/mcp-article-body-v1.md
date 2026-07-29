# MCP article body v1

> **HISTORICAL (2026-07-29).** The tool sequence below belongs to the legacy
> `save_json_blob_*` pipeline, deleted with that pipeline (ruling OQ-W11-6).
> `article_body.v1` still exists as CMS-Agent's composition schema, but on the
> Dr-Lurie side it maps into a `content_item` object body — see
> [`cms-agent-contract-alignment.md`](cms-agent-contract-alignment.md) §2 for
> the mapping and [`publishing-policy.md`](publishing-policy.md) for the live
> publish path.

`content.article_body` with `schema_version: "article_body.v1"` is the canonical article body. Publishing reads only this structured body.

Agents may continuously edit `article_body.nodes` while holding a workflow lock. Reader-visible content belongs in node `public` fields; `private`, `commercial`, and `rendering` fields remain structured metadata.

Publication control is timestamp-only through `input.publication.published_time`:

- omit or set `null` to keep/unpublish the article
- set a future ISO timestamp to schedule publication
- call `save_json_blob_publish_by_time` with no timestamp, or with an ISO timestamp at/before server time, to publish now

No agent should store a derived article state. Markdown may be generated as a build artifact, but only from `content.article_body`.
