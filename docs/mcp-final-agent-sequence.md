# MCP final agent sequence

The final article agent prepares a reviewed `content.article_body` and keeps the workflow lock active through publication.

1. Re-fetch the workflow/request state.
2. Confirm `input.content.article_body.schema_version === "article_body.v1"` and at least one public reader-visible node exists.
3. Publish now by calling `save_json_blob_publish_by_time` with `request_id` and `lock_token` and no `published_time`.
4. Schedule by calling the same tool with a future ISO `published_time`.
5. Unpublish by calling the same tool with `published_time: null`.
6. Check in the workflow lock after a successful mutation.

The publication tool writes `input.publication.published_time` and publish receipt metadata. It does not set a workflow publication state.
