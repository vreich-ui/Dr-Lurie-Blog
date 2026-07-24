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
