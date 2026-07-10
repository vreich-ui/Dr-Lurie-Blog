# State of play — agent-editability push

Rolling session log for the multi-session mandate ("an agent can inspect and
edit any meaningful part of the live Dr-Lurie site through one consistent,
human-reviewed workflow"). Each session appends its entry at the top and
updates the standing tables. **Rule inherited from the mandate: never trust
this file over real state — verify against main / test output / the live
store before building on anything below.**

## Session 2026-07-10 F (/about DECOMPOSED into 8 generic objects; bio gains a portrait; driver handles all-shared_ref pages)

Wolf: "convert the about page — the objects on it should each be their own
converted object; mostly generic text sections." Done as the first W2
conversion, the design-principles way (retire the bespoke, don't repeat it):

- **/about decomposed** from the single bespoke `about` section into EIGHT
  standalone shared sections of REUSABLE types — `sec_about_intro` (bio),
  `sec_about_{thinking,products,science,research,blog,note}` (prose ×6),
  `sec_about_cta` (cta_banner); `page_about` is now a `standard` page of 8
  `shared_ref`s. Each piece is independently editable/reorderable/reusable.
  Seed: `scripts/lib/page-about-seed-data.mjs`.
- **bio generalized (Wolf's call)** to keep the doctor's portrait: added an
  optional URL `portrait {src,alt}` field + rendering (distinct from the
  artifact-ref `portraitAssetRef`, which fails artifact-trust on a raw URL —
  that's WHY portrait is a separate field; pinned by test). The reusable "person
  intro" now carries a photo; the homepage bio (no portrait) is byte-identical.
- **Driver improvement surfaced by this conversion:** a fully-decomposed page is
  ALL `shared_ref`s — the normal shape once every section is its own object —
  which the page-drill's "refuse to guess" guard (fix 5) correctly stopped on.
  `pageDrillOps` now handles it by cloning ANY of the page's own sections as the
  probe (a shared_ref duplicate resolves + is PageType-legal). Unit-tested.
- **Gates:** astro check 0 errors; 896 netlify/src + 37 scripts tests green (16
  new); build green; dist grep shows all 8 sections + portrait + lists + CTA;
  build-diff scoped to `/about` ONLY (202/203 identical — the home bio is
  unaffected). Local `--seeds page-about` round-trip all-green.

**Status: RENDERS, not yet CONVERTED** — criteria 2/3 need the credentialed
`node scripts/home-conversion-roundtrip.mjs --production --release --seeds
scripts/lib/page-about-seed-data.mjs` run (same as the home family). **Follow-up
flagged:** the `about` section TYPE is now orphaned (no object uses it) — retire
it (union member + About.astro + registry + resolve.ts entry + fixtures) in a
separate focused change.

## Session 2026-07-10 E (conversion factory: full object map + generalized driver + tightened recipe)

Wolf's directive after the home-page success: tighten the instructions so any
coding agent can convert the rest, and produce the complete object universe for
him to set boundaries and priority. Landed:

- **`conversion-map.md` (NEW)** — the full tree of every actual and potential
  object in the Astro project: attributes, dependencies, dependents, status
  marks, composable ⚪ potential objects (topics hub from content_grid, landing
  pages, shared CTAs, pricing_table/steps/feature_grid/content_split types for
  W5), and a PROPOSED wave order (W1 lede+system pages → W1-enabler
  content_item resolver → W2 bespoke pages → W3 taxonomy decision → W4 site →
  W5 pricing/services/shop → W6 listings → W7 rich text). **The priority table
  is Wolf's to edit; agents follow it.** Wired into CLAUDE.md/AGENTS.md
  mandatory reading and playbook criterion 5.
- **Driver generalized** — `home-conversion-roundtrip.mjs --seeds
scripts/lib/<family>-seed-data.mjs`; a seed module exports CONVERSION_SEEDS
  (ordered, referenced-before-referrer) + SEED_SITE. v1 drills page/section
  types and refuses others loudly.
- **Playbook recipe rewritten as the factory flow** (seed module → local
  driver run → gates → record-as-RENDERS → merge+deploy → credentialed
  `--production --release` → flip to CONVERTED) + traps 10–12 (deep-merge
  heal strays; release gateway timeout; schema-vintage before --production).

## Session 2026-07-10 D (HOME-PAGE FAMILY CONVERTED — all five criteria)

Wolf's second credentialed run (after PR #386's driver fixes) came back
**all-green**: every `ensure` reported "already matches the seed" (store ===
seed byte-exact; page_home v44), all four objects re-published, contract and
inventory checks passed, and `release_to_production` confirmed
**`released: true`**. That completes criterion 3's release→re-render leg — so
**`page_home`, `sec_home_audience_grid`, `sec_home_start_grid`, and
`sec_newsletter_signup` are CONVERTED, all five criteria, no asterisks.**
Seven objects total now (3 nav + the home family); the reality lines in
CLAUDE.md / AGENTS.md / conversion-playbook.md / object-inventory.md /
core-structure.md were all flipped in this change. The 2026-07-10 goal —
"agents can change everything on the home page through the MCP, up to
publishing live" — is met: hero and bio edit via `page_home`'s section ops,
each grid and the newsletter via their own section objects, chrome via nav.

Still-open, known follow-ups (unchanged): the `content_item` resolver gap
(manual grid curation, playbook trap 4); archive/unpublish verbs; the other
11 rendered-stub pages; `site`/`taxonomy` objects; `checklist` type now unused
on the home page (kept registered — retirement optional). Also noted for
later: rotate `PUBLISH_SECRET` before real go-live (exposed in a chat
transcript during testing; Wolf accepted the risk for now — nothing is live).

## Session 2026-07-10 C (FIRST CREDENTIALED PRODUCTION RUN + driver hardening)

PR #385 merged; **Wolf ran `home-conversion-roundtrip.mjs --production --release`
from his machine — the first credentialed store run since nav.** Results:

- **`sec_newsletter_signup`, `sec_home_audience_grid`, `sec_home_start_grid`:
  created in the production store, EVERY permitted op exercised, validated,
  PUBLISHED** (export commits `a3d6e87`/`4dbbc1f`/`86b9174` on main).
  `object_inventory` returns all of them. Criteria 1–4 all proven in
  production for the section family.
- **`page_home`: healed and PUBLISHED** (`344faab`, record_version 42) — the
  broken record's structure was fully reconciled (hero inline, two grid refs,
  bio, newsletter ref, footer override). The ensure check flagged a residual
  diff: three `seo` subkeys from the old record (`description`/`robots`/`title`)
  survived because the reconciler hit **playbook trap 2 itself** (`set_page_meta`
  deep-merges; strays must be nulled). The values are good editorial content,
  so they were **adopted into the seed** (seed === store now) rather than
  stripped.
- **`release_to_production` died at a gateway "Inactivity Timeout" 504** — the
  server polls deploy receipts longer than intermediary proxies allow. The
  build hook fires before the polling, and the #385 merge itself also triggers
  a production build, so the release almost certainly happened; confirmation
  rerun pending.

**Hardening landed this session:** reconcile logic extracted to
`scripts/lib/roundtrip-reconcile.mjs` with `diffFieldsForMerge` (nulls stray
keys at every depth — unit-tested against the exact production drift); a failed
ensure now SKIPS that object's drill/publish (never publish a wrong body); the
release step fires the hook once (`timeout_seconds: 15`) then confirms via
short read-only polls (`force_build: false`) tolerant of gateway errors.

**Remaining to declare the home family CONVERTED:** one rerun of
`--production --release` (expect: every ensure "already matches the seed";
`released: true`), a look at the live homepage, then flip the four inventory
rows to 🟢. **Security follow-up: rotate `PUBLISH_SECRET`** — it was exposed
in a chat transcript during this run's setup.

## Session 2026-07-10 B (home-page conversion push: restructure + standing round-trip driver)

Wolf's goal: the home page at 100% conversion — hero, the two grids, about/bio,
newsletter — everything agent-editable via MCP through to live publish. His
structural call, implemented: **hero and bio stay inline on `page_home`; the two
grids become standalone objects of the ONE reusable `content_grid` type**
(`sec_home_audience_grid` — new sanctioned `cards` source of curated text cells;
`sec_home_start_grid` — the settled M-8 `query` source), referenced via
`shared_ref` like the newsletter. One grid type, two roles by configuration
alone — the design-principles litmus passes.

**Landed on `claude/home-page-conversion-state-6wsc2r`:**

- **Schema:** `content_grid` gains the `cards` source (cells: optional
  title/description + optional `link` LinkAction, ≥1 of title/description,
  max 8 = the block-tree bound); the transitional `static` variant is **removed**
  (playbook trap 9 closed; seed script now safe to re-run). Renderer resolves
  cell links like hero actions (`ContentGridResolved.cardHrefs`).
- **Restructure:** `page_home` = hero (inline), 2 grid `shared_ref`s, bio
  (inline), newsletter `shared_ref`. `index.astro` collapsed to
  `<PageObjectRenderer objectId="page_home" />` (removes the loader duplication
  AND the 2026-07-10 footer-crash mode — the renderer falls back to `nav_footer`;
  the `structure_home_footer` rule still guards the store record).
- **Standing round-trip driver** (`scripts/home-conversion-roundtrip.mjs`) —
  closes root-cause 4 (throwaway drivers): ensure/heal each record (the broken
  production `page_home` reconciles via real patch ops), drill EVERY permitted
  op per type ending byte-identical, validate (zero blockers), publish, then
  contract-completeness (advertised ops ≡ exercised ops — criterion 4 ✓ for
  page/section) and inventory checks. `--local` rehearsal **PASSED end-to-end**
  (publish blocked exactly at `export_commit_failed` — the expected boundary);
  `--production [--release]` is the credentialed conversion run.
- **Gates:** astro check 0 errors; 882 + 24 tests green; build green; dist grep
  shows all five sections' real copy; render gate 5/5 IDENTICAL (fixture updated
  to the two-grid structure); build-diff reviewed: **scoped to `/` section 2
  only** (audience cards adopt the grid card frame — intentional, per
  design-principles rule 4), 202/203 pages byte-identical.

**Honest status: page_home + the three shared sections are RENDERS + fully
rehearsed, NOT yet converted.** Criteria 2/3 (production store record + proven
production round-trip) still need what no agent session has: `PUBLISH_SECRET`
(+ egress to `drluriescience.netlify.app` — this session verified the network
policy blocks it). **The remaining work is one command from a credentialed
machine:** `node scripts/home-conversion-roundtrip.mjs --production --release`
(then re-check `object_inventory` and the live site; expect the four exports'
`__generated` markers to reconcile). Alternatively: add `PUBLISH_SECRET` (and
the domain) to this Claude environment's config and re-run from a session.

## Session 2026-07-10 (definition-of-done RESET; homepage-footer regression fix)

Two things. **(1) Incident + fix (PR #383, merged):** four real production
`object_publish` calls on 2026-07-10 progressively stripped `page_home`'s store
record down to one section with no `navigationOverrides` — every step passed
validation (the field is schema-optional) and only surfaced as a site-wide Netlify
build crash (`index.astro` throws without `navigationOverrides.footer`; Astro's build
is all-or-nothing). Added the `structure_home_footer` validation rule (rejects any
page_home / pageType-home patch/publish missing the footer override, at validation
time), restored the git export, documented in `object_contract`. The **live store
record for page_home is still broken** — restoring it needs production credentials.

**(2) Governing reset (Wolf):** "converted" was being used to mean "renders," which
let half-done work look finished. New GOVERNING definition, added to CLAUDE.md /
AGENTS.md / conversion-playbook.md: an object is converted ONLY when it renders **and**
is store-backed **and** an agent can round-trip every permitted action via MCP **and**
every permitted action is in the contract + has a server tool **and** it's recorded in
docs. No half measures. **After every session, docs must be updated; no record =
not converted.** Honest status recorded: **only nav_header/nav_footer/nav_footer_home
are actually converted**; the 12 pages are rendered stubs. Root-cause analysis of why
(no production credentials in any session; missing archive/unpublish + nested-block
MCP verbs; content_item resolver gap; no standing round-trip test) is in
`object-inventory.md` "Why only nav is converted."

## Session 2026-07-09 (system pages + grid via the real MCP lifecycle; playbook)

PR #380 (`claude/system-pages-and-grid`): `page_privacy`/`page_terms`/`page_404`
cut over as `system` pages using **reusable** section types (`prose`, `cta_banner`
— no bespoke per-page types, per design-principles), and the homepage grid's
invalid `static` placeholder retired for a live `query` source. Every object was
driven through the REAL compiled MCP handler (create→checkout→validate→patch→
publish→checkin, local file-backed store; publish correctly blocked at the
`not_configured` git-commit gate — the expected sandbox boundary). Also: site-wide
noindex/nofollow guard (`SITE_NOT_YET_LIVE`, Metadata.astro) + README notice — the
site is not live; QA posts surfacing in the grid is accepted per Wolf.

**Review pass (Fable) findings, fixed in the same PR:** literal markdown backticks
shipped into page_privacy's rendered copy (no `code` tag in the allowlist);
materializer meta silently dropped `record_version` when passed camelCase (now a
loud runtime guard + test); the object-inventory same-change rule was missed.
Every trap from this batch is codified in **`docs/cms-architecture/conversion-playbook.md`**
(new; mandatory pre-conversion reading, wired into CLAUDE.md/AGENTS.md/core-structure)
so Sonnet-class conversions don't need a fix-up pass. Open follow-ups: `content_item`
resolver (manual grid curation), retiring the `static` grid variant + seed script.

## Standing state (after session 2026-07-08 D — bespoke-page cutovers)

Continues the bespoke-page cutover track opened by the `/thank-you` cutover
(`7c14eb4`, **merged to main** in `fdc55eb`), which established the
functional-equivalence gate for pages carrying a page-level inline script/scoped
style (`known-inert-diffs.md`). This session cut over the next two, each on its
**own branch off `main`** (not stacked — applying the #368–#371 scoping lesson):

| Page cutover                  | Branch / commit                      | State                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/about` → page_about**     | `claude/cutover-about` (`6180f3a`)   | **Cut over in CODE + verified.** Bespoke-markup page: prose blocks stay fixed component furniture, only the **clean fields** are object data — page + 6 section headings, portrait src/alt, closing CTA (Wolf's "clean fields only" call; no rich-text/injection surface). `build-diff` EMPTY (203/203). No page-level script/style → strict byte-identity, no ledger entry. **Not merged.**                                                      |
| **`/contact` → page_contact** | `claude/cutover-contact` (`e7e734c`) | **Cut over in CODE + verified.** First **widget-composition** page: `ContactPage.astro` re-invokes the same HeroText/Contact/Features2 widgets, every prop now object data (promotes cleanly — no prose-emphasis problem, so no clean-fields compromise). Two editorial HTML comments kept verbatim (html-minifier `removeComments` off). `build-diff` EMPTY (203/203). No link actions → empty resolved, no `resolve.ts` change. **Not merged.** |

**Two page-shape families identified for the remaining cutovers:**

- **Bespoke raw markup** (`about` done; `shop-preview` remaining). Faithful repro = one bespoke section reproducing the exact markup. `shop-preview` also carries a scoped `<style>`, so it takes the **functional-equivalence** gate + a `known-inert-diffs.md` entry (like thank-you).
- **Widget-composition** (`contact` done; `pricing`, `services` remaining). Faithful repro = a bespoke section re-invoking the page's existing widgets with props promoted to object data. `pricing`/`services` both use `CallToAction` (link actions), so each will need the action-hrefs resolved shape + a `resolve.ts` entry (like `about`) and richer data modeling (pricing tiers/steps/FAQ; content/testimonials).

**Every cutover this session:** `astro check` 0 errors, eslint/prettier clean,
full suite green (870 netlify+src, 24 script), `build-diff` EMPTY. **Object-store
seed+publish still deferred to the handoff** (no production store in this sandbox)
— same posture as thank*you and the lede family; the committed `page*\*.json`exports are the derived-export half, publish reconciles the`\_\_generated` marker.

A separate `claude/state-of-play-cutovers` branch carries only this log entry, to
keep each cutover branch a clean single-purpose diff for review.

## Standing state (after session 2026-07-08)

| Area                                  | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Homepage cutover (T3.6/T3.7/T3.8)** | **DONE + verified.** `index.astro` is a thin loader over the published `page_home` object (`src/lib/renderer/resolve.ts`). `build-diff` EMPTY (203/203 identical); verify-section-components 5/5; astro check 0 errors. On branch `claude/phase-3-cutover`, not merged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **T3.4/T3.5 exports**                 | Materialized locally (`page_home.json`, `sec_newsletter_signup.json`) via the real materializers. Blob records still unpublished — a real `object_publish` reconciles the `__generated` marker only (handoff Step 2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Structural-capacity guardrail**     | **NEW.** `src/lib/registry/structural-capacity.ts` + `nav_actions_capacity` criterion (warn-only; content stays editable). The first "JSON-based hard rules" layer — fixed structure, agents decide content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **T2.6**                              | **DONE** (was "parked"). `navigation.ts` + demo chain deleted; import chain verified self-contained.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **T3.13 extensibility drill**         | **DONE.** `testimonial` type added end-to-end; proves one-module-one-binding cost.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **nav_header incident**               | `nav_header.actions` is `[]` on `main` (test-probe fallout, not live). Fix is object-layer (handoff Step 1) — the guardrail, not a human gate, is the durable answer per Wolf's framing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Remaining to close Phase 3**        | All object-store operations: publish page/section (reconcile), T3.9 grid content (needs renderer wiring + curation), T3.11 route→page upgrade, release. **See `phase-3-handoff.md` for exact steps + payloads.** T3.10/T3.12 admin-UI deferred (block nothing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **T3.9 content_grid code**            | **DONE.** `manual`/`query` rendering wired (`resolve-content-grid.ts` → `resolve.ts` + `ContentGrid.astro`, resolvers from `fetchPosts()`). Only the object-layer source-kind switch + curation remain (handoff Step 3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Phase 4 — lede family (T4.2/T4.3)** | **Cut over in CODE + verified.** New `lede` section type + component + shared `PageObjectRenderer`; 5 interior pages (start-here, member-updates, newsletter, free-guide, early-access) are thin loaders, `build-diff` EMPTY (203/203). Object-layer seed+publish is NEW records — handoff Step 4b.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **build-diff normalizer**             | **Extended** (`0e34ea4`) to drop class-attribute-value ORDER + CSS chunk-STEM (both content-neutral; astro-compress frequency-sort + Astro chunk renaming churn every page when a component is added). Required to verify any Phase 4 page cutover.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Self-describing object contract**   | **NEW** (`0212f55`). `object_contract(object_type)` MCP tool + `src/lib/registry/object-contract.ts`: one read-only call returns the full editing contract (body JSON-schema, all 16 section variants + fields, per-type patch ops with arg schemas + minted-id fields, constraints, publish policy, workflow, aux inputs) — all DERIVED from the enforcing code (`z.toJSONSchema`, `patchOpNamesByObjectType`, the registries, `activeApprovalPolicy`), so it cannot drift. `registry_get('component')` un-stubbed from the same source. Agents no longer guess what a valid body/op looks like.                                                                                                                                                                                       |
| **Live validation enforcement**       | **NEW** (`b48413c`). `netlify/lib/object-validation-context.ts` + injection at object-store.ts/admin-object.ts: the write path now runs the resolver-dependent criteria (reference integrity, PageType allowed/required sections, route uniqueness, template registry, taxonomy) that previously degraded to `optional`. So the boundaries the contract advertises actually bite. Regression-guarded: every committed export validates zero-blockers under the live resolvers.                                                                                                                                                                                                                                                                                                          |
| **Section-type catalog COMPLETE**     | **NEW** (`05de63e`, `4f9e9a1`, `f4d532b`). Bound the 8 schema-legal-but-unbound section types — `prose`, `cta_banner`, `faq`, `link_list`, `product_preview`, `contact_form`, `search`, `content_embed`. Every variant except `shared_ref` (dereferenced by the renderer, never a component) now has a component + editor hints and surfaces as `component_bound` in `object_contract` / `registry_get`. Reusable guardrailed primitives an agent can compose onto any page; `build-diff` EMPTY (additive registry entries — no page renders them yet). **Bespoke-page cutovers (about/contact/pricing/services/shop-preview) deliberately deferred:** their hand-tuned per-block markup can't be both byte-identical AND reusable-guardrailed (Wolf chose "finish the catalog first"). |

### Session 2026-07-08 (Phase 3 cutover, one long autonomous session)

Ran from a sandbox with **no route to the production object store** (no MCP
tools, no `PUBLISH_SECRET`, no egress — verified at start). So this session did
every **code + cutover** task and left every **object-store** task as a
documented handoff (`phase-3-handoff.md`). Five commits on
`claude/phase-3-cutover`, full suite green (848 netlify/src + 20 script), build
green, `build-diff` empty for the cutover.

**Landed:** the structural-capacity guardrail (the deconfliction framework Wolf
asked for — warns on over-budget header CTAs, never blocks content, deliberately
does NOT re-add the action↔menu duplication flag the seed's "exactly one warning
class" invariant forbids); T2.6 dead-code deletion; the two derived exports; the
homepage cutover (T3.6/T3.7/T3.8) verified byte-identical; the T3.13 testimonial
drill.

**Deliberately deferred (object-store / editorial / large admin-UI):** the real
publishes, the nav_header incident fix, T3.9 grid content (renderer wiring +
curation), T3.11 target upgrades, release, T3.10/T3.12. Phase 4 does not start
until the cutover pattern is exercised against production (handoff Steps 1–5).

**Judgment calls (per Wolf's "make reasonable decisions" directive):** treated
T2.7's old blocking rationale as superseded (approval policy is `all-autonomous`,
publish is agentic); kept the policy autonomous rather than re-gating (the fix
for the incident is the structural guardrail); materialized exports locally from
the canonical seed so the cutover could be verified, with the marker-reconcile
documented.

## Standing state (after session 2026-07-07)

| Area                              | State                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Configurable approval policy      | **Landed** (`b50c5e4` + follow-ups on PR #364) — replaces T1.4's hardcoded tier gate entirely. See "New model" below.                            |
| `netlify/lib/tier-gate.ts`        | **Deleted.** Replaced by `netlify/lib/publish-gate.ts`; `Tier` type and `tierForObjectType` are gone from the codebase.                          |
| Everything else from 2026-07-06 C | Unchanged — still standing as recorded below (T2.7/T2.6 waiting on Wolf, T3.2–T3.10 landed, homepage cutover still forbidden until T2.7 closes). |

### New model: configurable approval policy (replaces T1.4's hardcoded tiers)

The old scheme hardcoded publish permission by tier: Tier 1 (`content_item`)
untouched, Tier 2 (`page`/`section`/`template`) agent-publishes-after-approval,
Tier 3 (`navigation`/`taxonomy`/`site`) approval-plus-**human-executed**. That
fixed scheme is gone. There is now **one gate, one question, per object type**:
_does a change to this type require human approval before it can be published?_

- **Not gated (the default):** an agent proposes and publishes directly. Fully
  autonomous, no human in the loop.
- **Gated (opt-in):** an agent proposes → the change waits → a human approves
  → **the agent publishes it**. There is no separate "human executes the
  publish" step anymore — approval is the only human touch, on every governed
  type, not just former-Tier-2. If a further edit invalidates the approval
  (`content_revision` moves), it waits again.

**How Wolf flips posture — one file, no code changes:**
`src/config/approval-policy.ts`. Two levers:

```ts
export const approvalPolicyConfig = {
  master: 'all-autonomous', // or 'all-require-approval'
  overrides: {}, // e.g. { navigation: 'require-approval' }
} satisfies ApprovalPolicyConfig;
```

- `master` is the fast lever for the whole system's posture.
- `overrides` pins individual types (`page`, `section`, `navigation`,
  `taxonomy`, `site`, `template`) against the master, either direction.
- Resolution order: per-type override → master switch → hardcoded default
  `autonomous`. An unconfigured type in an unconfigured system is fully
  autonomous — this is the checked-in **dev-stage default** (`all-autonomous`,
  no overrides).
- `content_item` (articles) is structurally outside this config — the schema
  rejects it as an override key — and keeps its own pipeline (OQ-8), untouched.

**What's preserved verbatim from T1.4:** the `content_revision`-based approval
invalidation (an approval is invalidated by a body write, not by lock
checkout/checkin or the publish stamp — both still bump only `version`); the
M-6 publish-action pin exactness for agent execution on gated types; the
patch/inverse Discard mechanism. **What's decoupled:** audit-trail writing
(history attribution, patch+inverse capture, the publish receipt) never lived
in the gate to begin with — it's unconditional in `object-patch-apply.ts` and
`object-publish.ts` regardless of gate outcome, so an autonomous publish is as
attributed and revertible as an approved one. Nothing needed to change there;
this was verified, not assumed (see `publish-gate.test.ts`'s explicit
autonomous-publish-audit-trail assertions and the wiring tests in
`object-verbs-review.test.ts` / `publish-review-lifecycle.e2e.test.ts`).

**Module map:** `src/lib/approval-policy.ts` (pure resolution: `governedObjectTypes`,
`publishRequiresApproval`, zod-validated `resolveApprovalPolicy` that THROWS on
a malformed config rather than silently defaulting permissive) + `src/config/approval-policy.ts`
(the one editable file) + `netlify/lib/publish-gate.ts` (the server gate,
replacing `tier-gate.ts`) + `src/lib/admin/object-review-ui.ts` (client-safe
display-only mirror for the admin UI's button visibility — same policy, same
resolution, never the enforcement point).

**Consumers updated:** `object-verbs.ts` (gate + inventory both take an
injectable `approvalPolicy`, defaulting to the committed config),
`object-inventory.ts` (`tier` field replaced by `requires_approval`),
`mcp.ts`'s `object_inventory` tool (same rename), `admin-auth-state.ts` (comment
only, gate reference updated). Three scripts (`drill-footer-cta.mjs`,
`patch-nav-header-t28-t29.mjs`, `submit-navigation-review.mjs`) had their old
"expect-403 live agent publish probe" removed — under an autonomous posture
that probe would have actually **published**, not been refused, so firing it
blind was no longer safe; `--verify-tier3` is retired with an explicit error
pointing at the offline gate-matrix tests instead.

**Test matrix (`tests/netlify/publish-gate.test.ts`, new, replaces
`tier-gate.test.ts`):** every master × override × type combination in both
directions (master all-autonomous per type, master all-require-approval per
type, one override against each master for every governed type), the config
parse itself (dev default pinned; malformed configs throw; `content_item` and
typo'd keys rejected), M-6 pin exactness, the full content_revision
invalidation lifecycle (survives lock ops and the publish stamp, dies on a
body write), and two explicit "changing the config changes behavior
immediately" tests. `object-verbs-review.test.ts` and
`publish-review-lifecycle.e2e.test.ts` (the T1.8 exit drill) were rewritten at
the wiring/e2e level for the same model — including a new drill scenario
proving the replacement behavior end-to-end: gated navigation, approved by a
human, **published by the agent**, not a human.

Full suite green (822 netlify/src tests + 20 script tests, eslint/astro/prettier
clean) before this landed.

## Standing state (after session 2026-07-06 C)

| Area                   | State                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| T2.7                   | **STILL WAITING ON WOLF** — commands + clicks both run on his side (agent sandbox has no PUBLISH_SECRET and no egress to production); runbook §6  |
| T2.6                   | PARKED — Wolf alone                                                                                                                               |
| publishReceiptSchema   | **Approved + landed** (`df5e631`) — typed to the real buildReceipt shape; ObjectPublishReceipt derives from it                                    |
| T3.2 (M-9 + registry)  | **Done** (`57f878f` + `c292f7e`) — five components render 5/5 IDENTICAL to the live homepage via `scripts/verify-section-components.mjs`          |
| T3.3 (M-8)             | **Done** (`41bbc80`) — manual+fallback schema, validation, pure resolution helper for T3.6                                                        |
| Next (T3.4/T3.5)       | Reference-count validation (archive refused while referenced) + seed-page-home script (assembles from `home-fixture-data.ts` — one transcription) |
| T3.6+ homepage cutover | FORBIDDEN until Wolf's T2.7 clicks close Part 1                                                                                                   |

## Session 2026-07-06 C

Wolf's directives: receipt tightening approved (landed, `df5e631`); T2.7
"run the drill clicks" — **cannot run from an agent session**: no
`PUBLISH_SECRET` in the environment and the sandbox proxy blocks egress to
the production domain (verified empirically this session), and the
approve/publish clicks are architecturally human-only regardless (Tier 3 —
the drill exists to prove exactly that). The full command+click sequence
stays in runbook §6; every agent-side command is safe to run from Wolf's
machine as-is. Continued into Phase 3: T3.2 (with amendment M-9) and T3.3
(M-8) landed; T3.2's render gate compares component output against the live
homepage from the same build — the strongest available oracle — and passed
5/5. `index.astro` remains untouched (T3.6 is the cutover).

Continuation (same session, "keep working"): **T3.4+T3.5 seed half**
(`3c17c24`) — `scripts/seed-page-home.mjs` creates `sec_newsletter_signup`
then `page_home` with the seed-navigation discipline plus a schema-vintage
gate (the bodies use M-8/M-9 fields; a create rejection on those keys means
Phase 3 isn't deployed, not bad data); tests pin the seed deep-equal to the
T3.2 render fixture, so the seeded record IS the proven data. **T3.10 lib
half** (`050ada4`) — `netlify/lib/object-impact.ts` computes the real
affected-pages lists (shared_ref / navigationOverrides-then-site-default /
template provenance); `sec_newsletter_signup → page_home` pinned by test.

**Everything still open is gated**, none of it agent-completable offline:
T2.7 + T2.6 (Wolf), seed `--execute` + Tier 2 publishes (production creds,
post-deploy), T3.6–T3.9 cutover chain (forbidden until T2.7 closes),
T3.11 (needs published page objects), T3.10 admin wiring + T3.12 editor
(admin-UI surfaces — take them with a fresh session's full context), T3.13
(drill; also exposes that a new section type needs a union edit outside
the registry dirs — flag to resolve when run). **Open dependency noted:**
T3.4's archive-refusal needs an `archive` verb that does not exist yet —
object-impact provides the reference count it will consume; building the
verb is propose-first (new write path).

New gotcha for the log: Astro silently excludes underscore-prefixed files
in `src/pages` from routing — the render-gate fixture had to be named
without the `__` prefix.

## Standing state (after session 2026-07-06 B)

| Area                        | State                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 + Phase 1           | Complete on `main`; both exit drills re-run this session from actual output (object-lifecycle 5/5, publish-review-lifecycle 4/4 covering the 5 scenarios)                 |
| Phase 2 (T2.0–T2.5, T2.8–9) | **Complete and live.** nav_header/nav_footer/nav_footer_home are CMS objects; chrome renders from published exports; T2.8+T2.9 end state verified (see §7 of the runbook) |
| T2.6                        | **PARKED — Wolf alone.** Production observation window, then the cleanup commit (runbook §5). Explicitly excluded from agent sessions                                     |
| T2.7                        | **READY FOR WOLF.** Agent side fully scripted + offline-verified; ordered checklist in runbook §6                                                                         |
| Object inventory (Part 2)   | **Done.** `object_inventory` MCP tool + `inventory` verb (commit `eed8cae`)                                                                                               |
| T3.1 PageType registry      | **Done** (commit `0a400c4`). `registry_get('page_type')` live; `listing`/`content_detail` typed-but-unimplemented until P6                                                |
| T3.2 component registry     | **Not started — next session's first task** (see "Next work" for the two decisions it needs)                                                                              |
| T3.3+ / homepage cutover    | Not started; **T3.5+ cutover remains forbidden until Wolf closes Part 1's human steps** (T2.7 clicks are the acceptance gate)                                             |

## Session 2026-07-06 B (this session)

Branch: `claude/phase-2-nav-footers-fdwfpt`, restarted from `main`@`e09e608`
(prior PR #362 merged; branch carried no unmerged work).

**Verification battery (mandate-required, all read from real state):**

- `main` tip `e09e608 Publish navigation: nav_header` — Wolf ran the
  T2.8+T2.9 patch + publish AFTER the premature #362 chrome merge; the
  rehearsed regression window closed itself. Recorded in runbook §7.
- `origin/main:src/data/site/navigation/nav_header.json` body deep-equals
  `applyPatchOps(seed, NAV_HEADER_T28_T29_OPS)` exactly (record_version 20;
  actions `['Join Early Access','Join Newsletter']`; `i_early_access` gone).
- `main` builds green (210 HTML files); rendered header carries both action
  containers with `data-newsletter-cta` in each; the only remaining
  'Early Access' label is the `nav_footer` link T2.7 edits by design.
- Phase 0 + Phase 1 exit drills pass from actual output.

**Landed (one task, one commit):**

- `6ac2c47` — T2.8+T2.9 runbook truth-up (executed record incl. the
  out-of-order merge; T2.5 gate marked PASSED 210/210).
- `bb28864` — T2.7 agent side: `scripts/drill-footer-cta.mjs` (two legs,
  pre-flight state gate, Tier 3 refusal check, submit-only),
  `scripts/lib/nav-footer-t27-drill.mjs`, offline tests proving both legs
  through the real T0.6/T0.7 engine (revert restores the seed byte-exactly);
  runbook §6 rewritten as the ordered agent/human checklist.
- `eed8cae` — Part 2: `object_inventory` MCP tool + `inventory` verb.
  Read-only; per object: tier, lock (held/free/holder/expiry, never the
  token), review state incl. `'none'`, version, content_revision,
  published_time, published_content_revision (from the T1.3 receipt),
  `unpublished_changes`; filters status/tier/review_state/pending_changes;
  single-object detail view. No new stored state.
- `0a400c4` — T3.1: PageType registry v1 (`src/lib/registry/page-types.ts`)
  - `registry_get('page_type')` serving definitions with a
    JSON-schema-rendered shape.

**Waiting on Wolf (ordered):**

1. **T2.7 drill** — runbook §6 checklist. Agent steps are scripted; your
   steps are the two review/approve/publish clicks (forward leg, then
   revert leg). This is the Phase 2 acceptance test and the gate the
   homepage cutover (T3.5+) waits behind.
2. **T2.6** — whenever you're satisfied with the production observation
   window: say so, and the cleanup commit gets prepared per runbook §5
   (delete `src/navigation.ts` + demo pages, build-verified).
3. **Proposal (shared-interface, not acted on):** `publishReceiptSchema` in
   `src/schema/object-record-v1.ts` is a loose `z.record(...)` while
   `buildReceipt` (T1.3) writes a rich fixed shape the new inventory now
   reads (`content_revision`). Tightening the schema to the real shape would
   let consumers rely on it — but it's a Phase 1 file, so it needs your nod.

**Next work (for the next agent session):**

1. **T3.2 component registry + section components** — deliberately deferred
   whole rather than half-landed. Two decisions to make at session start:
   (a) render-test vehicle for `.astro` components under the repo's
   tsc+node--test harness (Astro's experimental Container API needs a vite
   pipeline; options: a small vite-based test entry, or snapshot the built
   HTML via the T2.0 harness instead), and (b) whether registry modules
   import per-variant zod schemas from `section-v1.ts` (single source of
   truth stays in schema land) or the reverse. Extraction itself is
   mechanical: `index.astro:89-201` → five components, markup-verbatim.
2. T3.3 (M-8 content_grid manual+fallback), T3.4 (shared newsletter
   section), T3.5 seed script — in order, after T3.2.
3. Homepage cutover (T3.6/T3.7) only after Wolf's T2.7 clicks close Part 1.

**Gotcha log (recurring):**

- `*/` inside a JS block comment terminates it — bit T2.4's docs once and
  this session's drill script once (`--execute-*/--verify`). Write flag
  pairs without the slash-star adjacency.
- `node --test tests/scripts/` (directory form) fails; use the glob.
- The Astro content store bleeds across worktrees via symlinked
  node_modules — `scripts/build-diff.mjs` purges it per build; do the same
  in any new harness.
