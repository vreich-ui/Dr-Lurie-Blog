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
