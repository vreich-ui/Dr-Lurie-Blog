# Core Structure — the one document to read first

> **The core of cores.** If this file and a canonical example below are understood,
> everything else in `docs/cms-architecture/` is detail. Written for a human first;
> agents read it too. Last updated 2026-07-09.

## What we are building, in one paragraph

An **AI-first, agentic CMS** for direct-to-consumer publishing. Every page, section,
component, and piece of rich content is a **structured JSON object** that AI agents
can independently create, edit, review, version, and publish. Humans set direction;
agents do the manipulation. There is **one structured source of truth** (JSON in the
object store), and the website is just one rendering of it — PDF, email, social, and
API renderings can follow from the same objects.

## Why Astro + Netlify + markdown/JSON exports (the architecture rationale)

The product targets DTC: **landing and offer pages must load fast**, so pages are
pre-built static files (Astro → Netlify CDN). The cost of that speed: a change goes
live only when a **build** runs. That is deliberate and fits the agentic pattern:

- Every edit lives **in JSON only** (the object store) — drafts cost nothing.
- Nothing is visible until an agent triggers the **final publish**, which commits the
  derived exports and runs the build.
- Immediate publishing is not needed; there is **no editorial UI** in scope now.
- MVP scope = **web publishing content only**. Shop and complex functionality are out.

## The system we standardize on: Contentful's content model

We do not invent a content structure. We adopt **Contentful's model** — mature,
JSON-native, hierarchical, built for granular programmatic manipulation, with
open-source types and renderers (`@contentful/rich-text-types`,
`@contentful/rich-text-html-renderer`). It has exactly two layers, and we use both
the way Contentful does:

1. **Entries** — typed objects with named fields. Our Pages, Sections/Components,
   and Navigation **already are this** (typed bodies, validated by schema, edited by
   patch operations). No rework needed at this layer.
2. **Rich Text** — a JSON node tree used _inside_ a field for flowing content:
   paragraphs, headings, quotes, images, and **embedded entries** (other objects
   placed inline). This **replaces our current HTML-string rich text**.

## The three levels, one canonical example each

Copy these shapes when building any new object. Everything else is a variation.

### Level 1 — Page (an entry that owns an ordered list of components)

Exists and works today (8 live pages). A page = route + metadata + ordered sections.

```jsonc
{
  "route": "/start-here",
  "pageType": "standard",
  "title": "Start Here",
  "seo": { "description": "Where to begin with age-aware skin care." },
  "sections": [
    { "id": "s_lede", "type": "lede", "data": { "heading": "Start Here", "actions": [] } },
    {
      "id": "s_grid",
      "type": "content_grid",
      "data": { "heading": "Five places to begin", "source": { "kind": "manual", "items": [] }, "limit": 5 },
    },
    { "id": "s_news", "type": "shared_ref", "data": { "section": "sec_newsletter_signup" } },
  ],
}
```

- Sections are inline (owned by the page) or `shared_ref` (a pointer to a shared
  Section object — edit once, changes everywhere).
- Agent operations: `upsert_section`, `move_section`, `remove_section`,
  `update_section_data`, `set_section_visibility`, `set_page_meta`.

### Level 2 — Component / Section (a typed entry with named fields)

Exists and works today (17 registered types). One component type = one schema +
one renderer + editor hints, registered once. Canonical example — `hero`:

```jsonc
{
  "id": "s_hero",
  "type": "hero",
  "data": {
    "kicker": "Aging skin needs focused care.",
    "heading": "Age-aware skincare is coming.",
    "body": "…rich text field — see Level 3…",
    "actions": [{ "label": "Start Here", "target": { "kind": "route", "href": "/start-here" }, "style": "primary" }],
  },
}
```

**Container rule (bounded composition):** a component that holds other components
declares _what_ it may hold and _how many_ — e.g. `content_grid` → children of type
`card`, max 8. This is Contentful's link validation (`linkContentType` + `size`),
enforced by our validator and advertised to agents by `object_contract`. An agent
can never build a structure the rules don't sanction.

### Level 3 — Rich Text (Contentful's node tree, inside a field)

**The new part.** Every rich-content field (`body` on sections; article bodies
later) becomes a Contentful Rich Text document instead of an HTML string:

```jsonc
{
  "nodeType": "document",
  "data": {},
  "content": [
    {
      "nodeType": "heading-2",
      "data": {},
      "content": [{ "nodeType": "text", "value": "Why skin changes after 60", "marks": [], "data": {} }],
    },
    {
      "nodeType": "paragraph",
      "data": {},
      "content": [
        { "nodeType": "text", "value": "Skin behaves ", "marks": [], "data": {} },
        { "nodeType": "text", "value": "differently", "marks": [{ "type": "italic" }], "data": {} },
        { "nodeType": "text", "value": " — and that changes what works.", "marks": [], "data": {} },
      ],
    },
    {
      "nodeType": "blockquote",
      "data": {},
      "content": [
        {
          "nodeType": "paragraph",
          "data": {},
          "content": [
            {
              "nodeType": "text",
              "value": "Understand the system before choosing the product.",
              "marks": [],
              "data": {},
            },
          ],
        },
      ],
    },
    {
      "nodeType": "embedded-entry-block",
      "content": [],
      "data": { "target": { "sys": { "id": "sec_cta_free_guide", "type": "Link", "linkType": "Entry" } } },
    },
  ],
}
```

How the article-structure example maps (nothing custom needed for most of it):

| Your example block  | Contentful node                                                        |
| ------------------- | ---------------------------------------------------------------------- |
| Hook (opening text) | `paragraph` / `heading-*` nodes                                        |
| Quote               | `blockquote` (native)                                                  |
| Image               | `embedded-asset-block` (native; target = a trusted artifact ref)       |
| Embed               | `embedded-entry-block` (native; target = another object)               |
| Custom AI Block     | `embedded-entry-block` → a registered component type (e.g. `ai_block`) |

**Boundaries here too:** each rich-text field declares its allowed node types,
allowed marks, and which entry types may be embedded (Contentful's
`enabledNodeTypes` / `enabledMarks` / link validations). Our existing sanitizer
allowlist becomes that declaration.

## How an agent changes anything (the one workflow)

```
object_contract(type)   → read the rules: fields, node grammar, allowed embeds, ops
object_checkout         → lock + version
object_validate         → dry-run the change
object_patch            → apply it (JSON only — nothing visible yet)
object_publish          → mark the version publishable
release_to_production   → commit derived exports + Netlify build = actually live
```

Everything is audited and revertible. Approval gates per object type are one config
switch (`src/config/approval-policy.ts`); current posture is fully autonomous.

## Status and the path to done (ordered; sized for a Sonnet-class model)

**Already built and tested** (876 tests): object store + envelope, locks, patch
grammar + inverses, validation, self-describing `object_contract`, publish +
materializers, build-diff harness, 8 live pages, navigation, 17 component types,
container bounds (`allowedChildren`).

| #   | Task                                                                                                                                                            | Size        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | `rich-text-v1` zod schema mirroring Contentful's node types (restricted set above) + adopt `@contentful/rich-text-types` constants                              | S           |
| 2   | Build-time renderer for the document (use `@contentful/rich-text-html-renderer` with custom renderers for embeds/assets)                                        | M           |
| 3   | Migrate section `body` fields: accept legacy HTML string **or** document; convert the committed exports; keep validation allowlist as the node/mark declaration | M           |
| 4   | Resolve `embedded-entry-block` through the existing shared-section resolution; `embedded-asset-block` through artifact refs                                     | M           |
| 5   | Align `content_grid` cells with embeds (`card` children; retire the `static` escape hatch; M-8 query fallback when empty)                                       | M           |
| 6   | Remaining pages (`pricing`, `services`, `shop-preview`) composed from **reusable** components — no new per-page types                                           | S each      |
| 7   | Real `site` + `taxonomy` objects (taxonomy needs a source-of-truth decision first)                                                                              | M           |
| 8   | Articles (`content_item`) onto the same Rich Text model — **later**, its pipeline is deliberately untouched in MVP                                              | L, post-MVP |

Rules that stay in force throughout: one task, one commit; JSON is the source of
truth and git exports are derived; never a bespoke one-page component type again
(see `design-principles.md`); bounded composition is enforced at patch time, not
publish time.

## Supersessions

- This document is the entry point; `design-principles.md` (the flexibility rule)
  and `block-tree.md` (bounded composition) remain valid but are read **after** it.
- `block-tree.md`'s home-grown `children` shape is superseded by Contentful Rich
  Text embeds for flowing content; its `allowedChildren`/`childCount` enforcement
  code stands — it now enforces the standard's link validations.
