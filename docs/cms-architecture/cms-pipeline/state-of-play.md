# State of play — agent-editability push

Rolling session log for the multi-session mandate ("an agent can inspect and
edit any meaningful part of the live Dr-Lurie site through one consistent,
human-reviewed workflow"). Each session appends its entry at the top and
updates the standing tables. **Rule inherited from the mandate: never trust
this file over real state — verify against main / test output / the live
store before building on anything below.**

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
