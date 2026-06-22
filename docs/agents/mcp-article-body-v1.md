# MCP article_body.v1 draft guide

Use this guide when creating admin-publish drafts through the Dr. Lurie MCP server.

## Publication status semantics

- `publication_status: "draft"` means the article payload is not publishable yet.
- `publication_status: "ready"` means the article should be published now through the immediate publishing path.
- `publication_status: "scheduled"` plus `scheduled_for` means the article should be published later by the due scheduled-publish path.
- `workflow_status: "published"` is set only after an actual successful publish, never as a substitute for publishing.

## Preferred body field

For new structured article drafts, put reader-facing content in:

```json
input.content.article_body.schema_version = "article_body.v1"
input.content.article_body.nodes = []
```

Minimum valid body: `nodes` must contain at least **one** node, and at least one node must be public or omit `visibility`.

Use `node.public` for visible copy. `node.private` is internal strategy/editor metadata only and must never be used as visible article copy.

## Legacy fallback

Legacy publishers may still need Markdown. Treat `publication.publish_payload.markdown` as a generated fallback derived from `content.article_body`, not the preferred authoring field. Older body locations remain accepted for compatibility:

1. `publication.publish_payload.markdown`
2. `publication.publish_payload.content`
3. `editorial.draft_markdown`
4. `content.blocks[]` markdown payloads where `block_type === "markdown"`

## Preferred helper tool

If available, call `save_json_blob_create_article_draft`. It wraps `save_json_blob_create_request` with `validation_mode: "admin_publish_draft"`.

## Copy/paste helper payload

```json
{
  "request_id": "req_article_body_example_001",
  "input": {
    "record_type": "content_source",
    "schema_version": "content_source.v1",
    "content": {
      "schema_version": "content_blocks.v1",
      "title": "Why Your Skin Barrier Gets Dry in Winter",
      "description": "A practical guide to winter barrier care.",
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
              "body": "If your routine needs a gentle reset, consider a fragrance-free moisturizer and daily sunscreen.",
              "ctaText": "Shop barrier-support basics",
              "ctaLink": "https://example.com/barrier-care"
            },
            "commercial": {
              "type": "offer",
              "source": "firstParty",
              "disclosure": {
                "required": true,
                "label": "Sponsored or affiliate offer",
                "mode": "nearby"
              }
            },
            "rendering": {
              "presentation": "offerCard",
              "placement": "inline"
            }
          },
          {
            "id": "n_c7d8e9",
            "kind": "interactive",
            "public": {
              "title": "Ask a follow-up question",
              "body": "Want help adapting this advice to your routine? Use the chat prompt below."
            },
            "chat": {
              "invitationText": "Ask Dr. Lurie’s guide about your winter skin routine.",
              "suggestedQuery": "How should I adjust my moisturizer if my skin feels tight by noon?"
            },
            "rendering": {
              "presentation": "chatInvite",
              "placement": "footer"
            }
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
        "author": "Dr. Lurie",
        "description": "A practical guide to winter barrier care.",
        "draft": true
      }
    },
    "editorial": {
      "schema_version": "editorial.v1",
      "writer_notes": "Use article_body as canonical content. Generate publication.publish_payload.markdown only if a legacy publishing path needs it."
    }
  }
}
```

## Copy/paste create_request payload

Use this when the helper is not available:

```json
{
  "validation_mode": "admin_publish_draft",
  "request_id": "req_article_body_example_001",
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
              "body": "A contextual offer can be shown near practical routine advice.",
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
              "body": "Use the chat prompt if you want help applying this guidance."
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
