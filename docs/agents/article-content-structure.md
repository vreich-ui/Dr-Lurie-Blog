# Structured Article Content Structure (article_body.v1)

This document defines the structured format for article content in the agent-first publishing CMS. This system moves away from flat markdown towards a node-based structure that allows for rich metadata, commercial integration, and agent-driven optimizations.

## Why this exists

- **Agent-First Workflows**: Allows agents to understand the _intent_ and _strategy_ behind each part of an article.
- **Commercial Integration**: Provides first-class support for ad slots, product mentions, and affiliate offers without polluting the content body.
- **Interactive Features**: Enables per-node chat invitations and global chat configurations.
- **Rendering Flexibility**: Decouples content from specific UI widgets while providing presentation hints.

## Canonical JSON Example

```json
{
  "schema_version": "article_body.v1",
  "nodes": [
    {
      "id": "n_1a2b3c",
      "kind": "content",
      "public": {
        "eyebrow": "Introduction",
        "title": "Why You Need a Good CMS",
        "body": "In today's fast-paced world, having a robust CMS is crucial for any publishing business."
      },
      "private": {
        "strategy": "hook",
        "intent": "educate",
        "agentNotes": "Focus on the pain points of manual publishing."
      }
    },
    {
      "id": "n_4d5e6f",
      "kind": "action",
      "public": {
        "ctaText": "Check out our product",
        "ctaLink": "https://example.com/product"
      },
      "commercial": {
        "type": "housePromotion",
        "source": "firstParty"
      },
      "rendering": {
        "presentation": "callout",
        "emphasis": "high"
      }
    }
  ],
  "chat": {
    "enabled": true,
    "welcomeMessage": "Hi! Do you have any questions about this article?"
  }
}
```

## Legacy Fallback Rule

Legacy articles can be represented as a single node to maintain compatibility:

- **kind**: `"content"`
- **public.body**: The legacy markdown or HTML content.

## Private Metadata Leak Rules

- **`node.private`**: Fields under `private` (like `strategy`, `intent`, `agentNotes`) **must never** be rendered or serialized to the reader-facing page. These are for internal agent and editorial use only.
- **Editorial Strategy Names**: Strategy names (e.g., `hook`, `agitation`, `proof`) are internal identifiers and should not appear in the UI.

## Commercial/Offer/Ad/Product Mention Rules

Commercial intent is captured in the `node.commercial` field. This allows for:

- Standardized disclosure management (required, label, mode).
- Structured ad slot definitions (provider, ad unit path, sizes).
- Product and offer metadata (coupon codes, expiration, terms).
- SEO-friendly link attributes (`rel="sponsored"`).

## Chat Config vs Chat Invitation Node

- **Global Chat (`article_body.chat`)**: Configures the overall chat experience for the article (enabled state, welcome message, etc.).
- **Node-level Chat Invitation (`node.chat`)**: Allows specific nodes to "invite" the reader to chat with a contextual message or suggested query.

## Data Independence from Widgets/UI

The schema defines _what_ the content is and _how_ it should be emphasized, but it does not reference specific Astro components or UI widgets.

- Use `rendering.presentation` (e.g., `card`, `callout`, `section`) to hint at the desired layout.
- Use `rendering.emphasis` (e.g., `low`, `medium`, `high`) to guide the visual weight.
- The actual implementation of these hints is up to the frontend rendering engine.

## Validation Rules

1. **Node IDs**: Must be opaque stable IDs (e.g., `n_8f31a2`). They **must not** include descriptive strategy words like `hook`, `agitation`, `cta`, `advert`, `offer`, etc.
2. **Required Nodes**: At least one node must be present in the `nodes` array.
3. **Kind**: Each node must have a valid `kind` (`content`, `action`, `placement`, `interactive`, `reference`).

## Input Templates (Editor/Agent Help)

To assist editors and agents in creating structured content, the system provides **Input Templates**.

- **Purpose**: Templates act as blueprints for common node types (e.g., `prose_section`, `commerce_offer`, `faq`).
- **Input Helpers Only**: These templates are strictly helpers for data entry. They are **not** UI component references or widget names.
- **Data Independence**: A node created from a `commerce_offer` template is just a `placement` kind node with specific public and commercial metadata. The frontend decides how to render it based on its `kind` and `rendering.presentation` hint, not by looking up the template ID.
- **Opaque IDs**: All nodes generated from templates receive a stable, opaque ID (e.g., `n_8f31a2`) to ensure reader privacy and data independence.
