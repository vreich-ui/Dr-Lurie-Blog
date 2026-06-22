# MCP tool schema notes

Production `/mcp` registers workflow tools plus the retained artifact tools:

- `create_artifact_upload_intent`
- `create_artifact_from_url` (preferred fallback for restricted clients)
- `save_artifact` (legacy tiny base64 compatibility only)
- artifact listing/admin tools such as `list_artifacts_for_request`, `get_artifact_metadata`, `list_artifacts_by_kind`, `list_artifacts_by_request`, `search_artifacts`, `soft_delete_artifact`, `restore_artifact`, `migrate_artifact_indexes`, `wipe_blob_stores`, and `reconcile_artifact_indexes`

Generated binary files and images should use `create_artifact_upload_intent`, then raw HTTP `POST /api/artifacts/upload` with `application/octet-stream` and the returned required headers.

Clients that cannot perform raw binary POST should use `create_artifact_from_url` to trigger a server-side fetch of a public HTTPS URL. This tool requires `requestId`, `artifactKind`, `contentType`, `sourceUrl`, `expectedSizeBytes`, and `expectedSha256`. The server verifies integrity and format before saving. In production, it is highly recommended to set the `ARTIFACT_URL_INGEST_ALLOWED_HOSTS` environment variable to limit ingestion to trusted domains.

`save_artifact` accepts a single base64 payload and remains only for legacy/tiny-artifact clients. It writes the final artifact blob and retained ArtifactReference indexes.

Legacy MCP JSON chunk and upload-session tools are intentionally no longer registered.

## article_body.v1 admin-publish drafts

For new admin-publish drafts, agents should prefer `input.content.article_body` over legacy Markdown fields:

```json
{
  "validation_mode": "admin_publish_draft",
  "input": {
    "record_type": "content_source",
    "schema_version": "content_source.v1",
    "content": {
      "schema_version": "content_blocks.v1",
      "title": "Why Your Skin Barrier Gets Dry in Winter",
      "article_body": {
        "schema_version": "article_body.v1",
        "nodes": [
          {
            "id": "n_a1b2c3",
            "kind": "content",
            "public": {
              "title": "Winter dryness is usually a barrier problem",
              "body": "Cold air, indoor heat, and low humidity can make the skin barrier lose water faster than usual."
            }
          },
          {
            "id": "n_b4c5d6",
            "kind": "placement",
            "public": {
              "label": "Contextual offer",
              "body": "Consider a simple fragrance-free moisturizer routine if your skin feels tight.",
              "ctaText": "Shop barrier-support basics",
              "ctaLink": "https://example.com/barrier-care"
            },
            "commercial": {
              "type": "offer",
              "source": "firstParty",
              "disclosure": { "required": true, "label": "Offer", "mode": "nearby" }
            },
            "rendering": { "presentation": "offerCard", "placement": "inline" }
          },
          {
            "id": "n_c7d8e9",
            "kind": "interactive",
            "public": {
              "title": "Ask a follow-up question",
              "body": "Use the chat prompt to apply this guidance to a routine."
            },
            "chat": {
              "invitationText": "Ask about your winter skin routine.",
              "suggestedQuery": "How should I adjust my moisturizer if my skin feels tight by noon?"
            },
            "rendering": { "presentation": "chatInvite", "placement": "footer" }
          }
        ]
      }
    },
    "publication": {
      "schema_version": "publication.v1",
      "publication_status": "draft",
      "publish_payload": {
        "slug": "winter-skin-barrier-care",
        "title": "Why Your Skin Barrier Gets Dry in Winter",
        "author": "Dr. Lurie"
      }
    }
  }
}
```

Minimum body: `content.article_body.nodes` must contain at least one node, and at least one node must be public or omit `visibility`. Use `node.public` for all visible copy. `node.private` is internal strategy/editor metadata and must never be rendered or repurposed as visible article copy.

Legacy fallback remains supported for older agents and publishing paths: `publication.publish_payload.markdown`, `publication.publish_payload.content`, `editorial.draft_markdown`, or `content.blocks[]` markdown. Treat `publication.publish_payload.markdown` as a generated fallback derived from `content.article_body`, not the preferred authoring source.

If registered, `save_json_blob_create_article_draft` is a convenience helper that accepts the same `input` and optional `request_id` as `save_json_blob_create_request` and always sends `validation_mode: "admin_publish_draft"`.
