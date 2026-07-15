# 09 — Template System Plan (W8): the recipe family — section templates, page-template composition, theme presets

> **Status (2026-07-15): CONVERTED — W8 exit criteria met.**
> Designed, built (W8.1–W8.3b, PRs #437/#439/#440/#442), and run (W8.4
> credentialed run via the session MCP connection, same day) on branch
> `claude/template-architecture-design-dem5xb`. Wolf's four decisions in §0
> were GOVERNING throughout. All 9 recipe objects (3 tpl backfilled + 5 stpl
> + 1 thm created) are store-backed, fully round-tripped on their patch
> surface, published, and released (deploy ready 2026-07-14T16:23Z);
> store === seed === export verified. The application-verb production
> proofs ran 2026-07-15 (after a connector reset exposed the W8 tools):
> stamp dry_run BOTH modes × EACH of the 5 stpl records (10/10 eligible),
> apply_theme dry_run + ONE REAL default apply end-to-end (publish +
> release). ⚠ The real apply exposed LIVE-PALETTE DRIFT — production was
> rebranded 2026-07-13 after the seeds were written, so the apply reverted
> the live look ~6 min (09:30:57–09:37:13Z); restored byte-exact (`eba0c42`) and re-released.
> Resolved 2026-07-15: Wolf ruled the 2026-07-13 palette change an
> unsanctioned agent edit and ordered the original palette restored (second
> real apply, publish `2f88ef6`, released) — the theme and the seed's
> brandTokens match production again (⚠ the seed stays stale on
> name/logo/metadataDefaults — no site-family reconciles until updated). NEW DIRECTION (pending build): palette changes via
> themes ONLY (close direct brandTokens patching); theme workflow
> requester → maker (creation policy) with the optional human-approval pin.
> Docs flipped to CONVERTED, 41 → 47. Composite sections (§8) remain
> SPEC-ONLY behind OQ-W8-1…4.

## 0. Mandate and decisions (Wolf, 2026-07-14 — GOVERNING for W8)

**Wolf's framing (verbatim in intent):** _"I need the system to have at least
two types of templates: page template and section template. Section is a set
of basic objects grouped together … it is our hero section on the home page.
This will give agents ability to generate different new sections or edit
existing. … Page templates are basically the same. They can take in any
object or section and add them to the page. … This will give this agent an
ability to create any site form factor — add new pages in the future, add
sections. … The code dictates what functionality, options exist and what
amount, also what a section can do based on objects functionality; template
decides object position within section. CSS stuff stays with site."_

That division of labor is already the system's constitution —
design-principles rule 5, "Templates are recipes; PageTypes are law." W8 does
not change the law; it completes the recipe side. Ground truth going in:

- **Page templates EXIST and are CONVERTED** (W2.5): `template.v1` slot
  recipes + 4 patch ops + `object_instantiate_template` + 3 production
  recipes (`tpl_interior`/`tpl_landing`/`tpl_legal`) — built and dormant
  (zero pages instantiated to date).
- **"All sections structured the same way, in JSON" is already true**: every
  section is one member of the strict discriminated union in
  `src/schema/bodies/section-v1.ts` (21 members; 19 component-bound via
  `src/lib/registry/components/registered-types.ts`), rendered through the
  single type→component registry by `PageObjectRenderer.astro`. The home hero
  IS this: a `hero` instance (`kicker/heading/body/actions`) in
  `page_home.sections[]`.
- **Agent-created pages are live end-to-end**: the object-page catch-all
  serves any published Page object at its route with zero code.
- What does NOT exist: an agent-editable **section recipe** (starter sections
  live only in code — page-template slot blueprints, the edit-mode quick-add
  palette, per-type `defaultData`), and any recipe treatment for **site
  CSS tokens**.

**Wolf's four decisions (2026-07-14, AskUserQuestion):**

1. **Section templates are STAGED.** W8 ships them as **recipes over the
   existing coded section types** — a named, pre-configured section blueprint
   an agent stamps into any page or mints as a standalone shared section.
   Within-section layout stays **bounded data fields that code exposes**
   (§5). The composable "arrange blocks freely inside a section" model is
   **SPEC-ONLY** this wave (§8) — designed forward, gated on OQ-W8-1…4,
   built in its own future wave.
2. **Deliverable = this plan doc + per-phase briefs** (§9), the 06/08
   convention. No code this session.
3. **Theme presets are IN scope** (§6): a `theme` object bundling brandToken
   values, applied to the site singleton by copy. Explicitly settled: site
   theming is **NOT taxonomy** — taxonomy is the content vocabulary registry;
   a theme is a recipe.
4. **Git posture:** design commits to `claude/template-architecture-design-dem5xb`,
   pushed, **no PR** (CLAUDE.md hard constraint stands).

**Descoped, recorded:** T6.2's "editor support" leftover (admin UI for
template slot editing) stays descoped — templates and section templates are
**agent/MCP-first surfaces**; canvas/admin exposure waits for Wolf's
admin-rethink ruling (08-plan W7.7 hold). OQ-4 (PageType-as-data) remains
REJECTED — agents compose pages and mint recipes freely, but page *kinds*
(routing + loaders) stay code law.

## 1. Target architecture: the recipe family

W8 completes the recipe family under rule 5. Three recipe types, one
contract: **data, many, agent-editable; applied by COPY at instantiation;
never live-bound; the law stays in code** (PageTypes, the component registry,
the validation engine).

| Recipe                    | Ids      | Applies to          | Answers                                    | Status                                  |
| ------------------------- | -------- | ------------------- | ------------------------------------------ | --------------------------------------- |
| `template` (page)         | `tpl_*`  | a new page          | "how do I START a page of kind X?"         | 🟢 CONVERTED (W2.5; §4 blueprintRef SHIPPED W8.2; metadata backfilled W8.4) |
| `section_template` (NEW)  | `stpl_*` | a section instance  | "how do I START a section of type Y?"      | 🟢 CONVERTED (W8.4 run 2026-07-14; stamp verb proven both modes × each record 2026-07-15) |
| `theme` (NEW)             | `thm_*`  | `site.brandTokens`  | "how do I re-skin the site's token set?"   | 🟢 CONVERTED (W8.4 run 2026-07-14; apply verb proven end-to-end 2026-07-15 — tokens now ≠ live palette, see status header) |

Wolf's sentence, mapped: **code** = the section union + component registry +
PageType registry + validation (what exists, what options, what amounts);
**templates** = arrangement (which sections a page starts with; which
pre-configured data a section starts with; which token values the site
wears); **site** = CSS (tokens live on the site singleton; themes are presets
FOR it, injected by the one code pipeline, `CustomStyles.astro`).

Composition rule (the fractal): a page template's slot may reference a
section template (§4), exactly as a page's section may reference a shared
section — always dereferenced **at instantiation, by deep copy**. Editing a
recipe never changes anything already instantiated from it.

## 2. `section_template` — the new section-recipe object type

### 2.1 Why a new type (decision record)

The rejected alternative — a `kind: 'page' | 'section'` discriminator on
`template.v1` — fails on op honesty: patch-op applicability is keyed by
object type (`patchOpNamesByObjectType`), so slot ops (`upsert_slot` …) would
be advertised on section-kind templates where they are meaningless; the
contract would either lie or need per-kind op gating that exists nowhere
else; the 3 CONVERTED `tpl_*` records would churn; and one instantiate tool
would return two result shapes. A new governed type is the proven, mechanical
path (eighth type: `product`, S1a; ninth: `content_item`, W7.3).

### 2.2 Body schema — `section_template.v1`

`src/schema/bodies/section-template-v1.ts`:

```ts
export const SECTION_TEMPLATE_SCHEMA_VERSION = 'section_template.v1';

export const sectionTemplateBodySchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(), // agent-facing purpose note; never rendered
    blueprint: sectionInstanceSchema,   // ONE pre-configured section instance
  })
  .strict();
```

The blueprint is a full `sectionInstance` (same union as a page's inline
sections — no parallel shape to drift). Its `s_*` id is a placeholder,
**always re-minted at instantiation** (the `template.v1` slot-blueprint
precedent). Because the blueprint IS a `sectionInstance`, a future composite
section type (§8) becomes stampable with **zero** section_template changes.

### 2.3 Patch ops (`patchOpNamesByObjectType.section_template`)

| Op                          | Payload                                                                                            | Inverse                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `set_section_template_meta` | `{fields}` — deep-merge over `name`/`description`; **forbids `blueprint`** (the `set_template_meta` idiom) | same op with captured before-fields          |
| `replace_blueprint`         | `{blueprint}` — whole-instance swap; `blueprint.id` omitted → server-minted (`MINTED_ID_FIELD` entry, the `upsert_section` idiom) | `replace_blueprint` with captured before     |
| `update_blueprint_data`     | `{fields}` — deep-merge over `blueprint.data` (null unsets; arrays/scalars replace)                | fields capture                               |

Type swap = `replace_blueprint` with a new `{type, data}` (whole-instance
replacement re-validates the union member — the same posture pages take).

### 2.4 Validation

The standard pipeline covers almost everything for free once
`section_template.v1` joins `BODY_SCHEMAS`: per-type zod + richtext allowlist
(check 1 walks the blueprint's `data`), id discipline, reader safety,
artifact trust + renderable-image refs, **and reference integrity** —
`checkReferenceIntegrity`'s object walker already recognizes any `{type,
data}` node, so blueprint-internal refs (grid query terms, manual items,
pricing products) validate with zero new code.

One NEW structural check, `checkSectionTemplate` (dispatched from
`checkStructuralInvariants`):

- **`blueprint.type` must be standalone-placeable** — via a NEW shared
  helper `isStandalonePlaceableSectionType(type)`: member of
  `REGISTERED_SECTION_TYPES` (component-bound), excluding `card` (a grid
  leaf with no standalone component) and `shared_ref` (a pointer is not a
  recipe — copy semantics would be incoherent). Severity `blocks_write`.
- Check-7 renderability (the real splitters) runs over the blueprint, so a
  recipe can never stamp out a section the build would choke on.

The SAME helper powers the §7 page-level leaf fix — one predicate, two
enforcement sites, cannot drift.

### 2.5 Registration checklist (the W8.1 task list — the proven ninth-type recipe)

`src/schema/object-record-v1.ts` (`objectTypes` + body union) ·
`src/lib/object-ids.ts` (`OBJECT_ID_PATTERNS`, `OBJECT_TYPE_PREFIXES`, id
ceiling regex gains `stpl`) · `src/lib/object-ids-mint.ts` (`OBJECT_PREFIX`) ·
`src/schema/object-patch-ops.ts` + `src/lib/object-patch-apply.ts`
(ops + inverses) · `netlify/lib/object-validate.ts` (`BODY_SCHEMAS` +
`checkSectionTemplate`) · `src/lib/registry/object-contract.ts`
(`BODY_SCHEMA`, per-type constraints incl.
`blueprint_standalone_renderable`, workflow sequence incl. the §3 verb line,
`section_types: listSectionTypeContracts()` — agents need the vocabulary) ·
`netlify/lib/materialize.ts` + `netlify/lib/materializers/section-template.ts`
(verbatim export → `src/data/site/section-templates/{stpl_id}.json`; recipes
resolve nothing — the `template.ts` precedent) · `src/lib/approval-policy.ts`
(governed; autonomous under the `all-autonomous` master — recipes render
nothing live) · `src/content/config.ts` (inert collection, T1.7 pattern) ·
contract/inventory tests + roundtrip-driver op support.

### 2.6 Seeds — `scripts/lib/section-templates-seed-data.mjs`

Five starters, distilled from real converted sections; all **self-contained**
(no object/asset/taxonomy refs — the templates-seed rule) with neutral
starter copy:

| Seed                     | Blueprint type      | Derived from                                                     |
| ------------------------ | ------------------- | ----------------------------------------------------------------- |
| `stpl_hero_landing`      | `hero`              | `page_home` `s_hero` (kicker + heading + body + actions)          |
| `stpl_audience_grid`     | `content_grid`      | `sec_home_audience_grid` (`cards` source, curated text cells)     |
| `stpl_related_articles`  | `content_grid`      | `page_article` `s_related` (`related`/`tag_similarity`, limit 3, columns 3) |
| `stpl_newsletter_cta`    | `newsletter_signup` | `sec_newsletter_signup` (`formName: 'newsletter'`)                |
| `stpl_cta_banner`        | `cta_banner`        | the W1/about closing-CTA shape                                    |

## 3. `object_instantiate_section_template` (verb: `instantiate_section`)

New verb in `netlify/lib/object-verbs.ts` + MCP tool in
`netlify/functions/mcp.ts`, named parallel to `object_instantiate_template`.
Request:

```
{ section_template_id, site,
  target: { kind: 'page', page_id, position?, lock_token, expected_record_version }
        | { kind: 'standalone', requested_id? },
  dry_run?, agent_name? }
```

Loads the `stpl_*` record (existence semantics like `instantiate`: must
exist, draft OK), parses `section_template.v1`, deep-copies the blueprint,
mints a fresh **deterministic** `s_*` id (seed `${stpl_id}/${target}` —
idempotent retries).

- **Page mode**: composes exactly ONE `upsert_section {section, position}` op
  and routes it through the **existing patch handler** under the caller's
  `lock_token` + `expected_record_version`. Decision: **the agent must
  already hold the page checkout — the verb never auto-checkouts.** One-lock
  discipline is preserved, nothing steals locks, the stamp composes with the
  agent's other ops in the same session, and the inverse (`remove_section`)
  comes free. Full page validation (PageType allow/require rules, the §7
  leaf check) gates the write exactly as a hand-authored `upsert_section`
  would. History records `action: 'instantiate_section'`,
  `details.instantiated_from: stpl_*`.
- **Standalone mode**: builds `{section: copiedBlueprint}` and routes through
  the standard `create` path for object type `section` — a new `sec_*`
  shared object, identical in every way to a hand-authored one (then usable
  via `shared_ref` from any page).
- **`dry_run: true`**: page mode returns the built op + candidate-patch
  validation; standalone mode returns minted id, availability, body,
  validation (the `instantiate` dry-run shape). Dry-run is how W8.4 proves
  the verb credentialed without probe mutations (the W2.5 precedent).
- Documented escape hatch (also in the contract workflow text): an agent can
  always `object_get` the recipe and hand-copy its blueprint into a plain
  `upsert_section` — the verb exists for id-mint discipline,
  provenance-in-history, and one-call dry-run, **not** as a second write
  path.

**Provenance decision (recorded): NO schema-level provenance on section
instances.** A `template: {ref, instantiated_at}` field on sections would
churn the strict envelope of all 21 union variants, mint a reference edge
from every stamped section to a recipe (stranding sections if a recipe is
retired), and decay to noise the moment copy diverges. The history entry
carries the audit answer; usage analytics, if ever wanted, count history
events. `page.template` stays the system's one provenance field — a page's
origin story; a section stamp is closer to quick-add. Revisit only with a
concrete consumer for the field.

## 4. Page-template composition — `blueprintRef` on `templateSlot`

`src/schema/bodies/template-v1.ts`: `templateSlotSchema` gains

```ts
blueprintRef: z.string().min(1).optional(), // stpl_* id — dereferenced + deep-copied at instantiation
```

with a refine making `blueprint` and `blueprintRef` **mutually exclusive**.
Additive-optional: the 3 live `tpl_*` records parse unchanged;
`schema_version` stays `template.v1` (the M-9/`columns` precedent).

- **Instantiation**: `buildPageBodyFromTemplate` stays pure — the verb
  pre-resolves every referenced `stpl_*` record and passes a
  `resolvedBlueprints` map in the request; the builder treats a resolved ref
  exactly like an inline blueprint (deep copy + fresh minted id).
  Unresolvable or unparseable ref at instantiate time → 422.
- **Slot-fill order** for a required slot: inline `blueprint` →
  `blueprintRef` → registry `defaultData` of the first allowed type
  (unchanged fallback). A required slot with only a `blueprintRef` counts as
  "has a blueprint" for `checkTemplate`'s warn-only rule.
- **Validation** (`checkTemplate` additions): `blueprintRef` must resolve to
  an existing `section_template` and its blueprint's type must be in the
  slot's `allowed` set when non-empty — via a new injected resolver
  `resolveSectionTemplateType` (the `resolveSharedSectionType` sibling,
  wired in `netlify/lib/object-validation-context.ts`).
- Deref is **instantiation-only**. Editing a section template never rewires
  existing pages or previously instantiated results — only future
  instantiations. No live binding, no propagation trap (rule 5 stands).

Payoff: page templates become thin arrangements over a growing, agent-owned
library of section recipes — "take in any section and add it to the page" as
data, while every instantiation still passes PageType law.

## 5. Layout is bounded data — design-principles rule 6

New GOVERNING rule (full text lands in `design-principles.md`; summary):

> A component exposes layout variation **only as enumerated/bounded data
> fields** in its zod schema (`content_grid.columns` 1–4,
> `content_split.reverse`), rendered through pre-built class mappings.
> Templates and agents **select** values; no schema field ever carries CSS,
> class names, or arbitrary style tokens. New layout options are a code
> change to one component + its schema, so every expressible option is
> render-proven and canvas-safe. Grown on demand (rule 1), never
> speculatively.

This is Wolf's sentence — "the code dictates what options exist and what
amount; template decides position" — made law. It is also §8's inner law:
composite children get bounded arrangement fields, never pixel positions.

**No new layout fields are required for W8** — the five §2.6 seeds are fully
expressible with existing bounds (`columns`, `limit`, `reverse`). Nearest
on-demand candidates, named so the next need doesn't improvise:
`steps.columns (2|3|4)` · `cta_banner.compact?: boolean` ·
`content_split.imageLayout ('stagger'|'stack')`. Add only when a real recipe
or page needs one.

## 6. `theme` — the brand-token recipe object type, and `site_apply_theme`

### 6.1 What it is (and is not)

A theme is a **preset for `site.brandTokens`**: a named bundle of color +
font token VALUES an agent can draft, validate, and apply to the site
singleton. It is to `site.brandTokens` what `template` is to
`page.sections`. **It is NOT taxonomy**: nothing resolves against a theme,
terms/`merged_into` semantics don't apply, and the site never live-inherits
from it — apply copies values, after which the theme could be deleted with
zero effect on the live site.

### 6.2 Body schema — `theme.v1`

`src/schema/bodies/theme-v1.ts`. First, `brandTokensSchema` is **extracted**
from `siteBodySchema` into a shared export (`src/schema/bodies/site-v1.ts`)
and reused verbatim so the two shapes cannot drift:

```ts
export const themeBodySchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    tokens: brandTokensSchema, // ≡ site.brandTokens: {colors: Record<string,string>, fonts: {sans, serif, heading}}
  })
  .strict();
```

**One patch op**: `set_theme_fields {fields}` (deep-merge, null unsets — the
`set_site_fields` idiom; inverse = fields capture). Registration follows the
§2.5 checklist (`thm` prefix; materializer →
`src/data/site/themes/{thm_id}.json`, verbatim, no build consumer — the
applied SITE object is what renders; governed, autonomous under the master —
a theme going live changes nothing until applied, and `site` is already
governed where the risk lives).

### 6.3 Validation — the token registry + value safety (new `checkTheme`)

- **Key registry**: NEW client-safe module `src/lib/registry/theme-tokens.ts`
  exporting the consumed token keys — the 10 light color keys
  (`primary`, `secondary`, `accent`, `gold`, `text-heading`, `text-default`,
  `text-muted`, `bg-page`, `bg-surface`, `bg-page-dark`), the 9 optional
  `dark:`-prefixed overrides (every light key except `bg-page-dark`; a
  missing dark key falls back to the light value — today's documented
  behavior), and the 3 font keys (`sans`, `serif`, `heading`).
  `CustomStyles.astro`'s fallback map refactors to read from this module
  (**byte-identical** — values unchanged), so validation and the renderer
  share one source of truth. Missing required key → `blocks_publish` (drafts
  warn); unknown key → warn (inert — CustomStyles reads only the known
  list).
- **Value safety** (`blocks_write`): token values are interpolated **raw**
  into an inline `<style>` tag — an unguarded injection/breakage surface
  found during this design pass. A shared safe-CSS-value helper enforces a
  positive grammar (hex / `rgb()` / `rgba()` / `hsl()` / `hsla()` /
  `oklch()` for colors; a conservative font-stack charset for fonts) with a
  hard floor either way: reject `;`, `{`, `}`, `<`, `url(`. **The same
  helper is applied to `site.brandTokens` under `set_site_fields`** —
  closing the live gap for the existing type, not just the new one (§7.3).

### 6.4 Apply — verb `site_apply_theme` (decision record)

Rejected alternative: "just document checkout + `set_site_fields` with the
theme's tokens." The decisive flaw is merge semantics: `colors` is an open
record and `fields` deep-merges, so a hand-applied theme **leaves stale
keys** from the previous palette unless the agent computes per-key
null-unsets against the current site record — precisely the fiddly,
error-prone diff a verb should own.

`site_apply_theme { theme_id, site, lock_token, expected_record_version,
dry_run?, agent_name? }`: load theme → load site → diff → build **ONE**
`set_site_fields` op that makes `brandTokens` exactly equal the theme's
tokens (including null-unsets for keys the theme doesn't carry) → route
through the standard patch path under the caller's site checkout (same lock
discipline as §3 page mode). One op = one atomic revision; history records
`details.applied_theme: thm_*`; the exact inverse makes "revert the theme" a
standard discard; publishing the site stays the separate deliberate step
under the existing site gate. `dry_run` returns the computed op + candidate
validation. **No `site.theme` provenance field** (§3 rationale — the
singleton stays schema-stable; history carries attribution).

### 6.5 Seed

`scripts/lib/themes-seed-data.mjs` → `thm_drlurie_default`, tokens
**imported from `scripts/lib/site-seed-data.mjs`** (single source — cannot
drift, byte-identical to production values). One seed only (rule 1: agents
mint variants on demand).

## 7. Gap fixes folded into W8

1. **Leaf-section validation (Session 2026-07-13 K finding).** A standalone
   `card` section passes `object_validate` but kills the build ("No
   component registered for section type 'card'"). Fix (W8.1): a
   `blocks_write` criterion in the page structural check AND the shared
   `section` wrapper check — every instance in `sections[]` (or the
   wrapper) must satisfy `isStandalonePlaceableSectionType` OR be a
   `shared_ref` (valid on pages; excluded only for template blueprints,
   §2.4). Must NOT touch `content_grid` `cards`-source cells — those are
   data cells, not section instances. Contract constraint entries added for
   `page` + `section`.
2. **`SECTION_PALETTE` disposition (recorded decision).** The edit-mode
   quick-add palette stays code-curated for now. Deriving it from the
   committed `section-templates/*.json` exports (build-time, client-safe —
   the site-object loader pattern; code palette as fallback) is an
   **optional backlog slice**, deferred because canvas UX sits under Wolf's
   admin-rethink hold (08-plan W7.7). Recorded so the duplication is a
   decision, not drift.
3. **Brand-token value safety on `site` (found this session).** Unvalidated
   strings flow from `set_site_fields` into the inline `<style>` tag today.
   The §6.3 helper closes it for both `theme` and `site` in W8.3.

## 8. Phase-2 forward spec — composite sections (SPEC ONLY, gated)

The staged second act: a **composite** section whose child blocks agents
arrange — "template decides object position within section" in its full
form. Direction, so W8 keeps the door open by construction:

- Extend the **existing block-tree mechanism** (`block-tree.md`;
  `src/lib/registry/block-tree.ts` already derives `allowedChildren` /
  `childCount` bounds from the registry, and `validateBlockTree` exists but
  is wired to nothing on the write path). Either a new `composite` container
  type or container-capable types gaining `children: BlockNode[]`.
- New LAW required before any build: path-addressed block patch ops with
  exact inverses (`upsert_block` / `move_block` / `remove_block` — designed
  in `block-tree.md`, never built), renderer dispatch for children, canvas
  addressing for nested blocks, `validateBlockTree` wired into
  `checkStructuralInvariants`.
- Rule 6 applies INSIDE composites: children get bounded arrangement fields
  (order, span presets), never pixel positions or CSS.
- Because `section_template.blueprint` is a `sectionInstance`, a composite
  becomes stampable through the same recipes with zero stpl schema change.

**Open questions for Wolf — CHECKPOINT, answer before any Phase-2 build:**

- **OQ-W8-1 (evidence gate):** name three real layouts the bounded palette +
  rule-6 fields cannot express. If they can't be named, composite waits
  (rule 1: grown on demand).
- **OQ-W8-2 (child vocabulary):** start with `card` + a small leaf set
  (recommended) vs arbitrary section nesting; depth cap 2 (the nav
  precedent)?
- **OQ-W8-3 (arrangement law):** confirm children are arranged only via
  bounded fields on the container — no free positioning.
- **OQ-W8-4 (coexistence):** `content_grid`'s `cards` data cells coexist
  with composite children (recommended) or get superseded?

## 9. Phase sequence (each its own session; one phase = one session = one PR)

| Phase    | Delivers                                                                                                                           | Depends on            | Mode           | Gate                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------- | -------------------------------------------------------------------- |
| **W8.1** | `section_template` type end-to-end + `isStandalonePlaceableSectionType` + the page/section leaf fix + seeds                          | —                     | normal         | Full suite + `astro check` 0 + build-diff EMPTY                       |
| **W8.2** | `object_instantiate_section_template` (both modes, dry_run) + `blueprintRef` composition + `checkTemplate` additions                 | W8.1                  | normal         | Suite + local lifecycle drill + build-diff EMPTY                      |
| **W8.3** | `theme` type end-to-end + token key registry + CustomStyles refactor (byte-identical) + value safety (theme AND site) + `site_apply_theme` + default seed | — (parallel-safe)     | normal         | Suite + build-diff EMPTY + local apply drill (apply → vars change → inverse restores) |
| **W8.3b** | Recipe metadata (description/whenToUse/scope, publish-gated) uniform across the recipe family + creation-policy seam (committed config, default open) + reuse-first surfacing (inventory recipe summaries, REUSE-FIRST contract lines, section-type `useWhen` ×19) + metadata-complete seeds + committed tpl-export pre-materialization + reconcile support | W8.1–W8.3            | normal         | Suite + `npm run check` + build-diff EMPTY                            |
| **W8.4** | ✅ COMPLETE (run 2026-07-14 + verb proofs 2026-07-15): Step-0 tpl backfill + 6 creations + full drills + publishes + release + all application-verb production proofs (stamp both modes × each stpl; apply dry_run + one real apply — exposed live-palette drift, reverted byte-exact); docs flipped 🟢, 41 → 47 | W8.1–W8.3b merged + deployed | **human_gate** | All five playbook criteria per type (§10)                             |

### W8.1 brief — `section_template` + the leaf fix

- **Scope:** everything in §2 (schema, 3 ops + inverses, `checkSectionTemplate`,
  materializer, contract, approval policy, inert collection, 5 seeds,
  roundtrip-driver op support) + the §7.1 leaf fix via the shared helper.
- **Touches:** the §2.5 checklist files; ✚ `src/schema/bodies/section-template-v1.ts`,
  ✚ `netlify/lib/materializers/section-template.ts`,
  ✚ `scripts/lib/section-templates-seed-data.mjs`; the helper lands beside
  `registered-types.ts`.
- **Verify:** unit tests per op incl. inverses; validation tests (leaf/pointer
  blueprint rejected; standalone `card` on a page rejected; `cards` grid
  cells unaffected — pin the 21-section showcase page still validates);
  contract test lists the type; build-diff EMPTY (recipes render nothing).
- **Gate:** suite green, `astro check` 0, build-diff EMPTY. Nothing claims
  CONVERTED.

### W8.2 brief — instantiate verb + `blueprintRef`

- **Scope:** §3 (verb, both target modes, deterministic minting, dry_run,
  MCP tool, contract workflow lines) + §4 (`blueprintRef`, builder deref via
  pre-resolved map, `checkTemplate` + `resolveSectionTemplateType`).
- **Touches:** `netlify/lib/object-verbs.ts`, `netlify/functions/mcp.ts`,
  `src/lib/template-instantiate.ts`, `src/schema/bodies/template-v1.ts`,
  `netlify/lib/object-validate.ts`, `netlify/lib/object-validation-context.ts`,
  `src/lib/registry/object-contract.ts`, tests beside
  `object-instantiate.test.ts`.
- **Verify:** lifecycle drill in the sandbox — create stpl → stamp into a
  draft page under its lock (position honored; inverse removes) → standalone
  mode mints a valid `sec_*` → tpl slot with `blueprintRef` instantiates a
  page that passes PageType law → both dry_run shapes; "law beats recipe"
  pinned (a blueprintRef whose type violates the target PageType still
  fails page validation).
- **Gate:** suite + build-diff EMPTY.

### W8.3 brief — `theme` + `site_apply_theme` + token safety

- **Scope:** §6 end-to-end + §7.3. `brandTokensSchema` extraction;
  ✚ `src/lib/registry/theme-tokens.ts`; CustomStyles refactor
  (**byte-identical** — build-diff proves it); value-safety helper wired
  into `checkTheme` AND the site structural check; verb + tool + dry_run;
  ✚ `scripts/lib/themes-seed-data.mjs`.
- **Touches:** §2.5 checklist files for `theme`; `src/schema/bodies/site-v1.ts`,
  `src/components/CustomStyles.astro`, `netlify/lib/object-verbs.ts`,
  `netlify/functions/mcp.ts`.
- **Verify:** apply drill — seed theme, mutate a draft copy's tokens, apply
  under site checkout, confirm the computed op replaces exactly (stale keys
  unset), inverse restores; safety tests (a `url(`/`;` value rejected on
  BOTH theme and site paths); missing required key blocks publish, unknown
  key warns.
- **Gate:** suite + build-diff EMPTY + the local apply drill.

### W8.3b brief — recipe metadata + creation policy + reuse-first (Wolf, 2026-07-14)

- **Mandate:** every recipe must be explainable in JSON (what it is, when to
  use it, one-off vs strategic); template creation must be restrictable to
  some agents (ability now, teeth later); agents reuse existing recipes with
  discovery cheap enough to lower AI cost — **index-then-fetch, never
  context-dumping**.
- **Scope:**
  - ✚ `src/schema/bodies/recipe-metadata-v1.ts`: `{description?, whenToUse?,
    scope?: 'evergreen' | 'one_off'}` spread into all three recipe body
    schemas ('evergreen' = a standing recipe with a strategy behind it;
    'one_off' = built for a single project). Schema-OPTIONAL (the 3 live
    tpl\_\* records keep parsing) but REQUIRED TO PUBLISH — the shared
    `checkRecipeMetadata` criterion (`recipe_metadata`, blocks_publish, warns
    drafting; empty-after-trim counts missing). Editable via each type's
    existing meta/fields op — zero new ops.
  - ✚ `src/config/creation-policy.ts` + ✚ `src/lib/creation-policy.ts` (the
    approval-policy twin): per-type `'open' | {agents: [...]}` rules, master +
    overrides, HUMANS ALWAYS CREATE, default fully open. Enforced at the top
    of the `create` verb (before minting/existence probing — the recursion
    from create_variant/instantiate/instantiate_section-standalone makes it
    unbypassable) plus thin pre-checks in those three verbs for dry_run
    honesty. The policy keys on the type BEING CREATED (instantiate → page;
    standalone stamp → section); page-mode stamping and `site_apply_theme`
    are patches, deliberately ungated. Denial = 403 `creation_restricted`
    naming the allowlist and pointing at reuse. Surfaced on every
    `object_contract` as `creation_policy`. ⚠️ agent_name is SELF-DECLARED
    until OQ-3 — a coordination seam, not a security boundary; the same
    allowlist becomes verifiable identity when OQ-3 lands.
  - Reuse-first surfacing: `object_inventory` recipe rows carry a `recipe`
    summary (name/scope/description/when_to_use + blueprint_type or
    applies_to/slot_count) — one cheap call answers "what exists and which
    fits"; the three recipe contracts open their workflow with a REUSE-FIRST
    step; all 19 section components gained an `editor.useWhen` one-liner
    (flows automatically into `object_contract.section_types` +
    `registry_get`).
  - Seeds: all 9 recipe seeds are metadata-complete; the 3 committed
    `src/data/site/templates/*.json` exports were hand-updated with the SAME
    trio — this pre-materializes exactly what the W8.4 backfill republishes
    (byte-identical body), keeping `seed-objects-enforcement` green at
    publish level; blobs-are-truth is restored the moment W8.4 runs.
    `roundtrip-reconcile` gained the metadata keys in `TEMPLATE_META_KEYS`
    plus the previously missing `section_template`/`theme` branches.
- **Interim caveat (RESOLVED by the W8.4 run 2026-07-14):** the 3 live
  tpl\_\* records were *published* trio-less, so any patch whose applied body
  still lacked the trio 422'd (`recipe_metadata` blocks on published
  records) — the Step-0 backfill patch passed because validation runs on the
  applied body. The caveat now applies only to `tpl_fieldtest` (fieldtest
  family, deliberately not backfilled).
- **Gate:** suite + `npm run check` + build-diff EMPTY (recipes render
  nothing; the export metadata feeds no rendered surface).

### W8.4 brief — credentialed conversion run (human_gate)

- **Scope:** the playbook, production, **strictly sequential ops** (the
  Session-K gateway lesson). **Step 0 — tpl metadata backfill:** run the
  driver with the (now metadata-complete) template seeds
  (`--production --seeds scripts/lib/templates-seed-data.mjs --release`) —
  ensure reconciles the 3 live tpl\_\* bodies via `set_template_meta`
  (description/whenToUse/scope), publish + release re-materializes the
  exports byte-identical to the committed W8.3b pre-materialization. Then:
  create the 5 `stpl_*` + `thm_drlurie_default` →
  drill every permitted op per type → publish → release.
  `object_instantiate_section_template` proven by dry_run in BOTH modes (no
  probe mutations — the W2.5 precedent); `site_apply_theme` proven by
  dry_run **plus one real apply of the default theme** — byte-identical to
  production tokens, so a zero-risk end-to-end proof. Seeds are
  metadata-complete since W8.3b and the `recipe_metadata` criterion blocks
  publish without the trio — any future seed edit must keep it.
- **Docs (same change, per the definition of converted):** inventory rows +
  conversion-map marks flip to 🟢, state-of-play session entry, CLAUDE.md
  converted-count line.
- **Gate:** all five playbook criteria per type; store === seed === export.
- **RUN OUTCOME — COMPLETE:** 2026-07-14: Step 0, 6 creations, all patch-op
  drills, publishes, release, store === seed === export, contract +
  inventory checks, instantiate_template dry_runs ×3. 2026-07-15 (connector
  reset exposed the W8 tools): stamp dry_run BOTH modes × EACH stpl (10/10
  eligible, zero blockers) + apply_theme dry_run + ONE REAL default apply →
  site publish (`ec2cbd3`) → release (deploy ready 09:30:57Z). **The
  "no-op" premise was FALSE** — production had been rebranded 2026-07-13
  (teal/terracotta + Source Serif heading) after the seeds were written;
  the apply put the old palette live ~6 min; restored byte-exact
  (`eba0c42`) + re-released. LESSON: "byte-identical to production" claims
  must be verified against the LIVE record at apply time, not the seed
  corpus. Palette follow-ups CLOSED 2026-07-15: Wolf ordered the original
  palette restored (second real apply, publish `2f88ef6`, released) — the
  theme and the seed's brandTokens match production again. The seed stays
  RESYNCED to the live "Skincare" branding 2026-07-15
  (`scripts/sync-site-seed.mjs` + a drift-guard test) — the site family is
  safe to reconcile again.

## 10. Exit criteria

W8 is done when: `section_template` and `theme` are governed object types
meeting **all five playbook criteria** (store-backed in production;
round-tripping every permitted op; published + released; contract-complete —
every permitted action has a tool + contract entry, including both
instantiate/apply verbs with dry_run; recorded in inventory +
state-of-play). "Renders" is satisfied in the recipe sense (the template
precedent): recipes materialize verbatim exports and render nothing
themselves — what renders is what they're applied TO, proven by the W8.2
lifecycle drill and the W8.4 default-theme apply. Page templates compose
section templates via `blueprintRef`; the leaf-section and token-injection
gaps are closed; rule 6 is written law; Phase-2 composite work remains
gated on OQ-W8-1…4.
