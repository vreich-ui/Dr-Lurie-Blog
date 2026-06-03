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

## Agent output envelope examples

Each agent should patch its stage output with `save_json_blob_patch_agent_output` (or the stage-specific `*_update_output` helper). Store one schema-versioned envelope in `record.agent_outputs.{agent_name}.output`; put stage-specific fields under `data`, routing notes under `handoff`, and non-contract extension fields under `metadata`.

### `reader_insight`

```json
{
  "schema_version": "agent_output.v1",
  "agent_name": "reader_insight",
  "summary": "Reader need, concern, and desired takeaway.",
  "data": {
    "audience_questions": ["What should I do first?"],
    "reader_risks": ["May confuse normal aging changes with disease."],
    "recommended_angle_inputs": ["Emphasize calm, non-alarmist guidance."]
  },
  "handoff": {
    "next_agent": "research",
    "notes": "Prioritize claims that need sources."
  },
  "metadata": {}
}
```

### `research`

```json
{
  "schema_version": "agent_output.v1",
  "agent_name": "research",
  "summary": "Evidence map and source-backed claim list.",
  "data": {
    "sources": [{ "source_id": "src_1", "name": "Source name", "url": "https://example.com" }],
    "claims": [{ "claim_id": "claim_1", "claim_text": "A verifiable claim.", "source_ids": ["src_1"] }],
    "open_questions": ["Needs a stronger source for ingredient comparison."]
  },
  "handoff": {
    "next_agent": "angle",
    "notes": "Use claim_1 only with the linked source."
  },
  "metadata": {}
}
```

### `angle`

```json
{
  "schema_version": "agent_output.v1",
  "agent_name": "angle",
  "summary": "Approved editorial angle and structure.",
  "data": {
    "thesis": "The article should explain the issue without anti-aging panic.",
    "outline": [{ "section_id": "intro", "heading": "Why this changes" }],
    "compliance_requirements": [
      { "requirement_id": "req_1", "category": "medical_claim", "description": "Avoid diagnosis language." }
    ]
  },
  "handoff": {
    "next_agent": "draft",
    "notes": "Draft to the outline and preserve compliance requirements."
  },
  "metadata": {}
}
```

### `draft`

```json
{
  "schema_version": "agent_output.v1",
  "agent_name": "draft",
  "summary": "Draft article body ready for final editing.",
  "data": {
    "draft_markdown": "## Draft section\n\nDraft body...",
    "content_blocks": [{ "block_id": "intro", "block_type": "markdown", "payload": "Intro copy" }],
    "revision_requests": [{ "request_id": "rev_1", "instruction": "Tighten the intro." }]
  },
  "handoff": {
    "next_agent": "final_article",
    "notes": "Resolve rev_1 before publishing."
  },
  "metadata": {}
}
```

### `final_article`

```json
{
  "schema_version": "agent_output.v1",
  "agent_name": "final_article",
  "summary": "Final article and publish payload are ready.",
  "data": {
    "final_markdown": "---\ntitle: Example\n---\n\nFinal body...",
    "publication": {
      "publish_payload": {
        "slug": "example-article",
        "title": "Example Article",
        "markdown": "---\ntitle: Example\n---\n\nFinal body...",
        "tags": ["skin-health"]
      }
    },
    "validation": {
      "has_slug": true,
      "has_title": true,
      "has_article_body": true
    }
  },
  "handoff": {
    "next_agent": null,
    "notes": "Publish or hand off to the server-side publisher, then mark published."
  },
  "metadata": {}
}
```
