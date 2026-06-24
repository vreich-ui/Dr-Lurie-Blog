# Workflow map

The canonical workflow contract lives in `src/schema/workflow-contract.ts`.

Article publication is not represented as a stored workflow/article state. Agents keep editing `input.content.article_body` while holding a workflow lock. Publication is controlled only by `input.publication.published_time`:

- missing, invalid, or `null`: not live and not scheduled
- valid ISO timestamp in the future: scheduled by time
- valid ISO timestamp at or before server time: publish/live

Use `save_json_blob_publish_by_time` to set the timestamp. The tool validates the existing lock, validates `content.article_body.schema_version === "article_body.v1"`, publishes only from `content.article_body` when due, and records commit/deploy receipt metadata after successful publishing.
