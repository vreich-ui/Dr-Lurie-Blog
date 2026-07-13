# 08 — Articles Plan (W7): `content_item` onto the object model, bodies onto Rich Text

> **Status (2026-07-13): W7.1 + W7.3 + W7.8 BUILT; W7.9 RUN — `content_item`
> is CONVERTED; W7.4/W7.6 WAIVED.** Wolf's 2026-07-13 directives supersede
> parts of this plan (see §0.5): the committed legacy posts are NOT migrated
> ("mostly junk, not worth the effort") — they stay on the old pipeline; new
> articles are content_item objects end-to-end (schema, node ops + inverses,
> create_variant, validation, materializer, render path, canvas node
> editing). The credentialed run happened 2026-07-13 over the session MCP
> connection: the demo article is live at /object-model-demo, all five
> playbook criteria hold (seed taxonomy fixed to registry terms en route).
> **OQ-W7-1 is RESOLVED (Wolf, 2026-07-13): reverse support is NOT
> required** — no alias layer; MCP tools and functions may be updated,
> changed, or retired, provided functionality survives on the object
> substrate. Still open: W7.2 (sections onto rich text), W7.5 (re-point
> internal surfaces + retire-or-repoint legacy tools — reduced scope, no
> aliases), W7.7 (admin editor + annotation panel + rich-text editing),
> OQ-W7-3 (strategy registry go/no-go).

## 0. Mandate and decisions (Wolf, 2026-07-12 — GOVERNING for W7)

Wolf's four rulings, recorded verbatim in intent:

1. **OQ-8 is RESOLVED: one-time migration.** `content_item` becomes a real
   ObjectRecord type in the object store — not an adapter over the `workflows`
   store. The adapter path (D§1, C§2.3) is retired.
2. **The Contentful Rich Text substrate is built NOW** (core-structure tasks
   1–5, never previously built): sections' `body` fields and article bodies
   both move onto the Rich Text document model.
3. **Articles come onto the edit-mode canvas** as the final phase of W7, if it
   fits the wave (the 07-canvas stop line lifts once articles are
   object-addressable).
4. **Plan doc first** — this document — then phased build.

**The preservation directive (Wolf's words, the key constraint):** _"an article
has to have more data incorporated into it at JSON level for agents to judge,
score and build variants quickly. It incorporates human behavioral theory,
storytelling and such frameworks that all target perfect DTC edge. That is the
key that I want to keep. One paragraph can be a hook and something else and
agents need to know what it is."_

That layer exists today and is documented in
[`docs/agents/article-content-structure.md`](../agents/article-content-structure.md)
and implemented in `src/schema/article-content-v1.ts`:

- **`node.private.strategy`** — hook / agitation / context / explanation /
  proof / example / comparison / myth / step / recommendation / resolution /
  summary (the storytelling framework).
- **`node.private.intent`** — educate / persuade / reassure / convert /
  navigate (the DTC edge), plus `agentNotes`, prompt/template provenance.
- **`node.commercial`** — adSlot / sponsoredPlacement / productMention /
  affiliateMention / partnerResource / offer / housePromotion, with disclosure
  requirements, offer terms, rel attributes.
- **`node.rendering`** hints, **`node.chat`** invitations, node
  **`visibility`** (public / internal / hidden), **opaque node ids** that must
  never leak strategy words to readers, and **input templates** as pure data
  helpers.
- Envelope-level: `emotional_strategy`, `claims`, `sources`, `compliance`,
  `editorial`, `versioning.previous_version_refs`, `ids.parent_content_id`
  (variant lineage), `revision_control.change_assessments` ("add structured
  scores here" — the schema anticipated scoring).

**W7's prime rule: this layer is extended, never flattened.** Every migration
step below is judged first by "does the strategy/commercial/scoring metadata
survive and become MORE agent-usable?"

### §0.5 Supersessions by Wolf, 2026-07-13 (GOVERNING over the phase table)

1. **The committed posts are ignored.** "The committed posts can be ignored,
   they are mostly junk and are not worth the effort." W7.4 (pilot
   migration), W7.6 (full migration + `.md` retirement), the 83-post
   DOM-equivalence harness, and the credentialed `workflows`-store inventory
   are **waived**; §1.5's preservation item and OQ-W7-5/OQ-W7-6 are moot.
   The legacy pipeline keeps serving the committed posts unchanged; the two
   families share one permalink space (article-object slugs are validated
   against committed post ids).
2. **Canvas for articles is mandatory in-wave** (W7.8 confirmed, not
   severable): object-backed article bodies carry per-node chips.
   _Addendum (2026-07-13, second directive):_ **reverse support is not
   required** — resolves OQ-W7-1 (no alias layer; legacy tools/functions may
   be updated or retired); the end goal is articles AND article publishing
   fully on the project-wide object schema without losing functionality.
3. **The annotation layer is the point** (re-affirmed): every block carries
   its context attributes (hook/agitation/resolution + intent etc.) exactly
   as the original architecture defined them — imported from
   `article-content-v1.ts`, never flattened. Vocabulary stays code enums
   ("like in the original architecture") pending OQ-W7-3's registry go/no-go.

### Supersessions this plan enacts (on Wolf's approval)

- The **§3.10 freeze** (`ContentSourceV1` verbatim, article tools off-limits)
  existed _pending OQ-8_. OQ-8 is now decided; the freeze lifts **only inside
  the W7 phases below**, each still additive-first and equivalence-gated. The
  CLAUDE.md hard-constraint line is updated when phase W7.5 (the first phase
  that touches `publish-article.ts`) starts, not before.
- C§2.3's "existing tool surface unchanged + adapter" for `content_item` is
  superseded by the migration + alias policy (§4).
- Core-structure tasks 1–5 + 8 are activated as phases W7.1–W7.2 and W7.3–W7.6.
- Tier 1 policy (direct agent publish for articles, C§2.2) is **preserved** —
  migration changes the substrate, not the trust posture.

## 1. What must be preserved (the non-negotiables)

1. **The semantic annotation layer** (above). Target state: annotations are
   first-class object fields agents can read via `object_contract`/`object_get`
   and edit via typed patch ops — not opaque blobs.
2. **The 5-agent drafting workflow** (`reader_insight → research → angle →
draft → final_article`): the staged-collaboration functionality survives;
   its state moves into the object (§3.4). The ChatKit publisher-agent runner
   and external agent configurations keep working via tool-name aliases (§4).
3. **The publish-time safety stack**, item for item: artifact per-request
   trust + sharp decode validation + materialization before render; no raw
   refs in committed output; taxonomy resolution with `merged_into` aliases
   (W3 hook — becomes standard validation); `publish_by_time` semantics
   (immediate / scheduled `time_set` / `null` unpublish — articles are THE
   timestamp-gated type, D§5.6); deploy receipt polling; render verification.
4. **The admin editor experience** at `/admin/publish` (block editor,
   word-diff Accept/Discard, per-node Ask-AI) — re-wired, not removed.
5. **All 83 committed posts keep their URLs** and render **equivalently**
   (§5's equivalence harness; byte-identical is not the gate here because the
   markdown pipeline itself is replaced — DOM-equivalence is).
6. **Artifact continuity**: blobKeys embed the owning `req_*` id, and
   per-request trust hangs off it — so **`content_item` keeps `req_*` ids
   verbatim** (`validateRequestId`, D§3.1). No id re-mint, no artifact
   re-keying, no trust migration.

## 2. Target architecture

### 2.1 `content_item` — the ninth object type

One standard ObjectRecord (envelope: locks, versions, patch ops + inverses,
validation, publish, release — everything the other eight types get for free)
with a `content_item.v1` body. The object model was designed as "the article
envelope, generalized" (D§1); migration is the envelope coming home.

**Envelope mapping (`ContentSourceV1` → `content_item.v1` body):**

| ContentSourceV1 section                                                            | Destination                                                                                       | Notes                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `ids`                                                                              | envelope `id` = existing `req_*`; `parent_content_id`/`source_version_id` → `body.lineage`        | variant lineage becomes queryable (§2.4)                     |
| `publication_context`                                                              | `body.publication_context`                                                                        | carried as-is (multi-site later, D§6)                        |
| `content.title/deck/description`                                                   | `body.title/deck/description`                                                                     |                                                              |
| `content.article_body` (nodes)                                                     | `body.nodes[]` — **the node envelope survives structurally**                                      | §2.2                                                         |
| `content.structure`/`blocks` (future slots)                                        | absorbed: `structure.sections[].role` becomes node grouping if ever needed; the slots are retired | they anticipated exactly this migration                      |
| `taxonomy`                                                                         | `body.taxonomy` — validated against `tax_drlurie` at patch time (not only publish time)           | strengthens W3                                               |
| `seo`                                                                              | `body.seo`                                                                                        | same shape as page seo                                       |
| `media` (prompt register, generation runs, asset register, image sets)             | `body.media`                                                                                      | carried verbatim — agent-facing planning data                |
| `editorial`, `emotional_strategy`, `sources`, `claims`, `compliance`, `commercial` | `body.*` same names                                                                               | **verbatim sub-schemas** — this is the judge/score substrate |
| `approvals`                                                                        | envelope review machinery (review-state.ts)                                                       | articles stay Tier 1: review optional, policy knob           |
| `publication.published_time`                                                       | envelope publication block (D§5.6 timestamp-gated)                                                | the ONE visibility gate — divergent semantics die (§6 bug ①) |
| `workflow` + WorkflowRecord stage fields                                           | `body.workflow` (stage, next_agent, completed/failed agents, handoff notes)                       | §3.4                                                         |
| `revision_control`                                                                 | `body.revision_control` incl. `change_assessments` → typed `scores[]`                             | §2.4                                                         |
| WorkflowRecord `agent_outputs`                                                     | object history + `body.workflow.agent_outputs` during drafting; pruned on publish                 | history is the audit trail                                   |
| WorkflowRecord `lock`/`version`/`history`                                          | envelope lock/version/history                                                                     | the mechanics are already identical by design                |

### 2.2 The body model: node envelope outside, Rich Text inside

**Decision (recommended, the synthesis of Wolf's rulings 1+2+5):** the article
body stays a **list of annotated nodes** — `id` (opaque), `kind`
(content / action / placement / interactive / **reference**, §6 bug ⑧),
`private`, `commercial`, `rendering`, `chat`, `visibility` — and inside
`content` nodes, **`public.body` upgrades from a flat string to a
`rich_text.v1` document** (Contentful node tree: paragraphs, headings, quotes,
lists, marks, embedded-asset-block for artifact refs, embedded-entry-block for
object refs).

Why not one giant Rich Text document with per-paragraph annotations: a hook is
often **more than one paragraph** — the annotation's unit is the node, and the
node grouping IS the behavioral-framework structure Wolf wants agents to see.
Rich Text handles flowing content _within_ a strategic unit; the node list
handles strategy _across_ units. (Per-block `data` inside a document remains
available for finer-grained hints later — additive.)

- `rich_text.v1`: zod schema mirroring Contentful's types (adopt
  `@contentful/rich-text-types` constants); per-field grammar =
  `enabledNodeTypes` / `enabledMarks` / embed allowlists — the current
  per-component vocabulary and splitter checks become the declaration
  (write-time guardrails carry over, traps 5/14 stay closed).
- Renderer: `@contentful/rich-text-html-renderer` at build time with custom
  renderers — `embedded-asset-block` → committed upload paths via the existing
  materialization, `embedded-entry-block` → the shared-section/object
  resolution path. **`node.private` is never serialized into HTML** (the leak
  rule, enforced by a renderer test that greps output for strategy vocabulary).
- Legacy fallback (already documented): a whole markdown article = one
  `content` node. The markdown→rich-text converter (mdast → Contentful nodes,
  deterministic) upgrades it; §5's harness proves render equivalence.

### 2.3 Rendering path

Articles keep their routes (`/%slug%`) and the SinglePost furniture; W6's
`page_article` continues to own SEO defaults + below-post sections. What
changes: the article's content comes from the **object export (JSON)** through
the rich-text renderer instead of `Astro.render()` over a committed `.md`.
**One renderer** serves the public build, the admin preview, and the canvas —
the dual-renderer drift class (§6 bug ⑦) dies structurally.

During migration both paths coexist per-article (§5): un-migrated articles
render from `.md` exactly as today; migrated ones from their export. The
committed `.md` is **retired per-article at cutover** (OQ-W7-5).

### 2.4 Variants, judging, scoring (the A/B substrate)

v1 scope (deliberately bounded):

- **`create_variant`** op: clone an article object as a draft variant —
  `lineage.parent_content_id` set, node ids re-minted, annotations carried.
  `object_inventory {variants_of: req_x}` lists a family.
- **`body.revision_control.scores[]`**: typed
  `{scored_by, at, framework, dimension, score, rationale}` — agents judge and
  score against the strategy annotations; `change_assessments` was reserved
  for exactly this.
- **Out of scope v1**: live traffic splitting / variant serving. The site is
  static; serving experiments needs edge logic — its own plan when Wolf calls
  for it (OQ-W7-2). What v1 buys: agents can build, score, and compare
  variants quickly, and publishing a winner is one `object_publish`.

### 2.5 The strategy vocabulary as data (`strategy_drlurie`) — expanded design (OQ-W7-3)

Today `strategy` (12 values) and `intent` (5) are **closed code enums**: a
term is a bare word. Three failures against the mandate: extending the
vocabulary is a code change (the design-principles litmus fails); no
definition travels with the term, so agents guess what the house means by
"agitation"; and there is nothing shared to score against. The behavioral
theory lives implicitly in prompts — the registry makes it a versioned,
agent-readable asset of the CMS.

**Design: one singleton registry, three term kinds** (taxonomy's sibling —
same term ops, `merged_into` alias machinery, and Tier 3 human-executed
publish, since vocabulary changes alter validation site-wide):

- **`strategy`** — the per-node role. Term fields: `definition` (what it IS,
  house-style), `purpose` (behavioral rationale — what it does to the
  reader), `cues[]` (signals a node is doing this job), `quality_criteria[]`
  (what agents score against), `placement` (zone + typical count),
  `followed_well_by[]` (sequencing hints), `examples[]` (curated from the
  83-post corpus), `status`/`merged_into`.
- **`intent`** — educate/persuade/reassure/convert/navigate, each with
  definition + funnel position.
- **`framework`** — named arcs bundling strategies in order with optionality:
  PAS (hook → agitation → resolution → recommendation), AIDA,
  Before-After-Bridge, house arcs. Agents use frameworks to BUILD (instantiate
  the arc) and to JUDGE (does the article realize its declared arc?).

**Wiring:** `private.strategy` resolves against active terms
(`resolveStrategyTerm`, the `resolveTaxonomyTerm` sibling; aliases followed;
unknown term at patch = named blocker with near matches).
`object_contract('content_item')` serves the vocabulary WITH definitions;
input templates reference terms. `scores[]` cite `{framework, dimension}` as
term ids, making scores comparable across articles and variants — the
"judge, score, build variants quickly" mechanism made concrete (a variant
hypothesis becomes legible: "same article, PAS arc vs BAB arc"). Optional
article-level `editorial.framework` declares the arc; a validator **warns,
never blocks** when the node sequence deviates. Deprecating a term in live
use requires `merged_into` (the taxonomy no-stranding rule).

**Seed:** today's 12 + 5 become the seed terms; definitions/criteria drafted
from the corpus and docs, **approved by Wolf term-by-term** (the tax_drlurie
precedent). Existing annotations already use the seed values — zero
normalization.

**Costs:** one more registry to curate (machinery identical to taxonomy);
strategy values lose static TypeScript typing (runtime validation — the same
trade taxonomy made); definitions are load-bearing prompt material, so their
quality propagates — which is the point: theory encoded once, inherited by
every agent.

Its own bounded slice of W7.3; blocks nothing in W7.1/W7.2 either way.

## 3. Functional continuity

### 3.1 Publish mechanics

`object_publish` for a `content_item` runs the full preserved stack:
validation (incl. taxonomy + artifact trust + renderability against the REAL
renderer) → artifact materialization to `src/assets/**/uploads/{slug}/` →
export commit (JSON, not `.md`) via the standard object committer →
`release_to_production` → deploy receipt. `published_time` semantics
(immediate / future `time_set` / `null` unpublish) are pinned by tests ported
from the existing suite. OQ-12 (committer duplication) resolves itself: one
committer remains.

### 3.2 Admin surfaces

- `/admin/publish` block editor re-targets object verbs; TipTap emits
  `rich_text.v1` via a ProseMirror↔Rich-Text mapper (written once in W7.1,
  reused by admin + canvas). Word-diff review and per-node Ask-AI carry over.
- `/admin/library` publish toggle calls `object_publish_by_time`
  (`published_time: null` ↔ ISO) — bug ① dies.
- Annotation editing (strategy/intent/notes/commercial) becomes a visible,
  admin-only panel per node — today it's JSON-only; this is new capability,
  not just parity.

### 3.3 Tool surface: aliases, then sunset (OQ-W7-1)

External agent configs (the OpenAI publisher agent, any saved MCP clients)
call today's ~31 tools **by name**. Policy: every article tool keeps its name
as a **thin alias** over the object verbs from W7.5 on (same inputs, same
response shapes, same error vocabulary — pinned by the existing 27 test
files, which keep passing against the aliases). Sunset only after Wolf
confirms every external caller is re-pointed; until then aliases are
permanent. `wipe_blob_stores` and artifact tools are model-agnostic and
survive unchanged.

### 3.4 The 5-agent workflow

Stage state (`current_stage`, `next_agent`, `completed_agents`,
`failed_agents`, `needs_review`, handoff notes) moves into `body.workflow`;
per-agent `{agent}_update_output` / `{agent}_mark_complete` become aliases
over `object_patch` ops scoped to `body.workflow.agent_outputs[agent]` with
the same optimistic `expected_agent_version` check. One record, one lock, one
history — the drafting-room functionality is unchanged from an agent's seat.

## 4. Known-bug register — disposition under W7

| #   | Bug (recon 2026-07-12)                                                                                          | Disposition                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ①   | Three divergent publish semantics; `toggle-article-publish` drifts blob vs `.md`                                | **Dies structurally** in W7.5 — one publish semantic (object publish), toggle re-pointed                                        |
| ②   | `to-markdown.ts` parity gaps: sponsored `rel`, offerInline/offerCard, adSlot/chatInvite, PDF media never render | **Becomes the renderer feature matrix** in W7.2/W7.3 — these render for the first time (new functionality, explicitly in scope) |
| ③   | Hero-image edge case (image lands nowhere)                                                                      | Re-specified in the renderer: hero = designated node, rendered exactly once, warning machinery kept (W7.3)                      |
| ④   | `createRequestId()` fallback mints invalid ids                                                                  | Explicit small fix in W7.3 (ids stay `req_*`; the mint must satisfy its own validator)                                          |
| ⑤   | Image 404 gap (no blob-backed serving fallback), non-atomic writes, GIF/AVIF/SVG rejected                       | Non-atomic writes die (single-commit release); blob-backed image fallback = explicit task W7.5; format policy unchanged v1      |
| ⑥   | `verify_article_images` blind spots (stem matching, `<img>` only)                                               | Kept + extended against the new renderer (W7.5); CSS backgrounds remain out of scope v1                                         |
| ⑦   | Admin/public renderer drift                                                                                     | **Dies structurally** — one renderer (W7.2)                                                                                     |
| ⑧   | Schema-doc drift: `reference` node kind documented, forbidden by zod                                            | Resolved by **adding** `reference` as a real kind = embedded object ref (the doc anticipated the feature; W7.3)                 |
| ⑨   | No "derived" marker on committed `.md`                                                                          | Class retired with the `.md` files; JSON exports carry the standard markers                                                     |
| ⑩   | `admin-taxonomy.ts` aggregates blob drafts                                                                      | Replaced with a registry read (W3's finishing move; W7.7)                                                                       |

Also inherited: the shared publish-key self-approval TODO (review-state.ts:135)
— unchanged by W7 (articles stay Tier 1), tracked under OQ-3/OQ-5.

## 5. Migration and safety

- **Inventory first** (W7.4, credentialed): list the production `workflows`
  store — how many live WorkflowRecords exist, which correspond to committed
  posts, which are orphan drafts. Not knowable from a sandbox; first
  credentialed step of the wave.
- **Converters** (pure, unit-tested, idempotent): WorkflowRecord →
  `content_item` object; markdown → `rich_text.v1` (mdast-based); structured
  `article_body.v1` → node-envelope-plus-rich-text.
- **The equivalence harness** (the wave's build-diff analogue): for every
  migrated article, render legacy path and object path, compare normalized DOM
  (allowlisted inert differences only, `known-inert-diffs.md` discipline). A
  migration that changes what a reader sees is a failed migration.
- **Per-article cutover flag**: both render paths coexist; articles flip
  individually; a bad conversion rolls back by flipping one flag, not the
  wave.
- **Store**: objects live in `site-objects` like every other type; the
  `workflows` store is retired read-only after the last record migrates
  (never deleted mid-wave — it is the rollback source).
- Every phase: full suite green, `astro check` 0, build-diff EMPTY (W7.1) or
  equivalence-gated (W7.2+), one phase = one session = one PR, playbook
  criteria before anything is called CONVERTED.

## 6. Phase sequence (each its own session; sized like the shop S-phases)

| Phase    | Delivers                                                                                                                                                                                                                                                                                          | Gate                                                     | Status (2026-07-13)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W7.1** | `rich_text.v1` schema + `@contentful/rich-text-*` deps + build-time renderer + ProseMirror↔RichText mapper. Used by nothing.                                                                                                                                                                     | Suite + build-diff EMPTY                                 | ✅ BUILT (2026-07-12 M)                                                                                                                                                                                                                                                                                                                                                                                                             |
| **W7.2** | Section `body` fields accept string **or** document (union); one-time export conversion; TipTap emits rich text; splitters retire behind the renderer.                                                                                                                                            | DOM-equivalence on all 172 pages; canvas preview drive   | OPEN (own session)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **W7.3** | `content_item.v1` object type end-to-end (schema incl. verbatim strategy/commercial/claims sub-schemas, contract, patch ops incl. node ops + `create_variant`, validation, materializer, approval policy Tier 1) + object render path. Bugs ③④⑧. Optional: `strategy_drlurie` registry (OQ-W7-3). | Suite; sandbox lifecycle drill; probe-build verification | ✅ BUILT (2026-07-13 S; `reference` kind deferred — a kind that can't render yet would be a trap-5 regression; bug ④ moot on this path — the endpoint mints validated ids)                                                                                                                                                                                                                                                          |
| **W7.4** | ~~Migration tooling + credentialed inventory of the `workflows` store; pilot batch.~~                                                                                                                                                                                                             | —                                                        | ❌ WAIVED (§0.5: committed posts ignored)                                                                                                                                                                                                                                                                                                                                                                                           |
| **W7.5** | Publish unification: alias layer over the 31 tool names; `toggle-article-publish` + admin patch paths re-pointed; blob-backed image fallback (bug ⑤). CLAUDE.md freeze line updated.                                                                                                              | All 27 legacy test files pass against aliases            | OPEN — reduced scope: object articles already publish through object_publish; aliases matter only for external agent configs still pointed at the old tools (OQ-W7-1)                                                                                                                                                                                                                                                               |
| **W7.6** | ~~Full migration, `.md` retirement, `workflows` store read-only.~~                                                                                                                                                                                                                                | —                                                        | ❌ WAIVED (§0.5)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **W7.7** | Admin editor on rich text + annotation panel; single renderer everywhere; bugs ⑥⑩.                                                                                                                                                                                                                | Suite; editor drive                                      | ⚙ CANVAS CAPABILITY SLICE SHIPPED (2026-07-13, 07-canvas §3h): node palette (incl. offer/affiliate + mock-ad + gallery starters), adSlot mockup bank, the visible ROLE/annotation panel (strategy/intent/notes per block), multi-image blocks, and the missing `upsert_node` id-mint. REMAINING: TipTap/rich-text document editing in the panel, the /admin/publish re-wire decision (reduced by the legacy-wipe ruling), bugs ⑥⑩. |
| **W7.8** | Canvas for articles (stop line lifts): per-node chips, Ask-AI node scope, same EditSession/publish path.                                                                                                                                                                                          | Suite (wire-shape tests) + probe-build drive             | ✅ BUILT (2026-07-13 S)                                                                                                                                                                                                                                                                                                                                                                                                             |
| **W7.9** | Credentialed conversion run for the type + records; inventory/state-of-play flips; W7 exit.                                                                                                                                                                                                       | All five playbook criteria for the type                  | ✅ RUN (2026-07-13, op-by-op over the session MCP connection): create → 6/6 node ops byte-identical → validate → create_variant dry-run → publish `60cd213` → released (deploy ready). Demo live at /object-model-demo (OQ-2: stays live until edited). Seed taxonomy fixed to registry terms.                                                                                                                                      |

Rough shape: W7.1–W7.3 are the heavy engineering; W7.4–W7.6 are careful but
mechanical; W7.7–W7.8 are UX payoff. Canvas (W7.8) is in-wave per Wolf's
ruling 3 but severable if the wave runs long.

## 7. Open questions for Wolf (checkpoints — answer before the named phase)

- **OQ-W7-1: ✅ RESOLVED (Wolf, 2026-07-13): reverse support is NOT
  required.** No alias layer over the legacy tool names; MCP tools and
  functions may be updated, changed, or retired as the remaining phases
  land. The constraint that stands is functional, not nominal: the drafting
  workflow, the publish-time safety stack, and the admin editor must survive
  on the object substrate ("new architecture and implementation need to be
  the same in principle and follow data management principles and logic").
  External agent configs pointed at old tool names get re-pointed, not
  aliased. §3.3's alias policy is superseded accordingly.
- **OQ-W7-2 (anytime):** variant serving / traffic splitting — confirm out of
  scope for W7 (records + scoring only).
- **OQ-W7-3 (before W7.3):** strategy/intent vocabulary as a governed registry
  (`strategy_drlurie`, full design §2.5) vs staying code enums. Recommendation:
  registry — definitions travel with terms; agents extend without code
  changes. _Expanded design delivered to Wolf 2026-07-12; awaiting his
  go/no-go._
- **OQ-W7-4: ✅ RESOLVED (Wolf, 2026-07-12): articles keep Tier 1 direct
  publish.** Review stays an optional policy knob; migration changes the
  substrate, not the trust posture.
- **OQ-W7-5 (before W7.6):** committed `.md` files — retire at cutover
  (recommended) or keep as a derived mirror?
- **OQ-W7-6 (before W7.4):** confirm you can run the credentialed inventory of
  the production `workflows` store (same credentials posture as every
  conversion run).

## 8. Exit criteria

W7 is done when: every article is a `content_item` object meeting **all five
playbook criteria** (store-backed, round-tripping every permitted op incl.
node ops and `create_variant`, published, contract-complete, recorded);
section and article rich content is `rich_text.v1` end-to-end; one renderer
serves build/admin/canvas; the strategy/commercial/scoring layer is
patch-editable and contract-visible; the 10-bug register is dispositioned as
tabled; the 27 legacy test files still pass against the alias layer; and the
canvas edits an article body live. Standing launch gates (PUBLISH_SECRET
rotation, SITE_NOT_YET_LIVE flip) remain open items outside W7's scope.
