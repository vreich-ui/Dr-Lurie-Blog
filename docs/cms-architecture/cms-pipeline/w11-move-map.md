# W11 move map — source path → target package (authoritative for T11.2–T11.6)

Generated at **T11.1** from the real tree on `main` @ `5d74ad19`, against the
target layout ratified at T11.0 (`11-platformization-plan.md` §2.2). T11.2–T11.6
**execute this map** rather than improvising; if the tree has drifted when a
task runs, re-verify against `main` first (Loop Step 1) and amend this file in
the same commit.

**Invariant for every move task:** the public `drlurie` build stays
byte-identical — `scripts/build-diff.mjs` EMPTY after each commit. Moves are
`git mv` + import-path rewrites only; no behavior change.

## Off-limits / do-not-move (HARD STOPS — carry through unchanged)

- `netlify/functions/publish-article.ts`, `netlify/functions/admin-workflow-lock.ts`,
  and the legacy article MCP tools — **stay where they are, byte-untouched.**
  The legacy article path remains Dr-Lurie-bound until its separate retirement;
  do not pull it into `packages/core`.
- `mcp/save-json-blob-mcp/` — **retired-not-extracted** (OQ-W11-6). Importer-check
  first; it does NOT enter core. Leave in place.
- Routing authority stays a committed FILE (Wolf B2): `src/config.yaml` /
  `astro.config.ts` / `netlify.toml` become `sites/drlurie/site.config.*` +
  generated `netlify.toml` (T11.5), they are NOT objectified.
- `tests/` fixtures are lint-exempt for v1 (parameterization deferred) — do not
  rewrite fixture literals during extraction.

## packages/core  (LAW + MACHINERY — fleet-propagated)  <- T11.2–T11.4

| Target (packages/core/…) | Source | Task | Notes |
| --- | --- | --- | --- |
| `schema/` | `src/schema/**` (object-record-v1, bodies/*, object-patch-ops, schema-v1, article-content-v1, tracking-event-v1, workflow-contract) | **T11.2** | Pure zod/types. Co-located `*.test.ts` move with their units. |
| `lib/` | `src/lib/*` pure modules: `object-ids*.ts`, `object-patch-apply*.ts`, `agents-naming*.ts`, `approval-policy.ts`, `creation-policy.ts`, `media-policy.ts`, `site-identity*.ts`, `template-instantiate.ts`, `publishArticleFromPayload.ts`, `contentSource*.ts` | **T11.2** | Pure libs only in T11.2. |
| `lib/registry/` | `src/lib/registry/**` (page-types, theme-tokens, components/*, object-contract) | **T11.2** | Registries are law. |
| `lib/grammar/`, `lib/validation/` | grammar + validation-engine modules under `src/lib/**` (T0.6/T0.7 outputs) | **T11.2** | Pure. |
| `lib/renderer/`, `lib/richtext/`, `lib/article-content/`, `lib/article-object/`, `lib/edit-mode/` | `src/lib/{renderer,richtext,article-content,article-object,edit-mode}/**` | **T11.4** | Renderer/edit surface — moves with components in T11.4. |
| `lib/tracking/` | `src/lib/tracking/**` | **T11.2** | Pure (W13 substrate). |
| `server/` | `netlify/functions/*.ts` (the **verb/store/publish/materializer/release/MCP-factory** set — 37 fns MINUS the off-limits legacy ones above), `netlify/lib/**` (incl. `agent/`, `materializers/`), `netlify/lib/taxonomy-enforcement.ts` | **T11.3 (NOTIFY)** | Security boundary. De-hardcode `tax_drlurie` (`taxonomy-enforcement.ts:25`) is T11.5, not here — T11.3 is move + import-rewrite only. |
| `components/` | `src/components/{sections,cms}/**`, `PageObjectRenderer`, canvas components under `src/components/**` | **T11.4** | Section components + renderer. |
| `admin/` | `src/components/admin-ui/**` (AdminShell.tsx et al.), admin-facing `netlify/functions/*` as factories | **T11.4** | W9 workspace (React islands). |
| `cli/` | `scripts/build-diff.mjs`, roundtrip/reconcile/sync drivers under `scripts/*.mjs` that are site-parameterizable | **T11.4** | Site-parameterized in T11.7; T11.4 relocates only. |

## sites/drlurie  (ONE CLIENT — data + bindings only)  <- T11.5–T11.6

| Target (sites/drlurie/…) | Source | Task | Notes |
| --- | --- | --- | --- |
| `site.config.*` | `src/config.yaml`, site-bound fields from `astro.config.ts` (site URL, permalinks, metadata template, image domains) | **T11.5** | Routing stays a FILE. De-hardcode per §2.3. |
| `netlify.toml` | root `netlify.toml` (redirects `/mcp`, `/admin/*`, `/blog`, `/shop`, `/pdf/*`, `/img/*`…) | **T11.5** | Generated/templated from `site.config`. No behavior change. |
| `seeds/` | `scripts/lib/*-seed-data.mjs` (16 seed modules) + `scripts/sync-site-seed.mjs` binding | **T11.6** | Data — copy semantics, not fleet-propagated. |
| `data/site/` | `src/data/site/**` (committed exports: `articles/*.json`, `navigation/*.json`) | **T11.6** | Committed exports move verbatim. |

## De-hardcode targets folded into T11.5 (from §2.3)

`tax_drlurie` (`netlify/lib/taxonomy-enforcement.ts:25`) -> per-site resolve;
`strategy_drlurie` (content-item schema) -> site-derived id; image-host URLs;
git-committer fallback email; per-site env bindings (`PUBLISH_SECRET`,
`NETLIFY_SITE_ID`, `GITHUB_REPOSITORY`/branch, build hook, `MCP_HTTP_AUTH_TOKEN`,
AI keys) -> per-site env table (provisioned by the T11.7 CLI). **`publish-article.ts`
references stay byte-untouched.**

## Sequencing

T11.2 (pure libs) -> T11.3 (server layer, NOTIFY) -> T11.4 (renderer/components/
admin/cli) -> T11.5 (de-hardcode + site.config/netlify.toml) -> T11.6 (seeds +
exports relocation). Each is one commit, build-diff EMPTY, `packages/core` and
`sites/drlurie` building green from root.

## T11.6 execution amendment (2026-07-24 — per this file's amend clause)

Landed as gated step-commits (the T11.4 precedent). **Step 1** (prior commit
`f2569175`, now merged to `main` via PR #471): seeds → `sites/drlurie/seeds/`.
**Step 2** (this amendment): committed exports `git mv`'d `src/data/site/**` →
`sites/drlurie/data/site/**` (verbatim — same tree shape, only the root moved)
and the publish-time materializer paths were PARAMETERIZED rather than
re-hardcoded to the new literal:

- `MaterializeMeta` (`packages/core/server/lib/materializers/shared.ts`) gained
  a required `exportRoot: string` field + an `exportPath(meta, ...segments)`
  helper; all 11 per-type materializers build their `path` from it instead of
  a literal `src/data/site/...` template string. Core hardcodes no client's
  tree — a materialize call with no exportRoot fails loudly (same stance as
  the T11.2 policy-provider seams), so a future second site can never collide
  on Dr-Lurie's export tree by omission.
- `SiteBinding` (`packages/core/server/lib/site-binding.ts`, T11.3's seam)
  gained a `dataRoot: string` field — the site's export root, e.g.
  `sites/drlurie/data/site`. `src/config/site-binding.ts`'s `drlurieSiteBinding`
  sets it; `object-publish.ts`'s `PublishObjectDeps.exportRoot` is threaded
  from there through every publish-reaching call site: the two publish-key/
  admin function factories (`object-store.ts`, `admin-object.ts`), the
  publisher-agent factory (`run-publisher-agent.ts`), and the agent-chat tool
  context (`agent/context.ts`, wired from both `admin-agent-chat.ts` and
  `admin-agent-chat-run-background.ts`). All five factories' previously-inert
  `_binding` parameter (a T11.4 residual — `createHandler(_binding)` ignored
  it) now actually closes over it; the other ~27 factories that never reach
  publish are untouched.
- **Fixed in passing, not scope creep:** T11.5 had left TWO divergent
  `SiteBinding`-shaped values — the real one at `src/config/site-binding.ts`
  (wired into every netlify shim) and an unused duplicate reconstructed in
  `sites/drlurie/site.config.ts`. Threading `dataRoot` onto two copies would
  have been the exact drift this seam exists to prevent, so
  `site.config.ts` now re-exports the real binding instead of rebuilding one.
- Readers updated (relative `import.meta.glob` in `site-object.ts`; the 11
  `astro:content` collection `base` globs in `src/content/config.ts`; comment-
  only path mentions in `products.ts`/`blog.ts`/`section-resolve-deps.ts`/
  `PageObjectRenderer.astro`/`CustomStyles.astro`/`PageLayout.astro` — none of
  these had a second hardcoded path, only prose).
- Test fixtures updated: 19 test files either asserted a materializer path
  literal, located a real committed export by walking up the directory tree,
  or passed a bare `{at, record_version}` meta/publishDeps object that now
  needs `exportRoot`. Two hard stops upheld while doing this: (1) the
  zero-drlurie lint caught a literal `sites/drlurie/data/site` EXAMPLE inside
  a thrown-error string in `object-publish.ts` — fixed by making the message
  generic (comments are exempt, runtime strings are not); (2) the T11.5
  apostrophe-in-single-quoted-string bug recurred in `object-contract.ts`'s
  tracking_config description (`the site's <exportRoot>` broke the parser
  identically to the T11.5 incident) — fixed by rewording rather than
  escaping, twice, until zero apostrophes remained in that literal.

**Step 3 (this amendment, completed):** driver scripts stay at their current
path — the physical `packages/core/cli/` relocation is DEFERRED to T11.7 (the
T11.4 amendment already set this precedent: "rides T11.7 where site-
parameterization makes the move meaningful"). Reasoning: ~40 other task briefs
across the queue reference `node scripts/build-diff.mjs`/
`scripts/home-conversion-roundtrip.mjs` at their literal current path; moving
the files now (with no compensating value beyond the move itself, since T11.7
hasn't yet built whatever cli scaffolding would make the new location
meaningful) would silently break every one of those references. What T11.6
genuinely requires — `--site` parameterization, since the scripts were
actively broken by step 2's `git mv` — was done in place instead:

- `scripts/build-diff.mjs` gained a `--site <path>` flag (default
  `sites/drlurie`); `SELF_TEST_FILE` now derives from it
  (`` `${site}/data/site/pages/page_home.json` ``) instead of a hardcoded
  `src/data/site/...` literal.
- `scripts/home-conversion-roundtrip.mjs` gained `--site <path>` (default
  `sites/drlurie`); `siteRoot`/`siteExportRoot` derive from it and are used for
  the default `--seeds` path, the navigation reference-target seed lookup, and
  the `--write-exports` materialize meta's `exportRoot`. Production-mode
  endpoint resolution now reads `canonicalHost` from the site's compiled
  `site.config.js` (falling back to the existing hardcoded endpoint if that
  compiled file isn't present), rather than hardcoding the one site's host.
- **Found and fixed in passing** (latent breakage, not new scope, but blocking
  the acceptance criterion so it had to be fixed to prove the criterion true):
  three stale paths in `home-conversion-roundtrip.mjs` left over from earlier
  waves and never caught because this driver isn't part of `npm test` — only a
  manual rehearsal surfaces it. (1) the default `--seeds` path still pointed at
  the pre-T11.6-step-1 `scripts/lib/page-home-seed-data.mjs` location (the step-1
  import rewrite only caught static `import` statements, not this
  `path.join()` construction); (2) the navigation reference-target seed path
  still built from `repoRoot + 'src/data/site/navigation'`, broken by this
  session's own step-2 move; (3) the materializer and `local-blobs` compiled-
  path imports still pointed at the defunct `netlify/lib/...` location, a T11.3
  regression that had gone unnoticed until now.
- `sites/drlurie/seeds/sync-site-seed.mjs`'s `EXPORT_PATH` (the production-
  export comparison target) still pointed at the pre-step-2
  `src/data/site/site.json` — step 1 had correctly moved the seed/script but
  couldn't have updated this, since the export itself hadn't moved yet at
  step-1 time. Fixed to `sites/drlurie/data/site/site.json`; verified
  `--check` reports "seed already matches the production export."

Acceptance criteria verified after reverting two `--write-exports` rehearsal
runs' pollution of the real committed export files (expected/documented
behavior of that flag — it writes fresh-store rehearsal data with different
`record_version`/`at` markers over the real files; reverted both times via
`git checkout --`):

- `npm test`: 1627/1627 + 70/70 pass.
- `npx astro check`: 0 errors. `eslint .` / `prettier --check`: clean.
- `node scripts/build-diff.mjs --self-test --site sites/drlurie`: PASS (both
  sub-checks).
- `node scripts/build-diff.mjs HEAD origin/main --site sites/drlurie`: EMPTY —
  74 pages compared, 74 identical, 0 changed.
- `node scripts/home-conversion-roundtrip.mjs --local --site sites/drlurie`
  (and again with `--write-exports`): SUCCESS both times — full lifecycle
  against the file-backed store, publish blocked only at the expected
  `export_commit_failed` credential sandbox boundary.

T11.6 is done as of this amendment.

## T11.7 execution amendment (2026-07-24 — per this file's amend clause)

Built per `T11.7-provisioning-cli.md`'s own Scope section (the standalone
brief), which lists only `packages/core/cli/create-site.mjs` +
`docs/cms-architecture/site-provisioning-runbook.md` — it does NOT itself
call for moving `scripts/build-diff.mjs` /
`scripts/home-conversion-roundtrip.mjs` / `scripts/lib/roundtrip-reconcile.mjs`
into `packages/core/cli/`, even though this file's own `cli/` row (above,
under T11.4) assigns that relocation to land "site-parameterized in T11.7."
**Recorded discrepancy, not improvised scope:** the two planning docs
disagree (this move-map's row vs. the concrete T11.7 brief); per
autonomous-run.md's evidence-over-doc rule, the standalone brief governs
what a task actually does, and moving three scripts ~40 other task briefs
reference at their current literal path is exactly the kind of scope
addition the "one task, one commit, minimal diff" rule warns against absent
an explicit instruction. Left for T11.12 records close-out to reconcile
which planning doc wins, rather than guessing. `create-site.mjs` is
`cli/`'s first real inhabitant either way — the directory placement itself
is not in question, only whether the pre-existing driver scripts join it.

`create-site.mjs` scaffolds `sites/<client>/` as **fully self-contained**
(its own `config/site-identity.ts` + `config/site-binding.ts` +
`site.config.ts`, importing only from `packages/core`) rather than
following Dr-Lurie's shell (`sites/drlurie/site.config.ts` re-exports
identity/binding singletons from `src/config/*`, T11.6's fix for a T11.5
residual) — that location is Dr-Lurie's OWN committed config, not a shared
core seam a second client could import from. This is the cleaner target
shape for every *subsequent* client; Dr-Lurie's own wiring is untouched
(no reason to touch a working, tested, byte-identical setup for this task).

Baseline seed pack: site singleton (generic starter branding/palette, not
Dr-Lurie's), a two-item nav skeleton (`nav_header`/`nav_footer`, each one
"Home" link), an empty taxonomy registry (`tax_<client>`, zero terms — a
new client has no vocabulary yet), a default theme (`thm_<client>_default`,
tokens imported from the site seed, same no-op-apply pattern as
`thm_drlurie_default`), and the same five starter section-template recipes
Dr-Lurie's `stpl_*` set uses (their blueprint copy carries no client-specific
content, so there is no reason for a client's copy to diverge from the
canonical starter set). All five body shapes verified against the real
`packages/core/schema/bodies/*` zod schemas — two real bugs caught this way
and fixed: `content_grid`'s `related` source needs `algorithm`, not a bare
`related_articles` kind; `newsletter_signup` needs `formName`, not
`formAction`.

`--netlify-token` execution (site creation, the 8-store write/read/delete
probe — `site-objects`/`workflows`/`artifacts`/`artifact-index`/`commerce`/
`agent-chats`/`governance`/`users`, mirroring
`scripts/provision-pdf-tool-stores.mjs`'s pattern for the separate pdf-tool
stores — and pushing generated per-site secrets straight to the new site's
env store) is built against the documented Netlify API shape but **UNVERIFIED
against a live account**: `NETLIFY_API_TOKEN` is not available in this
session (autonomous-run.md's own prerequisites list already flag it as
"needed from T11.7 on"). Per the standing "credential unavailability isn't a
blocker" instruction, this is recorded as a limitation, not treated as a
halt — the brief's actual acceptance criteria (unit tests over scaffold
output, dry-run fixture, no secret material in any artifact) don't require a
live run, and non-goal explicitly rules out creating a real second site in
this task. `executeNetlifyProvisioning` is written with an injectable
`fetchImpl`/`getStoreImpl` seam so the control flow itself is testable
without live credentials, matching the `object-publish.ts` /
`provision-pdf-tool-stores.mjs` testing-seam precedent — but the actual
Netlify wire shapes (`POST /api/v1/sites`, `POST /api/v1/accounts/:id/env`)
are only as verified as the current public docs describe; a first live
`--netlify-token` run (naturally, T11.11's provisioning step) is this path's
real proof.

## T11.8 execution amendment (2026-07-24 — per this file's amend clause)

Replaced the T11.1 placeholder `fleet` job (hardcoded `matrix: site:
[drlurie]`) with real dynamic discovery: `scripts/ci/discover-fleet-matrix.mjs`
(new — `discoverSites()` lists every `sites/<name>/` carrying its own
`site.config.ts`; `computeFleetMatrix()` is a pure decision function, unit-
tested against fixture diffs with no real git/filesystem access) feeds a new
`discover-fleet` job's outputs into both the `fleet` job's matrix and a new
`fleet-build-diff` job.

**The fan-out rule is deliberately conservative**, matching this project's
"no half measures" posture applied to CI correctness: a diff confined
ENTIRELY to `sites/**` paths only rebuilds the touched site(s); anything
else (`packages/core`, root config, the workflow file itself, docs, an
unresolvable diff) fans out to the WHOLE fleet. Silently under-building on
an ambiguous change would be the actual bug — over-building is just a
slower green. Verified against real git history (not just the unit tests):
`HEAD~1..HEAD` and `origin/main..HEAD` both correctly report `fanOut: true`
(T11.6/T11.7's changes touch `packages/core`); a throwaway demo commit
touching only `sites/drlurie/data/site/` correctly reported `fanOut: false,
sites: ['drlurie']` before being reverted with `git reset --hard`.

**The site-seed drift guard** (`node sites/<site>/seeds/sync-site-seed.mjs
--check`) moved out of the `check` job (where it was hardcoded to
`sites/drlurie`) into the `fleet` job's per-site steps, so a second client
gets its own drift guard automatically — best-effort: skipped (not failed)
for a site with no `sync-site-seed.mjs` yet, since T11.7's `create-site.mjs`
scaffold doesn't generate one today (a recorded residual for a future task,
not silently papered over here).

**The `fleet-build-diff` job** (new) runs only on `pull_request` events
where the fleet fanned out — the brief's "on PRs touching packages/core"
condition, generalized to the same conservative fan-out signal rather than
a narrower packages/core-only path filter, since the whole point of this
stage is exactly the changes the fan-out rule already flags as risky. Per
site: `build-diff.mjs <base> <head> --site sites/<site>` redirected to a
file with `|| true` (never fails the job — a non-empty diff is a REVIEW
ARTIFACT per design-principles rule 4, not an automatic failure) and
uploaded via `actions/upload-artifact@v4`.

**Unverified in a live run:** this is a GitHub Actions workflow file; there
is no way to actually execute GitHub Actions from inside this sandboxed
session. What WAS verified: the YAML parses (`js-yaml`), every script
invoked by a step runs correctly against real repo state (`npm run
check:astro`/`build`/`test` all pass locally; `discover-fleet-matrix.mjs`
correctly resolves real SHA ranges via `git diff`, including the demo-commit
proof above), and `scripts/build-diff.mjs`'s own positional `<base> <head>
--site <path>` interface already works against real refs (used throughout
T11.6/T11.7's gates). The specific GitHub-Actions-context plumbing (`github.
event.pull_request.base.sha`, the default `refs/pull/N/merge` checkout still
carrying the head SHA's commit object for `git worktree add` to resolve,
`fromJson()` over a job output) is standard/documented but — same posture as
T11.7's Netlify API calls — its first real proof is a live PR.

## T11.9 execution amendment (2026-07-24 — per this file's amend clause)

Built the schema-migration harness in three layers, none of which ships a
real schema bump (T11.9's own non-goal — the acceptance criteria only asks
for the synthetic case to be proven end-to-end):

**Framework** — `packages/core/server/migrations/registry.ts` (`SchemaMigration`
type: `objectType, from, to, description, migrate, toPatchOps?, inverse?,
irreversible?`; `findMigrationChain` — BFS composing one-hop migrations into
an arbitrary `(from, to)` chain; `applyMigrationChain`; `reverseChain`/
`applyReverseChain` — rollback preview, blocked at the first irreversible/
no-inverse step) + `classify.ts` (`classifyRecord` — parses-as-is wins over
a version-string technicality; migratable reports `writable` per whether
every hop in the chain carries `toPatchOps`; blocked distinguishes "no path"
from "a chain exists but the migration itself is broken"; `classifySiteRecords`
— a single blocked record fails the whole scan). 23 unit tests, including
the brief's explicitly-required adversarial case: a synthetic v1→v2
required-field addition blocks with no migration registered and passes once
one is.

**`toPatchOps` is optional by design** — not every object type has a generic
"replace the whole body" patch op (page/section have narrower field-scoped
ops; only some types have a `set_<type>_fields` deep-merge op) — a migration
without one is preview-only: `migrate-site.mjs --write` reports its records
as migratable-in-dry-run but blocked for a real write, rather than reaching
around the existing patch grammar with something unsafe.

**CLI** — `packages/core/cli/migrate-site.mjs`. `--dry-run` (default) scans a
site's COMMITTED exports (`sites/<site>/data/site/**`, mapping each
directory/single-file to its objectType, deriving the real objectId from
`__generated.from`'s basename since a filename alone doesn't carry it for
the two singleton types) and classifies every record — pure disk + the
registry, safe on every PR. A recorded, deliberate assumption: since a
committed export carries NO real `schema_version` tag at all (materializers
only emit `{__generated, ...body}`), every scanned record's version is
assumed to be the CURRENT head version for its type
(`CURRENT_SCHEMA_VERSIONS` — the one map a real bump would update, mirroring
`object-verbs.ts`'s own `${objectType}.v1` hardcode) — correct as long as
nothing has drifted, true today, and the harness's own real-repo test proves
it holds. `--write` applies migratable+writable records through the
STANDARD verb path only — `get` (current body/publish state) → `checkout` →
`patch` (the chain's own `toPatchOps`) → a best-effort republish ONLY when
the record was already live (preserves publish state; a gated/blocked
republish is reported, not fatal — the store body is already migrated
either way) → `checkin` (always attempted, even after a failure, so no lock
is ever left stuck) — never a raw blob write. Real production writes need
real Netlify Blobs credentials this sandbox doesn't have (same posture as
T11.7's `--netlify-token` path); `--write` without `--local` refuses with an
explicit message rather than silently no-op'ing. 13 tests: disk-scan
plumbing, the real `sites/drlurie` export tree passing the gate today
(gracefully skipped, not false-failed, if the compiled test's cwd assumption
about locating the real repo root ever stops holding), and the write
orchestration (checkout/patch/checkin sequencing, the already-published
republish branch, the record-not-found failure path) against an in-memory
store — using a migration compatible with the REAL (strict) page schema, so
these tests prove the write MECHANISM; the adversarial schema-blocking logic
already has its own fully-synthetic proof in `classify.test.ts` and needs no
re-proving here.

**CI gate** — `scripts/ci/schema-migration-gate.mjs`, extending T11.8's fleet
discovery (`discoverSites()`, so a second client is covered with zero edits
here): for every discovered site, runs a throwaway `tsc -p
tsconfig.test.json` pass into its OWN outDir (`.tmp/ci-schema-gate` —
deliberately different from `npm test`'s `.tmp/ci-test`, so it can run as an
independent CI step without racing a concurrent test run), dynamically
imports the compiled `migrate-site.mjs` (tsc copies a `.mjs` source through
as `.mjs`, not `.js` — it can't rename an ESM-mode file's extension the way
it emits `.ts` → `.js`; this cost a first debugging pass), and fails if any
site is blocked. Wired into the `check` job as a new named step (a real
~20-40s cost, accepted for an independently-attributable gate rather than
burying this check inside the full suite's pass/fail count) — the top-of-file
time-budget comment updated to match. **Verified for real, not just
unit-tested**: ran `node scripts/ci/schema-migration-gate.mjs` directly in
this sandbox — compiled, imported, scanned the real `sites/drlurie` tree (64
records), reported `PASS`, cleaned up its own compiled tree, exit code 0.
The aggregation logic (`aggregateFleetGate` — one blocked site fails the
whole gate) has its own 3-test pure-logic suite in
`tests/scripts/schema-migration-gate.test.mjs`, matching
`discover-fleet-matrix.test.mjs`'s established plain-`.mjs`-test convention.

**Unverified in a live run:** same posture as T11.7/T11.8 — no way to
actually execute GitHub Actions from inside this sandbox. What WAS verified:
the YAML parses; the gate script runs correctly end-to-end against real
repo state (above); the full local suite (`npx astro check`, `npm run
check:eslint`, `npm run check:prettier`, `npm run test`, `node
scripts/build-diff.mjs --self-test`, `node scripts/build-diff.mjs HEAD
origin/main --site sites/drlurie`) all pass/report EMPTY.

## T11.10 execution amendment (2026-07-24 — per this file's amend clause)

Not a move-map task in the file-relocation sense (no source→target package
motion beyond the two per-site posture files below) — recorded here per this
file's amend clause anyway, since it's the same session's next queue task
and touches the same core/site boundary the rest of this file tracks.

**Per-site posture files, the one real relocation this task performs**:
`src/config/approval-policy.ts` + `creation-policy.ts` → `sites/drlurie/
config/approval-policy.ts` + `creation-policy.ts`, verbatim (same committed
values — `master: 'all-autonomous'`/`overrides: {product:
'require-approval'}` for approval; `master: 'open'`/`overrides:
{tracking_config: {agents: ['object-conversion-roundtrip']}}` for
creation), matching the shape T11.7's `create-site.mjs` scaffold already
generates for a NEW client — drlurie now matches its own scaffold instead
of predating it. `src/config/policy-bindings.ts` (the T11.2-laid provider
seam) now imports both from the new location; the two old files are
deleted (`git rm`), verified first by exhaustive grep that only 2 real code
importers existed (both updated: `policy-bindings.ts` itself, plus the two
test files importing the old paths directly —
`tests/netlify/creation-policy.test.ts` and
`tests/netlify/publish-gate.test.ts`).

**Everything else this task built is new, not moved**: the per-agent-
credential framework (`packages/core/server/lib/agent-keys.ts`), its three
`admin-governance.ts` verbs, and the MCP auth-gate wiring in
`netlify/functions/mcp.ts` — see this session's `state-of-play.md` entry
for the full design (the single-chokepoint mechanism: `callTool`'s `input`
construction is the ONE place a verified identity needed to be injected,
scoped by an explicit 7-tool allowlist so it never collides with the
UNRELATED workflow-stage `agent_name` enum `save_json_blob_*` uses).
`docs/cms-architecture/secrets-runbook.md` is a new doc, the brief's own
explicit deliverable, not a relocation of anything existing.

**No discrepancy to record this task** — unlike T11.3/T11.8/T11.9, nothing
in the brief's file list conflicted with what was actually found in the
tree; the per-site posture-file relocation was exactly as scoped, and the
credential/auth work was net-new with no prior home to move from.

## T11.4 execution amendment (2026-07-24 — per this file's amend clause)

Landed as three gated step-commits (T9.24 precedent), each check+test+
build-diff-EMPTY green. Step 1: pure .ts remainders (renderer, edit-mode,
admin libs, richtext/article remainders, contentSource*,
publishArticleFromPayload, goTrueClient → core/lib/admin/). Step 2: 24
section components → `core/components/sections/`, the registry barrel
rejoined `core/lib/registry/components/`, admin workspace →
`core/admin/**`; the SITE-SHELL SEAM stays site-side by the brief's own
no-globbing invariant (PageObjectRenderer.astro, section-resolve-deps.ts,
ObjectSections.astro, CustomStyles.astro, EditMode.astro — all
astro:content/site-util coupling lives there). Harness extension (disclosed +
test-pinned): astro-island `uid` values are path-derived hashes; normalized
like chunk names. Step 3: the consolidated function-factory pass — 32
functions (all but the 4 frozen + mcp.ts) → `core/server/functions/*` as
`createHandler(binding)` factories; `netlify/functions/*` are now per-site
shims (policy-bindings + `createHandler(drlurieSiteBinding)`; `export *`
keeps named internals for tests). Direct secret reads in
object-store/admin-get-blob-pdf/deploy-status/run-publisher-agent/
save-artifact now route through `readBoundEnv(PLATFORM_ENV_NAMES.publishSecret)`.
Source-scan invariants repointed at the implementations (admin-object
publish-key absence, admin-governance Owner gate, publisher-repoint absence
scans).

**Residuals (recorded, not dropped):** `mcp.ts` split still waits on the
legacy article path's retirement (T11.3 amendment); pages-as-shells + the
`src/data/site` loader seam compose with T11.5–T11.6 (site.config/netlify.toml
and exports relocation — moving pages twice would churn); `cli/` relocation
rides T11.7 where site-parameterization makes the move meaningful (today it
would only churn CI paths + package.json).

## T11.3 execution amendment (2026-07-24 — per this file's amend clause)

**Moved:** `netlify/lib/**` (68 modules incl. `agent/`, `materializers/`,
`taxonomy-enforcement.ts` with its T11.5-deferred literal) → `packages/core/
server/lib/**`. Five more PURE src modules pulled forward (same rationale as
T11.2's pull-forwards; all had only core imports): `admin/display-name`,
`admin/readiness-criteria` (+ their tests), `richtext/paragraphs`,
`article-content/assert-reader-safe`, `article-object/variant` →
`packages/core/lib/…`.

**Frozen-file wiring (hard stop upheld):** the four off-limits functions
import `../lib/*` and `../../src/{schema,lib}/*` paths; they are byte-
untouched, so those exact paths now carry single-purpose re-export shims:
10 at `netlify/lib/*` (admin-auth, artifacts, artifact-index, blob-store,
taxonomy-enforcement, image-validation, pdf-validation, netlify-deploys,
blob-list, artifact-trust — each also registers the site policy providers for
the legacy path) and 5 frozen-path stubs (`src/schema/{schema-v1,
workflow-contract,article-content-v1}.ts`, `src/lib/agents-naming.ts`,
`src/lib/article-content/to-markdown.ts`). **Correction to T11.2:** its batch
import-rewrite had touched publish-article/admin-workflow-lock/save-json-blob
(import lines only); restored to `main` bytes here — the stubs exist so that
never recurs. Delete the stubs when the legacy article path retires.

**SiteBinding (the brief's factory seam):** `packages/core/server/lib/
site-binding.ts` — a binding = site id + env-var NAMES (never values), read
live per call (`readBoundEnv`; no module-scope caching). `PLATFORM_ENV_NAMES`
pins the pre-W11 fallback chains byte-for-byte (order is wire behavior, now
test-pinned). Threaded through: all blob-store getters (optional trailing
`binding?`), object-git-committer, production-release, netlify-deploys
(build hook + deploy lookup). The Dr-Lurie instance: `src/config/
site-binding.ts` (platform names + `siteIdentityConfig.siteId`);
`object-store.ts` (the verb auth entry) resolves its publish secret through
it. Adversarial set: `tests/netlify/site-binding.test.ts` (cross-binding
isolation, live rotation, fails-closed, chain-order pin, no shared store
handles).

**DISCREPANCY — functions did NOT move (recorded, not improvised):** the
map's T11.3 row lists the non-admin `netlify/functions/*` set incl. the "MCP
factory", but `mcp.ts` HOSTS the frozen legacy article MCP tools
(`invokeSaveJsonBlob`/`callPublishArticle`/`invokeSaveArtifact` + their tool
surfaces) — a factory split of that file is exactly the redesign the hard
stop forbids. Function-body moves therefore consolidate into T11.4's factory
pass (admin + non-admin in one reviewable mechanism), and the mcp factory
split waits for the legacy article path's retirement or an explicit bounded
sanction. `mcp.ts` this wave carries only mechanical `../lib/` →
core-path import rewrites (its tool behavior is test-pinned).

**Test-harness correction:** `tsconfig.test.json` had never gained
`packages/core/**/*.ts`, so every co-located test moved in T11.2 was silently
NOT running (~193 tests). Fixed; all revived and green. `site-identity.test.ts`
is explicitly the drlurie byte-compat gate and registers the real site
bindings (tests are lint-carve-out exempt). Policy-provider registration
re-homed from lib modules to entry points: non-off-limits functions importing
core server lib (32), the 10 shims, and core-importing test files.

**Still pending from the brief:** deployed-preview `/mcp` ping + read-verb
smoke (needs deploy access — recorded for the wave summary); binding
threading for the remaining direct env readers (`deploy-status`,
`save-artifact`, `admin-get-blob-pdf`) rides the T11.4/T11.5 function pass.

## T11.2 execution amendment (2026-07-24 — re-verified against `main`, per this file's amend clause)

Tracing the real import graph before moving showed the pure-lib slice above is
NOT cleanly separable from T11.4 at several value-import points. Corrections
made and executed (build-diff EMPTY, full suite green):

**Ratified alias:** `@core/*` -> `packages/core/*` (tsconfig paths + astro vite
alias). Two import worlds, as the tree already split them: `.astro`/`.tsx`
(Vite-only) use the `@core` alias; all `.ts` (in the tsc/Node test graph) use
relative `packages/core/...` paths (tsc does not rewrite path aliases and the
test runtime resolves the emitted relative specifiers). netlify/tests/scripts
keep their existing relative style, `src/...` -> `packages/core/...`.

**DEFERRED to T11.4** (value-imports into T11.4 modules — moving now would force
a core->src back-dep, which the "core imports no site code" rule forbids, or a
directory split, which "git mv only / no redesign" forbids):

- `src/lib/registry/components/index.ts` — value-imports 24 `~/components/
  sections/*.astro`; it is renderer glue (imported only by `PageObjectRenderer`/
  `ObjectSections`), not law. Stays in `src`; its sibling-def imports now point
  at `@core`/relative core. object-contract does NOT import it.
- `src/lib/publishArticleFromPayload.ts` — imports `~/utils/goTrueClient`.
- `src/lib/contentSourceBody.ts` — imports `article-content/` (T11.4);
  `src/lib/contentSourceImportFormData.ts` — imports the former.

**PULLED INTO T11.2** (pure files the schema law genuinely needs; moved as
single files, the rest of their dirs stay for T11.4):

- `lib/richtext/rich-text-v1.ts` (+ test) — pure zod; `schema/bodies/
  content-item-v1.ts` needs it. `render-html.ts`/`prosemirror.ts`/`paragraphs.ts`
  stay in `src/lib/richtext/` (T11.4).
- `lib/article-content/to-markdown.ts` — pure (schema-only dep);
  `schema/article-content-helpers.ts` needs it. Rest of `article-content/`
  stays (T11.4).

**Config-injection (the one real refactor; behavior unchanged).** Four core
modules imported `../config/*` site config: `approval-policy`, `creation-policy`,
`media-policy`, `site-identity` (the last two were NOT named in the brief —
found during execution; same fix). Core now exposes a provider seam
(`setActive*Provider` / `activeApprovalPolicy()`+`activeCreationPolicy()`+
`activeMediaPolicy()` throw if unset; `resolveSiteIdentity`'s `config` default
comes from a `setSiteIdentityConfigProvider`). The site registers all four in
the new `src/config/policy-bindings.ts`, imported for its side effect at every
entry point that reaches a singleton (netlify verb/store/publish/inventory/
governance + module-load `getSiteIdentity` callers, the registry barrel for the
Astro path, and the tests that hit the singletons). `bio.ts` (core) reads
`getSiteIdentity()` at module load, so the barrel's binding import is ordered
first. `src/config/*-policy.ts` + `site-identity.ts` stay site-side per the
brief. Verified: no `packages/core` module imports `src/`, `netlify/`, or a site
config.
