# CMS Design Principles — the flexible backbone

> **Status: governing.** Records Wolf's 2026-07-08 direction. Where the earlier
> phased-plan / "faithful reproduction" / "new component type per page" framing
> conflicts with anything here, **this governs** — those were migration tactics,
> this is the destination.

## North star

We are building a **flexible content backbone, not a replica of the current site.**
The object model exists so an agent can compose **many different pages and
scenarios** from a **small set of reusable, configurable components** — the same
`content_grid` serving a "start here" list on one page, a "latest posts" feed on
another, a "featured products" row on a third.

**We are explicitly NOT trying to reproduce today's pages one-for-one with objects.**
Making the live site come out unchanged was a way to migrate safely — a checkpoint,
not the goal. The goal is objects an agent can freely reconfigure to play different
roles.

## The rules

### 1. Reusable pattern-components, not per-page replicas

Prefer a generic component an agent configures over a bespoke type that only knows
how to render one page. If a page needs a shape the catalog doesn't cover,
**generalize an existing component to cover the pattern, or add a new _reusable_
type** — never a one-off that renders exactly one page and nothing else.

- ✅ `content_grid` with `{ limit, source }` an agent sets — start-here list, latest feed, product row.
- ❌ a `five_simple_places` grid hardcoded to the homepage's exact 5 cards.

### 2. The data schema is the agent↔component bridge

A component is only as flexible as the configuration it exposes in its object
`data`. Every reusable component must let an agent set the things that make it play
a different role — cell counts, content sources, copy, links, media — through the
schema, surfaced via `object_contract` editor hints. **"Bridging the gap between the
agent and the component" means: if an agent can't reconfigure it without a code
change, the component isn't done.**

### 3. Sensible fallbacks, never invented content

A configurable component degrades gracefully when it isn't curated. The grid's
settled design (**amendment M-8**) is the model: **manual-primary with query
fallback** — an agent curates specific items; when there are fewer than `limit`,
backfill from a query (e.g. latest posts). Reference integrity forbids fake or
placeholder items, so "not yet curated" resolves to the fallback — **never** to
hardcoded make-believe cards.

### 4. Byte-identical cutover was migration safety, not "done"

An empty `build-diff` proved a cutover changed nothing on the live site — a safety
property while migrating, nothing more. Once a surface is object-backed, "matches
the old markup exactly" is **not** the definition of done. **"An agent can now
reconfigure this to do something else" is.**

## What this means for the current state (2026-07-08)

- **Homepage grid** — retire the transitional `static` placeholder to the flexible
  **manual + query-fallback** config (M-8). Its five "Five simple places to begin"
  cards reference articles that don't exist and are invalid as manual items anyway;
  uncurated ⇒ latest-posts fallback. _(Done: PR #380 switched the start grid to a
  `query` source; 2026-07-10 removed `static` from the schema entirely — the
  sanctioned `cards` source of curated copy cells replaced it, and BOTH homepage
  grids are now shared `content_grid` objects — one type, two roles by config.)_
- **Bespoke section types (`about`, `contact`, `thank_you`)** — these are the
  Rule 1 anti-pattern: each renders exactly one page. They were an expedient
  migration. **Do not mint more of them.** Prefer generalizing into reusable
  building blocks (e.g. a configurable "prose page", "widget stack", "feature grid",
  "form" an agent composes). Refactoring the existing three is optional cleanup;
  **not** repeating the pattern is mandatory.
- **Remaining page migrations (`pricing`, `services`, `shop-preview`)** — build them
  from **reusable** components an agent can reconfigure, not new per-page types.
  Accept a non-empty `build-diff` when the flexible result is intentionally not
  byte-identical (review the diff instead of gating on emptiness).
- **Superseded where conflicting:** `static` content_grid cards, OQ-14's "new
  component type per pattern (recommended)", and the "faithful reproduction" TODO
  framing in `object-inventory.md`.

## Litmus test for any new object work

Before adding a section type or shaping a page, ask: **"Could an agent point this at
different content, or reuse it on another page, without a code change?"** If no,
you're building a replica, not backbone — stop and generalize.
