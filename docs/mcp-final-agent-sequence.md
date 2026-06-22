# MCP final-agent publishing sequence

## Decision: MCP marks publication state only

The production MCP endpoint exposes workflow-state tools plus a minimal immediate-publish wrapper for approved `content_source.v1` article drafts. The final article agent must prepare and validate the article, then either call `save_json_blob_publish_article_now` for `publication_status: "ready"`, use the due scheduled-publish path for `publication_status: "scheduled"`, or hand the payload to another trusted server-side publishing process. After an actual successful publish, MCP records the state transition with `save_json_blob_mark_published`.

This separation keeps publication credentials in server-only runtimes, avoids adding publish credentials to MCP tool schemas or model-facing instructions, and preserves the existing `publish-article` Netlify Function as the single place that performs repository writes.

## Final-agent sequence

> **Agent publishing note:** `publication.publish_payload.markdown` and `publication.publish_payload.content` must be body-only article text. Do not include YAML frontmatter, do not send `publishedDate`, and do not add `repoPath` to `artifactReferences`. Use `publishDate` for scheduling/metadata, preserve immutable `ArtifactReference` objects exactly as returned by artifact tools, and let the server build frontmatter and final upload paths.

1. **Validate final article output.** The final agent must verify that the final article has a destination `slug`, a `title`, and one article body field (`markdown` preferred, `content` acceptable). It should also validate optional metadata such as `publishDate`, `author`, `tags`, images, `artifactReferences`, SEO/excerpt fields, and overwrite intent before publishing or handoff.
2. **Produce `publication.publish_payload`.** Store the normalized payload on the workflow input at `publication.publish_payload` (or include an equivalent final article output for the server-side handoff). Include `artifactReferences` for uploaded artifacts and/or `mediaEntries` for existing base64 media. Use this shape as the source of truth for the publish step.
3. **Re-fetch artifact state, then publish or hand off.** MCP does not publish directly. Before publication, re-fetch the current workflow/request state and use the latest immutable `ArtifactReference` objects; do not publish with stale, guessed, or model-generated blob keys. A trusted server-side process may read `record.input.publication.publish_payload` or the final article output, validate it again, resolve `artifactReferences` to media bytes in the existing publishing endpoint with server-only credentials, and return commit/deploy metadata. If publishing is handled outside the agent runtime, hand off the payload and wait for the same metadata.
4. **Mark published.** With the workflow lock still held, call `save_json_blob_mark_published` with `request_id`, `lock_token`, and `commit_metadata`. The tool forwards `mark_published` to `save-json-blob.ts` and returns the updated workflow record with `workflow_status: "published"`.
5. **Check in.** Release the workflow lock with `save_json_blob_checkin_request` after the record is marked published.

## Publication status semantics

- `publication_status: "draft"` means the payload is not publishable yet.
- `publication_status: "ready"` means publish now using `save_json_blob_publish_article_now` or the existing immediate publish path.
- `publication_status: "scheduled"` with `scheduled_for` means publish later through the scheduled-publish path when due.
- `workflow_status: "published"` is set only after an actual successful publish.

## `save_json_blob_mark_published` inputs

- `request_id`: workflow record id.
- `lock_token`: active lock token acquired through checkout.
- `commit_metadata`: publication result details such as commit SHA, commit URL, article path, deploy status, and a human-readable message.

The mark-published step records publication state only. It must not accept, request, display, or return server publish credentials.

## Artifact handling rules

- When agents generate images, binaries, or other artifacts, call an artifact upload tool immediately. For publisher-agent activity, use `create_artifact_upload_intent` plus raw HTTP `POST /api/artifacts/upload` as the default upload path.
- Store the returned `ArtifactReference` in MCP workflow state or the relevant agent output. Persist the whole reference, not just a URL or filename.
- `save_artifact` remains available only for legacy small-artifact MCP compatibility; legacy chunk/session tools are intentionally removed. Artifact listing/admin tools read the retained ArtifactReference indexes.
- Never construct deterministic artifact keys in the model. The artifact tool is authoritative for `blobKey`, checksum, size, content type, and creation timestamp.
- Treat `ArtifactReference` as immutable. Regeneration means a new upload and a new reference.
- On upload or network failure, retry the same payload or direct upload intent and rely on checksum deduplication; do not create alternate handles manually.
- Before publishing, re-fetch the current request state and pass `artifactReferences` to the publishing payload. The `publish-article` function resolves artifact references to base64 media entries before committing to GitHub.
- Agents must never ask for or transmit Netlify/GitHub credentials; upload and publish tools use server-side configuration only.

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
        "tags": ["skin-health"],
        "artifactReferences": []
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
