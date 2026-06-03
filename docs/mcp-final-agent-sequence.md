# MCP final-agent publishing sequence

## Decision: MCP marks publication state only

The production MCP endpoint should expose workflow-state tools, not a tool that directly invokes article publishing. The final article agent must prepare and validate the article, then either hand the payload to the existing server-side publishing path or receive commit/deploy metadata from a trusted server-side publish process. After that publish step has succeeded or been handed off, MCP records the state transition with `save_json_blob_mark_published`.

This separation keeps publication credentials in server-only runtimes, avoids adding publish credentials to MCP tool schemas or model-facing instructions, and preserves the existing `publish-article` Netlify Function as the single place that performs repository writes.

## Final-agent sequence

1. **Validate final article output.** The final agent must verify that the final article has a destination `slug`, a `title`, and one article body field (`markdown` preferred, `content` acceptable). It should also validate optional metadata such as `publishDate`, `author`, `tags`, images, SEO/excerpt fields, and overwrite intent before publishing or handoff.
2. **Produce `publication.publish_payload`.** Store the normalized payload on the workflow input at `publication.publish_payload` (or include an equivalent final article output for the server-side handoff). Use this shape as the source of truth for the publish step.
3. **Publish or hand off.** MCP does not publish directly. A trusted server-side process may read `record.input.publication.publish_payload` or the final article output, validate it again, invoke the existing publishing endpoint with server-only credentials, and return commit/deploy metadata. If publishing is handled outside the agent runtime, hand off the payload and wait for the same metadata.
4. **Mark published.** With the workflow lock still held, call `save_json_blob_mark_published` with `request_id`, `lock_token`, and `commit_metadata`. The tool forwards `mark_published` to `save-json-blob.ts` and returns the updated workflow record with `workflow_status: "published"`.
5. **Check in.** Release the workflow lock with `save_json_blob_checkin_request` after the record is marked published.

## `save_json_blob_mark_published` inputs

- `request_id`: workflow record id.
- `lock_token`: active lock token acquired through checkout.
- `commit_metadata`: publication result details such as commit SHA, commit URL, article path, deploy status, and a human-readable message.

The mark-published step records publication state only. It must not accept, request, display, or return server publish credentials.
