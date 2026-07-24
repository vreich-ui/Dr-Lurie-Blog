# State of play — agent-editability push

Rolling session log for the multi-session mandate ("an agent can inspect and
edit any meaningful part of the live Dr-Lurie site through one consistent,
human-reviewed workflow"). Each session appends its entry at the top and
updates the standing tables. **Rule inherited from the mandate: never trust
this file over real state — verify against main / test output / the live
store before building on anything below.**

## Session 2026-07-24 (T11.4 step 2/3 — sections + registry barrel + admin workspace into core)

**Step 2 committed.** Moved: the 24 `src/components/sections/*.astro` →
`packages/core/components/sections/`; the registry barrel
`registry/components/index.ts` (T11.2-deferred) rejoined its dir in core —
its 24 `.astro` imports are now intra-core; `src/components/admin-ui/**`
(23 files, W9 workspace) → `packages/core/admin/**`. Admin pages/layouts
import `@core/admin/*`.

**The site-shell seam (brief's "no core file may glob a site path"):** ALL
site coupling concentrated in exactly two render-entry files —
`PageObjectRenderer.astro` + `section-resolve-deps.ts` (astro:content +
permalinks + site-object + PageLayout/Footer) — plus `ObjectSections.astro`,
`CustomStyles.astro`, `EditMode.astro`. These STAY site-side as the shell
that loads site data and injects it into core (`ResolvePageDeps` was already
the injection seam by design). Recorded as the boundary interpretation of the
brief's "PageObjectRenderer moves" line, which would otherwise violate its
own no-globbing invariant. Both cms shells register the site providers ahead
of the `@core` barrel (bio.ts reads site identity at module load).

**Harness extension (disclosed):** the move exposed that `<astro-island uid>`
values are hashes of the component FILE PATH — the attribute-level twin of
the hashed chunk filenames `html-normalize` already collapses. 10 admin
shell pages differed ONLY in uid strings. Added `normalizeIslandUids`
(scoped to astro-island; add/remove/props/reorder still differ; uid on other
elements untouched) + 2 harness tests; build-diff then EMPTY — proving uids
were the only delta. Self-test still PASS.

Gates (step 2): check 0 errors, eslint+prettier clean; tests 1624/1624 +
67/67 (+16 harness incl. 2 new); build-diff vs step 1 EMPTY; self-test PASS.
Remaining: step 3 — function-factory pass + cli relocation (+ pages shells /
data-root seam with T11.5-T11.6's site.config work, where they naturally
compose).

## Session 2026-07-24 (T11.4 IN PROGRESS — step 1/3: pure .ts remainders into core; gated step-commits per the T9.24 precedent)

**T11.4 step 1 committed** (branch `claude/t11.4-core-extraction-renderer-admin`).
Moved (55 renames): `src/lib/{renderer,edit-mode}/**`, the `src/lib/admin/**`
remainder (clients, node-editor/renderer, review-ui, diffs, lock-manager…),
`article-object/render-nodes`, `article-content` remainder (input-bank +
tests), `richtext` remainder (prosemirror, render-html + tests), the
T11.2-deferred `contentSourceBody`/`contentSourceImportFormData`/
`publishArticleFromPayload`, and `src/utils/goTrueClient` →
`packages/core/lib/admin/goTrueClient.ts` (self-contained Identity client —
admin machinery). `src/lib` now holds ONLY the 2 frozen-path stubs + the
registry barrel (moves in step 2 with the components).

Seam fixes en route: `edit-mode/ui.ts` dropped its raw `mediaPolicyConfig`
import for `activeMediaPolicy()` (the T11.2 provider); provider registration
re-homed from moved libs to entry points; `object-review-ui.test` registers
the site bindings as a live-policy gate (carve-out); `taxonomy-lookup-guard`
source-scan path updated.

Gates (step 1): check 0 errors, eslint+prettier clean; tests **1624/1624 +
67/67**; build-diff vs T11.3 **EMPTY** (74 pages). Remaining T11.4 steps:
(2) components/PageObjectRenderer/canvas + admin-ui islands + pages shells +
the `src/data/site` loader seam + registry barrel; (3) the consolidated
function-factory pass + cli relocation.

## Session 2026-07-24 (T11.3 — core extraction: server layer + SiteBinding seam; NOTIFY row run at fable/xhigh)

**T11.3 DONE** (branch `claude/t11.3-core-extraction-server-layer`, on T11.2).
Executed at the row's assigned model (owner switched the session to fable for
it). `netlify/lib/**` (68 modules) now lives at `packages/core/server/lib/**`;
the **SiteBinding** seam is in (env-var NAMES never values, live per-call
reads, `PLATFORM_ENV_NAMES` chains pinned in order by test); Dr-Lurie's
binding at `src/config/site-binding.ts`; `object-store.ts` verb auth resolves
its secret through it. Adversarial set added
(`tests/netlify/site-binding.test.ts`): cross-binding isolation with live
rotation, fails-closed per binding, no shared store handles.

**Hard stop upheld — and a T11.2 breach corrected.** T11.2's batch rewrite had
touched 3 frozen files (import lines only). Restored to `main` bytes; their
exact import paths now carry single-purpose re-export shims (10 at
`netlify/lib/*`, 5 frozen-path stubs under `src/`), so the frozen set never
needs touching again. All four frozen functions + `mcp/save-json-blob-mcp/`
verified byte-identical to `main`.

**Recorded discrepancy (functions stay put this task):** the move-map's "MCP
factory" collides with the frozen legacy article MCP tools living INSIDE
`mcp.ts` — a factory split of that file is the redesign the hard stop forbids.
Function-body moves consolidate into T11.4's factory pass; the mcp split waits
for the legacy path's retirement. `mcp.ts` carries only mechanical import
rewrites (tool behavior test-pinned).

**Test-harness gap found & fixed (reaches back to T11.2):**
`tsconfig.test.json` never included `packages/core/**`, so ~193 co-located
tests moved in T11.2 had been silently dropped from every run since. Revived
(suite now 1624+67) — including `site-identity.test.ts`, kept as the drlurie
byte-compat gate (registers real site bindings; tests are carve-out exempt).
Five more pure modules pulled forward to core (display-name,
readiness-criteria, paragraphs, assert-reader-safe, variant).

**Gates:** `npm run check` 0 errors, eslint+prettier clean; `npm test`
**1624/1624 + 67/67**; `build-diff --base <T11.2>` **EMPTY** (74 pages
byte-identical); core purity verified (no app-code import escapes
`packages/core`). **Pending:** deployed-preview `/mcp` ping smoke (no deploy
access this session); binding threading for `deploy-status`/`save-artifact`/
`admin-get-blob-pdf` rides T11.4/T11.5. Landing still blocked on push access.

## Session 2026-07-24 (T11.2 — core extraction: schema + registries + grammar/validation + pure policy libs)

**T11.2 DONE** (branch `claude/t11.2-core-extraction-pure-libs`, stacked on the
lockfix). The pure-law layer now lives in `packages/core/` (88 `.ts` files);
Dr-Lurie builds + tests green against it; **build-diff EMPTY** (74 pages
byte-identical vs the pre-move base). 88 `git mv` renames (history preserved);
310 files changed total (moves + import rewrites).

**Moved to core:** all of `schema/**`; `lib/registry/**` (minus the renderer-glue
barrel `components/index.ts`); `lib/tracking/**`; `object-ids*`, `object-patch-
apply*`, `agents-naming*`, `approval-policy`, `creation-policy`, `media-policy`,
`site-identity*`, `template-instantiate`; plus the two pure schema deps
`richtext/rich-text-v1.ts` and `article-content/to-markdown.ts`.

**Alias ratified:** `@core/*` -> `packages/core/*`. `.astro`/`.tsx` use the
`@core` Vite alias; all `.ts` use relative `packages/core/...` (Node test-runtime
resolution — tsc doesn't rewrite path aliases). `tsconfig.test.json` include +
astro vite alias + tsconfig paths wired.

**Config-injection (behavior-identical).** Four core modules imported site
config (`approval`, `creation`, `media` policies + `site-identity`; the latter
two were discovered in execution, not named in the brief). Core now uses a
provider seam; the site registers all four in the new
`src/config/policy-bindings.ts`, imported for side effect at every entry that
reaches a singleton. No `packages/core` module imports `src/`/`netlify/`/site
config (verified).

**Boundary correction (move-map amended, per its re-verify clause).** The
brief's pure-lib slice had value-imports into T11.4 modules. DEFERRED to T11.4:
`registry/components/index.ts` (24 `.astro` imports; renderer glue),
`publishArticleFromPayload.ts` (`~/utils`), `contentSource{Body,ImportFormData}.ts`
(article-content). PULLED the two pure schema deps forward. Full rationale in
`w11-move-map.md` "T11.2 execution amendment".

**In-scope test fixes (moved-path references):** `tracking-loader.test.ts`
(loader entry path), `object-store-auth.test.ts` (mintId import-path assertion),
`csp-drift.test.ts` (repo-root marker was `src/lib/tracking`). Gates:
`npm run check` 0 errors / eslint+prettier clean; `npm test` 1473/1473 +
67/67; build-diff EMPTY.

**Landing status:** committed locally only — this session has **no push/PR
access** (read-only git proxy). The lockfix + T11.2 await push credentials to
land; both were delivered as patches / are on local branches.

## Session 2026-07-23 (W11 scaffold repair — package-lock out of sync with T11.1 workspaces; `main` was red)

**Discrepancy found and fixed (prerequisite to the W11 extraction wave).** The
T11.1 scaffold added `workspaces: ["packages/*", "sites/*"]` to `package.json`
plus the two placeholder manifests (`@drlurie/core`, `@drlurie/site-drlurie`)
but did NOT update `package-lock.json` in the same change (the T11.1 commit
body deferred its gates — "gates … to be run on apply"). Consequence: **every
CI job on `main` was failing at `npm ci`** ("Missing: @drlurie/core@0.0.0 from
lock file"), across all three jobs (`build`, `check`, `fleet`) — all run
`npm ci`. This blocks green CI on any W11 wave-chunk PR.

**Fix (this change):** `npm install` lock sync only — adds the root
`workspaces` array and the two workspace link/package entries to
`package-lock.json` (23 insertions, 0 deletions, **no dependency version
changes**). No source touched. Verified green on the synced tree: `npm run
check` (0 errors/0 warnings/4 pre-existing hints, eslint + prettier clean),
`npm test` (all suites pass), `node scripts/build-diff.mjs --self-test` PASS,
`node scripts/sync-site-seed.mjs --check` clean. So `main`'s only defect was
the lockfile; with this, the scaffold actually installs.

**Governance note:** landed as its own isolated repair commit (not bundled
into any queue task), per autonomous-run "land [missing scaffold pieces]
first" + "one task, one commit." Recorded here per E5. Does not advance the
queue; the next not-done row remains **T11.2**.

## Session 2026-07-23 (T11.0 checkpoint close — platform rulings + W9 completion gate)

**T11.0 is DONE.** Both gates verified against `main` (not docs):

- **Gate (a) — T9.24 legacy deletion landed.** Confirmed on `main` @ `5d74ad19`
  (PR #470; branch step-commits `eada6ed`/`3111f2a` squash-flattened in).
  ABSENT: `src/pages/admin/{publish,drafts,library,agent-admin}.astro`,
  `review/[draftId].astro`, `objects/[objectId].astro`,
  `src/components/admin/AdminNav.astro`,
  `netlify/functions/toggle-article-publish.ts` (+ the STEP-2 legacy MCP
  functions). `AdminShell` retained as the edited island
  `src/components/admin-ui/AdminShell.tsx`. HARD-STOP files intact/untouched:
  `netlify/functions/publish-article.ts`, `admin-workflow-lock.ts`.
  `mcp/save-json-blob-mcp/` retained in place per OQ-W11-6 (retired-not-
  extracted; must NOT enter `packages/core`).
- **Gate (b) — OQ-W11-1…6 rulings ratified** 2026-07-22, recorded in
  `11-platformization-plan.md` §6 + §6.1 (and
  `decisions/2026-07-22-platformization-and-capture-rulings.md`).

**Disposition:** closed under autonomous-run A1 async-review; **owner ratified
in-session (2026-07-23, "Close T11.0 now, then continue") — the 24h objection
window is waived by that instruction.** W11 extraction is unblocked; the next
not-done queue row is **T11.1** (`depends_on: T11.0`, satisfied here). The
"begin at T11.1" launch assumption was one row early: T11.0 had no closing
commit until this entry.

## Session 2026-07-23 (T9.24 legacy deletion + maintenance reskin; T9.25 records close-out; branch `claude/t9.24-legacy-deletion`)

**T9.24 is DONE.** The T9.23 sign-off below unblocked it; all three groups
landed as their own commits, each with importer-grep evidence in the commit
body, `npm run check` + `npm test` + `npm run build` green after every one,
off-limits files proven byte-untouched throughout.

- **STEP 1 (`eada6ed`)** — deleted `src/pages/admin/{publish,drafts,
  library,agent-admin}.astro`, `review/[draftId].astro`,
  `objects/[objectId].astro`, and `src/components/admin/AdminNav.astro`;
  removed the 5-item "Legacy" nav group from `AdminShell`; removed the dead
  `/admin/review/*` and `/admin/objects/*` redirects from `netlify.toml`.
  `agent-admin.astro` (ChatKit) retired per **OQ-W9-1, Wolf 2026-07-23:
  RETIRE** — one chat system going forward, the in-house Agents hub.
  Every live route reference the grep turned up was repointed in the same
  commit: `AdminShell`'s Cmd-K "New chat" + Quick Actions, `edit-mode/ui.ts`'s
  fallback message, `kit.astro`'s AdminNav import (interim fix — STEP 3
  rewrites the file it briefly touched), a stray comment in `Header.astro`,
  doc comments in `approval-policy.ts`/`home-conversion-roundtrip.mjs`, and
  a live tool-response string in `product-set-price.ts` — all now point at
  `/admin/content/<id>` / `/admin/agents`. `npm run check` clean, `npm test`
  1705/1705, `npm run build` 73 pages (down from 79 — exactly the 6 deleted
  pages).
- **STEP 2 (`3111f2a`)** — deleted `admin-ask-ai-node.ts`,
  `get-article-for-edit.ts`, `admin-update-node.ts`, `admin-patch-workflow.ts`,
  `list-draft-articles.ts`, `admin-save-json-draft.ts`,
  `admin-get-json-draft.ts`, `admin-list-json-drafts.ts`,
  `toggle-article-publish.ts`, `create-chatkit-session.ts`, plus the orphaned
  `src/lib/admin/ai-suggestion.ts` (sole importer was the already-deleted
  `publish.astro`) and the 3 dedicated test files for the deleted functions.
  **The importer-grep discipline caught a real miss**: a first pass excluded
  `tests/` from one grep loop, so `tests/netlify/canonical-promotion-trust.test.ts`'s
  import of `handlePatchCanonicalInput` (from `admin-patch-workflow.ts`) only
  surfaced as a `npm run check` TS2307 error. Fixed surgically — removed
  only the affected import + its `describe` block, leaving that same file's
  off-limits `save-json-blob.ts` coverage (Stage 3.3/3.4) byte-for-byte
  untouched. All 9 functions' shared libs confirmed to have live importers
  outside this deleted set — none orphaned beyond `ai-suggestion.ts`.
  `npm test` 1619/1619 (the 19-test drop = 3 deleted test files + 2 removed
  cases from the surgical fix), `npm run build` 73 pages (unchanged —
  function deletions don't touch Astro output).
- **STEP 3 (`d62db1d`)** — `src/pages/admin/blobs.astro` (1200 lines of
  vanilla JS) rebuilt as `src/pages/admin/maintenance.astro` on
  AdminLayout/AdminShell: new `src/lib/admin/maintenance-client.ts` (typed
  wrappers over `admin-blob-manager`/`admin-blob-store-diagnostics`,
  mirroring `users-client.ts`) and `src/components/admin-ui/MaintenancePage.tsx`
  (Owner-gated the same way `AdminUsers.tsx` is — `fetchMe` →
  `roles.includes('owner')` — on top of the server-side Owner check T9.4
  already enforces on both functions; human-framed DataTable with a "Raw"
  tab in the Drawer for actual payloads; Danger Zone wipe-store/wipe-all
  behind `ConfirmDialog requireTyped`). `AdminShell`'s Maintenance nav entry
  lost `soon: true`. `npm run check` clean (fixed 4 real lint issues along
  the way: an unused import, 3 dead `react-hooks/exhaustive-deps` disable
  comments this project's eslint config doesn't register), `npm test`
  1619/1619, `npm run build` 73 pages (unchanged, 1:1 replacement).
  Playwright + curl confirmed all 7 deleted/renamed routes 404 and
  `/admin/maintenance` 200s; the signed-in-as-Owner render path couldn't be
  exercised in this sandbox (no real Identity credentials) — disclosed, not
  assumed.
- **Found, ruled out, not fixed:** `/admin/kit` throws React hydration
  errors (minified #418/#423/#425) under Playwright. A/B tested by
  temporarily restoring the exact pre-STEP-1 `kit.astro` + `AdminNav.astro`
  and rebuilding — identical errors reproduce with `AdminNav` present,
  proving this is a pre-existing `KitGallery.tsx` bug, not a regression from
  this task. Left alone; worth its own fix task.
- **Live production fix (MCP, not a git commit in these three):**
  `nav_header`'s admin-only dropdown still pointed at 5 routes this task
  deleted or renamed. Flagged to Wolf mid-task (a live object-store write is
  a different risk class than the git-scoped deletion work) —
  **Wolf: "Patch it live now."** Checked out, removed the Publish/Drafts
  items, relabeled Library → "Content library" (`/admin/content`),
  AI Publisher → "Agents" (`/admin/agents`), Blob Store → "Maintenance"
  (`/admin/maintenance`); published to `main` (`612cda1`, `[skip netlify]`).
  **`release_to_production` deliberately NOT called** — publish only moves
  the git export; the live site still serves the prior export until a
  release. `612cda1` has since been merged into this branch (`origin/main`
  was one commit ahead, no conflicts — this branch never touched
  `nav_header.json`). Wolf to decide when to release; nothing breaks in the
  meantime, the dead links would only 404.
- **Off-limits verification (all three groups + the merge):** `git diff
  --stat` against `main` is empty for `netlify/functions/publish-article.ts`,
  `netlify/functions/admin-workflow-lock.ts`, and
  `netlify/functions/save-json-blob.ts` (its MCP surface included) — checked
  after every commit and re-checked after merging `origin/main` in. The
  `workflows` blob store's data was never touched (code paths only).
  `mcp/save-json-blob-mcp/` was not touched — explicitly out of this task's
  scope, deferred to the W11 window per the brief.

**T9.24 DONE.** T11.0's "verify T9.24 legacy deletion actually landed" gate
(flagged as untouched/still-owned-by-T11.0 in the 2026-07-22 platformization
session below) **is now satisfiable** — T9.24 is in git on this branch, PR
pending against `main`.

**T9.25 records close-out (this session, same branch):** this entry;
`docs/cms-architecture/10-admin-workspace-plan.md` (status flipped
PLANNED → SHIPPED, OQ-W9-1 and OQ-W9-5 resolved, §6 Retirements marked
DONE, the §2 AdminNav mention updated to past tense); `CLAUDE.md` (new
admin-surface pointer section); `docs/cms-architecture/07-canvas-editing.md`
(the W7.7-remainder ON HOLD ruling annotated: lifted by T9.19, closed by
T9.24); `docs/cms-architecture/cms-pipeline/queue.tsv` (W9-complete
comment).

## Session 2026-07-23 (T9.23 parity sign-off recorded; branch `claude/t9.24-legacy-deletion`)

**T9.23's retirement gate has passed.** Full drive:
`docs/cms-architecture/cms-pipeline/T9.23-parity-signoff-checklist.md`
(updated same commit — every row now ✅ checked or waived, in place of the
all-☐ PREPARED state it carried since 2026-07-19).

- **Rows 1–7: PASS.** Draft picker, title/lede editing, metadata
  (author/date/category — author closed by T9.23a below), tags/SEO/path,
  save-with-undo, per-node TipTap editing, and per-node Ask-AI word-diff all
  drive cleanly on the new `/admin/content`+canvas+workspace surfaces.
- **Rows 8–10: confirmed-present/waivable** on the strength of their prior
  credentialed builds and test coverage (T9.4 force-checkin + LockBanner;
  T9.21 readiness strip + publish-by-time) rather than a fresh live
  click-through session — the built surfaces and their tests stand as the
  evidence.
- **Row 11 — OQ-W9-5 RULED: retire without port.** Canonical-input
  promotion (the legacy `req_*` workflow concept) has no object-model
  analogue and needs none — `create_variant` lineage + Discard (history
  inverses) cover the intent. No canonical-input surface will be built on
  the object substrate.
- **The one gap the drive found (row 3, author) is CLOSED:** T9.23a added
  `content_item.author` (optional, ≤120 chars, plain text) end-to-end —
  schema, `set_article_meta` grammar, reader-safety leak-scan coverage, both
  editor surfaces (canvas panel + workspace Details drawer), an optional
  byline render, and `object_contract` discovery. Merged PR #469
  (`ebe2779`), `scripts/build-diff.mjs` empty (80/80 pages) since none of
  the 12 live articles carry one. A pre-existing (T9.20) dirty-tracking bug
  in the canvas Article-settings Save button (found while landing the
  author field) was fixed in the same PR.

**T9.24 (legacy deletion + maintenance reskin) is now unblocked** and runs
in this same branch, followed by T9.25 records close-out — each group's
commit prepends its own entry above this one as it lands.

## Session 2026-07-23 (T9.23a: content_item author field — the T9.23 parity gap closed; branch `claude/content-item-author-field-kgazza`)

Wolf's 2026-07-23 ruling: the legacy `/admin/publish` exposed an author; the
object model never carried one — add the field (not retire). This was the
sole gap the T9.23 parity drive found (row 3, author); T9.24 (legacy
deletion) was blocked on it landing.

**Scope — v1, deliberately minimal**, shipped end to end through the
governed substrate. No new patch op: `author` rides the existing
`set_article_meta` fields grammar generically, exactly like every other
article-settings scalar (slug/title/deck/description/taxonomy/seo).

- `src/schema/bodies/content-item-v1.ts` — `author?: string` (`.max(120)`),
  additive-optional, in the same public-settings envelope as slug/deck/
  description. Every existing record (none carry it) still parses.
- `src/schema/object-patch-ops.ts` — `set_article_meta`'s `.describe()` now
  names `author` alongside title/slug/taxonomy/seo/scores, for contract
  discoverability. No grammar change: the op already deep-merges any
  body-level field except `nodes`/`tracking`, and its inverse derivation
  (`derivePatchInverse`) is generic over the captured before/after tree —
  both already covered a new scalar field for free.
- `netlify/lib/object-validate.ts` — `contentItemReaderProjection` (the
  reader-safety leak scan specific to content_item) now includes `author`,
  because it is now a RENDERED field. Without this an agent could leak
  strategy vocabulary (`private`/`agentNotes`/…) through the byline
  undetected — the projection is a curated allowlist of what actually
  reaches readers, not the whole body. Length/plain-text bounds are the
  schema's `.max(120)`, enforced generically by the existing `checkSchema`
  pass at every patch/create/publish — no new validation code needed.
- Editor parity on BOTH surfaces (matching every other article-settings
  field, since T9.20 built them as two hand-kept-in-sync implementations):
  `src/lib/edit-mode/ui.ts` (canvas panel "Article settings" accordion —
  `renderArticleMetaForm`/`saveArticleMetaForm`) and
  `src/components/admin-ui/ObjectWorkspace.tsx` (`ArticleSettingsCard` in
  the "Details" drawer) — an Author input beside Slug/Category/Tags/SEO in
  both, saved through the same `set_article_meta`/EditSession path. The
  stale "author deliberately absent" comment in `ui.ts` is corrected.
- Render: `src/utils/blog.ts` (`loadArticleObjectPosts` now carries
  `article.author` onto the shared `Post.author` field — already declared
  on the `Post` type, previously populated only by the legacy `.md` path)
  + `src/components/blog/SinglePost.astro` (the article meta line renders
  `By <author>` between the date and category when set; renders nothing
  when absent — matches the existing typography exactly, no icon, no new
  layout).
- Tests (all new, all green): schema additive-parse + max-length bound, and
  reader-safety leak-scan coverage
  (`tests/netlify/content-item-object.test.ts`); a `set_article_meta`
  set/inverse round-trip on `author` through the real engine
  (`src/lib/object-patch-apply.test.ts`); `object_contract('content_item')`
  advertising `author` in `body_schema` and in `set_article_meta`'s
  description (`tests/netlify/object-contract.test.ts`).

**Verification:** `npm run check` (astro check 0 errors/0 warnings, eslint
clean, prettier clean) + `npm test` green — 1705 tests, 0 failures.
`scripts/build-diff.mjs` (working tree vs `HEAD`): **80/80 pages identical,
EMPTY DIFF** — none of the 12 live articles carry an author, so the
conditional byline moved zero pixels; this was the acceptance gate.

**Found, not fixed — flagged per CLAUDE.md rather than bundled in:** the
canvas panel's Article-settings Save-draft button has a dirty-state bug
predating this task. `serializeForm()` (`ui.ts`, the shared save-button
dirty tracker) queries only
`[data-em-field],[data-em-role-field],[data-em-nav-field]`; the Article
Settings form's inputs (slug/author/description/category/tags/seo) all
carry `[data-em-meta-field]` instead, which that selector never matches. So
`serializeForm()` always returns `''` for this form regardless of what's
typed, `saveBaseline` is also always `''`, and
`button.disabled = serializeForm() === saveBaseline` never flips false —
the Save button reads as permanently disabled in the CANVAS panel for every
Article-settings field, not just the new one (pre-existing since T9.20, not
introduced here). The workspace Details-drawer's save button
(`ObjectWorkspace.tsx`) has no such gate and is unaffected. Worth its own
fix task before T9.23's sign-off treats capability #3/#4 as proven on the
canvas surface specifically.

**Records (same commit):** `object-inventory.md` (content_item row) +
`conversion-map.md` (content_item attributes line) updated.

**T9.23a author field — the T9.23 parity gap closed; T9.24 unblocked
(pending the recorded sign-off).**

## Session 2026-07-22 (DOCS-ONLY: W11/W12 platformization + capture rulings propagation; branch `claude/platformization-rulings-propagate-p8ebha`)

No source or test changes. Propagated Wolf's 2026-07-22 rulings (OQ-W11-6,
the lint exit-bar carve-out, and the ratified OQ-W12-1/-2/-3) into the task
briefs, env table, and plan so W11/W12 start with a consistent work
breakdown. `npm run check` unaffected (docs only; check touches `src/**` +
`scripts/**`).

**Reconciliation note:** the propagation brief told me to cite a decision
record and read §6 ANSWER lines that did not exist in the repo (T11.0's
RATIFIED artifact was never committed). Since every deliverable cites that
record, I created it from Wolf's ruling text and filled §6 — this session
also stands in for T11.0's deliverable #2. T11.0's OTHER gate (verify T9.24
legacy deletion actually landed) is untouched and still owned by T11.0.

**Files touched:**

- ✚ `docs/cms-architecture/decisions/2026-07-22-platformization-and-capture-rulings.md`
  — new decision record (the citable authority): OQ-W11-1…6, the lint
  carve-out, OQ-W12-1…3, verbatim-in-intent + consequences.
- `docs/cms-architecture/11-platformization-plan.md` — §6 ANSWER lines +
  §6.1 RATIFIED block + new OQ-W11-6 bullet; §3.2 old authorization rule
  annotated **SUPERSEDED** (kept, struck) with the new per-project/
  contract-owned rule + the per-project governance/limits-block
  implementation pointer beside `contentContract`/`toolPolicies`/
  `publishingPolicy`.
- `cms-pipeline/T11.5-desite-hardcodes.md` — 2026-07-22 census folded into
  an explicit target list (EXTENDS §2.3): admin-UI hardcodes (Studio SITE_ID,
  ObjectWorkspace/ui.ts `tax_drlurie`, GovernancePage `trk_drlurie`),
  run-publisher-agent, track-ingest fallback, MCP server strings
  (`mcp.ts:121-122`), Favicons/bio kugelmedia, pdf-tool `projectId` (the
  SECOND tenancy axis), GitHub User-Agent, and the agent-facing example ids
  in `object-contract.ts`/`agent/tools.ts`/`mcp.ts` descriptions. Items 1–9
  marked **FRONT-LOADED — verify absent** (the `pre-W11 dehardcode (N/11)`
  work, PRs #466/#467); the tool-description example ids are the one
  **PENDING** item (~9 `drlurie` still live in `mcp.ts`; planned items 10–11
  never committed). Added the lint exit-bar carve-out (tests/ fixtures EXEMPT
  for v1) and the OQ-W11-6 `save-json-blob-mcp` "retire, don't extract" note.
- `cms-pipeline/T11.7-provisioning-cli.md` — replaced the illustrative env
  list with the REAL per-site env table (census of every
  `process.env.*`/`env.*`/`Netlify.env.get` read across `src/`+`netlify/`+
  `mcp/`; ~35 config vars), each classed per-site / fleet-shared / optional /
  platform-injected; shared with T11.10.
- `cms-pipeline/T12.1,T12.2,T12.4,T12.5,T12.6` — authorization language
  rewritten to the ratified OQ-W12-1 (per-project, contract-owned; model
  hard refusals the sole floor; no built-in ownership precondition); OQ-W12-2
  (coverage default, per-project overridable) and OQ-W12-3 (never-released
  drafts in the target project's own store; T12.1 spike local) reflected;
  per-project governance/limits-block seam pointer added to T12.1.
- `cms-pipeline/state-of-play.md` — this entry.

## Session 2026-07-20 B (W13 TAIL: T13.8→T13.10 — natives+CSP, sink kit, seeds+roundtrip; branch `claude/w13-natives-tail` off the merged #462)

PR #462 MERGED (`d8171295`, 8/8 checks); continuation on a fresh branch.

- **T13.8 (`d82ce433`)**: meta_pixel/taboola/outbrain/mgid adapters — all
  ALWAYS advertising-gated; mgid validates but never interpolates its id
  (dashboard-resolved; snippet/hosts flagged for re-verification at first
  enablement). `nativeCalls` bridge fan-in (provider-correct shapes,
  build-resolved values, dedupe), core fan-out as one consent-gated unit,
  and the fbq/\_tfa/obApi/\_mgq routing in the browser binding. The site's
  FIRST CSP: `Content-Security-Policy-Report-Only` in netlify.toml at the
  all-disabled baseline (promotion = T13.11 after a clean soak) with the
  hosts-drift test pinning script/connect/frame = baseline ∪ enabled
  adapters' cspHosts (reads src/data/site/tracking.json when it exists);
  drift fails BOTH directions. Loader pin 4.5→5KB (ceiling 6KB).
- **T13.9 (`8fb3a64e`)**: the owner-DB reference kit
  (`docs/cms-architecture/tracking-sink-reference/`): receiver contract
  (NDJSON + Bearer + fast 202, idempotent on event_id, additive-only),
  OQ-W13-6 env contract, the blessed strategy-join recipe; schema.sql
  (tracking_events UNIQUE event_id + 4 indexes + pg_notify trigger +
  node_strategy + worked query); `scripts/tracking-mirror-replay.mjs`
  (dry-run default, in-run dedupe, abort-on-non-202, idempotent re-run;
  6 unit tests; rehearsed against the local store).
- **T13.10 (this commit)**: `scripts/lib/tracking-config-seed-data.mjs` —
  the ratified trk_drlurie body (geo-adaptive; EEA-30+UK+CH ×32; GPC;
  banner copy; ALL pixels disabled; own enabled with the OQ-W13-6 env
  names; the §6 defaults matrix). Driver support: tracking_config drill
  (set_tracking_config_fields flip/flip-back), reconcile branch
  (deep-merge diff, trap-2 stray-nulling), SUPPORTED_SEED_TYPES. The
  set_tracking probe upgraded to the FULL set→mutate→unset drill; a
  ten-type engine test proves it byte-identical with exact inverses on
  every attribute-carrying type. Creation policy: the ruling's "seeds
  mint" got its name — `tracking_config: { agents:
['object-conversion-roundtrip'] }` (the conversion-factory driver IS the
  seed identity; casual agents stay excluded; flag for Wolf's veto).
  FOUND+FIXED en route: the loader gated section impressions on
  `collects('section','impression')` — a word NO schema-legal export can
  carry (the §6 matrix says `section_impression`); production section
  impressions could never have fired. Local rehearsal:
  `--seeds tracking-config-seed-data.mjs` all-green — created (the seed
  identity), drilled, validated, publish blocked at export_commit_failed
  (the expected sandbox signal), contract advertised≡exercised, inventory
  returns trk_drlurie.

- **T13.12 (`5414d701`)**: the OQ-W13-2 posture surface — a Tracking card
  atop the guardrails page (T9.15's override layer IS built, so the toggle
  variant): effective publish mode from the ACTIVE policy with provenance,
  the creation posture from the live creation policy (humans + the seed
  driver), Product beside it as the other pin, and an Owner-only quick
  flip writing an explicit per-type pin through the SAME audit-logged
  admin-governance override — no new write machinery. Pure view-model +
  5 tests incl. a source-level no-bespoke-endpoint guard.
- **T13.13 (`a9fe2740`)**: doc 12 §15 — the scores-feedback DESIGN
  (OQ-W13-5 commission, nothing implemented): `metric:<framework>`
  provenance with a required evidence base, the append-only
  `append_scores` transport recommendation (owner DB computes, agent
  submits through the governed grammar; automatic writers rejected until
  OQ-3), hard guard rules (no cascade, leak rule untouched, n_sessions
  floor, idempotent-by-refusal windows), lineage-family variant judging
  with the no-A/B honesty rule, core-frameworks/site-thresholds split.
  Ends with the OQ-W13-5b ANSWER line for Wolf.

**EVERY W13 auto row is now BUILT (T13.1–T13.10, T13.12, T13.13).
Remaining before the wave closes:** T13.11 ONLY (human_gate — env
provisioning per OQ-W13-6 + `--production --release` + live beacon
verification + the ten-type set_tracking MCP round-trip + the CSP
promotion call). Open ANSWER lines on Wolf: OQ-W8-1…4
(`composite-sections-decision.md`) and OQ-W13-5b (doc 12 §15).

## Session 2026-07-20 (POST-MERGE CONTINUATION: W10 tail T10.5→T10.8 + W13 consent/conversions T13.6→T13.7 — six commits on `claude/w10-mints-w13-consent`)

PR #461 (the session D/E bundle) MERGED to main (`3ecde204`); Wolf said
"continue" — new branch `claude/w10-mints-w13-consent` off merged main,
same cloud-sandbox delivery constraints (git bundle → Wolf fetch/push).
One task = one commit; every task gated on suite + check + build-diff.

- **T10.5 (`80e49a68`)**: mint batch 1 per the T10.4 ratification — `media`
  (image/video discriminated items; video FOLDED IN: provider enum
  youtube|vimeo, regex-pinned videoId re-asserted at render — the embed
  template throws on drift), `brand_row` (2–8 logos, nav-target hrefs
  resolved via the renderer seam), `stats` (2–6 bounded stat cells).
  Union 21→24; registry modules + components + editor hints + contract.
- **T10.6 (`ccc40980`)**: mint batch 2 — `timeline` (2–8 milestones),
  `comparison_table` (2–4 columns ≤12 rows, boolean-or-short-string cells)
  — union 24→26 — plus ALL FIVE ratified variant fields (hero.variant
  center|split|background with the center branch the untouched audited
  markup; cta_banner.compact; content_split.imageLayout stagger|stack;
  steps.columns 2|3|4; testimonial.layout single|wall + variant
  quote|pullquote). Every variant additive-optional: the exact pre-variant
  shapes still parse (mint-batch-2 test pins this).
- **T10.7 (`2f6ae2a8`)**: `composite-sections-decision.md` — the OQ-W8-1…4
  decision package, re-scored AFTER the mints: gate NOT cleanly cleared
  (bento + overlap genuine static-composition cases; the pricing toggle is
  interactivity §8 would not fix) → recommend composite STAYS GATED until
  W12 capture evidence; build-ready answers for W8-2/3/4 if Wolf overrides.
  Four ANSWER lines await Wolf. Docs only.
- **T10.8 (`de0e9ad6`)**: starter recipes — stpl_stats_band /
  stpl_expectations_timeline / stpl_comparison_matrix / stpl_media_gallery
  (brand_row skipped: no licensed logo assets) + `thm_editorial_airy`, the
  first theme variant carrying T10.1 axes (narrow/airy/soft/editorial).
  Found+fixed two stale driver gates: SUPPORTED_SEED_TYPES never admitted
  section_template/theme seeds, and the advertised≡exercised contract gate
  broke on W13's `set_tracking` (now a uniform tracking probe on EVERY
  family drill, byte-exact restore). Both local rehearsals all-green.
- **T13.6 (`91e13cbe`)**: consent per OQ-W13-1 — the runtime is ONE
  self-contained function serialized into the inline bootstrap (the page
  ships the very function the 22-test gate matrix executes): geo-adaptive/
  consent-first/us-first from one enum, unknown-region hold, oracle via
  sessionStorage→GET /api/t?mode=region, Intl heuristic keep-held-only,
  Consent Mode v2 denied defaults + redaction + url_passthrough BEFORE any
  vendor head, gated-script activation, GPC absolute (beats grant, blocks
  id), ad_personalization permanently denied (no TCF CMP). ConsentBanner
  is a code component (validated config copy, escaped; hidden until the
  runtime reveals; any `#privacy-choices` footer nav link re-opens it —
  document for the nav edit, zero code). Consented-id upgrade: `_dlid`
  minted only on analytics grant with GPC off, 13-month cap FIXED at mint,
  cleared on refusal; loader flips visitor mode consented/cookieless.
- **T13.7 (`750ddbb9`)**: the google_ads (always-gated,
  send_page_view:false) and ga4 (gated only as advertising class; manual
  page_view per pageLoad) adapters, the one-gtag.js-loader rule, and the
  §7 bridge in the loader core: (object_id, on) activity matching and
  trk:goal by-name matching → the own `goal` event (never sampled) plus
  declared provider conversions ONLY, under a released ads-consent state;
  product_price values build-resolved into the goal map; enhanced
  conversions OFF (asserted). v1 wiring: opt_in / contact_submit via a
  LOADER-owned submit listener on data-netlify forms (also the §6
  form_submit signal — exists only when a tracking export mounts the
  loader, so the inline opt-in capture stays byte-identical); purchase
  dispatched from the checkout success confirmation. Loader size pin
  4KB→4.5KB (documented in the test; ceiling 6KB unchanged).

**Verification at the chunk boundary:** suite **1608/1608 + 60/60**;
`npm run check` green; build-diff vs merged main: EMPTY for every task
except ONE RECORDED DEVIATION on T13.7 — `/shop/thank-you/index.html`
changed, inline-script-only (Astro inlines the hand-coded S1c page script;
rendered DOM byte-identical): the brief's own commissioned purchase
dispatch. All 79 other pages byte-identical.

**Waiting on Wolf/vreich:** (1) fetch + review + push the bundle (branch
`claude/w10-mints-w13-consent`, 7 commits incl. the records commit); (2)
the four OQ-W8 ANSWER lines in `composite-sections-decision.md`; (3)
standing human gates unchanged (T9.16 re-drive, T9.7, T9.23, T10.9
credentialed seed run, eventual T13.11 env provisioning per OQ-W13-6).
**Next in queue:** T13.8 (native adapters + CSP — auto/opus), T13.9
(owner-DB kit — auto/sonnet), T13.10 (tracking seeds + roundtrip —
auto/opus), T13.12/T13.13 (auto/opus).

## Session 2026-07-19 E (W13 CHUNK 1 BUILT: T13.1→T13.5 — tracking substrate code-complete to the render seam; T10.4 RATIFIED in-session; delivery via git bundle)

Continuation of session D (same Cowork cloud sandbox, same branch
`claude/w10-design-vocabulary`, same no-push/no-device-git constraints —
delivery is `.tmp/w10-w13-progress.bundle`, superseded by the final chunk
bundle). T10.4 rulings were collected interactively mid-session (recorded
in `design-vocabulary-gaps.md` §7, commit `132328ce`): five mints approved
(video folds into media), all five variants approved, axis set ratified
as shipped — **T10.5/T10.6 are unblocked**. Then the W13 lane per the
sequencing choice:

- **T13.1 (`6bb7446a`)**: the shared `tracking` attribute on all ten bodies
  - the uniform `set_tracking` op (one-writer funnel via forbidKeys ×7;
    whole-block captures — first-set/removal/merge all invert exactly);
    tracking_attribute criterion (§6 matrix via TRACKABLE_ACTIVITIES_BY_TYPE);
    contract constraint; leak tests extended to label/tags sentinels.
- **T13.2 (`82c7baa3`)**: `tracking_config` — the ELEVENTH governed type
  (trk_drlurie): fixed-key provider registry with regex-pinned IDs (GTM
  permanently unenables — OQ-W13-3), env-var-NAMES-never-URLs law, consent
  - defaults blocks; trk\_ ids; set_tracking_config_fields; engine-enforced
    per-site singleton (409); materializer → src/data/site/tracking.json +
    collection; creation {agents: []} (empty allowlist now LEGAL = humans/
    seeds only); publish AUTONOMOUS under the master (OQ-W13-2); full
    contract. NOTE: objectTypes now has ELEVEN members.
- **T13.3 (`3da00f7b`)**: tracking_event.v1 (client vs enriched shapes;
  commerce_event rules verbatim) + /api/t relay: per-event drop, props
  allowlist, id-grammar revalidation, daily vhash + 30-min shash (raw IP
  discarded by construction), pinned geo accessor (x-nf-geo JSON/base64 →
  x-country; city NEVER read), same-origin + token bucket, 2s no-retry
  sink forward (env names from the config's own block, OQ-W13-6 defaults),
  blob mirror (tracking-events store, replay-idempotent), region oracle.
- **T13.4 (`a69184ac`)**: the loader — DOM-thin core (impression-once +
  dwell, scroll buckets, visibility-aware engagement, read_progress/
  completion, batch/flush policy, sampling on impressions/dwell only,
  GPC-suppressed consent seam) + pure click classification + thin browser
  binding (VT-safe: astro:page-load only trigger, before-swap flush).
  SIZE BUDGET test: real esbuild bundle ≤4KB min+gzip (ceiling 6KB).
- **T13.5 (`8860496a`)**: TrackingScripts.astro render seam — Layout swap
  live and byte-invisible (no export exists → renders nothing; build-diff
  EMPTY is the proof), #trk-config assembly + goal map, consent-bootstrap
  skeleton, loader mounted as a real bundled script, own+plausible
  adapters with the write+render regex double enforcement (drifted ID
  FAILS THE BUILD); data-cms-track="off" at all three annotation sites;
  Analytics/Splitbee/config.yaml-analytics/@astrolib-analytics RETIRED
  (importers verified). Loader page context derives from the stamped
  data-cms-\* DOM.

**Verification at the chunk boundary:** suite **1562/1562 + 59/59**;
`npm run check` green; build-diff EMPTY (80/80) after EVERY task —
nothing here changes a public page until a tracking_config export exists
(T13.10 seeds / T13.11 drive). Every W13 mark through T13.5 is BUILT,
NOT CONVERTED (no store record — the five-criteria bar applies at T13.11).

**Honest gaps (next builder):** the TrackingScripts component itself is
tested through its pure halves + the build-diff gate; a fixture-export
dist assertion (post-astro-compress #trk-config parse) should ride
T13.10's seed roundtrip when a real export exists. The ingest function's
sink-config store read is cached 5 min and falls back to
TRACKING_SINK_URL/TOKEN env names on any failure.

**Waiting on Wolf/vreich:** (1) fetch + review + push the bundle
(`.tmp/w13-chunk1.bundle`, 14 commits, branch
`claude/w10-design-vocabulary`) — CI runs on your push; (2) the standing
human gates unchanged (T9.16 re-drive, T9.7, T9.23; now also the eventual
T13.11 env provisioning per OQ-W13-6); (3) local repo cleanup one-liner
from session D still applies. **Next in queue:** T13.6 (consent banner —
auto), T13.7 (google_ads bridge — auto), T13.8+ / or W10 T10.5–T10.6
(mints, now ratified) — both lanes open.

## Session 2026-07-19 D (W10 CHUNK 1: T10.1→T10.2→T10.3 built to the T10.4 checkpoint — token axes live in schema/render/verbs/contract; survey proposal awaiting ratification)

Task (vreich): "check where we are on the conversion trail and continue"
(both lanes chosen: W10 to the checkpoint, then W13 pulled forward per the
queue's reorder sanction). Session ran in a Cowork cloud sandbox with NO
GitHub push credential and NO device-git write path (the desktop mount
forbids unlink — git index.lock operations fail), so delivery is a **git
bundle** of branch `claude/w10-design-vocabulary` handed to Wolf to fetch,
review, push; CI runs on his push. One task = one commit throughout
(autonomous-run C3, adapted: bundle instead of self-merged PR).

- **T10.1 (`5650f695`)**: bounded layout/shape/type axes on brandTokens —
  additive-optional enum groups on the SHARED schema (theme inherits by
  identity); `THEME_AXES` registry in theme-tokens.ts is the one source of
  truth (schema enums derive from it; every value maps to a pre-built
  custom-property set — rule 6, values never reach the CSS grammar);
  tailwind.css tiers read `var(--dl-…, <old literal>)` with byte-equal
  fallbacks; CustomStyles emits vars ONLY for non-default axes. Defaults
  byte-identical BY CONSTRUCTION: build-diff EMPTY (80/80). 7 tests.
- **T10.2 (`9a6af92b`)**: axes governed — site_apply_theme exact-replace at
  axis-key granularity (theme axis → copied; absent axis/group → site axis
  UNSET, defaults win), dry_run reflects axes, privileged-op inverse
  restores pre-apply byte-exactly (tested); shared brand_token_axes
  validation criteria on theme AND site (invalid enum blocks with readable
  copy; unknown axis keys warn inert; colors-totality posture NOT extended
  to axes); contract constraint DERIVED from THEME_AXES on both types;
  reconcile still excludes brandTokens whole (axes covered, test extended).
  7 tests. Suite 1510/1510 + 59/59; build-diff EMPTY.
- **T10.3 (`5dc47545`)**: `design-vocabulary-gaps.md` — survey over three
  representative archetypes (Wolf named no reference targets; disclosed in
  the doc; nothing crawled). Proposal: 6 mints ×2 batches (media, brand_row,
  stats / timeline, comparison_table, video_embed with a fold-into-media
  toggle), 5 bounded variants, `type.measure` named as the one axis ADD
  candidate, 3 composite-evidence cases for T10.7. Ends with the OQ-W10-1/-2
  question block. Docs only.

**T10.4 checkpoint (next)**: rulings collected interactively this session
(Wolf present) instead of the async-review 24h window; recorded in
design-vocabulary-gaps.md as the RATIFIED section when answered.

**Waiting on Wolf/vreich:** (1) fetch + push the bundle (branch
`claude/w10-design-vocabulary`), CI + merge per house flow; (2) T10.4
rulings if not yet answered in-session; (3) the standing T9.16 re-drive /
T9.7 / T9.23 human gates (unchanged, see Session 2026-07-19 entries above);
(4) local repo cleanup: `rm -f .git/index.lock && git checkout main &&
git branch -D __wt_test && rm -rf _to_delete` (session probe leftovers).

## Session 2026-07-19 C (W13 RULINGS: OQ-W13-1…6 all answered — queue unblocked, T13.12/T13.13 added; docs only)

Task (vreich): walk the six OQ-W13 questions interactively and record the
rulings. All six answered 2026-07-19; recorded as dated GOVERNING
amendments in the 12 plan §13 (wave-local convention). Branch
`claude/object-tracking-strategy-jh76f4` (restarted from `bcab22e`),
merged to main same session per vreich's delivery choice.

**The rulings (full text in [`12-object-tracking-and-analytics.md`](../12-object-tracking-and-analytics.md) §13):**

1. **OQ-W13-1 RATIFIED as seeded** — geo-adaptive; restricted regions =
   EEA-30 + UK + CH; GPC global; unknown = hold. → **T13.6 flipped
   checkpoint→auto** in queue.tsv.
2. **OQ-W13-2 ANSWERED, supersedes the doc's recommendation** — publish
   autonomy is config-driven ("auto if configured in config"): ships
   **AUTONOMOUS** (no approval-policy override; master covers it);
   creation stays human/seed-only (`{agents: []}`); posture must surface
   as an **owner toggle in the admin UI** → **NEW T13.12** (rides the
   T9.15 override-layer outcome). Doc 12 §3 amended in place.
3. **OQ-W13-3 RATIFIED** — full adapter set (google_ads/ga4/meta/taboola/
   outbrain/mgid, all shipped disabled; plausible dormant); **GTM
   permanently OUT**. → **T13.7 flipped checkpoint→auto**.
4. **OQ-W13-4 RATIFIED (recommended bundle)** — mirror retention 90d
   (policy; enforcement = future cleanup script); no sampling at launch;
   geo country+subdivision, **city dropped at ingest**; GPC honored,
   legacy DNT ignored. (12-plan §5.2/§5.3 + T13.3 brief updated.)
5. **OQ-W13-5 BLESS BOTH** — the engagement×`private.strategy` owner-DB
   join is BLESSED (events carry node_id only), AND the scores-feedback
   design is commissioned → **NEW T13.13** (design-only; deliverable =
   doc 12 §15 appendix; implementation stays a later decision).
6. **OQ-W13-6 ANSWERED** — vreich provisions `TRACKING_SINK_URL`/`_TOKEN`/
   `TRACKING_SALT` in Netlify env **before the T13.11 drive**;
   tracking_event.v1 = additive-only, v2 dual-write; Postgres+pg_notify
   kit stands.

**Changes:** doc 12 (§0/§1/§3/§5.2/§5.3/§5.4/§12/§13 amendments); briefs
T13.2/T13.3/T13.6/T13.7/T13.10 updated with the rulings (T13.6/T13.7
headers now `mode: auto`); NEW briefs T13.12 + T13.13; queue.tsv: two
mode flips + two appended rows. **W13 is now fully unblocked through
T13.10** — the only remaining gates are the T13.11 human_gate drive and
its env provisioning. Session-B "Waiting on" items 1–2 are RESOLVED by
this session; item 3 (merge) executed same-day.

**Verification:** docs-only diff; `npm run check` + `npm test` green;
queue.tsv tab/5-column/path check green (13 W13 rows).

## Session 2026-07-19 B (W13 STRATEGY: object tracking & analytics — doc 12 + T13 briefs; docs only, nothing built)

Task (vreich): research + plan "tracking as an attribute of each existing
object" — all usual trackers (Google Ads + native ad platforms), an OWN
tracker preferred over Plausible (the owner runs a DB listening to
triggers), object-type-aware activity collection, a legal-but-aggressive
posture, and project-dependent config (Dr. Lurie = one of several
projects). Session decisions (vreich, recorded in the plan §0): this
session ships docs+briefs only · own-tracker ingest = first-party relay ·
consent = geo-adaptive · branch pushed, NO PR (house rule). Branch
`claude/object-tracking-strategy-jh76f4`.

- **NEW [`12-object-tracking-and-analytics.md`](../12-object-tracking-and-analytics.md)**
  — governing plan for W13. Core design: (1) a cross-type `tracking` body
  attribute on ALL TEN types (the recipe-metadata spread pattern;
  enabled/label/tags/goals; ONE uniform `set_tracking` op with exact
  inverses + a one-writer funnel via `forbidKeys` on the seven open fields
  ops — nav is already strict, taxonomy/section gain their first
  body-fields op); (2) `tracking_config` as the ELEVENTH governed type
  (`trk_drlurie`: fixed-key provider registry with regex-pinned IDs — the
  `checkBrandTokenValue` law extended to scripts: agents flip typed
  switches, never inject script/URLs; consent block; per-type collection
  matrix; export `src/data/site/tracking.json`; require-approval +
  human-executed publish recommended, OQ-W13-2); (3) the own first-party
  pipeline: ≤4KB loader riding the EXISTING `data-cms-*` identity
  attributes → batched sendBeacon → `/api/t` relay function →
  `tracking_event.v1` (commerce_event.v1 rules verbatim; server-stamped
  `project_id`; cookieless daily-hash identity, zero device storage) →
  owner DB (Postgres + `pg_notify` reference kit) with a Blobs mirror for
  replay; (4) vetted adapters (google_ads/ga4/meta/taboola/outbrain/mgid +
  a dormant plausible slot; GTM recommended OUT) firing conversions ONLY
  from per-object `tracking.goals`; (5) geo-adaptive consent (own tracker
  consent-free everywhere by cookieless design; pixels
  Consent-Mode-v2-gated in EEA/UK/CH, auto-fire elsewhere; GPC always
  wins). Leak rule preserved: `label`/`tags` never render (leak tests
  extend); events carry `node_id` only — engagement×strategy joins happen
  in the owner DB from exports (OQ-W13-5 asks the blessing). The plan §0
  records the AMENDMENT: this directive supersedes the 03 §1.7-6 /
  inventory "analytics stays config.yaml" exclusion.
- **Briefs + queue:** `T13.1`–`T13.11` committed (attribute → config type
  → event schema/ingest → loader → render seam → consent [checkpoint
  OQ-W13-1] → google_ads bridge [checkpoint OQ-W13-3] → natives+CSP-RO →
  owner-DB kit → seeds/roundtrip → human-gated production drive proving
  the five criteria for `tracking_config` AND a `set_tracking` round-trip
  on one object of each of the ten types). queue.tsv rows appended after
  W12 with the W11-sequencing note (whichever wave runs second rebases
  paths). OQ-W13-1…6 live wave-locally in the 12 plan §13 (the 06/08
  convention); 05 §3 carries the pointer addendum.
- **Records:** object-inventory (planned-type note under the types table +
  MVP TODO #7), conversion-map (W13 row). NOTHING BUILT — no schema, no
  store record, no render change; every W13 mark is ⚪ PLANNED, and the
  build is untouched.

**Waiting on Wolf/vreich (this session adds):**

1. **OQ-W13-1** (consent posture ratification: regions list, geo
   granularity — gates T13.6) and **OQ-W13-3** (provider set v1; GTM
   stays out? — gates T13.7).
2. **OQ-W13-2 / -4 / -5 / -6** (governance tier for `tracking_config`,
   retention/PII policy, the owner-DB strategy-join blessing, sink env
   provisioning) — record answers in the 12 plan §13.
3. Review/merge of `claude/object-tracking-strategy-jh76f4` (no PR opened
   — house rule; branch review requested instead).

## Session 2026-07-19 (PRODUCTION FIX: CMS Agents chat 400 on the opening tool-call turn — array-aliasing bug in the run loop)

Task (vreich): fix a production bug reported twice on prod (request_ids
`req_011CdBZxMCf8BLLwAMyy1lHC`, `req_011CdBa3eHhuvx4QdvfMxGBz`) — at
`/admin/agents` → **New article**, the Site Agent's opening move
(`get_contract` + `list_objects`, both parallel + `auto`) succeeds, then the
SECOND provider turn 400s: `messages.2.content.0: unexpected tool_use_id
found in tool_result blocks`. No ApprovalCard ever rendered, blocking step 1
of the T9.16 drive. Branch `claude/cms-agents-provider-crash-8gte1j`.

**Root cause (`netlify/lib/agent/loop.ts`):** `run.call_queue =
turn.toolCalls` assigned the SAME array reference already pushed onto the
transcript as the assistant message's `tool_calls`
(`run.transcript.push({..., tool_calls: turn.toolCalls})`). Draining
call_queue with `.shift()` — once per auto-executed / not-available /
parse-error call — mutates that shared array in place, silently erasing
tool_use entries from the PERSISTED assistant turn as each call resolves.
With 2 parallel auto calls, by the time both had run, the recorded assistant
message's `tool_calls` had been mutated down to `[]` while its two
tool_results still referenced the now-vanished ids — exactly Anthropic's
rejected shape (the "previous message" has no tool_use left to match).
Neither existing test caught it: `agent-chat-providers.test.ts` fed
`toAnthropicMessages` a hand-built, never-corrupted transcript (never
exercised `loop.ts`), and `agent-chat-protocol.test.ts`'s scripted adapter
ignored its `transcript` argument entirely (never exercised the real
Anthropic/OpenAI conversion) — the gap was in the seam between the two test
files, not inside either one.

**Fix (minimal, provider-neutral, no schema/protocol change):**

- `loop.ts`: clone on assignment — `run.call_queue = [...turn.toolCalls]` —
  so draining the queue can never mutate the transcript's recorded turn.
- `provider.ts`: both `toAnthropicMessages` and `toOpenAIMessages` now track
  the open tool_use/tool_call ids per assistant turn and THROW a clear,
  attributable error if a tool result doesn't match the immediately
  preceding assistant turn, instead of silently building a request the
  provider would reject with a cryptic 400 (both now exported for direct
  unit testing).
- Audited pause/resume (approve/deny) and the not-available/parse-error
  paths: all already preserve pairing correctly once the aliasing is broken
  (approve/deny use non-mutating `.filter()`; the shared-array bug was the
  only source of corruption across every path that touches `call_queue`).

**Tests added (each independently verified to fail pre-fix / pass post-fix
by temporarily reverting just that half of the fix and re-running):**

- `agent-chat-protocol.test.ts`: `runAgentLoop` end-to-end with 2 parallel
  auto `get_object` calls on the opening turn, capturing the transcript
  handed to the SECOND provider call and asserting both tool_use ids survive
  on the recorded assistant turn.
- `agent-chat-providers.test.ts`: a hand-built corrupted transcript
  (mirroring the real `get_contract`+`list_objects` shape) asserting
  `toAnthropicMessages`/`toOpenAIMessages` throw instead of building the
  doomed request (and that the adapters never even call `fetch`); a
  companion valid-shape test proves the same tool names still round-trip
  clean.
- Full suite: **1495/1495 + 59/59** (6 new tests over the last-recorded
  1489/1489); `npx eslint` + `npx prettier --check` clean on all four
  changed files (`loop.ts`, `provider.ts`, both test files).

**Honest gap — NOT re-driven live:** this sandbox has no deploy and no
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, so the fix is verified by exact
root-cause tracing against the reported transcript shape + the regression
tests above, NOT by a live `/admin/agents` → New article click-through. The
T9.16 drive's step 1 (get_contract + list_objects → `create_object`
ApprovalCard, no 400) should now clear on the real deploy; if it doesn't,
that's a NEW finding, not a reopening of this one.

**Standing:** the 47-converted-objects count and every Wolf ruling above are
unchanged — this is a runtime bug fix in the chat infrastructure, not an
object conversion.

## Session 2026-07-19 (W9 REMAINDER BUILT: T9.12→T9.13→T9.14→T9.17→T9.18→T9.26→T9.20→T9.21→T9.22 + both human-gate preps — the queue's outstanding work fished before W10; chat system code-complete, gates pending)

Task (vreich): "Work along queue.tsv. Before we get to the new client wide
phases i prefer to fish all that is outstanding or has been passed over."
Session model switched to Fable 5 for the `notify` rows (T9.12/T9.13 run
in-session at designated model per autonomous-run B2). Branch
`claude/queue-tsv-outstanding-wghuhd`; one task = one commit throughout.
**Everything below is code-complete and suite-proven; NOTHING here counts as
shipped until the T9.16 + T9.23 production drives pass (house convention).**

- **T9.12 spike (commit `9979b4f`)**: the chat-first premise proven —
  pause on an ask-gated tool call, persist to a blob event-log doc, resume on
  a later invocation with the stored call re-verified (args re-hash; client
  args never read on plain approve). 4/4 local proof against the real
  `handleObjectVerb`; forged resumes (wrong call_id / tampered args / token
  replay) 409; deny feeds a refusal; human-principal attribution + clean lock
  cycle. **Deploy-level timing NOT exercised** (branch has no deploy) — the
  ≥60 s pause acceptance rides the T9.16 drive; findings note
  (`T9.12-findings.md`) carries the validated design: single-doc event log,
  single-writer state machine (no CAS on Blobs), one-shot trigger tokens,
  provider-neutral transcript with stateless re-send, call_queue for
  multi-tool turns, caps, and the two recovery gaps (stuck-queued /
  stuck-running) T9.13 closed with stale-takeover. Spike files deleted by
  T9.13 (importer-grep clean).
- **T9.13 runtime (commit `0f64865`)**: `netlify/lib/agent/{chat-store,
profiles,provider,tools,loop,context}.ts` + `admin-agent-chat.ts`
  (create_chat/list_chats/get_chat?since_seq/send/approve_tool [with
  edit-and-approve, schema-revalidated]/deny_tool/cancel) +
  `admin-agent-chat-run-background.ts` (15-min hop, trigger-token gated).
  BOTH provider adapters v1 (OQ-W9-3): Anthropic (`claude-opus-4-8` seed
  default; no sampling params — 400 on Opus 4.7+; thinking omitted v1 so the
  neutral transcript round-trips; parallel tool_results merge into ONE user
  turn) and OpenAI (`gpt-5` seed; arguments JSON parsed defensively) — both
  behind one interface, provider/model from the resolved profile, NEVER
  hardcoded. §4 registry: reads auto; draft/creation/publication ask;
  creation + apply_theme dry-run-FIRST (server-computed preview rides the
  approval card); apply_theme Owner-gated AT EXECUTION independent of
  autonomy; patch ops constrained to the type's agent-authored contract ops;
  args zod-validated BEFORE any pause. Governance `chat_tools` consumed
  (T9.15's seam closed) + per-profile overrides; autonomy frozen per run.
  Every execution carries the SAME store validation context + policies as
  admin-object — no new write paths. Deps added: `@anthropic-ai/sdk@0.112`,
  `openai@6.48`. 18 protocol/conformance tests.
- **T9.14 chat UI (commit `d3d2cac`)**: chat primitives
  (`src/components/admin-ui/chat.tsx` — ChatThread/ToolCallCard/ApprovalCard
  with Approve / Edit-and-approve / Deny + dry-run verdict/AgentChip/
  ChatComposer with the readiness strip directly above + suggested prompts
  from missing criteria) + `useChat` since_seq polling (~1.2 s live / 5 s
  idle; "Waking the agent…" covers cold starts) + the LAYOUT FLIP: chat
  center, live preview right (refreshes on every accepted write), the T9.9
  inspector + History + Raw one click away in a Details drawer.
- **T9.17 hub (commit `f08e14d`)**: `/admin/agents` — session list with human
  titles + outcome chips (created/published/edited N, from run summaries),
  resume, four starters (article / page-from-template REUSE-FIRST / section
  template / Owner-only retheme). Creation tool_result events now carry the
  created object's id+type → one-click "Open <id>" into its workspace.
- **T9.18 studio (commit `e60bf4c`)**: `/admin/studio` — tpl/stpl/thm
  galleries with the REQUIRED metadata trio (tpl_fieldtest wears the visible
  "needs backfill (422 on patch)" badge); dry-run-first instantiate + apply
  flows; theme apply = dry-run token diff → typed APPLY confirm → real
  apply under a site checkout. **SECURITY FIX found en route: the verb core
  had NO owner gate on a human real `apply_theme`** (§8 matrix said
  "verb-level owner check") — added: humans need `owner` (403), dry_run open,
  AGENT principals byte-unchanged (W8.4 path preserved); +1 test, 12/12.
- **T9.26 roster (commit `e6b2cdc`)**: §4a closed — roster UI (Owner
  create/edit: name/provider/model/prompt/status; site-default + per-type
  assignment selects), per-object "Dedicated agent" selector in the
  workspace drawer, run records stamp the resolved profile (mid-run
  reassignment never switches — tested), and the canvas Ask-AI re-pointed
  through profile resolution: `ask-ai-object.ts` gained an Anthropic
  transport (forced tool_choice) beside OpenAI; hardcoded OPENAI_MODEL/
  gpt-4o gone from `admin-ask-ai-object.ts`. ALSO: `admin-agent-chat`'s
  front door now follows the T9.4 pattern (resolved ROLES, not env isAdmin)
  so invited store-tier admins can chat. +3 tests over real local stores.
- **T9.20 article settings (commit `489b47e`)**: canvas panel "Article
  settings" accordion (article panels only) + workspace-drawer parity card:
  slug (edit-time candidate-validate BEFORE the lock — collisions surface at
  edit, not publish), description, category select + tags datalist from the
  tax_drlurie REGISTRY object (novel terms flagged inline pre-publish), SEO
  description with counter — one `set_article_meta` op under EditSession.
  **Honesty notes for the T9.23 drive: 'author' has NO object-model field**
  (legacy frontmatter concept; row-3 decision left to Wolf) and 'date' =
  the publish timestamp (T9.21's option).
- **T9.21 tray finishers (commit `6161fcc`)**: per-row readiness gate (a
  validate round-trip must report eligible; blockers hold the button with
  the criterion text inline; validation-unreachable fails OPEN to the server
  gate), publish now / explicit-timestamp (`EditSession.publish(time?)`
  additive; OQ-2 honored — no scheduling/unpublish), and the `--dlem-*`
  token bridge: every VALUE resolves through `--adm-*` first, falling back
  to the original `--aw-*` chain on the public canvas (values only, zero
  selector change).
- **T9.22 publisher re-point (commit `51e9d2c`, closes W7.5)**: the
  5-agent workflow's final stage targets the object substrate —
  content_item create (article_body.v1 nodes pass VERBATIM, strategy
  annotations intact in private.\*) → taxonomy/SEO → validate with the live
  context → publish under the gate → checkin; release NOT fired. Publish-key
  callers act as agent `publisher-workflow`; admin sessions as the human.
  **`publish-article.ts` + `admin-workflow-lock.ts` byte-untouched (git
  diff empty); the legacy path receives ZERO writes — pinned by a
  source-level test.** Legacy overwrite semantics retired (slug uniqueness
  refuses). +3 tests incl. mocked GitHub committer end-to-end.
- **Human-gate preps (this commit)**: `T9.16-chat-drive-checklist.md` (8
  steps + the T9.12 deploy-level acceptance carried in) and
  `T9.23-parity-signoff-checklist.md` (§5's 11 rows as drive steps; OQ-W9-5
  slot). **Waiting on Wolf/vreich** — see "Waiting on" below.
- **Verification**: full suite **1489/1489 + 59/59**; `npm run check` green
  throughout; **build-diff vs branch base (`601b8ab`): all 70 public pages
  byte-identical** — the 8 diffs are `/admin/*` only (2 new pages + 6 admin
  pages the tasks deliberately changed), i.e. the public-EMPTY criterion
  holds exactly.

**Waiting on Wolf/vreich (ordered):**

1. **Merge + deploy this branch** (PR from
   `claude/queue-tsv-outstanding-wghuhd`), with `ANTHROPIC_API_KEY` present
   in Netlify env (OPENAI_API_KEY already there).
2. **T9.7 drive** — the RBAC credentialed verification (runbook committed
   2026-07-17) apparently still awaits its production run; it precedes the
   chat drive naturally.
3. **T9.16 drive** — the chat credentialed run (checklist above). Wave-exit
   record in this file.
4. **T9.23 sign-off** — the 11-row parity drive + the row-3 author ruling +
   OQ-W9-5. Unblocks T9.24 legacy deletion → T9.25 close-out (both auto).
5. Standing smaller items still open: `tpl_fieldtest` metadata backfill or
   retirement (now VISIBLE in the studio as a badge); the stale-queue wipe
   (operator-gated, checklist in the 07-19 artifact entry); OQ-W9-2/-4/-6/-7
   remain as recorded.

**Gotchas found this session (for the next builder):**

- Netlify checkout responses carry the token as top-level `lockToken`
  (`body.lock` is sanitized — never the token); guessing `lock.token` costs
  a debugging pass.
- `EditSession.lockState` is private — UI code doing raw verb composition
  (studio theme apply) should checkout via `callObjectVerb` directly.
- The eslint config has no react-hooks plugin — a
  `react-hooks/exhaustive-deps` disable comment is itself a lint ERROR.
- Astro page ↔ island name collision: a page named `studio.astro` cannot
  import a component named `Studio` (ts2440); alias the import.
- The publish gate resolves human roles via the SYNC env resolver inside
  `publish_by_time` — tests must set `ADMIN_EMAILS`, and the T9.4 async
  store-tier roles do NOT feed that gate yet (worth a look when the roles
  migration continues).

## Session 2026-07-19 (W10–W12 PLANNED: platformization pipeline — design vocabulary, multi-tenant core, site capture; docs only, no code, nothing converted)

Task (vreich): analyze the conversion roadmap, agents' template-creation range
toward multi-site cloning, and the multi-tenant path — then "formalize parts 2
and 3 to be able to run auto with flexible AI model allocation." Deliverables
on `claude/conversion-roadmap-cms-strategy-hgplp8`:

- **Plan doc:** `docs/cms-architecture/11-platformization-plan.md` — three
  waves, constitution unchanged (rules 1/5/6 stand; the plan widens BOUNDED
  surfaces and relocates code, never puts CSS/page-kinds/free layout in data):
  - **W10 design vocabulary** (parallel-safe with the W9 tail): bounded
    layout/shape/type token axes on `brandTokens` (byte-identical defaults);
    evidence-driven palette mints + bounded variants (survey → Wolf ratifies at
    the T10.4 checkpoint); composite decision package assembling the
    OQ-W8-1…4 evidence (memo only); starter-recipe refresh + T10.9
    credentialed run (all five criteria — no half measures).
  - **W11 platformization** (GATED on T9.24 + the T11.0 checkpoint):
    monorepo `packages/core` + `sites/<client>`; tenant boundary = one Netlify
    site per client (stores/creds/deploys isolated); de-hardcoding incl.
    per-site `tax_<site>` resolution in `taxonomy-enforcement.ts`
    (**`publish-article.ts` stays byte-untouched** — the legacy path remains
    drlurie-bound until its separate retirement); provisioning CLI
    (`create-site`); fleet CI matrix; schema-migration harness + merge gate;
    per-site governance + the minimal OQ-3 per-agent-credential slice
    (OQ-W11-5); T11.11 second-site acceptance proof (one core commit rebuilds
    both sites — the "canonical changes update all clients" property,
    demonstrated).
  - **W12 site capture** (authorized targets ONLY — owned/licensed/explicitly
    approved, blocking precondition in every brief): crawl → snapshot →
    decompose onto the section palette (+ palette-gap reports feeding the W10
    growth loop) → theme extraction quantized to the token surface → emission
    as DRAFTS through the governed verbs into the staging client → bounded
    fidelity loop scored against the OQ-W12-2 rubric → T12.6 Wolf sign-off.
- **28 briefs** (`T10.1`–`T12.6`) + queue.tsv rows appended after T9.25.
  Runner semantics: W9 remainder runs first by default; W10 rows may be moved
  ahead (reordering queue.tsv IS the scheduler); modes — `auto` default,
  `notify` on security-boundary/Fable tasks (T11.3/5/9/10, T12.1/2),
  `checkpoint` T10.4 + T11.0 (T11.0 also verifies T9.24 actually landed),
  `human_gate` T10.9/T11.11/T12.6. **Flexible model allocation = the queue's
  per-row model/effort columns** (fable/opus/sonnet ladder per the W9
  convention; plan §4 records the reallocation + budget-cap rules).
- **OQs for Wolf (plan §6):** OQ-W10-1…3 (mint list, token axes, composite),
  OQ-W11-1…5 (repo strategy, exports location, per-site admin, tenant
  boundary, OQ-3 scope), OQ-W12-1…3 (capture authorization rule, fidelity
  bar, pre-W11 landing zone).
- **Noted en route:** the 2026-07-17 W9 merges (PRs #454/#455 — T9.1–T9.11,
  T9.15, T9.19 built) have no state-of-play entries yet; per the W9 plan,
  records concentrate at T9.25 — flagged here so the log's silence isn't
  misread as "W9 not started." The strategy analysis itself (roadmap position,
  the full deferred/open register, coupling inventory) was delivered in the
  session conversation and is condensed into the plan doc's premises.

## Session 2026-07-19 (artifact-publishing hardening: CMS-Agent ↔ Dr-Lurie ↔ pdf-tool triangle)

Task (vreich): analyze the artifact-production/publishing triangle (CMS-Agent
MCP orchestrator, this repo's Dr_Lurie MCP, pdf-tool) and make image/PDF
publishing smooth and bug-free. Branch
`claude/cms-agent-artifacts-publishing-12g3tk`. Live-state evidence gathered
first: 10 failed queue records (2026-06-30..07-02 smokes) triaged into six
failure classes (post-publish 404 / pdf-tool 429 / ×4 canonical-input trust
rejections / ×2 "PDF template not found" / self-referential URL 422 / PDF
media entry 422); CMS-Agent's dr-lurie project is read-only allowlist +
`publishEnabled=false`; both external MCP legs showed >60 s cold starts.
User-ratified decisions: the OBJECT path (`content_item` → `object_publish` →
`release_to_production`) is the canonical artifact route; legacy stays frozen.

- **Fix 1 — release truth signal (SHIPPED).** `released:true` used to mean "a
  ready deploy exists for the commit", which under locked Netlify Auto
  Publishing can be a ready-but-unpublished deploy (the documented
  `production-release.ts` risk; failure class 1's ambiguity).
  `releaseToProduction` now consults `getPublishedProductionDeploy` (the same
  authoritative signal `verify_article_images` adopted on 07-16): published
  commit match ⇒ `released:true` + `productionConfirmed:true` (published wins
  even if the receipt poll never saw ready); ready-but-unpublished ⇒ new status
  `build_ready_not_published` with unlock guidance; site lookup unavailable ⇒
  prior ready-by-commit behavior with `productionConfirmed:false` ("not
  independently proven live"). `deploy_status` additively returns
  `publishedDeploy` + `productionConfirmed` (absent = unknown, never "not
  live"); both tool descriptions now teach "poll until ready AND
  productionConfirmed". (`netlify/lib/production-release.ts`,
  `netlify/functions/deploy-status.ts`, mcp.ts descriptions; +4
  production-release tests, +3 new `deploy-status.test.ts`.)

- **Fix 3 — object-path artifact EXISTENCE trust (SHIPPED).** The object path's
  `*AssetRef`/`fulfillment.artifact_ref` checks ran shape-only in production —
  `trustedAssetRefs` had no writer, so a typo'd sha or soft-deleted artifact
  published clean and 404'd live. `buildStoreValidationContext` now accepts the
  artifact-index store + the raw request payload, sweeps payload + every loaded
  record body for Major-Key refs (raw or `/img|/pdf` public-path form,
  normalized via the new `rawArtifactRefForPublicPath`), pre-resolves exactly
  those against the index (one `readArtifactReference` each; ≤200/write), and
  exposes a sync `resolveArtifactRef` (exists/deleted/sizeBytes/contentType).
  `validateAssetRef` consults it when no `trustedAssetRefs` set is injected:
  absent/deleted artifacts BLOCK at publish and WARN while drafting (an agent
  mid-assembly may upload next); shape/trust problems still always block; index
  unavailable degrades to "not verified" — never a failed write. Trust unit is
  EXISTENCE, not same-request (canvas uploads legitimately cross requests).
  Wired in `object-store.ts` + `admin-object.ts`. ALSO: class-3 replay
  regression — the four 06-30..07-02 failed-record shapes (node
  `public_media_src`, `promote_publish_payload.featuredImage`,
  `mediaEntries[].src`, `artifactReferences[].blobKey`, index-trusted but NOT
  in agent_outputs, real sha) now pinned green against `patch_canonical_input`
  (`tests/netlify/canonical-input-trust-replay.test.ts`) — confirming #327
  holds for every shape that actually failed. (`netlify/lib/artifact-trust.ts` +`PUBLIC_ARTIFACT_PATH_RE`/inverse, `object-validation-context.ts`,
  `object-validate.ts`, both entry functions; +9 tests.)

- **Fix 2 — content_item media path + hero rules (SHIPPED; bug ② closed on the
  object path).** Node media srcs were schema-unconstrained strings: a mistyped
  path 404'd live, and a PDF in the hero (`body.image.src`) would reach Astro's
  getImage at build — the object-path analogue of the legacy
  PDF-as-featuredImage bug. New `article_media` criterion (structure group):
  image media/`images[]` srcs take the `/img/{id}/{sha}.{ext}` public path and
  document media + `/pdf/` ctaLinks take `/pdf/{id}/{sha}.pdf` — both
  EXISTENCE-checked through Fix 3's `resolveArtifactRef` (absent/deleted →
  publish blocker, draft warning); remote https and site-static paths WARN
  (renderable but ungoverned — remote warn-vs-block flagged for Wolf); data
  URIs, legacy `src/assets/` paths, and bare relative paths BLOCK; the hero
  must be an IMAGE — `/pdf/`/.pdf there blocks with the build-breaker message.
  video/audio/embed srcs stay out of scope until they render richer than a
  link. Renderer unchanged (document→honest link is the sanctioned rendering;
  now pinned by a render-matrix test). `object_contract("content_item")` gained
  image/PDF `auxiliary_inputs` rows (grant-first flow, public-path rule,
  never-a-PDF-hero), and the stale `create_artifact_upload_intent` hints on
  \*AssetRef/product-fulfillment guidance now point at the storage-grant path.
  (`netlify/lib/object-validate.ts`, `src/lib/registry/object-contract.ts`;
  +6 validation tests, +1 renderer test.)

- **Fix 4 — publish receipt carries the live article URL (SHIPPED).** A
  content_item `object_publish` now returns `article_path: "/<slug>"` (the blog
  permalink pattern, proven by /object-model-demo), and the MCP wrapper's
  `production` block adds `verify_after_release` — the exact deploy_status
  (ready AND productionConfirmed) → `verify_article_images {url,
expectedImages: [/img/... node paths], commit}` follow-up — so agents verify
  the real URL instead of guessing routes (the post-publish-404 class).
  `verify_article_images`' description now distinguishes legacy display-path
  matching from object-article `/img/` exact matching.
  (`netlify/lib/object-publish.ts`, mcp.ts; +1 test.)

- **Fix 5 — image byte budget surfaced at validation (SHIPPED).** The 150 KB
  webp budget rode the grant and object_contract but nothing on the write path
  surfaced an over-budget artifact (a default 1024×1024 PNG ships ~10× over,
  silently). New `media_budget` criterion (artifact_trust group): every
  resolved image ref (`/img/` path or raw `image/` Major Key) with
  `sizeBytes` over `activeMediaPolicy().maxImageBytes` reports — severity
  follows the committed policy (`overBudget:'warn'` → warning;
  flipping to `'block'` makes it a publish blocker with zero code). Over-budget
  only — format stays generation guidance, so existing .jpg canvas uploads
  don't nag. (`netlify/lib/object-validate.ts`; +2 tests. External half —
  pdf-tool defaulting generation to the grant `limits` — goes in the Track 2
  contract doc.)

- **Fix 7 — CI hardening (SHIPPED).** Node 20 added to the build matrix
  (Netlify production builds on 20 via netlify.toml; CI only exercised 22/24 —
  a Node-20-only failure shipped uncaught). The check job now runs the
  site-seed drift guard (`sync-site-seed.mjs --check`) and the T2.0 build-diff
  harness self-test. FOUND EN ROUTE: the self-test itself had rotted — its
  planted needle ("Five simple places to begin.") no longer exists since
  index.astro became a thin PageObjectRenderer loader; re-pointed at the
  page_home EXPORT copy (the string that actually reaches rendered HTML),
  self-test 2/2 PASS again. (`.github/workflows/actions.yaml`,
  `scripts/build-diff.mjs`.)

- **E2E ARTIFACT DRILL — FULL LIVE PROOF (2026-07-19, session MCP connection;
  the drill ran against the DEPLOYED server — this branch's fixes ship with
  the PR and are proven by the local suite meanwhile).** Modes A→B→C:
  **(A)** grant fetched → pdf-tool `list_pdf_templates` preflight (11
  templates, 4 active — failure-class 4 was remediated 2026-06-30, the
  `smoke-symptom-worksheet-v1` template landed minutes after the smokes
  failed) → image job (gpt-image-1, webp, **50,372 bytes — under the 150 KB
  budget**) + PDF job (pdfme, 9,506 bytes, 1 page A4) both complete →
  `verify_agent_artifact` **5/5 checks** on both → both visible in
  `list_artifacts_for_request req_artifact_drill_20260719_01` →
  `object_validate` candidate patch on the demo article **eligible:true**;
  negative probe (raw Major Key in `media.src`) correctly REFUSED by the
  deployed `render_image_ref` check. **(B)** checkout → patch (two nodes:
  `n_demoartifacts` image + `n_demoworksheet` PDF CTA; rev 15, ready) →
  `object_publish` → commit `3cea365` dark (`deploy_status` showed NO deploy —
  the [skip netlify] deferral held) → checkin. **(C)** `release_to_production
{commit}` — the MCP response was LOST to a proxy 502, and the
  state-check-first discipline (deploy_status BEFORE any retry) proved the
  hook HAD fired: production-context deploy `6a5cb1c4…` ready in 38 s, no
  duplicate build wasted. `verify_article_images` → **verified:true,
  deployReady:true**, all three `/img/` exact-matched and fetching 200
  `image/*`; the `/pdf/` worksheet URL serves **200** from production; the
  released export carries both nodes byte-exact. The demo article at
  `/object-model-demo` now demonstrates agent-produced binary artifacts
  end-to-end. Cold-start note: two 60 s first-call timeouts (CMS-Agent
  registration read; one object_validate under a concurrent pair) — both
  succeeded on single retry; keepalive recommendation stands.

- **Stale-queue disposition (Fix 6) — BLOCKED ON OPERATOR, documented.** The
  60 stale workflow records (50 pending pre-W7 drafts of wiped articles + 10
  failed June-smoke evidence) should be wiped via `wipe_blob_stores
{prefixes:['workflows/']}` (dry-run → review sampleKeys → confirm
  WIPE_BLOBS). The session connection CANNOT run it — the tool answered
  "Unauthorized: a valid server publish key is required" even on dry-run —
  so deletion stays operator-gated. Fixture payloads for the four class-3
  failure shapes were extracted FIRST and are pinned as committed regression
  tests (`canonical-input-trust-replay.test.ts`), so the wipe loses no
  evidence. Operator checklist: (1) dry-run, (2) confirm the sampleKeys are
  all `workflows/…`, (3) live run with `confirm:"WIPE_BLOBS"`, (4) note the
  count here.

## Session 2026-07-16 (publishing-backend hardening: article_body-only canonical input, grant-only artifacts, deploy-aware verification, extended live-publish approval pin)

Task (vreich): "implement the Dr. Lurie publishing backend changes needed for
live-ready article publishing" — six requirements, on branch
`claude/dr-lurie-publishing-backend-rs22da`. **Scope choice under the governing
freeze**: `publish-article.ts` + `admin-workflow-lock.ts` stayed OFF-LIMITS and
no Wolf ruling was reversed. Enforcement was added at the TOUCHABLE
MCP/canonical boundaries — additive + default-off — so the frozen fallbacks
become UNREACHABLE rather than edited. The two aggressive options (unfreeze
publish-article.ts to gate its direct-HTTP markdown/URL fallbacks; flip
`content_item` to require-approval) were deliberately NOT taken — each needs
Wolf sign-off (the W7.5 unlock; OQ-W7-4).

- **Goal 6 — deploy-aware image verification (SHIPPED).** `verify_article_images`
  takes an optional `commit`: it correlates to that commit's Netlify deploy
  (reusing `pollDeployReceipt`/`getDeployReceiptByCommit`) and runs image
  assertions ONLY once the deploy is confirmed ready. A page served by a
  stale/previous deploy is now `inconclusive` (deploy timing) or carries a
  build-failure note — never a false `verified:false` missing-image defect;
  `deployReady:true` ⇒ definitive. Degrades gracefully (`deployAware:false`)
  when deploy lookup is unconfigured; no-`commit` callers are byte-identical.
  (`netlify/functions/verify-article-images.ts`, mcp.ts tool schema+wrapper; +5 tests.)

- **Goals 2+3 — grant-only artifact transfer (SHIPPED, partial).** Closed the
  one reachable publish leak: `buildCanonicalPublishPayload` now derives
  featured-image candidates ONLY from request-scoped artifact pointers
  (`parseArtifactPointer` gate) — a remote URL / data URI / repo path in
  `image_asset_register` / `image_sets` / node media src can no longer be
  promoted to the committed frontmatter image. Trust-gate rejection copy
  (`artifact-trust.ts`) now points agents at `get_pdf_tool_storage_grant`, not
  the legacy upload tools. **DEFERRED (OQ-W7-1-authorized follow-up)**: globally
  removing `save_artifact` / `create_artifact_from_url` /
  `create_artifact_upload_intent` from tools/list — a deep deletion cascade in
  the frozen-adjacent mcp.ts, not undertaken without scope confirmation. Literal
  req-3 ("publishing code must not use them as fallbacks") is satisfied: the
  canonical publish path never invokes them and no longer trusts remote
  URLs/repo paths. (mcp.ts, artifact-trust.ts; publish-by-time-media +
  canonical-promotion-trust tests updated to the secure behavior.)

- **Goal 1 — article_body.v1 as the only canonical content path (SHIPPED).** The
  governed MCP publish boundary already required article_body.v1
  (`validateCanonicalArticleBody`) and emits only article_body
  (`buildCanonicalPublishPayload` never sets markdown/content). ADDED a
  fail-closed guard: a competing legacy prose blob (`content.blocks` /
  `content.structure.sections`) carried alongside article_body is rejected at
  publish (`error_code: competing_non_canonical_body`). Markdown stays an
  export-only adapter (`to-markdown.ts`). Remaining markdown-input doors — the
  frozen `publish-article.ts` direct-HTTP fallback and `run-publisher-agent`'s
  LLM conversion — are frozen-path follow-ups. (mcp.ts; +1 test.)

- **Goals 4+5 — extended live-publish approval pin + batchable release (SHIPPED,
  default-off).** The approval decision may now additionally pin the exact
  content-item/request id, artifact set, and release/build behavior
  (`object-record-v1.ts` reviewStateSchema.decisions.`approval_pin`;
  `review-state.ts` `approvalPinSchema`). The publish gate (`publish-gate.ts`)
  enforces them for AGENT execution on a gated type — `request_id` vs
  `record.object_id` always; `artifact_set`/`release_build` when the publish
  declares them — with new denial codes; humans with publish authority stay
  unbound (C§2.2). Settable via `object_review_decide` (mcp.ts + object-verbs.ts).
  **DEFAULT-OFF**: committed policy stays all-autonomous (product-gated), so
  OQ-W7-4 (articles autonomous) is preserved — turning on live-gated article
  publish is a one-line `content_item: 'require-approval'` flip plus (for the
  legacy WorkflowRecord article path) wiring the gate in, a frozen-path
  follow-up. Release/build is already explicit + batchable (object exports carry
  `[skip netlify]`; one release = one deploy; batch via one `trigger_netlify_build`)
  — the new `release_build` pin makes that behavior part of the approval. (+6 gate tests.)

- **Post-review hardening (Codex P2 ×2 on PR #452)**: (a) wired `artifact_set` +
  `release_build` through `object_publish` → object-verbs → gate, so an approval
  that pins them is SATISFIABLE (the agent declares them on the publish) instead
  of bricking the object with `publish_artifact_set_required`; (b)
  `verify_article_images` now treats the site's PUBLISHED production deploy as the
  source of truth for `deployReady` (new `getPublishedProductionDeploy`), so a
  ready-but-unpublished build under locked Auto Publishing (or a ready deploy
  preview) is inconclusive, never a false missing-image defect. (+3 tests.)
- **Gates**: `npm test` 1327 + 59 green; eslint clean on every touched file;
  prettier clean. No frozen file edited; no default behavior reversed.

## Session 2026-07-16 (W9 PLANNED: admin workspace overhaul — the chat-first admin conversion; docs only, no code, nothing converted)

Wolf's direct mandate: overhaul the admin UX ("consistent, logical and user
friendly … no more naked ref numbers … AI communication exchange front and
center for every object … at least two levels of admin rights"). This is the
admin-area rethink the W7.7 hold and the "ignore the old admin editor" ruling
were waiting on.

- **Plan doc:** `docs/cms-architecture/10-admin-workspace-plan.md` (09- was
  taken by the template-system plan). Vision: chat-first per object with the
  classic form UI as the always-available second option; names-never-refs;
  one design language; guardrails visible/adjustable with enforcement
  server-side; **no new write paths** (everything through `handleObjectVerb`).
- **Decisions taken by Wolf at commissioning (session Q&A):** deliverable =
  plan + briefs (this session); UI stack = **React islands scoped to
  /admin only** (public site + canvas stay vanilla; byte-identical public
  build is T9.1's gate); CMS Agents = **in-house agent endpoint** (background
  fn loop, tools over the object verbs, runs under the signed-in human's
  Principal, HITL approval cards); roles = **two tiers, Owner + Admin** (new
  `users` blob store; `ADMIN_EMAILS` stays the permanent bootstrap-Owner
  fallback — lockout structurally impossible).
- **Task pipeline:** 25 briefs `cms-pipeline/T9.1-*.md` … `T9.25-*.md` +
  queue.tsv rows (T9.12 spike pulled forward — it de-risks the
  pause/resume-approval mechanic the whole chat design stands on). Waves:
  foundations → RBAC → workspace forms parity → chat → hub/studio → canvas
  ports (T9.19 formally lifts the W7.7 hold) → retirement (gated on Wolf's
  T9.23 parity drive over the 11-capability port table; only then do
  /admin/publish, drafts, library, review, objects + their functions get
  deleted; blobs reskins to Owner-only /admin/maintenance).
- **Model ladder** (Wolf 2026-07-16: Fable/Opus budget not a constraint):
  Fable on security boundaries + hardest generative tasks (T9.2 kit, T9.4
  roles, T9.9 generated inspector, T9.12/13 chat runtime, T9.15 governance,
  T9.19 canvas edit); Opus on substantial product UI/integration; Sonnet on
  mechanical/prep. Recorded in the plan §9.
- **SAME-DAY AMENDMENT (Wolf):** (1) both Anthropic AND OpenAI are current
  providers and the provider **must be settable** — OQ-W9-3 RESOLVED; both
  adapters are v1 in T9.13, provider/model live on the agent profile, never
  hardcoded. (2) **Dedicated per-object agents**: an object may have its own
  agent and an admin changing that object is ALWAYS connected to it — new
  plan §4a (agent profiles + `agent-profiles` store + object → type →
  site-default resolution, stamped per run), runtime half in T9.13, roster/
  assignment UI + canvas Ask-AI re-point in NEW task **T9.26** (queued after
  T9.18, opus/medium). 26 briefs total now.
- **OQ-W9-1…8 await Wolf, minus resolved -3** (plan §11): ChatKit fate;
  runtime guardrail-override store vs commit-only (gates T9.15 — checkpoint
  mode); third visible tier; canonical-input retirement; unpublish stance;
  human-Principal-only chat; Owner force-checkin.
- Off-limits files untouched and stay so per the briefs
  (`admin-workflow-lock.ts`, `publish-article.ts`, article MCP tools —
  T9.22 re-points only their CALLER, closing W7.5).

## Session 2026-07-15 E (site seed resynced to production: scripts/sync-site-seed.mjs + a drift-guard test — the do-not-reconcile caveat is closed)

Wolf: "script for site-seed-data.mjs." Closed the last standing follow-up from
the palette incident — `site-seed-data.mjs` was stale on name / logo.text /
metadataDefaults (the live "Skincare" rebrand postdated the seed), so a
site-family reconcile would have rolled the live branding back to the seed.

- **`scripts/sync-site-seed.mjs`** (NEW): rewrites the seed's `siteBody` from
  the COMMITTED production export (`src/data/site/site.json`, the released
  materialization — no credentials, deterministic). MINIMAL diff: unchanged
  fields (brandTokens/urls/chrome/nav/blog) are kept verbatim in the seed's
  readable order; only the drifted fields take the export's value. `--check`
  mode reports drift and exits 1 (CI-friendly); default writes; idempotent.
- **Ran it**: name → "Dr. Lurié Skincare", logo.text → "DR. LURIÉ SKINCARE",
  metadataDefaults → the live titleTemplate + description. seed === production
  verified (order-independent). Seed header comment updated: it now tracks the
  released export via the sync script, not the original hardcoded literals.
- **Drift guard**: `site-seed.test.ts` gains a test asserting the seed
  deep-equals the committed export (fails with "run scripts/sync-site-seed.mjs"
  if they diverge) — exactly the check that would have caught the original
  drift. This closes the do-not-reconcile-the-site-family caveat Codex flagged;
  the site family is safe to reconcile again.
- Note: brandTokens is included in the sync for completeness, but the reconcile
  driver's site branch still EXCLUDES it (theme-only governance) — the palette
  heals via a theme apply, never the seed. Gates: 1294 + 57 green, check +
  build-diff clean/EMPTY.

## Session 2026-07-15 D (pdf-tool storage-grant provider: get_pdf_tool_storage_grant SHIPPED — stateless pdf-tool writes into OUR blob stores)

Task (Wolf): make Dr-Lurie the storage-grant provider for the now-stateless
pdf-tool — pdf-tool holds no blob credentials; agents fetch a short-lived
grant here and forward it per call. Not an object conversion; MCP-surface +
ops work only.

- **New MCP tool `get_pdf_tool_storage_grant`** (mcp.ts, behind the standard
  endpoint auth gate like every tool): returns the exact grant contract
  pdf-tool accepts — `grantVersion: 1`, `grantType: 'netlify-pat'`,
  `projectId: 'dr-lurie'`, `siteId`/`token` from env, the six-store mapping,
  `expiresAt` = now + 1h (advisory-but-enforced: pdf-tool rejects expired
  grants → agents re-fetch, never cache). Grant builder + canonical store
  list live in `netlify/lib/pdf-tool-storage-grant.ts`. Fails closed
  (`pdf_tool_storage_grant_not_configured`) until the env pair exists.
  Issuance logs are metadata-only — the token appears in no log and no
  stored record, proven by test.
- **Env pair (HUMAN STEP, not yet done):** `PDF_TOOL_STORAGE_TOKEN` (PAT of
  a dedicated Netlify machine account whose ONLY access is this site/team —
  leak blast radius = this one site) + `PDF_TOOL_STORAGE_SITE_ID`. Runbook
  with the machine-account steps, monthly-rotation and revocation procedure:
  `docs/agents/pdf-tool-storage-grant.md`. Rotation needs no pdf-tool
  change; the tool always serves current env values.
- **Stores:** grant hands out artifacts / artifact-index (shared with us) +
  pdf-templates / image-search / pdf-render-data / **pdf-tool-jobs (NEW —
  pdf-tool writes its job records there, giving us the full artifact-job
  audit trail in our own store)**. `scripts/provision-pdf-tool-stores.mjs`
  proves all six writable with the grant credentials (write→read→delete
  probe, prints no secrets) — run it after the env pair lands.
- **Agent rules** (README + `docs/agents/pdf-tool-artifacts.md`): fetch a
  grant before any storage-touching pdf-tool call and pass it as the
  `storage` argument; persist only returned ArtifactReferences — NEVER the
  grant/token; on "grant expired"/storage-auth error fetch fresh and retry
  once. The old doc's "don't add pdf-tool wrapper tools" rule stands — this
  is a credential provider, not a wrapper.
- **Future (designed for, NOT built):** `grantType: 'exchange'` — opaque
  short-lived token + server-to-server exchange endpoint so the PAT never
  transits agent context. Grant shape kept stable so it's a drop-in.
- **Tests:** 7 new (exact contract incl. key-set, TTL from injected clock,
  fail-closed × 3 env cases, no-token-in-logs, 401 without endpoint auth /
  grant with it, description teaches the three agent rules) + 2 pinning the
  provisioning script's store list to the contract. Suite 1300 + 59 green.

## Session 2026-07-15 C (Theme-only palette enforcement SHIPPED: brandTokens is grammar-locked out of set_site_fields; the privileged set_site_brand_tokens writer)

Wolf: "do the Theme-only enforcement now only." Built the enforcement half of
the 2026-07-15 B directive (the maker-agent restriction and human-approval pin
stay one-line config flips, deliberately not turned on).

- **The two-op grammar split (the set_product_fields ⇸ set_product_price
  precedent, applied to the site):**
  - `set_site_fields` now `superRefine`s `forbidKeys(['brandTokens'])` — a
    hand-written brandTokens patch is refused at the grammar (`invalid_op` →
    **400**), before any value reaches validation. The hole the 2026-07-13
    color-editing agent used is closed for safe AND unsafe values alike; the
    error points at `site_apply_theme`.
  - New privileged op `set_site_brand_tokens` (`fields: {brandTokens}` only) —
    the ONLY writer of the palette. `site_apply_theme` now emits it instead of
    `set_site_fields`; same deep-merge/exact-replace mechanics; the
    fields-capture inverse makes "revert the theme" a Discard, unchanged.
  - **CRITICAL (Codex P1 caught pre-merge):** the privileged op is NOT in the
    site agent-allowlist (`patchOpNamesByObjectType.site` stays
    `['set_site_fields']`). Unlike `set_product_price` (allowlisted, leans on
    the product review gate), `site` is AUTONOMOUS — an allowlisted palette op
    would let an agent hand-author `set_site_brand_tokens` via `object_patch`
    and skip the total-theme completeness check. So the op is applyable ONLY
    when a caller passes it as `privilegedOps` (new `applyPatchOps` /
    `HandleObjectVerbOptions` / `validateCandidatePatch` option): `site_apply_theme`
    passes it, `discardProposal` passes `PRIVILEGED_PATCH_OPS` (re-applying an
    already-authorized inverse), and a plain `object_patch` passes none →
    `op_not_applicable`. Guarded by tests at the engine and verb levels.
  - **SECOND P1 (Codex, same review):** `object_discard` forwards
    caller-supplied `entries` unverified, so granting discard the palette
    privilege let a forged `set_site_brand_tokens` entry (attacker-chosen
    `capture.before`) set an arbitrary palette. Fixed: `discardProposal` now
    verifies every privileged-op entry against the record's ACTUAL history
    (`deepEqualJson` on `details.op`+`details.capture`) before applying —
    a fabricated palette entry → 403 `discard_privileged_unverified`; a real
    one (from a genuine apply) reverts as before. Tested both ways.
  - `brand_token_values` / `theme_token_keys` CSS-safety criteria are
    body-keyed (object type `site`), so they gate the new op unchanged.
- **Contract:** site gains a `palette_theme_only` constraint (blocks_write)
  and advertises `set_site_brand_tokens` as tool-authored; `object_patch` /
  `site_apply_theme` MCP descriptions updated.
- **Reconcile driver:** the site branch now strips `brandTokens` from the
  `set_site_fields` diff — the driver never emits the palette (it would 400
  now); palette drift heals via a theme apply, not reconcile. (Reinforces the
  standing "don't reconcile the site family until the seed is updated" note —
  which is about name/logo/metadata, not the palette.)
- **Tests:** grammar refusal end-to-end (400 + message + a non-palette
  set_site_fields still 200); apply now emits + inverts set_site_brand_tokens;
  reconcile excludes brandTokens; contract advertises the op agent_authored:
  false. Suite 1288 + 57 green; check + build-diff EMPTY.
- **Still available as config flips (NOT turned on, per "enforcement only"):**
  maker-agent restriction on theme creation (`src/config/creation-policy.ts`),
  human-approval pin on theme/site (`src/config/approval-policy.ts`). Agent-
  approves-agent review remains unbuilt (M-6 approvals are human-only). The
  site seed (`site-seed-data.mjs`) was resynced to production 2026-07-15
  (`scripts/sync-site-seed.mjs` + a drift-guard test).

## Session 2026-07-15 B (Wolf's palette ruling: original restored via a REAL theme apply; theme-only governance directive logged)

Wolf: the 2026-07-13 teal/terracotta palette was "made by an agent which was
asked to change something in colors around" — NOT a sanctioned rebrand — and
"I actually need it returned to the original colors."

- **Restore executed (the apply verb's second real production run):**
  checkout site → `site_apply_theme` thm_drlurie_default (atomic op,
  content_revision 9, `applied_theme` in history, agent_name
  `wolf-ordered-palette-restore`) → validate clean → publish (`2f88ef6`) →
  checkin → release (production live on that commit, deploy ready
  10:35:46Z). The canonical palette is live; thm_drlurie_default's
  description ("applying is a no-op") is accurate again and the seed's
  brandTokens match production — the PALETTE follow-ups are closed. ⚠ But
  `site-seed-data.mjs` was RESYNCED to the live "Skincare" branding
  2026-07-15 via `scripts/sync-site-seed.mjs`, with a drift-guard test in
  site-seed.test.ts holding seed === production — the site family is safe to
  reconcile again (this closes the do-not-reconcile caveat Codex flagged).
- **New governance directive (Wolf, verbatim in intent), PENDING BUILD:**
  (1) "agents should only be able to change theme of the whole site not
  individual widgets and objects" — widgets already carry no color fields
  (rule 6); the remaining hole is DIRECT `set_site_fields` on
  `brandTokens` (exactly what the 2026-07-13 agent used) — close it so
  `site_apply_theme` is the only palette writer. (2) Theme workflow:
  a requesting agent asks; a MAKER agent creates (the W8.3b
  creation-policy override, e.g. `{theme: {agents: ['theme-maker']}}` —
  coordination-grade until OQ-3 credentials). (3) "an optional human
  approval required setting" — EXISTS: pin `theme`/`site` to
  require-approval in `src/config/approval-policy.ts` (one line, currently
  autonomous). Agent-approves-agent review is NOT built (M-6 approvals are
  human-only) — needs its own design if Wolf wants it literal.

## Session 2026-07-15 (W8.4 verb proofs — recipe family CONVERTED, 41 → 47; the "no-op" apply exposed live-palette drift, reverted byte-exact)

Wolf reset the MCP connector ("connection is reset. continue") — the fresh
registry exposed `object_instantiate_section_template` and
`site_apply_theme`, unblocking the four proofs deferred from Session E.

- **Stamp proofs (per-object, the W2.5 precedent):** dry*run in BOTH modes
  (standalone + page mode onto page_object_showcase) for EACH of the five
  `stpl*\*`records — 10/10`eligible: true`, zero blockers; deterministic
  minted section ids; PageType law / route uniqueness / placeability all
  exercised on the page-mode candidate patch.
- **Theme proofs:** `site_apply_theme` dry_run (computed exact-replace
  `set_site_fields` op, full token set, `brand_token_values` green), then
  ONE REAL apply under a site checkout — atomic op (content_revision 7),
  `applied_theme` in history, validate clean, publish (`ec2cbd3`), checkin,
  release (deploy ready 09:30:57Z). **Criterion 3 now holds for both types
  → recipe family CONVERTED, count 41 → 47.**
- **INCIDENT — the "no-op" premise was false:** production's brandTokens
  had been REBRANDED on 2026-07-13 (teal/terracotta palette + Source Serif
  heading font; site published at content_revision 6) AFTER the seed corpus
  was written, so the theme (authored from the SEED, verified against the
  seed by the W8.3 tests) reverted the live look. The wrong palette was live ~6 minutes
  (09:30:57–09:37:13Z); detected via the export diff; restored byte-exact by patching the pre-apply
  brandTokens back (`set_site_fields`, publish `eba0c42`, release).
  **Lesson: "byte-identical to production" claims must be checked against
  the LIVE record at apply time — the seed corpus is not production.**
- **Open follow-ups (Wolf's call):** (1) `thm_drlurie_default` no longer
  matches the live palette — update it to the 2026-07-13 rebrand (restores
  the "applying is a no-op" invariant) or keep it as the launch palette
  with corrected metadata; (2) `scripts/lib/site-seed-data.mjs` is stale vs
  production — a site-family reconcile run would "heal" the rebrand away;
  update the seed before any such run.
- Endpoint flakiness persisted (502s/timeouts); the verify-before-retry
  discipline held — every timed-out mutation had landed (incl. both site
  publishes and both releases). A post-reset harness quirk: one tool's
  approval died with a broken permission stream ("requires approval" on
  `object_inventory`); worked around with already-approved reads.
- Docs flipped in this change: CLAUDE.md (forty-seven + W8 CONVERTED
  paragraph with drift caveats), object-inventory (🟢 table, verb-proof
  record, follow-ups), conversion-map (🟢 marks, site-seed stale warning,
  W8 row), 09-plan (status header, §1 table, W8.4 row, RUN OUTCOME
  COMPLETE).

## Session 2026-07-14 E (W8.4 RUN — Wolf's go: recipe family RELEASED, not yet converted; the four application-verb production proofs are the open gate — first act of next session, then 41 → 47)

Wolf: "do W8.4" (after merging W8.3b as PR #442). Run executed via the
session MCP connection against production, strictly sequential ops.

- **Step 0 — tpl metadata backfill**: the 3 live `tpl_*` reconciled to the
  metadata-complete seeds via `reconcileOps` (one `set_template_meta`
  carrying description/whenToUse/scope + idempotent slot heals), then the
  FULL standing drill (all 4 template ops, probe slot in/out), validate
  clean, publish (rev 20: commits `8cbe103` / `6d228fb` / `ae8588c`),
  checkin. Exports content-identical to the W8.3b pre-materialization (only
  the `__generated` stamp moved). `object_instantiate_template` dry_run
  re-proven ×3 — incl. tpl_legal's blueprint-less required slot filling
  from prose registry defaultData.
- **Six creations**: 5 `stpl_*` + `thm_drlurie_default` created
  (`agent_name: w84-conversion-run`), every permitted patch op drilled with
  exact inverses (stpl: set_section_template_meta / update_blueprint_data /
  replace_blueprint; thm: set_theme_fields), validated clean at publish
  level (blueprint_standalone_renderable, theme_token_keys,
  brand_token_values, recipe_metadata all green), published (commits
  `b554133` / `a69ffeb` / `6ce0f8c` / `ac970a3` / `6e8eb1c` / `815de2a`),
  checked in. First-ever `src/data/site/section-templates/` and
  `src/data/site/themes/` exports.
- **Released**: production deploy for `6e8eb1c` (all 9 exports) `ready` at
  2026-07-14T16:23:38Z. store === seed === export verified byte-level
  (script compare, modulo `__generated`).
- **Contracts + index proven live**: section_template/theme contracts serve
  exactly the drilled ops, the W8 constraints, `creation_policy`, and the
  REUSE-FIRST opener; `object_inventory` rows carry full recipe summaries
  (the W8.3b index working in production with real data).
- **THE OPEN CONVERSION GATE — application-verb production proofs**: the
  session's MCP tool snapshot predated the W8 deploys, so
  `object_instantiate_section_template` and `site_apply_theme` were NOT
  callable from this session (Wolf refreshed the connector mid-run; the
  harness snapshot is session-static — confirmed by subagent probe; raw
  HTTPS to the endpoint is blocked by the container network policy). Per
  playbook criterion 3 and the W2.5 template precedent (instantiate proven
  in production before the flip), the family therefore stays **RELEASED,
  not converted** — inventory/map marks are 🔵, CLAUDE.md count stays 41.
  The proofs (stamp dry_run in BOTH modes for EACH of the 5 stpl records —
  per-object conversion, the W2.5 one-proof-per-template precedent; apply
  dry_run + ONE real no-op default apply + site publish + release) are the
  FIRST ACT of the next session; on green, flip the marks 🟢, count
  41 → 47. Both
  verbs are deployed, contract-advertised, and verb-level-tested in the
  merged suite.
- **Ops lessons (endpoint was flaky — 502s + 60s connector timeouts all
  run)**: a timed-out `object_checkout` usually DID take the lock
  server-side with a token never delivered — the lock is unreclaimable
  until lease expiry (~15 min); park the object and work another. NEVER
  blind-retry a mutating call: verify with `object_inventory` detail
  (publish receipt / lock / unpublished_changes) first — every timed-out
  create/patch/publish in this run had actually landed.
- Docs updated in this change (RELEASED framing, per the Codex-flagged
  no-half-measures call): object-inventory (W8 section → RELEASED table 🔵
  - tpl backfill note), conversion-map (🔵 marks + W8 row with the open
    gate), CLAUDE.md (count stays forty-one + "6 RELEASED pending proofs"),
    09-plan (status header, W8.4 row, tpl caveat RESOLVED). `tpl_fieldtest`
    stays trio-less (fieldtest family) — patching it 422s until backfilled
    or retired.

## Session 2026-07-14 D (W8.3b BUILT: recipe metadata + creation-policy seam + reuse-first surfacing — NOT converted; W8.4 awaits Wolf's go, now with a tpl backfill Step 0)

Wolf: recipes must be self-explaining in JSON ("what it is, whether it is for
a project that is one off or it has a strategy"); template creation must be
restrictable to some agents ("this dev is for later but the ability can be
inserted now"); agents should reuse existing templates, with well-described
types/use cases to lower AI cost. Decisions (AskUserQuestion): metadata on
ALL THREE recipe types uniformly; minimums REQUIRED TO PUBLISH (drafts warn;
the 3 live tpl\_\* get backfilled at W8.4); restriction = committed-config
seam, default open. Push-back accepted: the AI-cost pattern is
INDEX-THEN-FETCH, not "provide all context" — a one-line-per-recipe index in
`object_inventory`, then `object_get` only the chosen one.

- **Recipe metadata (09 §W8.3b brief)**: shared `recipe-metadata-v1.ts` —
  `description` / `whenToUse` / `scope: 'evergreen' | 'one_off'` spread into
  template.v1 + section_template.v1 + theme.v1 (page templates had NO
  description field before this). Schema-optional (additive: production
  records keep parsing), publish-gated by the shared `checkRecipeMetadata`
  criterion (`recipe_metadata`; empty-after-trim = missing). Zero new patch
  ops — the existing meta/fields ops carry the trio. All 9 seeds are
  metadata-complete; the 3 committed tpl exports were hand-updated with the
  same trio (pre-materializing the W8.4 backfill byte-identically — keeps
  seed-objects-enforcement green at publish level). INTERIM CAVEAT: until
  the backfill, patching a live tpl\_\* without adding the trio 422s.
- **Creation-policy seam**: `src/config/creation-policy.ts` +
  `src/lib/creation-policy.ts` (approval-policy twin; per-type
  `'open' | {agents}`, humans always, DEFAULT FULLY OPEN — nothing is
  restricted today). Enforced at the top of `create` (recursion-proof) with
  dry_run-honest pre-checks in create_variant/instantiate/
  instantiate_section-standalone; keys on the CREATED type (instantiate →
  page; standalone stamp → section; page-mode stamping + apply_theme are
  patches, ungated — test-pinned). 403 `creation_restricted` names the
  allowlist and points at reuse. Surfaced on every contract as
  `creation_policy`. ⚠️ Documented honestly: agent_name is self-declared
  until OQ-3 — coordination seam, not security.
- **Reuse-first surfacing**: `object_inventory` recipe rows carry a
  defensive body-derived `recipe` summary (name/scope/description/
  when_to_use + blueprint_type | applies_to + slot_count); the three recipe
  contracts open with a REUSE-FIRST workflow step; every one of the 19
  section components gained an `editor.useWhen` one-liner (auto-served via
  contract section_types + registry_get); tool descriptions updated
  (object_inventory / object_contract / object_create).
- **Reconcile machinery**: `TEMPLATE_META_KEYS` gained the trio (this IS the
  W8.4 backfill mechanism — ensure heals the live records to the enriched
  seeds); the previously missing `section_template` + `theme` reconcile
  branches were added (they would have crashed on drifted records).
- **Suite: 1,343 tests green** (new: recipe-metadata schema/criterion/
  pipeline per type; creation-policy resolution + verb-level 403s incl.
  recursion and page-mode-ungated pins; inventory summaries incl. malformed
  bodies; contract/useWhen/REUSE-FIRST pins; publish-level seed tightening;
  reconcile heal tests). `npm run check` 0 errors; build-diff EMPTY.
- **Still open: W8.4** (human_gate, unchanged in gate) — now begins with
  Step 0: the tpl metadata backfill via the templates-seeds driver run, then
  the stpl/thm creation run as planned. OQ-W8-1…4 remain checkpoints.

## Session 2026-07-14 C (W8.1–W8.3 BUILT + MERGED: section_template + instantiate verbs + blueprintRef + theme + site_apply_theme + token safety — NOT converted; W8.4 awaits Wolf's go)

Wolf: "check if anything blocks this, including the latest commit. If nothing
does merge and continue along this plan." Nothing blocked; the 09 design PR
(#436) merged, then all three normal-mode build phases were built, reviewed,
and merged the same day — each its own PR, each gated on the full suite +
`astro check` 0 + build-diff EMPTY. **Nothing is CONVERTED: no store records
exist for the new types; every inventory/conversion-map mark stays ⚪/🔴 until
the human-gated W8.4 credentialed run.**

- **W8.1 (PR #437, `6198748`)** — `section_template` is the TENTH governed
  object type end-to-end (schema/ids/3 ops with exact inverses incl.
  server-minted `blueprint.id`/validation/contract/materializer/policy/
  collection/Ask-AI/drill) + five self-contained starter seeds
  (`scripts/lib/section-templates-seed-data.mjs`). The Session-K leaf gap is
  CLOSED at write time via one shared predicate
  (`isStandalonePlaceableSectionType`): a standalone `card` on a page or in a
  shared-section wrapper (or a wrapper wrapping a `shared_ref`) is now a
  blocks_write failure; `cards`-source grid cells untouched; the committed
  21-section showcase export pinned green.
- **W8.2 (PR #439, `cf6d339`)** — `object_instantiate_section_template`:
  page mode = ONE `upsert_section` through the standard patch path under the
  CALLER'S checkout (fresh deterministic `s_*` id per (recipe, page,
  version); `instantiated_from` provenance in history; exact inverse; "law
  beats recipe" pinned — a hero recipe into a `listing` page is a 422);
  standalone mode = a new `sec_*` via the create path. `templateSlot` gained
  `blueprintRef` (mutually exclusive with inline blueprint; deref +
  deep-copy at instantiation ONLY; live existence + type-in-allowed checks
  via the new `resolveSectionTemplateType` resolver). Codex review fixes
  folded in: dry_run needs no checkout fields; blueprintRef types re-checked
  at the live instantiation point (a re-blueprinted recipe can't smuggle a
  disallowed type); honest retry semantics (409 carries
  `section_id_for_expected_version` for lost-response recovery). Fix found
  en route: both endpoints now derive the validation-context self ref from
  `target.page_id` too (route uniqueness would have flagged the target
  page's own route).
- **W8.3 (PR #440, `9bbba9c`)** — `theme` is the ELEVENTH governed type
  (`theme.v1`; `brandTokensSchema` extracted from site.v1 and SHARED;
  `set_theme_fields`; `thm_drlurie_default` seed importing the site seed's
  tokens — byte-identical to production). `site_apply_theme` verb + MCP
  tool: ONE exact-replace `set_site_fields` op (stale color keys explicitly
  unset) under the caller's site checkout; `applied_theme` provenance;
  revert = standard Discard; dry_run needs no checkout; an INCOMPLETE theme
  is not appliable (Codex review fix — applying it would delete consumed
  keys). **The §7.3 token-injection gap is CLOSED**: a shared safe-CSS
  grammar (`src/lib/registry/theme-tokens.ts`) now gates `set_theme_fields`
  AND `set_site_fields` (values with `;{}<>`, `url(`, `@import` rejected);
  CustomStyles refactored onto the shared key/fallback registry,
  byte-identical (build-diff EMPTY vs main).
- **Suite: 1,320 tests green** (was 1,236 pre-wave); every phase also passed
  `npm run check` (0 errors) and `scripts/build-diff.mjs` EMPTY.
- **Still open: W8.4 (human_gate — Wolf's explicit go required)**: the
  credentialed production conversion run per 09 §9 — create the 5 `stpl_*` +
  `thm_drlurie_default`, drill every permitted op sequentially, publish,
  release; prove `object_instantiate_section_template` by dry_run (both
  modes) and `site_apply_theme` by dry_run + ONE real no-op apply of the
  default theme; flip inventory/conversion-map/CLAUDE.md counts to CONVERTED
  in the same change. Also open per 09: OQ-W8-1…4 (composite sections,
  checkpoint) and the optional palette-derivation backlog slice.

## Session 2026-07-14 B (ADMIN MENU → main nav (MCP-editable, admin-gated); /object-showcase content-state variants; the stale-deploy incident FIXED)

Wolf: "make me a page object with every possible existing object … Move the
admin menu to the nav_header main menu … show if admin is logged in … Add a
link to this page … This should actually happen through the MCP server too.
Can it?" Plus a deploy incident: after the legacy wipe, production still
showed the old posts at /learn/library/4.

- **Stale-deploy incident — root-caused + FIXED.** Git/build were correct
  (wiped `main` builds 68 pages, 2 library pages, zero old posts — proven
  locally); production was serving a **pre-wipe deploy** because the earlier
  `release_to_production` calls timed out client-side before confirming.
  Re-fired the release → `released:true`, production live on `3c9debea`. Old
  posts gone. (Auto-publish was NOT locked; the tool's client 60s timeout was
  the culprit — verify releases via `deploy_status`, not the call return.)
- **Admin menu is now a main-nav group, MCP-editable, admin-gated** — answering
  "can MCP do it?": **the contents can, once a one-time code change lands.**
  - Code (PR #435, merged `3c9debea`): `adminOnly` flag added to the navigation
    schema (`NavItem` + `NavGroup`, M-9); the transform carries it only when
    set (existing navs byte-identical); `Header.astro` renders an `adminOnly`
    group's `<li>` with `data-admin-only hidden`; the header-auth script reveals
    every `[data-admin-only]` element site-wide when the visitor is a signed-in
    admin. The admin links were **removed from the account dropdown** — it is
    now just login/account (Wolf's "old admin = a login state"). Build 68 pages,
    nav/patch/schema suites 218+100 green, adapter test 8/8.
  - MCP (after the schema deployed): added a `g_admin` group to `nav_header`
    (`adminOnly:true`, route-kind items — Dashboard/Publish/Drafts/Library/AI
    Publisher/Blob Store **+ Object Showcase**), published `9bdc2764`. The admin
    menu's structure/content is now store-backed and editable via `object_patch`
    — no longer a hardcoded JS array.
- **`/object-showcase` expanded via MCP** (no git commit for the page): +16
  content-state variant sections (37 total) — each block in minimal / short /
  one-line text and image none/one/two states, in a labeled "Variants" cluster
  below the full versions, so edge cases (missing-image fallbacks, bare
  headings, single-item lists) are visible for QA. Published `03173c7c`.
- **One release** deployed the admin group + showcase together — deploy
  `6a561a09…` ready 11:15Z, `deploy_status` confirmed production reflects
  `03173c7c`. The admin dropdown is LIVE for signed-in admins.
- **MCP reachability note (Wolf's "good exercise"):** all 10 governed types are
  fully MCP-reachable (create/checkout/patch/publish + typed ops + contract).
  The gap this session closed: the admin menu was **chrome hardcoded in JS**,
  not an object — now it's a `nav_header` group. Remaining hardcoded chrome to
  audit if wanted: login-modal copy, some 404/system strings.
- **Standalone-`card` validation gap (logged Session K) is CLOSED** by W8.1's
  leaf-section validation fix (#437, `6198748`) — a leaf-only section placed
  directly on a page is now rejected at write time.

## Session 2026-07-14 A (W8 PLANNED: template-system expansion — section templates, page-template composition, theme presets; docs only, no code, nothing converted)

Wolf asked where templates stand and mandated "at least two types of
templates: page template and section template," with the division of labor
"the code dictates what functionality, options exist and what amount …
template decides object position within section. CSS stuff stays with site."
Recon confirmed page templates already exist and are CONVERTED-but-dormant
(W2.5, zero instantiations) and every section is already uniform JSON through
one registry — the gaps were section-level recipes and any recipe treatment
for site CSS tokens. Wolf's four decisions (recorded in 09 §0): section
templates STAGED (recipes over the existing coded types now; composable
"composite" sections SPEC-ONLY, gated on OQ-W8-1…4); deliverable = plan doc +
per-phase briefs; theme presets IN scope (settled: theming is NOT taxonomy —
it's a recipe); push the design branch, no PR.

- **[`09-template-system-plan.md`](../09-template-system-plan.md) written**
  (the 06/08 convention: one plan doc, embedded W8.1–W8.4 briefs). The
  architecture: the **recipe family** completes design-principles rule 5 —
  `template → page` (exists), `section_template → section` (NEW, tenth type:
  `{name, description?, blueprint: sectionInstance}`, 3 ops with inverses,
  `object_instantiate_section_template` stamping into a page under the
  caller's lock or minting a standalone `sec_*`; 5 planned seeds), `theme →
site.brandTokens` (NEW, eleventh type: `set_theme_fields` +
  `site_apply_theme` computing ONE exact-replace `set_site_fields` op with
  stale-key unsets). Page templates gain slot-level `blueprintRef` →
  section_template (deref + deep-copy at instantiation only). Provenance
  decisions recorded: no schema-level provenance on section instances and no
  `site.theme` field — history carries attribution.
- **Design-principles rule 6 added (GOVERNING)**: layout is bounded data,
  never free-form style — components expose enumerated layout fields, agents
  select values, no CSS/class names in schema ever. Rule 5 extended to the
  recipe family.
- **Two live gaps scheduled into the wave**: the Session-K standalone-`card`
  validation gap (fix in W8.1 via the new shared
  `isStandalonePlaceableSectionType` helper, also used for stpl blueprints)
  and a NEW finding — brand-token values flow **unvalidated** from
  `set_site_fields` into CustomStyles' inline `<style>` (value-safety grammar
  closes it for both `site` and `theme` in W8.3, alongside a byte-identical
  CustomStyles refactor onto a shared `theme-tokens.ts` key registry).
- **Docs updated in the same change**: conversion-map (⚪ SECTION TEMPLATES +
  ⚪ THEMES nodes, W8 wave row), object-inventory ("Planned (W8)" block —
  🔴 TODO, nothing overstated), 05-task-breakdown addendum (OQ-4 stays
  rejected; T6.2 editor leftover descoped; W8 OQs live wave-locally in 09),
  design-principles (rule 6 + rule-5 extension).
- **Nothing built, nothing converted**: no code, no store writes, no schema
  changes. The converted count stays 41. W8.1–W8.3 are normal build sessions;
  W8.4 is the human-gated credentialed run — both new types flip to CONVERTED
  only when all five playbook criteria hold there.

## Session 2026-07-13 K (CREDENTIALED CORPUS RUN: the ten-article content_item corpus is CONVERTED + LIVE; `page_article` gets a related grid; `/object-showcase` QA page built)

Follows Session J (the wipe + seed). Wolf: "Related-grid options do them …
[the corpus] needs to be rewritten" and, separately, "make me a page object
with every possible existing object added to it … one below another … Let's
call it /object_list or something technical so it never gets wired in." Both
executed this session over the live session MCP connection (fighting
intermittent api.anthropic.com 502s — publishes/checkins frequently applied
server-side despite a client-side 60s timeout, so every step was verified via
`object_inventory` rather than trusted from the call return).

- **Ten-article corpus CONVERTED.** All 10 `req_agent_*_20260713_01` articles
  (skin_barrier_basics, reactive_skin, minimal_routine, reading_labels,
  skin_after_40, retinoids_after_40, niacinamide, sunscreen, ten_step_myth,
  not_self_worth) created in the production store, validated clean, and
  published (export commits accumulate on main with `[skip netlify]`; last
  publish `514cb778` = retinoids_after_40). Parallel `object_create` overwhelmed
  the gateway (1 of 4 landed) → switched to strictly sequential; that held.
  Each is a real record `object_inventory` returns, `unpublished_changes:false`,
  Tier-1 autonomous. All five conversion criteria hold per article.
- **`page_article` related grid.** Added a `content_grid` section
  (`s_related`, `source:{kind:"related",algorithm:"tag_similarity"}`, `limit:3`,
  `columns:3`, heading "More to read") at position 0 of `page_article`
  (`content_detail`, publishes autonomously — the pageType review policy gates
  only human-executed publishes). Dry-run clean → checkout → patch → publish
  (`c69b5cfa`) → checkin. Every article now renders a selectable "More to read"
  tile block (Slice D options apply to it).
- **Single release.** `release_to_production` fired once (client timed out at
  60s; the build hook POSTed server-side) — deploy `6a553f5260cc650008f4363b`
  for `c69b5cfa` reached **ready** (finished 19:42:06Z), confirmed via
  `deploy_status`. Production now reflects: 10 corpus articles + the demo
  article + the `page_article` grid + `/object-showcase`, all in one build.
- **`/object-showcase` QA page built** (`page_object_showcase`, route
  `/object-showcase`, `pageType:standard`, `seo.robots.index:false` — a
  technical surface deliberately not wired into any nav). 21 sections, one
  below another, every placeable section type populated with throwaway data so
  each block can be hovered and canvas-tested for bugs one by one. Store-backed,
  published (export `fa2abbdb`), released.
  - **VALIDATION-GAP FINDING (logged, not yet fixed): a standalone `card`
    section passes `object_validate` but breaks the production build.** The
    first showcase build failed (exit 2, "No component registered for section
    type 'card'"): `card` is a grid _leaf_ (rendered only inside a
    `content_grid` via its `cards` source) and has no standalone component, yet
    validation admitted it as a top-level page section. Fixed the page by
    replacing the standalone `s_card` with an `s_cards` `content_grid`
    (`source.kind:"cards"`), re-published, re-released (green). The engine gap
    stands: `validateObject` should reject a leaf-only section type placed
    directly on a page, at patch/create time, the same way it already blocks
    disallowed section types. Candidate follow-up (own task) — not bundled here.

- **Docs**: this entry; `object-inventory.md` articles section flipped to record
  the corpus + related grid + the showcase QA surface + the wipe truth-up;
  `conversion-map.md` article count updated. No code in this PR — the conversion
  itself lives in the production store + the export commits already on main.

## Session 2026-07-13 J (LEGACY WIPE: 83 smoke-test .md posts deleted; ten-article content_item corpus seeded — awaiting the credentialed run)

Wolf: "Old legacy articles can actually be wiped if it helps. I say wipe it.
Perhaps we can convert up to ten for testing to the new schema. … you be the
judge. It doesn't really matter. needs to be rewritten. GitHub needs to be
cleaned too then." Recon confirmed the 83 `src/data/post/*.md` were
smoke-test/SEO filler ("smoke-test article" literally in the excerpts; only
10 even carried a category) — so this is a rewrite, not a migration.

- **All 83 .md deleted** (`git rm`); a `.gitkeep` keeps the `post` collection
  glob base. No page/section export or component referenced any post slug
  (verified: no manual-grid picks, no content_embed, no hardcoded slugs) — the
  deletion is reference-safe. The `post` collection is now permanently empty;
  `load()` in utils/blog.ts guards the read (`.catch(() => [])`) and Astro logs
  a benign "collection 'post' … is empty" line (same class as the pre-seed
  articleObject warning) — build unaffected.
- **Ten-article corpus** (`scripts/lib/articles-corpus-seed-data.mjs`): genuine
  content_item articles, TWO per registry category
  (skin-health / skincare / skin-after-40 / ingredients / reflections), fresh
  slugs, full annotation layer (PAS-ish arc of hook→…→recommendation; a couple
  carry node-wired claims). All 10 bodies validate against the live
  content_item schema; taxonomy uses registry slugs only.
- **Local full-state build proven**: the 10 exports materialized to
  `src/data/site/articles/` + the demo = 11 articles → build 67 pages, all 5
  category pages, 12 tag pages, the topics hub, and RSS (11 items) render; then
  the temp exports were REMOVED (they must arrive store-backed via the run, not
  committed). Committed-state build (demo only) = 37 pages, green.
- **Gates**: 1210 + 49 tests green · astro check 0 · eslint/prettier clean.
- **Status: DELETION + SEED READY, corpus NOT yet converted.** Next: merge +
  deploy this PR, then the credentialed run —
  `create → publish → release` each of the 10 content_item objects (fresh
  slugs = no collision with anything), plus add a `related` content_grid to
  `page_article` so the article "other articles" block becomes a selectable
  tile (Slice D options apply). Records flip to CONVERTED after the run. Brief
  pre-launch window between deploy and run where the blog shows only the demo
  article — acceptable behind the SITE_NOT_YET_LIVE gate.

## Session 2026-07-13 I (CANVAS Slice D: related-grid options — random/tiles/columns — + save-button dirty state)

Wolf: "Related-grid options do them. and also buttons like save draft need to
show have inactive state when there's nothing to save. After save 'Saved'
should appear for a relatively short time and then button should become
inactive." (07-canvas §3k.)

- **`random` algorithm**: deterministic seeded shuffle
  (src/utils/seeded-shuffle.ts, pure + unit-tested — same seed → same order,
  no build-diff churn; seeded by the anchor post, salt otherwise). Wired
  through schema → resolver (section-resolve-deps) → chip dropdown.
- **Tiles + columns**: content_grid gains optional `columns` (1–4, default 2
  → byte-identical unset; ContentGrid.astro uses literal grid-cols classes so
  Tailwind JIT emits them). The related chip grows inline `tiles` (limit) +
  `columns` steppers next to the algorithm dropdown; all three patch
  update_section_data (applyRelated, key-stable deep-merge). Annotations
  emit -limit/-columns alongside -algorithm.
- **Save-button dirty state**: disabled when the form matches the last-saved
  baseline; enabled on edit; "✓ Saved" briefly then re-baseline → disabled.
  One serializer + delegated input/change listener over edit/image/role/nav
  forms.
- **Gates**: 1210 + 49 tests (seeded-shuffle determinism/permutation/purity;
  annotations emit tile+columns) · astro check 0 · eslint/prettier clean ·
  **build-diff EMPTY (174/174 identical — columns default is byte-identical)**
  · **13-assertion Slice-D drive** (pristine-disabled → edit-enabled →
  revert-disabled → Saving…/Saved/disabled + one update_node; Random in the
  dropdown; tiles/columns steppers show current values and patch
  limit/columns/source.algorithm) + the A/B/C drives re-run green.

## Session 2026-07-13 H (CANVAS Slice C: delete on every tile + glass restyle + right-rail anchor + tile→accordion morph)

Wolf's third field-test round, same session: the tile becomes an interaction
system (07-canvas §3j).

- **Delete everywhere** (rightmost trash on every tile; chrome excepted):
  nodes → remove_node; sections incl. shared_refs → remove_section on the
  HOST page (a shared delete removes the reference, never the sec\_\*
  object). Always behind a confirmation modal; lands as a draft; region
  disappears in place; tray phrases it.
- **Glass tiles**: near-transparent blur surface, full-contrast content.
- **Right rail**: tile just right of the content column, top-aligned with
  the block's heading — clear of the "+" gaps. Drive found + fixed a real
  z-order bug: the anchored panel intercepted clicks on a neighboring
  block's tile (chip now stacks above the panel).
- **Tile → accordion morph** (the container-transform idiom): the panel
  opens in place of the tile, absolutely anchored and top-aligned with its
  object, FLIP-animated out of the tile's box (reduced-motion safe; mobile
  keeps the bottom sheet); tool presses switch sections in place. Universal
  across all target kinds by construction.
- **Gates**: 1205 + 49 tests · astro check 0 · eslint/prettier clean ·
  build 173 pages · 15-assertion Slice-C drive (glass alpha; rail x/y
  alignment to the pixel; trash rightmost; confirm modal semantics; cancel
  sends nothing; remove_node wire; in-place disappearance; anchored panel
  top == tile top; tool-switch stability) + Slice A/B and W7.7 drives
  re-run green. Screenshots delivered to Wolf.

## Session 2026-07-13 G (CANVAS Slice B: second field-test round — preload, human tray, image placeholders, button states, bullets)

Wolf's second live round (screenshots) + three rulings: **W7.7 remainder ON
HOLD** ("that UI is stale now. I need to rethink what the admin area is
supposed to be like" — no TipTap panel or /admin/publish re-wire until his
ruling); **metadata row = category + tags**; the rest shipped same-day
(07-canvas §3i):

- Metadata row: category + tag links on every article header (both
  families, registry labels).
- Record cache + preload (pay the wait up front): edit-mode entry warms one
  get per visible object; chips/panels/tray/role editor open from memory;
  writes invalidate; failures don't stick.
- Pending tray humanized — "object · verb · location": object TITLE + a
  history-derived summary of unpublished ops ("Image added to Resolution",
  "Text edited in Hook · +1 more"); req\_\* ids demoted to tooltips.
- Chip identity is the ROLE alone ("Hook · educate") — "article content"
  boilerplate dropped from chip and panel header.
- Image tool: thumbnails never show the broken-image glyph (load-gated +
  neutral placeholder); a NEW image previews in place as an appended figure
  on save; an emptied src removes its element.
- Buttons: Save draft on the accent token (green was off-palette), full
  hover/active/focus-visible/disabled states, "Saving…" in flight +
  "✓ Saved" confirmation (restores on failure) — saveForm/roleForm/navForm.
- Bullets (the "lists dropped, not editable" report): items[] is ALWAYS
  offered on content blocks ("Bullet points", one per line) — the gap was
  that the form only listed EXISTING fields, so a text block could never
  gain a list; lists now also preview in place on save. Editor-facing field
  labels throughout (Text/Heading/Kicker/Button text…).
- **Gates**: 1205 + 49 tests green · astro check 0 · eslint/prettier clean ·
  build 173 pages · **15-assertion Slice-B drive** on the built demo page
  (metadata links; warm-cache proof — zero re-fetch before first save;
  tray title + "Text edited in Hook · +1 more"; placeholder-not-broken;
  accent save button; Saving…/Saved states; items wire + in-place <ul>) +
  the 19-assertion W7.7 drive and 16-assertion Slice-A drive re-run green
  (probe export recreated for the run, then removed).

## Session 2026-07-13 F (W7.7 CANVAS CAPABILITY SLICE: node palette + adSlot mockup bank + role panel + multi-image; upsert_node id-mint gap fixed)

Same session as E, on Wolf's "continue to W7.7". The article body is now
COMPOSABLE from the canvas — full doc: 07-canvas-editing.md §3h.

- **Node palette** (`nodes-palette.ts`, pure + tested): "+" before/between/
  after blocks ("Add an article block" — req\_\* ids banned from UI copy) →
  nine schema-valid starters, each annotated from birth: Text, Heading+text,
  Checklist, Image, Image gallery, CTA, **Offer/affiliate** (disclosure +
  nofollow-sponsored pre-filled), **Ad slot (mock)**, Chat invite. Insert =
  `upsert_node` at a record-derived position, server-minted id, honest draft
  placeholder.
- **SERVER GAP FOUND + FIXED**: `mintOpsIds` never handled `upsert_node`
  though the contract advertised `minted_id_field: node.id` since W7.3 (the
  W7.9 drill's probe carried an explicit id, so it never fired). Id-less
  upsert*node now mints `n*<hex>` (leak-safe by construction) + test.
- **adSlot MOCKUP BANK** (Wolf: "make them look real like served by google
  or a native ads provider"): native in-feed / leaderboard / med-rectangle,
  rendered ONLY for `adSlot.provider:'mock'` (real providers still render
  nothing — mockups never fake live inventory), honestly labeled
  Advertisement/Sponsored + Ad chip, fictional advertiser, no external
  assets, copy overridable per node, creative switched via
  `commercial.creativeId`. Screenshots delivered to Wolf.
- **ROLE & INTENT PANEL**: fourth accordion section (article blocks only) —
  strategy (12) + intent (5) dropdowns + agent notes → `update_node` on
  `private` fields; '' clears (null); chip/header roles refresh (cache
  invalidated). The semantic layer is human-editable — was JSON-only.
- **MULTI-IMAGE** (Wolf-approved): `public.images[]` on content nodes (full
  media objects, rendered as figures in order); image tool grows the gallery
  ("Add image"; empty src removes on save); one-image-per-node stays the
  norm.
- **Gates**: 1205 + 49 tests green (nodes-palette starters validated against
  the REAL node schema + render; ad bank + gallery render tests; the
  upsert_node mint test) · astro check 0 · eslint/prettier clean · build 173
  pages (probe export used for verification, then removed) · **19-assertion
  headless-Chromium drive on the built probe page** (3 ad units + gallery +
  offer + chat render; node gaps; palette wire: upsert_node id-less at
  position 0 → minted placeholder; role editor: hook→proof +
  agentNotes wire + header refresh; gallery rows + Add image + uploads) +
  the 16-assertion Slice-A drive re-run green.
- **Still open in W7.7**: TipTap/rich-text DOCUMENT editing in the panel,
  the /admin/publish re-wire decision (reduced by the legacy-wipe ruling),
  bugs ⑥⑩. NOTE the schema-vintage gate: canvas inserts against production
  need this merged + deployed first.

## Session 2026-07-13 E (CANVAS Slice A: six field-test fixes from Wolf's first live article-canvas session)

Wolf field-tested the canvas on /object-model-demo and filed the first live
feedback (screenshots). Slice A = the six small fixes, shipped same-day; the
structural asks are queued as W7.7 (node palette incl. commercial
blocks + adSlot mockup bank + annotation panel; multi-image block approved)
and the related-grid options slice (manual/random/latest + tile counts).
Wolf's UI rule recorded in 07 §3g: **on-screen information must be what an
editor needs at the moment of action** — a req\_\* id is worthless there; the
block's marketing role is the point. Also ruled: the 83 legacy posts get
WIPED after ~10 are converted as test corpus (own session; no git-history
rewrite), pending Wolf's keeper shortlist.

- **Role chips**: article-block chip + panel header show `Hook · educate`
  instead of the object id — roles read from the draft record (cached fetch;
  the leak rule keeps strategy out of built HTML, so the DOM can't carry it).
- **Image ADD on nodes**: media-less content nodes get src/alt + Upload rows;
  save seeds `{type:'image'}` (content_item only). Before: dead-end "no
  image fields".
- **Panel content-sized** (was pinned to viewport bottom = "opens to max");
  log/form bodies capped + scroll internally.
- **Busy dots** on every wait; send disabled in flight.
- **CTA button**: `not-prose` + `font-sans` — prose-a color had made the
  label invisible (teal-on-teal) and the serif leaked; render-nodes test pins
  the new classes.
- **Print/share under ClientRouter**: re-wire on `astro:page-load`
  (data-wired guard) — swapped-in article pages had dead buttons.
- **Gates**: 1198 + 49 tests green · astro check 0 · build 173 pages ·
  eslint/prettier clean · **16/16-assertion headless-Chromium drive of the
  built site** (mocked admin endpoints): print/share AFTER a view-transition
  nav, CTA computed white-on-teal in Inter, chip/header role text with no
  req\_\* anywhere, media.src/alt + Upload on an empty node, busy dots
  visible-in-flight → removed after reply + send re-enabled, panel bottom
  edge 421/900.

## Session 2026-07-13 D (W7.9 CREDENTIALED RUN: content_item is CONVERTED — the first article object is LIVE with node chips; OQ-W7-1 resolved)

Wolf: "Nothing allows me to see article elements with node chips and edit
options — finish what's opened, recheck W7.8, make sure the MCP connections
are updated … the end goal is to have articles and article publishing
converted from old schema to the new project-wide schema without losing
functionality. Reverse support is not required." Root cause of "nothing to
see" confirmed first: `object_inventory {content_item}` returned **empty** —
the W7.8 canvas machinery was built and merged but had no article to act on
(W7.9 had never run). This session ran it, op-by-op over the session's live
MCP connection (the same verbs the driver calls):

- **MCP endpoint check**: ping OK; `object_contract('content_item')` serves
  the full W7.3 contract (all six node ops advertised, create_variant in the
  workflow, Tier-1 autonomous publish) — the deployed server needed no
  update; only the store record was missing.
- **SEED BUG found + fixed (the run's one surprise)**: `object_create` was
  blocked by `article_taxonomy` — the seed's `skin-science` category doesn't
  exist in the production `tax_drlurie` registry (it's a TAG there) and
  `skincare-education` exists nowhere. The local rehearsal couldn't catch it:
  the check is registry-gated and the isolated local store has no registry.
  Seed now carries `reflections`/`reflections` (playbook reality-check gained
  the trap note). Store ≡ seed ≡ export holds.
- **The run**: create `req_agent_object_model_demo_20260713_01` → checkout →
  ONE batch patch drilling all six ops (set_article_meta ×2, upsert_node,
  update_node on copy AND `private.strategy` hook→summary, set_node_visibility,
  move_node ×2, remove_node) ending **byte-identical** (history carries every
  exact-inverse capture; the client timed out mid-patch but the server had
  applied — object_get confirmed before proceeding) → validate: eligible,
  zero blockers (slug unique across the 83 committed posts) →
  `create_variant` dry-run: eligible, node ids re-minted, claims node_ids
  re-pointed, lineage set, nothing persisted → publish: export commit
  `60cd213` (`src/data/site/articles/…01.json`) → checkin → inventory returns
  it (published_content_revision 10, no unpublished changes) → release:
  build fired once, confirmed `released: true`, deploy `6a54cf0d…` ready at
  11:42:57Z. **All five conversion criteria hold — content_item, the ninth
  and final governed type, is CONVERTED. Forty-one objects converted total.**
- **W7.8 RECHECKED on the real export** (main fast-forwarded into the
  branch): build 173 pages (was 172); `/object-model-demo` carries all five
  `data-cms-node-id` wrappers + the object id (the chip anchors are in the
  shipped HTML); zero strategy vocabulary in output (leak rule); the article
  joined library + RSS automatically; edit-mode `targets.ts` maps
  `data-cms-node-id` → `update_node` scoped patches. Suite 1198 + 49 green ·
  astro check 0 errors. **What Wolf sees now**: enter edit mode on
  /object-model-demo → every block has a chip (pencil + node-scoped ✨);
  legacy .md articles still have body chips NOWHERE by ruling (only
  page_article furniture + chrome) — that is design, not drift.
- **Rulings recorded (plan §0.5 + §7)**: **OQ-W7-1 RESOLVED — reverse
  support is NOT required.** No alias layer; MCP tools/functions may be
  updated, changed, or retired as the remaining phases land; what must
  survive is FUNCTIONALITY on the object substrate (drafting workflow,
  publish safety stack, admin editor). W7.5's scope is re-pointing internal
  surfaces + retiring/re-pointing the ~31 legacy tools, not aliasing them.

**Still open (each its own session per the phase discipline)**: W7.2
(sections onto rich text, DOM-equivalence gate), W7.5 (reduced: re-point
`/admin/library` toggle + admin patch paths to object verbs; retire or
re-point the legacy `save_json_blob_*`/publish-article tool surface — the
5-agent workflow state moves into `body.workflow` per plan §3.4), W7.7
(admin editor on rich text + visible annotation panel + document-body
canvas/TipTap editing — today plain-text node bodies are the editable
canvas surface), OQ-W7-3 (strategy registry go/no-go, design in plan §2.5).
Standing caveats: unpublish unsupported (OQ-2 — the demo article stays live
until edited); the three shop products still await Wolf's approval in
/admin/objects.

## Session 2026-07-13 C (INCIDENT: agent images broke the production build — raw artifact keys in render fields; guardrail + heal)

Wolf: an agent-triggered build failed — "It had an image as part of its work.
this image was saved correctly in the blob store but it might have failed at
time of build." Root cause (Netlify log): the `Publish page: page_shop_preview`
agent run set the page's `content_split.images[].src` AND `seo.ogImage` to the
RAW artifact blob key `image/req_publish_premium_skus_20260713_01/<sha>.png`.
A raw Major-Key key is servable ONLY at its public path
`/img/<id>/<sha>.png` (the `/img/*` → `get-public-image?blobKey=image/:splat`
redirect); the raw form is neither a URL nor an imported asset, so Astro's
`getImage` on `ogImage` threw **`LocalImageUsedWrongly`** and failed the ENTIRE
static build (a plain `<img src>` like content_split just 404s silently). The
canvas image tool already stores the correct `/img/...` form; this agent used
the raw artifact-upload key. **Not caused by the W7/shop conversions** — a
standing gap: the OBJECT pipeline had no analogue of the ARTICLE pipeline's
`rawImageArtifactReferencePattern` guard (`publish-article.ts` hard-throws on
raw refs), and `checkArtifactTrust` only inspects `*AssetRef` fields (which
LEGITIMATELY hold raw refs — resolved/unrendered), never `src`/`ogImage`/`href`.

Fix (the trap-14 pattern — heal + guardrail):

- **Guardrail** (`checkRenderableImageRefs`, wired into the `renderability`
  group; contract constraint `render_image_ref`): a raw Major-Key artifact key
  (`image|pdf/{id}/{sha}.{ext}`) in ANY string leaf that is NOT a raw-ref
  carrier (`*AssetRef` or product `fulfillment.artifact_ref`) and not private
  `notes` is a BLOCKER at patch/create/publish — the message names the field
  AND the exact public path to use (`publicPathForArtifactRef`, the one
  exported `image/→/img/`, `pdf/→/pdf/` helper in artifact-trust.ts). So the
  broken store record CANNOT republish until fixed, and this class can't
  recur through the store.
- **Heal** (fix-forward, quarantine-safe because of the guardrail): the
  committed exports corrected in-repo — `page_shop_preview` images+ogImage →
  `/img/...`; the SAME scan also caught a PRE-EXISTING sibling bug the guard
  now covers: `pdf/...` raw keys in `kind:'asset'` "Download Starter PDF" link
  `target.href`s on `page_home` (×3) and `nav_header` — relative `pdf/...`
  hrefs 404 from any non-root page (nav is everywhere) → healed to `/pdf/...`.
  The store records still carry the raw values and now can't republish until
  an agent fixes them (the validation error tells them exactly what/how) —
  needs a store-side `object_patch` + publish per object (page_shop_preview,
  page_home, nav_header), no credentialed heal spent on it here.
- Gates: 1198 + 49 tests green (7 new: the helper + guard exemptions/blocks) ·
  astro check 0 · eslint/prettier clean · **production build REPRODUCED green
  (172 pages, the LocalImageUsedWrongly throw gone)**. Benign standing log
  line: the empty `articleObject` collection warns until the first article
  object export lands (W7 dir has only `.gitkeep`) — non-fatal.

## Session 2026-07-13 B (W7.3 + W7.8 BUILT: content_item is the ninth governed type; article bodies on the canvas — awaiting the credentialed run)

Wolf: "Finish W7 rich text with article migration. The committed posts can be
ignored, they are mostly junk and are not worth the effort. The article
section has to have canvas edit-mode overlay. Articles and human engagement
is of the most value, so they need to be converted in full … it is important
that not only basic attributes are attached to every article block but
context attributes related to it being a hook, agitation or a resolution.
Like in the original architecture." Three plan supersessions recorded (plan
§0 updated): **W7.4/W7.6 are WAIVED** (no migration of the 83 committed .md
posts, no DOM-equivalence harness over them — they stay on the legacy
pipeline untouched, OQ-W7-5 moot); **W7.8 canvas is mandatory in-wave**; the
node annotation layer is non-negotiable (already the plan's prime rule).
Recon first (Wolf suspected doc drift): main had gained canvas sessions P/Q/R
(#425 put chips on article-page SECTIONS + chrome, explicitly stopping at the
body) and W7.1's substrate — but `content_item` was still refused by every
verb. That gap is what this session built:

- **`content_item.v1` body schema** (`src/schema/bodies/content-item-v1.ts`):
  node envelope OUTSIDE, rich text INSIDE (plan §2.2). The semantic layer is
  IMPORTED from `article-content-v1.ts`, not copied — `private.strategy`
  (hook/agitation/context/…/resolution/summary), `intent`, `commercial`
  (offers/disclosure/rel/adSlot), `rendering`, `chat`, 3-state `visibility`,
  opaque `n_*` ids (forbidden-word rule kept). `public.body` is
  `string | rich_text.v1 document` (string = plain text, escaped; blank line
  = paragraph). Envelope: slug/title/deck/description/image/taxonomy/seo +
  the judge/score substrate — editorial, emotional_strategy, sources, claims
  (node_ids-wired), compliance, lineage {parent_content_id}, typed
  `scores[]` {scored_by, at, framework, dimension, score, rationale} (§2.4).
- **Ninth governed type end-to-end**: `governedObjectTypes` + approval config
  (Tier 1 = autonomous under the master, OQ-W7-4 — gate it any time with one
  config pin), create (dated `req_agent_<topic>_<yyyymmdd>_01` minting —
  req\_\* ids keep artifact trust intact §1.6), the **node op family**
  (set_article_meta + upsert/update/move/remove_node + set_node_visibility;
  exact inverses via the section-family mechanics; "mark this block a hook"
  is ONE op: `update_node {fields:{private:{strategy:'hook'}}}`),
  **`create_variant`** verb + `object_create_variant` MCP tool (node ids
  re-minted deterministically, claims/compliance node_ids re-pointed,
  lineage set, scores reset, slug uniqueness enforced; `dry_run` for
  zero-residue production proofs), materializer →
  `src/data/site/articles/{req_id}.json`, publish/release through the
  standard pipeline, full contract (annotations contract-visible).
- **Validation**: schema; taxonomy category/tags resolve as REGISTRY SLUGS
  (store resolver now matches slug or term_id, aliases followed;
  registry-gated like the W3 hook); article slug unique across article
  objects AND committed posts (one permalink space; `isArticleSlugTaken`);
  node-id uniqueness; ≥1 public content node publish-gated; rich-text bodies
  restricted to the RENDERABLE grammar (prose + quotes; embeds blocked until
  their resolvers exist — trap-5 discipline) + https-only hyperlinks;
  **reader safety runs on the READER PROJECTION** (public fields of public
  nodes) so the annotation layer is legal record data while a strategy word
  in public copy still blocks; deploy-safety walks everything incl. notes
  (the export commits to the repo).
- **Render path**: published article exports join `fetchPosts()` as
  first-class posts (listings, categories, tags, related scoring, RSS,
  search — no per-surface wiring) via a new `articleObject` collection
  (generateId pinned: bodies carry `slug`, the S2 lesson) and ONE node
  renderer (`src/lib/article-object/render-nodes.ts`) into the article
  route's dormant `set:html` branch — SinglePost furniture, SEO merge, and
  page_article extras all unchanged. Never-render-private: internal/hidden
  nodes emit NOTHING; the leak rule is test-grepped (no strategy vocabulary
  in output). Offers render with disclosure + rel (bug ② partially paid);
  unsafe hrefs degrade to text; hero image via `body.image` (bug ③);
  reading time computed to the md convention.
- **W7.8 canvas (the OQ-8 stop line lifts)**: every rendered node carries
  `data-cms-node-*` identity; node chips (pencil + sparkles; image tool on
  content nodes) ride the SAME EditSession → `update_node` → pending tray →
  publish/release path as sections. Ask-AI gains NODE SCOPE
  (`ask-ai-object.ts`): tool = the node's PUBLIC copy grammar with
  protected-field strip (+`ctaLink`), a document body is excluded (no
  flattening), and the node's strategy/intent flow INTO the prompt ("write
  copy for a hook") but never into the suggestion. The legacy article Ask-AI
  (admin-ask-ai-node, workflow records) is untouched.
- **Driver + seeds**: `articleDrillOps` (probe node cloned/poked — copy AND
  annotation — hidden/moved/removed, byte-identical end), create_variant
  dry-run proof (the instantiate pattern), content_item materializer
  dispatch, and `scripts/lib/articles-seed-data.mjs` — one honest
  demonstration article (full PAS-ish arc of annotated nodes + a
  node-wired claim) at slug `object-model-demo`.
- **Gates**: 1195 + 49 tests green (~60 new; 8 old posture pins deliberately
  flipped) · astro check 0 errors · eslint/prettier clean · **build-diff
  EMPTY (173/173 identical)** — with no article exports the change is
  render-inert · probe-export build verified in dist (article page + node
  wrappers + zero leaks + listing/RSS inclusion), then removed · **local
  rehearsal ALL GREEN** (ensure → 6/6 ops → validate → publish blocked at
  the expected sandbox boundary → variant dry-run → contract 6/6 advertised
  ≡ exercised → inventory).

**Status: BUILT + REHEARSED, not converted.** The credentialed run flips it:
`node scripts/home-conversion-roundtrip.mjs --production --release --seeds scripts/lib/articles-seed-data.mjs`
(schema-vintage gate applies — merge + deploy main first). Standing caveats,
named honestly: (1) **unpublish is still unsupported (OQ-2)** — once the demo
article publishes + releases it is live at /object-model-demo until edited;
the run may stop at the drill (criteria 1–4 proven, record stays draft) if
that's unwanted. (2) Rich-text DOCUMENT bodies exist end-to-end but have no
canvas/TipTap editor yet — plain-text bodies are the editable v1 surface;
W7.2/W7.7 (sections onto rich text; the admin editor + annotation panel +
embeds) remain open, as does the OQ-W7-3 strategy-registry go/no-go and the
W7.5 alias layer (legacy tools untouched this session; the ~31 article tool
names still serve only the .md pipeline). (3) A locally deleted article
export needs `node_modules/.astro` cleared (dev-cache only; CI/Netlify build
clean).

## Session 2026-07-13 (W5 CREDENTIALED RUN: the three hand-coded pages are CONVERTED — the hand-coded-page backlog is EMPTY)

Wolf ran the credentialed `--production --release` driver against the live
MCP endpoint with `scripts/lib/pages-w5-seed-data.mjs`. Result (verbatim
from the run): `page_shop_preview`, `page_pricing`, `page_services` each
`ensure created → drill every permitted op → published`, then
`contract page 6/6`, `inventory` returns all three, and
`release_to_production — live at commit`. **All five conversion criteria now
hold for the three pages** (rendering was proven in `dist` at build time —
172 pages, tiers showing $19/Free/Pay-what-you-want — the public URL is
still 403 behind the pre-launch `SITE_NOT_YET_LIVE` gate, so store-side
proof is the driver's own published+released+inventory, not a public
fetch). The server committed the page exports to main
(`Publish page: page_{shop_preview,pricing,services}`). This closes the
plan's "after S2/S3" conversions — **every routable page on the site now
renders from a page object; zero hand-coded page routes remain.**

Still open (unchanged, all Wolf-side): the three MOCK products
(`prod_barrier_repair_guide`, `prod_starter_checklist`,
`prod_support_the_work`) stopped at `approval_required` exactly as the
review-required gate intends — approve each in /admin/objects and re-run
the same idempotent command to convert them too. Launch gates: the LIVE
Stripe test-mode exit run (needs STRIPE_MODE + both key pairs +
PURCHASE_TOKEN_SECRET), PUBLISH_SECRET rotation, and the
`SITE_NOT_YET_LIVE` flip. Docs flipped in this same change: object-inventory
§1 (SEEDED → CONVERTED) and conversion-map (HAND-CODED PAGES node + W5 row).

## Session 2026-07-12 R (CANVAS Tier-1 surfaces: article pages, chrome, related-articles dropdown)

Wolf: "Article publishing Tier 1 after conversion does not have canvas mode …
apply the same treatment to the article and other tier one objects like
headers, footers … A set of 'other articles to read' below an article can
have an AI option and a simple choice of existing selection algorithms
through a stylish dropdown … inline with AI action button." Shipped on the
canvas branch (PR #425):

- **`content_grid` `related` source kind** (generalize-don't-replicate):
  `{kind:'related', algorithm: tag_similarity|same_category|latest}` —
  tag_similarity = the existing related-posts scoring, extracted pure as
  `rankRelatedPosts` (utils/blog.ts, single source of truth); anchored to
  the current post via a new resolve context (article route passes
  `relatedToPostId`), newest-first degradation elsewhere. Related-grid
  titles link to posts; query/manual grids keep audited unlinked markup.
- **Chip algorithm dropdown**: a related grid announces its algorithm via
  `data-cms-related-algorithm`; the chip renders a compact chip-native
  select inline with the sparkles; change → checkout →
  `update_section_data {source:{kind:'related',algorithm}}` draft.
- **Article pages get canvas**: `ObjectSections` leaves a zero-height
  `data-cms-empty-object` marker on object-empty pages; the gap layer turns
  it into one add "+" → the FIRST page_article section is addable from the
  canvas ("Related articles" joined the palette — the one reference-free
  content_grid starter). An object-backed related grid REPLACES the
  hardcoded RelatedPosts furniture; absent one, byte-identical legacy. The
  article BODY stays Tier-1 (OQ-8 line; /admin/publish).
- **Chrome**: Header/Footer wrapped in `data-cms-nav-object` (PageLayout +
  PageObjectRenderer footer override). Chip marked site-wide, pencil-only →
  copy form (item labels incl. children, group titles, brand, footNote)
  from pure `nav-editor.ts`; saves map to the NAV grammar — update_item,
  upsert_group (replace-by-id, current group rides along),
  remove_action+upsert_action renames, coalesced set_nav_meta — via
  EditSession('navigation'). Local body kept in step
  (`applyNavChangesToBody`) so sequential saves never resend stale groups.
  Targets/hrefs/icons excluded (structural = protected boundary); no AI
  chat on chrome.
- **Gates**: 11 new tests (related resolver + degradation + schema-valid
  page; annotation announces algorithm and only for related; nav-editor
  flatten/ops/throw/apply incl. every-op-legal check; palette related-only
  content_grid rule + empty-anchor append), suite 1159+49 green, astro
  check 0, build 172 pages, drive 60 assertions (nav chip site-wide/no-AI,
  nav grammar op on save, dropdown value + inline-with-AI + patch wire
  shape + annotation update, empty-marker "+" → palette targets
  page_article → upsert_section related grid). Docs: 07 §3f.
- **To make it real on production**: enter edit mode on any article page,
  click the "+" below the article, pick "Related articles", publish +
  release (the store write happens through the verbs; no code or seed
  needed). Header/footer copy edits work the same day-one.

## Session 2026-07-12 Q (CANVAS panel UI: icon-led collapsible accordion)

Wolf: "make the modal UI collapsible accordion. use less text and more
representative iconography. be focused on style and UX … do not use colors
that are outside of a current Astro schema." Shipped on the canvas branch
(PR #425):

- The docked panel is now one **accordion**: three icon-headed sections
  (✨ Ask AI / ✏️ Edit text / 🖼 Image), one expanded at a time (open one
  grows, rest collapse to a head + chevron). Chip tools open their section;
  accordion heads switch tools in place; clicking the open head collapses to
  a compact rail. Image section only shown for image-bearing types.
- **Iconography over prose**: identity = type + monospace id + tiny
  shared/draft dots (no sentences); actions are icon buttons w/ tooltips
  (check=save, undo=discard, plane=send, up-arrow=upload); sys/log lines
  terse + glyph-prefixed; field hints one-liners. Tray text trimmed too.
- **Palette discipline**: every color is a project `--aw-*` token via the
  `--dlem-*` layer — nothing bespoke; light/dark flips with the site.
- Structure preserved: same modes/data-hooks (`data-em-*`, `.dl-em-mode-*`),
  so the verbs/tests are untouched. Gates: astro check 0, eslint/prettier
  clean, suite 1148+49 green, build 172 pages, drive extended to 49
  assertions (3-section accordion, AI expanded/others collapsed, icon-only
  send, head-switch collapses previous, open-head collapse). Docs:
  07-canvas-editing.md §3e.

## Session 2026-07-12 P (CANVAS image tool v2: array images, blob-backed uploads, AI image references)

Wolf, on the Codex array-image finding + storage: "Close the gap. Also, those
images also need to be stored in blobs for edits and other manipulation as
happens now with pdf-tool. Same goes for About image or any other image."
Shipped on the canvas branch (PR #425):

- **Array images (Codex gap closed)**: the image tool now renders image
  ARRAYS (`content_split` `images: [{src,alt}]`) — one src/alt pair per item;
  save copies the array and patches it wholesale (deep-merge replaces arrays),
  editing only the touched item. `content_split` joins `bio` in
  `IMAGE_SECTION_TYPES`.
- **Blob-backed uploads (pdf-tool pattern, zero new write paths)**:
  - `admin-artifact-upload-intent.ts` (+ pure core
    `netlify/lib/canvas-upload-intent.ts`): admin-gated mint of the EXISTING
    HMAC upload token; server controls the claims — `requestId =
req_canvas_<object>_<yyyymmdd>_01`, kind `image`, filename from content
    type; JPEG/PNG/WebP only (what save-side sharp validation accepts).
  - Bytes go to the same `/api/artifacts/upload` agents use (re-verifies
    size/sha256/decodability against the signed claims); content-addressed
    keys `image/<requestId>/<sha256>.<ext>`.
  - **Public serving**: `/img/*` → new `get-public-image.ts`, the image
    mirror of `get-public-pdf.ts` — extension allowlist, immutable cache
    (content-addressed), CSP + nosniff. Sections carry the root-relative
    `/img/…` path (deploy-safe; renders through existing components).
  - Canvas: each src row gets an **Upload** button
    (`uploadImageArtifact` in `verbs-client.ts`: crypto.subtle sha256 →
    intent → tokened byte POST → fill src). Upload is storage-only; the src
    change still walks checkout → patch → publish → release.
- **AI image references ("Re: portrait.png", same session, Wolf)**: the AI
  chat on an image-bearing section shows image chips; arming one (a) ensures
  the image is blob-backed — existing repo images (`/images/…`) are
  **mirrored into the artifacts store** via the same pipeline, storage-only,
  src untouched — and (b) sends `image_ref {field, name, url}` with every
  ask. The section prompt gains a "Re: <name> — publicly served at <url>"
  clause (the public URL is the handle external image-editing tools need).
  Copy-only guard unchanged: image fields still never survive a suggestion.
- **Gates**: 15 new tests (intent mint/round-trip/rejections; public image
  route incl. real underscored canvas keys + 404/405/allowlist; image_ref
  prompt clause + guard-still-strips + optionality), full suite 1148+49
  green, astro check 0, build 172 pages, drive extended to 42 assertions
  (upload wire shapes; chip → mirror → armed pill → image_ref on the wire).
  Docs: 07-canvas-editing.md §3c/§3d.
- **Env note**: the intent endpoint needs `ARTIFACT_UPLOAD_TOKEN_SECRET` —
  already configured (the pdf-tool upload path uses it).

## Session 2026-07-12 O (CANVAS manual tools: icon toolbar, field editor, image tool, gap "+" add)

Wolf: "add text edit tools to each relevant object … remove the wording Ask AI
and replace it with an icon [stars slightly brighter] … other objects may
require uploads or other tools … hovering between objects [show] an Add
symbol." Shipped on the #423 branch (same canvas scope as the guard):

- **Chip → icon toolbar**: pencil (Edit text), image tool (types with image
  fields — `bio`), and an icon-only sparkles whose stars use `--dlem-spark`
  (site gold lifted toward white) so the AI action reads a notch brighter
  than the other tools. Tooltips carry the words; no "Ask AI" text.
- **Manual field editor** (pencil): copy fields only (same non-copy exclusion
  the AI guard enforces), Save draft → checkout → `update_section_data`,
  in-place preview, publish separate. **Image tool**: src/alt + live
  thumbnail — the deliberate image-change path (AI stays schema-blocked);
  also Wolf's in-canvas fix for the About portrait. Upload = later slice.
- **Gap "+"**: subtle round + above/between/below a page object's sections →
  compact palette (`sections-palette.ts`, pure; starters proven schema-valid
  - splitter-safe in tests) → `upsert_section` at a record-derived position
    (hidden-section safe, anchored by id), server-minted id, honest annotated
    draft placeholder in place until publish + release.
- Fixed en route: `.dl-em-actions[hidden]` was overridden by its own
  display:flex (the Accept row showed empty on fresh panels).
- **Gates**: 1104 + 49 tests (palette starters validated against the REAL
  section schema + splitters; insert-position math), astro check 0, build
  172 pages, headless drive extended to 25 assertions (icon toolbar, manual
  edit patch shape, image tool patch shape incl. alt preservation, gap add
  upsert wire shape + placeholder) — all green in both themes.

## Session 2026-07-12 N (CANVAS bug: copy-AI dropped an image — copy-only guard added)

First real production incident from the canvas, reported by Wolf: an AI edit
to the /about intro (heading → add "Ph.D") also **silently swapped the bio
`portrait.src`** from the working local `/images/dr-lurie-portrait4.jpeg` to a
hallucinated `https://kugelmedia.netlify.app/drlurieblog/dr-lurie-portrait.jpg`
(the model echoed the `kugelmedia.netlify.app/drlurieblog/` CDN pattern it saw
elsewhere in site data + a plausible filename). Published as `36b060c`, it
broke the About portrait — and was the "change I did not make." (The three
`prod_*` rows in Wolf's pending tray were unrelated: shop products the
inventory `pending_changes` filter surfaces, not canvas edits.)

**Root cause**: the section-scoped Ask-AI exposed the section's FULL data
schema — including media/asset/reference fields — to the model, and applied
whatever it returned (deep-merge). An LLM will hallucinate URLs.

**Fix (copy-only guard)**: `isProtectedAskAiField` (`ask-ai-schema.ts`) names
the non-copy fields — media/asset (`portrait`, `*AssetRef`, `logo`, `icon`,
`ogImage`, `src`…), references/bindings (`source`, `products`, `contentItem`,
`section`, `formName`, `actions`/`links`…), structure/routing (`route`,
`sections`, `slug`, `anchor`…). `deriveAskAiToolSchema` gains `protectFields`
(set on the canvas section path, off for whole-object admin asks) that strips
them from the tool schema, plus a defensive re-strip of the suggestion in
`ask-ai-object.ts`. The copy AI now edits **text only**. 1093 + 49 tests
(27 ask-ai, incl. a hallucinated-portrait regression test), astro check 0,
eslint/prettier clean. **Follow-ups**: (1) restore the live portrait to
`/images/dr-lurie-portrait4.jpeg` on `sec_about_intro` (inner id `s_intro`) —
needs the production key; (2) the canvas has no manual (non-AI) field editor,
which is now the only sanctioned way to deliberately change an image — worth
building next.

## Session 2026-07-12 M (W7.1 BUILT: the rich_text.v1 substrate — schema + renderer + ProseMirror mapper, inert by design)

Same session (PR #422 — the W7 plan — merged; branch restarted). Wolf's
rulings recorded first: **articles keep Tier 1** (OQ-W7-4 resolved, plan §7
updated on the PR before merge) and the expanded `strategy_drlurie` registry
design shipped into plan §2.5 (go/no-go still open). Mid-session directive
recorded: **canvas editing belongs to ANOTHER session** — articles are not
canvas-wired yet (they aren't objects yet at all); W7.8 is reassigned to that
session's owner when the wave gets there. Nothing canvas-adjacent was touched
here.

W7.1 per the plan, all three substrate pieces in `src/lib/richtext/`:

- **`rich-text-v1.ts`** — the zod mirror of Contentful's node tree
  (`@contentful/rich-text-types` constants are the name source), restricted
  to the house universe: p / h2 / h3 / ul / ol / li / blockquote /
  embedded-entry-block / embedded-asset-block; marks bold + italic;
  hyperlink inline (uri pinned whitespace-free). Per-field narrowing is a
  **`RichTextGrammar`** (enabledNodeTypes/enabledMarks — the D§3.5
  allowlist-becomes-declaration), with the three presets that mirror today's
  splitter vocabularies: INLINE_COPY (p-only fields), PROSE (prose.body),
  ARTICLE_BODY (adds quotes + embeds, the W7.3 target). `data` on every node
  is the annotation carrier — nothing writes to it in this phase.
- **`render-html.ts`** — build-time renderer over
  `@contentful/rich-text-html-renderer` (v17): marks emit the house
  `<strong>`/`<em>` (not the lib's b/i), embeds REQUIRE injected resolvers
  and throw naming the target when absent (never-silently-drop), input is
  schema-validated first, `node.data` never reaches HTML (leak-rule test
  greps the output), and `\n` in text values renders as `<br/>` via a
  post-pass (v17 ignores `renderText`; safe because the lib emits no
  formatting newlines and uris are whitespace-free by schema — verified
  empirically, incl. default text/attribute escaping).
- **`prosemirror.ts`** — the ONE TipTap/ProseMirror ↔ rich_text.v1 mapper
  (W7.2 editors + W7.7 article editor share it): heading levels 2–3, lists,
  blockquote, bold/italic; link MARKS ↔ hyperlink INLINE nodes (consecutive
  same-href runs merge, split back on return); hardBreak ↔ '\n'-in-value;
  everything outside the universe throws naming the type. Structural types
  only — no editor package imports in the build graph.

Gates: **1116 + 49 tests green** (27 new across three test files, incl. both
round-trip directions and the leak rule) · astro check 0 errors ·
eslint/prettier clean · **build-diff EMPTY (173/173 identical)** — the
substrate is used by nothing, exactly as specified. New deps:
`@contentful/rich-text-types`, `@contentful/rich-text-html-renderer`.
NEXT: W7.2 (section body fields accept string | document; one-time export
conversion; TipTap emits rich text) — DOM-equivalence gate, own session/PR.

## Session 2026-07-12 L (W7 PLANNED: OQ-8 RESOLVED as one-time migration — articles onto the object model + Rich Text; plan doc, not code)

Wolf opened the article wave ("let's move with articles W7. be careful, I
need the functionality developed for article publishing") and answered the
four forks in-session — **OQ-8 is resolved: (1) one-time MIGRATION to
ObjectRecords** (adapter path retired), (2) **build the Contentful Rich Text
substrate now** (core-structure tasks 1–5, confirmed never built — sections
use TipTap-HTML strings + splitters today), (3) canvas-for-articles in-wave
if it fits, (4) plan doc first per the shop precedent. His preservation
directive is the wave's prime rule: the `article_body.v1` semantic layer
(per-node `private.strategy`/`intent`, commercial metadata + disclosure,
chat, opaque ids, input templates; envelope-level emotional_strategy/claims/
sources/compliance/scoring slots) exists so "agents can judge, score and
build variants quickly" — it must come out of W7 MORE agent-usable, never
flattened.

**The plan is [`08-articles-plan.md`](../08-articles-plan.md).** Spine:
`content_item` = ninth object type keeping `req_*` ids verbatim (artifact
trust/blobKeys survive unchanged); body = **node envelope outside, Rich Text
inside** (a hook can span paragraphs — the node grouping IS the behavioral
structure; `public.body` upgrades string → `rich_text.v1` document); one
renderer for build/admin/canvas; `create_variant` + typed `scores[]` as the
A/B substrate (serving/traffic-split explicitly out of v1); the ~31 article
tool names live on as thin aliases over object verbs (external agent configs
call them by name); 5-agent workflow state moves into `body.workflow`;
per-article cutover flags + a DOM-equivalence harness (83 committed posts
keep URLs and rendering); the `workflows` store retires read-only as the
rollback source. Ten-bug register dispositioned (recon this session; nothing
was in the issue tracker): ①⑦⑨ die structurally, ② becomes the renderer
feature matrix (offers/adSlots/chatInvite/PDF media render for the first
time), ③④⑤⑥⑧⑩ are named phase tasks. Phases W7.1–W7.9, each its own
session/PR; six OQ-W7 checkpoints for Wolf (alias sunset, variant serving,
strategy vocabulary as a `strategy_drlurie` registry vs code enums, Tier 1
posture, `.md` retirement, credentialed workflows-store inventory). §3.10's
freeze lifts only inside the approved phases. NOT in this session: any code —
W7.1 (rich_text.v1 substrate) starts on Wolf's approval of the plan.

## Session 2026-07-12 K (CANVAS Ask-AI runs on OpenAI; retheme + review fixes landed)

Follow-ups to the merged canvas (PRs #415/#417/#418), each its own PR restarted
from main:

- **Ask-AI provider → OpenAI (Wolf's call: "replace")**: the generic canvas
  Ask-AI (`netlify/lib/ask-ai-object.ts` + `admin-ask-ai-object.ts`) now calls
  OpenAI Chat Completions function-calling with `OPENAI_API_KEY` (already
  configured for ChatKit / the publisher agent) and `OPENAI_MODEL` (default
  `gpt-4o`), replacing the Anthropic Messages call. The zod-derived tool schema
  is plain JSON Schema, so it is the OpenAI function's `parameters` verbatim; a
  forced `tool_choice` keeps the reply structured (arguments arrive as a JSON
  string — parsed before the null-strip). **Provider-only swap**: read-only
  contract, section scoping, shared_ref refusal, and the human **Accept** gate
  are unchanged — the AI still cannot write a field; Accept → object_patch
  (draft) → Publish → Release remain the three human gates. The article Ask-AI
  (`admin-ask-ai-node.ts`) is a separate system, untouched. Both ask-ai test
  files reworked to the OpenAI wire shape; 23 ask-ai tests + full suite green.
- **Retheme (#418, merged)**: canvas chrome derives every color/font from the
  project's `--aw-*` design tokens (auto-flips light/dark); no hardcoded purple.
- **Review fixes (#417, merged)**: lapsed-token sessions keep the canvas;
  listing-page headers carry editing chips.

Gates for the OpenAI swap: 1089 + 49 tests, astro check 0 errors, build 172
pages, eslint/prettier clean. Not yet exercised against the real OpenAI
endpoint (same credentialed-run boundary as the rest of the canvas).

## Session 2026-07-12 J (W5 PAGES SEEDED: /pricing, /services, shop-preview — zero hand-coded page routes left; commerce_orders admin tool)

Same session (PR #416 merged; branch restarted). The plan's "after S2/S3"
page conversions, per Wolf's directive ("convert W5 pricing and the other
passed-over pages; agents get full store administration"):

- **Three new REUSABLE section types** (schema → registry → component →
  resolver → validation → editors, the full wiring): `steps` (numbered
  icon cards), `content_split` (kicker/heading/rich body + actions + up to
  2 staggered images — the bespoke shop-preview hero generalized, its
  scoped styles absorbed), `pricing_table` (tiers REFERENCE product
  objects; title/price badge/availability/CTA href resolve from commerce
  data at build — copy never drifts from the store; unavailable products
  render "Coming soon", ghost refs are skipped with a build warning and
  BLOCKED at write by reference integrity).
- **Three page objects, three route files DELETED** (importers verified):
  `page_shop_preview` (/solutions/shop-preview — REAL copy verbatim;
  nav's route-kind links unchanged, same route now object-served),
  `page_pricing` + `page_services` (previously unlinked Astrowind lorem —
  MOCK copy per Wolf's 2026-07-12 directive). All standard pages on the
  object-page catch-all: **the hand-coded-page backlog is EMPTY — every
  routable page on the site now renders from a page object.**
  (`feature_grid` deliberately not minted: content_grid `cards` already
  covers icon grids — design-principles rule 1.)
- **`commerce_orders` MCP tool** (netlify/lib/commerce-admin.ts): the
  support-lookup half of store administration — list orders by
  email/product (newest-first, capped) or fetch full detail by order_key;
  what order_reissue needed to be operable from "customer lost the email".
  Read-only; raw buyer email visible by design (§6 — publish-key surface).
- **BUG FOUND + FIXED (latent since S2)**: Astro's glob loader prefers a
  top-level `slug` field for the entry id — product exports HAVE one, so
  `getCollection('productObject')` ids were the slug, not the object id.
  Every by-object-id lookup against the collection silently failed: the
  BUY BOX embedded the wrong product_id (live checkout would have 404'd
  product_not_found), and pricing_table tiers/manual product_preview picks
  never resolved. Pinned `generateId` to the filename (= object id) in
  content/config.ts; /shop buy flow and tiers verified in dist.
- Seed module prepends the S2 product seeds as reference targets
  (playbook trap 3 — imported from the shop module, one catalog source);
  driver materialize no longer crashes on a never-created object.

Local rehearsal: full lifecycle SUCCESS (ensure/drill/contract/inventory/
materialize ×6; pages block only at export_commit_failed, products at
approval_required — both expected terminals). Suite 1089 + 49 green; astro
check 0; eslint/prettier clean; build 172 pages — /pricing, /services,
/solutions/shop-preview all render from objects with resolved tiers
($19/Free/Pay-what-you-want badges live). **Rendered + seeded, NOT yet
converted**: the three pages await the credentialed `--production
--release` run (same run can approve the three products stuck at
approval_required). W5 empties the hand-coded backlog for good.

## Session 2026-07-12 I (S3 SHIPPED: PWYW + free + unlock paths; the two commerce MCP tools — criterion 4 closes)

Same session (PR #414 merged; branch restarted). S3 per plan §9 — the
product type's permitted-action surface is now COMPLETE:

- **`set_product_price` patch op** — the §3 funnel's WRITER, the exact
  complement of set_product_fields' refusal: `fields` restricted BY THE
  GRAMMAR to commerce.price/stripe/stripe_test (shape-pinned); internal
  (`agent_authored: false`, the reactivate_term posture); inverts to itself
  with the captured before-tree = "re-point to the archived price".
- **`product_set_price` MCP tool** (netlify/lib/product-set-price.ts):
  creates the new Stripe Price (immutable prices), archives the old one,
  writes cache + the running mode's linkage in ONE governed
  checkout→patch→checkin — cache ≡ what Stripe just created, by
  construction. Bootstraps a Stripe Product for unlinked products. Does NOT
  publish: the change waits for the §0.4 human approval.
- **`order_reissue` MCP tool** (netlify/lib/order-reissue.ts): regenerates
  a download link from the ORDER record alone (orders now store
  `fulfillment.artifact_ref` — §5's "fulfillment is a pure function of the
  order record" made literal; S1c-era orders fall back to the product's
  current ref). Audited reissue entries {at, token_hash, by} + a
  fulfillment_reissued event; ttl 1h–14d.
- **PWYW checkout**: the buyer picks the amount; create-checkout-session is
  the minimum-enforcement point (§3 — no Stripe Price exists; price_data
  charges the chosen amount against the linked Stripe Product). Buy box
  grew an amount input.
- **Free claim** (netlify/functions/claim-free.ts): direct token issuance
  through the SAME order/event machinery (ord*free*…, session null, amount 0) + the lead-capture tie-in (optional email → the opt-ins store). Buy
  box: "Get it free" renders the download link inline.
- **Unlock kind**: checkout requires an EXISTING pre-generated artifact
  under the product's unlock_prefix (nobody pays for a ghost); the webhook
  mints the token over exactly that key. The buy box keeps unlock products
  unbuyable until the artifact-generator integration exists.
- Drill: fixed products now exercise BOTH ops (price poked one cent,
  restored byte-identical); the driver unions exercised ops per type for
  the contract check. Local rehearsal: contract product 2/2 — **criterion 4
  is fully closed for the product type**.

Suite 1061 + 49 green; astro check 0; eslint/prettier clean; build 172
pages. The shop plan's §9 critical path (S1a→S1b→S1c→S2→S3) is now fully
built. Remaining, per plan: the credentialed production run (products stop
at approval_required → Wolf approves), the LIVE Stripe exit test (launch
gate, needs keys), and the after-S3 page conversions (/pricing with
pricing_table; /services + shop-preview with mockup copy per Wolf's
directive).

## Session 2026-07-12 H (CANVAS SHIPPED: the site is the editing surface — admin inline Ask-AI, draft-in-place, publish/release tray)

Wolf approved the edit-mode canvas plan ("go on and start work on this,
layering phases over preexisting conversion steps; stop at the article
publishing engine; ignore the old admin editor in favor of this UX") after a
feasibility/UX write-up + interactive mockup. Shipped in four commits on
`claude/admin-inline-ai-editing-trkigv` — full doc:
[`07-canvas-editing.md`](../07-canvas-editing.md).

- **Section identity in the built HTML**: both dispatch sites wrap every
  section in a `display:contents` element carrying
  `data-cms-object-id/-section-id/-section-type` (+ `-shared-object` for
  shared*ref derefs — `resolveSections` now keeps the `sec*\*`id on`RenderableSection`). No box, no layout change; ObjectSections gained a
required `objectId` prop (threaded from the 6 listing routes).
- **Section-scoped Ask-AI (additive)**: `admin-ask-ai-object` takes
  `section_id` (pages) — tool derived from the section type's own data
  grammar (`sectionDataSchemaForType`, generic over the union), suggestion
  maps 1:1 onto `update_section_data`; shared_ref scopes are refused with the
  target id; section OBJECTS auto-scope to their inner instance. Read-only as
  ever; content_item still refused (article Ask-AI untouched — the stop line).
- **The overlay** (`src/lib/edit-mode/`): dormant 1.5KB loader in Layout →
  GoTrue + server-side admin-auth-state gate → 27KB code-split editor for
  admins only. Hover chips (✨ Ask AI, selection-aware, shared/draft flags),
  docked panel diffing against the DRAFT record, conservative in-place
  preview (real splitters; honest fallback to panel diff), Accept →
  checkout → patch via shared LockManager (`EditSession`; 409-retry, 422
  blockers surfaced, foreign locks named), pending tray fed by
  `inventory {pending_changes:true}` with per-object Publish and Release.
  Draft state survives reloads (amber framing on load).
- **Gates**: 1071/1071 tests (+~45 new: annotations, scope, target routing),
  astro check 0, build 167 pages, **headless-browser drive of the real built
  site end-to-end** (dormant visitor path verified — zero admin calls/chunk;
  full edit flow wire shapes asserted; one real bug found+fixed by the drive).
  Build output now differs from pre-canvas builds by the inert data-cms-\*
  attributes only — sanctioned, one-time.
- **NOT done (deliberate)**: articles on the canvas (W7/OQ-8 — Wolf's stop),
  structural ops UI (add/move/remove/meta), OQ-9 SSR draft preview, W7 rich
  text itself (next conversion wave), and the credentialed production
  walk-through of one canvas edit (sandbox boundary — same as every
  conversion; suggest page_thank_you first).

## Session 2026-07-12 G (S2 BUILT + SEEDED: /shop catalog + product pages, mock content — awaiting credentialed run)

Same session (PR #413 merged; branch restarted). S2 per plan §4/§9, with
Wolf's mockup-data directive applied:

- **`product_preview` upgraded** from a dead static `ProductCard[]` (no live
  usage) to the M-8 source union over PRODUCT objects: `query` (every
  available product) / `manual` (+query fallback) / `cards` (curated cells).
  `resolveContentGridCards` generalized over the query type (same semantics,
  one owner); resolvers load available products from the new `productObject`
  collection ONLY when a section needs them (the dynamic-import chunk rule);
  mode decides the price badge ("$19" / "Pay what you want" / "Free").
  Manual picks validate through reference integrity (`requireObject
'product'`).
- **`/shop`** — NO route file: `page_shop` (standard) is the FIRST page
  served by the object-page catch-all in production use (the zero-code
  promise cashed in). Its grid is a `query` source, so newly published
  products appear with no page edit (the design-principles litmus).
- **`/shop/[slug]`** — the SinglePost-shaped loader: paths derive from
  published + AVAILABLE product exports (never-render-private for
  retired/coming_soon), buy box + hero from the product object, page_ref
  sections via ObjectSections, SEO defaults from `page_product_detail`
  (content_detail, the page_article idiom). Buy CTA posts to
  create-checkout-session; PWYW/free products show a disabled "Coming soon"
  until S3. `product_viewed` / `checkout_started` beacons use the
  save-opt-in sendBeacon pattern.
- **Seeds** (`pages-shop-seed-data.mjs`): three MOCK products covering all
  three commerce modes + the two pages. Driver + drill extended for product
  seeds (`productDrillOps` — set_product_fields poke/restore, never the §3
  funnel keys; materialize dispatch). **Local rehearsal ALL GREEN**: every
  permitted op drilled, contract 1/1 + 6/6, inventory 5/5, exports
  materialized and committed. Build: /shop + 3 product pages emit (172
  pages), dist carries the real copy/badges/wiring.
- **The review gate met the driver**: product publishes stop at
  `approval_required` — now recognized as the drill's expected terminal
  signal for gated types (sandbox AND production; the driver never works
  around the gate). The object-page-routes zero-paths pin was updated:
  page_shop legitimately emits through the catch-all now.

Suite 1051 + 49 green; astro check 0; eslint/prettier clean. **Next for the
credentialed run**: driver `--production` creates + drills the five objects,
products stop at approval_required → Wolf approves each in /admin/objects →
publish + release. Then S3 (PWYW/free/unlock + product_set_price +
order_reissue).

## Session 2026-07-12 F (S1c SHIPPED: checkout → webhook → token delivery → success page)

Same session (PR #412 merged; branch restarted). S1c per plan §9 — the whole
paid path for fixed-price downloads, built on S1b's substrate. The official
`stripe` SDK is the one new dependency (§7: session creation + webhook
signature verification; hand-rolling signature checks is malpractice).

- **`purchase-tokens.ts`**: HMAC-SHA256 expiring bearer tokens (72h default)
  embedding `{order_key, artifact_ref, exp}`, signed with
  `PURCHASE_TOKEN_SECRET` (min 16 chars or the endpoints 503). Signature is
  the authorization; order records keep only hashes (audit trail, not an
  allowlist — a fresh status-page token is as valid as the issued one).
- **`stripe-env.ts`** (§8.7): `STRIPE_MODE` picks the key pair (default
  'test' — a missing flag must never charge real cards);
  `stripeLinkageForMode` picks `commerce.stripe` vs `stripe_test`. All four
  key envs + the token secret are in PROTECTED_ENV_KEYS (§8.5). Lazy client
  - injectable test seam.
- **`create-checkout-session.ts`**: buyability gated on STORE state
  (published + active + available + linked); charges the linked `price_id`,
  never the cache (§3); stamps `metadata {product_id, event_id}`;
  success/cancel URLs from the server's own URL env, never a request header.
  v1 = fixed mode only (PWYW/free are S3).
- **`stripe-webhook.ts`**: signature-verified; `checkout.session.completed`
  → `writeOrderIfAbsent` (replays/double-fires no-op) → token minted for
  download kinds → authoritative events with DETERMINISTIC event ids + ts
  derived from the Stripe event, so replayed webhooks collide on the same
  store key and duplicate nothing (§8.2's window closes to true concurrent
  double-fires). §3 amount cross-check flags `amount_mismatch` + event.
  `checkout.session.expired` → idempotent `checkout_abandoned`. Non-2xx on
  store failures so Stripe retries.
- **`get-purchase.ts`**: token-gated streaming of the PRIVATE artifact
  (attachment, no-store) — 401/410/404 ladder, expired = Gone with a
  reissue hint; appends `download_succeeded` (best-effort).
- **`checkout-session-status.ts` + `/shop/thank-you`** (§8.8): the page
  verifies the session server-side and polls with backoff until the webhook
  lands — delivery never depends on email; Stripe's receipt is enabled
  Stripe-side.
- Tests: 23 new — including **the exit-test mechanics in sandbox form**:
  webhook delivered → replayed twice → ONE order, no duplicate events;
  amount-mismatch flag; unpaid-completion skip; token tamper/expiry ladder;
  status-poller transitions. (The REAL §9 exit test — a live Stripe
  test-mode purchase end-to-end — needs Stripe keys and is the launch-gate
  item, not runnable from this sandbox.) Suite 1044 green; astro check 0;
  build 168 pages (the thank-you page is new).

Env needed for production (all marked as secrets): STRIPE_MODE,
STRIPE_SECRET_KEY[_TEST], STRIPE_WEBHOOK_SECRET[_TEST],
PURCHASE_TOKEN_SECRET. NOT in S1c: PWYW/free/unlock paths + the two MCP
tools (S3), the /shop surfaces (S2).

## Session 2026-07-12 E (S1b SHIPPED: commerce + commerce-events stores, order/event libs, capture beacon)

Same session as S1a (PR #411 merged; branch restarted from main). S1b per
plan §9: the substrate the checkout path (S1c) writes into. Wolf directive
recorded this session: **products/services content uses MOCKUP data** — this
supersedes the plan's "/services awaits Wolf's copy-or-delete call" wait; S2
seeds mock products and the W5 conversions may seed mock copy (no longer
"silent lorem" — it is now sanctioned).

- **Stores** (`netlify/lib/blob-store.ts`, the one env-contract place):
  `commerce` (strong consistency — the success page polls the order the
  webhook just wrote) and `commerce-events` (eventual; append-only).
- **`commerce_order.v1`** (`netlify/lib/commerce-orders.ts`):
  `orders/<idempotency-key>.json` — Checkout Session id for paid orders, the
  minted order_id for free claims (§5). `writeOrderIfAbsent` is THE webhook
  idempotency mechanism: pre-read + `onlyIfNew` atomic write; replays and
  race-losers return the ORIGINAL record so fulfillment stays a pure
  function of first-write state. Raw buyer email lives ONLY here; tokens are
  never stored — only `sha256:` hashes (a store dump can't mint download
  links). Zod-strict, `reissues[]` ready for order_reissue (S3).
- **`commerce_event.v1`** (`netlify/lib/commerce-events.ts`): the §6
  substrate contract — 8 event types, one immutable JSON per event at
  `events/<yyyy-mm-dd>/<digits-ts>-<uuid>.json` (opt-ins layout; timestamp
  compacted to digits for local-FS key safety, still time-sorted).
  `appendCommerceEvent` is create-if-absent (immutable, replays no-op);
  `hashEmail` emits `sha256:<hex>` of the normalized address and the schema
  REJECTS anything in `actor.email_hash` that isn't that shape. Additive-only
  evolution documented in the module header.
- **Capture beacon** (`netlify/functions/save-commerce-event.ts`, the
  save-opt-in sibling): accepts ONLY the client-authored types
  (`product_viewed`, `checkout_started`) — authoritative types cannot be
  forged through the public endpoint; no email field accepted (hashed or
  raw); `data` is allowlisted (amount_cents/currency/mode), never
  passthrough; JSON parsed regardless of content-type (sendBeacon reality).
- Tests: 17 new (schema envelopes, PII rejections, idempotency + race
  paths, endpoint forgery/PII/allowlist) — suite 1021 green, astro check 0,
  eslint/prettier clean.

NOT in S1b: nothing reads these stores (by design, §6 — Blobs is not a
queryable database); S1c wires the writers (checkout session → webhook →
token delivery + success page), which is next on the critical path.

## Session 2026-07-12 D (S1a SHIPPED: `product` is the eighth object type — review-required, price-funnel enforced)

Shop build sequence started per [`06-shop-module-plan.md`](../06-shop-module-plan.md)
§9. **S1a is complete**: `product.v1` schema + object type + validation criteria

- contract + the review-required approval flip — the seam everything else hangs
  on. What exists now:

* **`product.v1` body schema** (`src/schema/bodies/product-v1.ts`): slug +
  presentation (title/excerpt/images/seo/`page_ref`/notes) + commerce
  (provider/mode/price/pwyw/stripe/stripe_test/availability, Stripe id shapes
  pinned so keys can't sit where ids belong) + **fulfillment as THE
  discriminated union** (`download` {artifact_ref, filename} / `unlock`
  {unlock_prefix} / `none`), all strict.
* **Type wiring end-to-end**: `objectTypes` + `prod_` id patterns/minting
  (minted from `slug`), store keys, `object_create` seeding, materializer →
  `src/data/site/products/{id}.json`, Ask-AI schema registry, admin
  `prod_→product` prefix map.
* **`set_product_fields`** patch op (deep-merge + exact inverse, the
  set_site_fields mechanics) with the **§3 canonicality funnel in the
  grammar**: `commerce.price` / `commerce.stripe` / `commerce.stripe_test`
  payloads are refused at write with a pointer to `product_set_price` (S3) —
  price drift is impossible by construction, not by discipline.
* **Validation criteria** (standing engine): `product_slug` (shape + live
  uniqueness via the new `isSlugTaken` store resolver — the isRouteTaken
  analogue), `product_commerce` (mode↔fields coherence: fixed⇒price cache,
  pwyw⇒pwyw block + NO Stripe Price, free⇒provider none + no linkage),
  `product_linkage` (publish-gated: 'available' fixed products need price_id
  or the pre-launch stripe_test mirror; coming_soon/retired publish without),
  `product_artifact` (Major-Key trust for download refs), and
  `commerce_price_sync` (§3 backstop; injected `resolveStripePrice`, optional
  until the Stripe surface lands). `presentation.page_ref` resolves through
  reference integrity like any object ref. `STRIPE_SECRET_KEY` /
  `STRIPE_WEBHOOK_SECRET` pre-marked in the deploy-safety scanner (§8.5).
* **The §0.4 flip**: `src/config/approval-policy.ts` pins
  `product: 'require-approval'` under the all-autonomous master — the one
  deliberate exception; publish-gate matrix tests updated to pin it.
* **Proven, not assumed** (sandbox, real MCP handler against an isolated
  store): contract → create (id minted `prod_barrier_repair_guide`) →
  duplicate-slug create BLOCKED → checkout → validate → patch applies →
  price-edit patch REFUSED (`product_set_price` pointer) → publish DENIED
  `approval_required` → inventory row `requires_approval: true`. All gates
  green: 1004 unit tests + 49 script tests, astro check 0 errors, eslint,
  prettier, full build (167 pages).

**Status: type BUILT, store empty by design** — no product records exist yet;
nothing here is "converted" (that vocabulary applies to store-backed content
objects, which arrive with S2's seeds). NOT in S1a (deliberately, per §9):
S1b stores/events, S1c checkout/webhook/delivery, the S3 tools
(`product_set_price`, `order_reissue` — criterion-4 completeness for the
type), roundtrip-drill support (parallelizable), and the W5 page conversions.

## Session 2026-07-12 C (W6 CONVERTED: the six listing objects are #32–#37 — the credentialed run)

Wolf's credentialed run (after one stale-checkout false start — the seed
module wasn't in his working tree until `git pull`; the driver's error named
the missing path correctly) came back **all-green in a single pass**: every
`ensure` created the store record, all six drilled every permitted page op
(page_article via its seed `drillProbe` — the section-less path working in
production), validated, **published** (export commits `7956b13` `d460db0`
`37dd040` `37fea10` `27a416c` `b0f8d90` on main, `[skip netlify]`), contract
6/6, inventory 6/6, and `release_to_production` confirmed **`released:true`**
(one poll). Byte-verified from this session against main: **store === seed
=== export** for all six (marker-stripped; record_version 11 across the
board).

All five criteria met → `page_library`, `page_topics_index`,
`page_topic_detail`, `page_category`, `page_tag`, `page_article` flipped to
🟢 CONVERTED across inventory / conversion-map / playbook / CLAUDE.md /
AGENTS.md in this change. **Converted count: 31 → 37.** W6 is closed: the
listing surfaces' headings/copy/SEO are live agent levers (`%term%` pattern
copy included), `page_article` governs every article page's SEO defaults and
below-post sections, and the P6/T6.1 "biggest remaining chunk" is done.
Remaining on the path: the shop module (own session, plan in
`06-shop-module-plan.md` — its S-phases now carry the W5 pages) and W7 rich
text (OQ-8, Wolf's checkpoint). Standing caveat repeated: `PUBLISH_SECRET`
is a temp value pasted in chat again this run — rotation stays mandatory
before real go-live (it is a named launch gate in the shop plan).

## Session 2026-07-12 B (SHOP MODULE PLAN: W5 re-grounded in commerce — plan, not code)

W6 merged (PR #408) and Wolf redirected W5: "do the pricing pages and the
rest of the W5 pages which were passed over — but add the payment system,"
with a Stripe-only v1 shop brief whose deliverable is **a development plan,
not code**. Survey findings that shaped it: /pricing and /services are
audit-confirmed Astrowind lorem leftovers (A§2.13, unlinked — nothing on the
site links to them), /solutions/shop-preview is real content, there is NO
Stripe surface or customer identity anywhere yet, and the commerce-relevant
prior art is the artifacts store + get-public-pdf delivery, the opt-ins
append-only capture, crypto.ts HMAC, and the object model itself.

**The plan is [`06-shop-module-plan.md`](../06-shop-module-plan.md).** Spine:
`product` as a governed OBJECT type (not an article-pipeline clone — pushback
recorded), fulfillment as the only discriminated union
(download/unlock/none), Stripe canonical for charge amounts with a
display-cache + `product_set_price` tool making drift structurally
impossible, product pages = product object + `page_ref` Page rendered by the
W6 section machinery (product-vs-article answered: different object, same
renderer), an append-only `commerce_event.v1` log designed for an unknown
consumer, Checkout Sessions only (Payment Links rejected in v1), idempotent
webhook→order→signed-token fulfillment with `order_reissue` as
launch-critical, and the W5 pages sequenced AFTER products exist so
pricing_table/steps/feature_grid/content_split mint with real content
(/services still needs Wolf's copy-or-delete call; seeding lorem refused).
Commerce publishes flip to review-required; PUBLISH_SECRET rotation +
SITE_NOT_YET_LIVE flip named as launch gates. Next session starts at S1a
(product.v1 schema) per the build sequence.

## Session 2026-07-12 (W6 BUILT + SEEDED: listing surfaces — the last unimplemented PageTypes are formalized)

Wolf: "Move to W6 on the conversion to CMS path." The T6.1 batch, built the
design-principles way: **the six listing/article page objects own headings/
copy/SEO; the query machinery stays the audited build-time derivation**
(A§2.5–2.7 — getStaticPathsBlogList/Category/Tag, fetchPosts, the topics
derivation; D§5.5 holds: topics remain category presentations, no Topic
entity).

- **PageType law completed** (`src/lib/registry/page-types.ts`): `listing`
  (allowed: lede/prose/cta_banner/newsletter_signup/content_grid/link_list/
  shared_ref; **required: lede** — the first lede IS the surface's header
  block; `listing: {source: 'content_items', defaultQuery
{sort: published_time_desc}, paginate: true}`) and `content_detail`
  (no lede — the post supplies its heading; **`minVisibleSections: 0`**, a new
  per-PageType knob on the ≥1-visible-section publish gate: page_article
  publishes with zero sections because the article IS its content).
  `unimplementedPageTypeIds()` is now empty; `object_contract('page')` and
  `registry_get('page_type')` serve all five definitions automatically.
- **Six objects seeded** (`scripts/lib/pages-listing-seed-data.mjs`), bodies
  verbatim transcriptions: `page_library` (/learn/library), `page_topics_index`
  (/learn/topics), `page_topic_detail`, `page_category`, `page_tag`,
  `page_article`. **Per-term surfaces are ONE object per route family with
  `%term%` pattern copy** (`src/lib/renderer/listing-term.ts`, deep string
  interpolation, unit-tested): `page_tag.title = "Posts by tag '%term%'"` is an
  agent-editable heading pattern — the loader substitutes each term's display
  label at build. Routes are self-describing family patterns
  (`/category/[category]`, `/%slug%`) — unique, and never emitted by the
  catch-all: `object-page-routes.ts` gained the `loader_owned_page_type` skip
  (listing/content_detail objects are served BY their loaders; without this,
  page_article's `/%slug%` route would have minted a literal page).
- **Wiring** (the six route files + shared plumbing): each loader reads its
  object via `loadRoutePageObject` (`src/utils/route-page-object.ts` — first
  visible lede → header copy; title/seo term-interpolated; pre-conversion
  literals as fallback when the export is absent, the W4 pattern), renders the
  header through the surface's EXISTING furniture (Headline / topics hub
  markup — byte-identical cutover), keeps pagination suffixes + robots gating
  as furniture (object seo.robots wins when set, config.yaml stays the
  fallback), and dispatches **every extra section through the component
  registry after the list/article** (`ObjectSections.astro` — hidden filtered).
  An agent can now put a cta_banner under the library list or a
  newsletter_signup below EVERY article with one patch op (proven with temp
  probes in dist, then removed). PageObjectRenderer's dep-building was
  extracted to `section-resolve-deps.ts` and shared — no behavior change.
- **Driver**: section-less pages drill via a seed-declared `drillProbe`
  (PageType-legal clone source; `roundtrip-drill.mjs`) — page_article
  exercises all six page ops like everyone else.

Gates: **1030/1030 tests** (981 compiled + 49 scripts; ~20 new) · astro check
0 errors · build OK (167 pages) · **build-diff EMPTY (168/168 identical)** —
a pure cutover · local driver run ALL GREEN (create → every permitted op
byte-identical → validate → publish blocked at the expected sandbox boundary →
contract 6/6 → inventory 6/6 → exports materialized).

**Status: the six listing objects are RENDERS + SEEDED, not CONVERTED** —
criteria 2/3 need the credentialed run after merge + deploy:
`node scripts/home-conversion-roundtrip.mjs --production --release --seeds scripts/lib/pages-listing-seed-data.mjs`
(schema-vintage gate applies: the deployed endpoint must carry the new
PageType definitions before the run). After it, 37 objects are converted and
the P6 exit criterion "every object type in the C§2.2 matrix exists in
production" is met for pages. Remaining waves: W5 hand-coded pages (Wolf:
separate session), W7 rich text (OQ-8).

**Follow-up in the same PR (Wolf: "address visibility: 'hidden' in the earlier
converted scope"): the never-render-private gap is CLOSED at the resolver.**
`resolveSections` (the pure layer BOTH render paths share — PageObjectRenderer
for the 12 converted pages + the object-page catch-all, and ObjectSections for
the listing surfaces) now skips a section when its page instance is hidden
(including a hidden `shared_ref`, which is not even dereferenced) OR when a
`shared_ref` target's own section object is hidden
(`parseSharedSectionExport` surfaces the inner `visibility`) — so
`set_section_visibility` on a shared section hides it on every page that
references it, matching the validator's `structure_visible` semantics. No
committed export carries `visibility` today, so the change is render-neutral:
build-diff EMPTY again. 4 new resolver tests pin all four cases.

## Session 2026-07-11 M (content_item resolver: manual article curation is agent-usable — trap 4 closed)

The first real step toward the article object model, per the post-W4 path
Wolf approved (resolver → W6 listings → OQ-8/W7):

- **`netlify/lib/content-item-index.ts`** — the committed article ids
  (filenames under src/data/post minus extension — exactly the renderer's
  `post.id`), fetched via the GitHub contents API with the same env contract
  as the object committer (the W3 ruling: committed frontmatter is the source
  of truth, never the blob drafts). 60s cache + in-flight dedupe;
  unconfigured/erroring → `undefined` = "cannot answer", stale-if-error after
  a first success.
- **Validation context** resolves `content_item` refs against that index:
  real ids pass, ghosts are blockers — `content_grid` manual picks and
  `content_embed.contentItem` validate against real articles at
  patch/create/publish.
- **Contract-conformance fix in `requireObject`**: the documented "resolver
  returns undefined = cannot answer" contract was never implemented — every
  undefined fell through to a hard failure, which is WHY trap 4 blocked
  manual curation for everyone. Now undefined degrades to "not verified"
  (local mode keeps working with no GitHub env); `{exists:false}` still
  blocks.
- **Render-side dead-end removed (no-pipeline-dead-ends rule)**: an
  unresolvable manual pick at BUILD time (a post deleted after the grid
  published — temporal drift validation can't prevent) is now SKIPPED with a
  loud build-log warning naming the id, and the declared fallback backfills
  the freed room. Previously it THREW (`ContentGridResolutionError`,
  removed): one content deletion could kill every future build.

Gates: 1012/1012 tests (7 new/updated) · astro 0 errors · build-diff EMPTY
(no manual grids exist yet; behavior changes are server-side + drift-only).
Agents can now curate: `update_section_data` switching a grid's source to
`{kind:'manual', items:[<post ids>], fallback:{…}}` validates, publishes,
renders. NEXT on the path: W6 listing surfaces.

## Session 2026-07-11 L (INCIDENT: agent content tripped the deploy secrets scanner — trap 14)

Wolf's agent, working the /about intro through the MCP (record_version 25 —
real autonomous editing), set `portrait.src` to an images.weserv.nl proxy of
`raw.githubusercontent.com/<repo>/…/dr-lurie-portrait4.jpeg`. That URL contains
the repo slug — the VALUE of the secret-marked `GITHUB_REPOSITORY` env var —
and Netlify's post-build secrets scan matches marked values (even URL-encoded)
in repo files and build output, so **every production deploy failed** from that
publish onward (the build itself compiled clean; the block is the scan).
Everything published since the last good deploy (the agent's nav/home/site
edits, the W4 record, the object-page catch-all) sat dark until healed.

Resolution (final — zero operator actions; Wolf ruled against spending effort
on a credentialed heal for one image):

- **ENFORCEMENT, not advice — two new validation groups in `validateObject`**,
  run on patch AND create AND publish, so agents get the named blocker at
  write time: `deploy_safety` (no renderable string may contain a protected
  env value — raw, URL-encoded, or double-encoded, matched case-insensitively;
  the error names the KEY, never the value; the repo-file hotlink URL families
  raw.githubusercontent/weserv are blocked outright) and `renderability`
  (trap 5 closed: every field a component splits is checked with the REAL
  splitters, so paragraph-only bodies carrying headings/lists — which pass the
  global allowlist but throw at build — are blockers; FAQ answers per item).
- **The committed export corrected in-repo** (one field: `portrait.src` →
  `/images/dr-lurie-portrait4.jpeg`, the photo the agent wanted, shipped in
  `public/images/` in the same change). Hand-editing an export is normally
  the anti-pattern (the next publish clobbers it) — here it is safe BECAUSE of
  the new guardrail: the store record still carries the bad URL and now CANNOT
  republish until an agent fixes that field (the validation error tells it
  exactly what and why). Quarantine + fix-forward; no credentialed run needed.
- **Merging this change alone unblocks all deploys**: the slug no longer
  appears anywhere in repo files or build output (repo-wide sweep clean), so
  the scanner passes with the env config untouched. Unmarking
  `GITHUB_REPOSITORY` as a secret remains OPTIONAL hardening.
- Also shipped: the bio `portrait` editor hint names sanctioned image sources;
  `scripts/fix-about-portrait.mjs` kept as the store-heal template (trap 14);
  playbook trap 14 + refreshed reality-check; two lifecycle-test fixtures that
  carried never-buildable bare-text prose bodies were themselves caught by the
  new renderability check and fixed.

## Session 2026-07-11 K (object-page catch-all: agent-CREATED pages are now live end-to-end — B1 closed)

The last plumbing between "agent creates a page" and "that page is on the
site": every converted page had a hand-written one-line loader file, so a NEW
page object published + released was store-backed but unreachable. Now
`src/pages/[...objectPage].astro` serves any published Page object whose route
no file owns, via the standard PageObjectRenderer. Ownership rules are pure +
unit-tested (`src/utils/object-page-routes.ts`): file routes always win (the
12 converted pages emit nothing here), article permalinks and the reserved
path families (blog list/category/tag bases from config.yaml per B2,
learn/topics, admin) are refused — and every refusal is a loud build-log
warning naming the object, never a silent drop. Route collisions between page
objects are already blocked live at validation (`isRouteTaken`).

Proof: a temp probe export at `/rt-probe-page` built and served (168th page,
site-object titleTemplate applied) then removed. Gates: astro 0 errors ·
999/999 tests (5 new, incl. "the real committed exports emit ZERO paths
today") · build OK · **build-diff EMPTY**. The full agentic loop is now:
instantiate/create → patch → validate → publish → release → **live at its
route** — no code change per page.

## Session 2026-07-11 J (W4 CONVERTED: site_drlurie is object #31 — after a production credentials outage)

Wolf's credentialed run went green after three failed attempts whose root cause
was **environment, not code**: every object verb 500'd because Netlify Blobs
rejected the store credentials. The diagnosis chain, recorded because it will
recur: (1) the generic 500 hides the real error — it lives in the Netlify
function log after `Object_Store request failed.`; (2) first failure was
`BlobsInternalError (401)` — the token env var held a non-token value (an
all-a–p string, i.e. a clipboard/extension-ID mishap or an expired credential);
(3) mid-repair, `MissingBlobsEnvironmentError` = siteID/token env vars absent
entirely (the MCP function proxies object verbs in-process, so the
platform-injected Lambda blob context never reaches the store — the explicit
env vars do ALL the work); (4) the release path can still report green while
blobs are down (deploys API tolerates things blobs does not — including the
site NAME where blobs requires the UUID), so a green release proves nothing
about store health. **The 5-second local probe that isolates it** (run from the
repo, no redeploys): `getStore({name:'site-objects', siteID:<UUID>,
token:<PAT>}).list(...)` via `node --input-type=module`. Fix: fresh `nfp_` PAT
in `NETLIFY_AUTH_TOKEN` (no separate `NETLIFY_BLOBS_TOKEN` — one live token,
both paths fall back to it), `NETLIFY_SITE_ID` = the site UUID, redeploy.
TODO(nice-to-have): expose `getCoreBlobStoreSourceDiagnostics` as a read-only
`blob_store_diagnostics` MCP tool.

The run itself: create → `set_site_fields` drill byte-identical → validate →
publish → contract (1 op ≡ exercised) → inventory → release `released:true`.
Export commit `a20f107` (`Publish site: site_drlurie [skip netlify]`);
**store === seed === export byte-verified** post-release. `site_drlurie` is
🟢 CONVERTED — **31 objects converted**; the layout renders chrome/brand/
metadata/default-nav from the store-backed object with `set_site_fields` as
the agent's lever.

## Session 2026-07-11 I (W4 BUILT + WIRED: the site singleton renders the chrome — pending credentialed run)

Wolf's W4 answers locked the scope (B1 autonomous publish; B2 urls/blog carried
but config.yaml stays authoritative for routing; B3 announcement deferred). The
singleton is built end-to-end and the layout renders from it:

- **Seed** (`scripts/lib/site-seed-data.mjs`): `site_drlurie`, a byte-identical
  transcription of the previously hardcoded values — name/urls/metadataDefaults/
  blog from config.yaml, logo.text from Logo.astro, brandTokens from the
  CustomStyles literals (colors keyed by var name minus `--aw-color-`, dark
  overrides under `dark:` keys), chrome flags + defaultNavigation from
  PageLayout. 5-test seed suite (schema/id/validation clean; dangling
  defaultNavigation ref proven a real blocker; token set covers every custom
  property).
- **Wiring** (`src/utils/site-object.ts` + 5 consumers): CustomStyles renders
  every custom property from brandTokens; Logo text; PageLayout header/footer
  nav ids + Header chrome flags; PageObjectRenderer footer default; Metadata
  gains a metadataDefaults layer (titleTemplate/description/ogImage/twitter
  handle/og site_name) between config.yaml and per-page props. All with the
  pre-conversion literals as fallback when the export is absent.
- **The trap this session found (recorded for every future wiring): an `await`
  in previously-sync component frontmatter flips astro-icon's `<symbol>`/`<use>`
  placement.** First wiring used a memoized async `getEntry` loader — build-diff
  lit up 153/168 pages, ALL of it icon-sprite placement shifts (Astro evaluates
  sibling components concurrently; any new microtask changes which instance
  renders first and wins the symbol). Fix: the loader is a deliberately
  SYNCHRONOUS eager `import.meta.glob` (zero-or-one match, absent → undefined),
  so frontmatter that was sync stays sync. Re-run: **build-diff EMPTY**.
- **Driver**: `site` support — `siteDrillOps` (`set_site_fields` is the type's
  only op: poke name + restore), reconcile = one `diffFieldsForMerge` fields op
  (trap-2 stray-nulling), materializeSite dispatch. Local rehearsal green: full
  lifecycle create → drill → validate → publish (sandbox boundary) → contract
  (1 op advertised ≡ exercised) → inventory → site.json materialized.

Gates: astro 0 errors · 994/994 tests (8 new) · build OK · **build-diff EMPTY**
(the byte-identical cutover held). Still config-owned deliberately: i18n,
ui.theme, analytics, googleSiteVerificationId, trailingSlash, and routing
(urls/blog are carried, not wired — B2). NEXT: Wolf's credentialed run
(`node scripts/home-conversion-roundtrip.mjs --production --release --seeds
scripts/lib/site-seed-data.mjs`) flips site_drlurie to CONVERTED (#31).

## Session 2026-07-11 H (content cleanup: 10 junk posts dumped, 18 surfaced — PR #402 merged)

Wolf ruled on the 28 invisible posts ("you be the judge"): judged by content —
deleted 10 (5 twenty-three-word "After N" stubs, 4 pipeline-test artifacts,
1 malformed notes file), stamped `published_time` (from each `publishDate`) on
the 18 real ones. Site 123 → 167 pages; topics hub renders all 5 registry
categories; tag pages 18 → 26. The standing "28 posts invisible" caveat is
CLOSED.

## Session 2026-07-11 G (W3 STEP 2 SHIPPED: publish-article taxonomy enforcement + frontmatter normalization + registry labels)

Wolf picked "slugs + label lookup". The bounded exception is built — full §5.5
for articles, in three pieces:

- **Enforcement hook** (`netlify/lib/taxonomy-enforcement.ts` + a minimal
  insertion in `publish-article.ts` before `buildFrontmatter`): when the
  tax_drlurie registry exists in site-objects, every category/tag on a publish
  resolves BY SLUG (labels and slugs both work), following `merged_into`
  aliases (cycle-guarded); unresolvable terms → 422 `TAXONOMY_TERMS_UNRESOLVED`
  with the offender list; resolved terms are materialized into frontmatter as
  their CANONICAL SLUGS (deduped). **No registry → skipped, byte-identical old
  behavior** — the bounded-exception guarantee is structural: all 56
  pre-existing publish-article tests run storeless of taxonomy and pass
  unchanged. Record free-strings stay lossy input (§3.10 untouched).
- **One-time normalization** (`scripts/normalize-taxonomy-frontmatter.mjs`,
  standing tool + audit trail): all 93 posts rewritten via RAW_TO_CANONICAL —
  category kept 11 / dropped 3 (test posts); tag usages kept 122 / dropped 235
  (the junk). Line surgery only; tag-list style preserved per file. One mapping
  added beyond the approved table: tag `Health` → `skin-health` (the category
  map already absorbed it; obvious cluster variant).
- **Registry display labels** (`src/utils/blog.ts`): getNormalizedPost now
  resolves category/tag titles from the taxonomy export by slug (memoized
  `getEntry('taxonomyObject', …)`; raw-string fallback when absent). Labels
  are registry-governed — rename a label in tax_drlurie and every card, chip,
  tag page, and topics entry updates on the next build.

Gates: **986/986 tests** (8 unit + 2 integration new — the integration pair
drives the REAL handler against the REAL seed registry in an isolated local
store: canonical-slug frontmatter committed on success; 422 + nothing committed
on junk). astro 0 errors; build OK. **build-diff reviewed and intended**: 90
only-in-base pages = junk-tag listing pages gone; 11 only-in-head = canonical
merged-term tag pages (+ pagination); 75 changed = article pages' tag chips +
kept tag pages now registry-labeled. Site: 202 → 123 pages.

**Discovered, pre-existing, out of scope (flagged to Wolf):** `fetchPosts()`
filters to posts with a finite `published_time`; 28 of 93 posts (including ALL
11 categorized ones) lack it, so they are invisible in every listing/tag/topics
surface TODAY — the /learn/topics hub renders zero topics at HEAD and after
this change alike (build-diff: byte-identical). Fixing means stamping
`published_time` on those 28 posts (an article-pipeline pass, Wolf's call).

## Session 2026-07-11 F (tax_drlurie CONVERTED — object #30; taxonomy registry live in production)

Wolf ran the credentialed taxonomy command; single all-green run: ensure
(created) → drill (all 5 term ops: add/update/deprecate/reactivate/remove,
byte-identical) → validate → published → contract 5/5 → inventory →
`released:true` (one transient `build_not_confirmed_live` poll, then confirmed).
Export commit `627fa8d` on main; byte-verified store === seed === export
(5 categories + 26 tags, mint-convention ids). All five criteria met → flipped
🟢 CONVERTED across inventory / conversion-map / reality lines.

**Converted count: 29 → 30.** The taxonomy registry is now live: the store
validation context wires `resolveTaxonomyTerm` automatically, so `content_grid`
query terms validate against the real curated vocabulary in production from
this moment.

**Open next (Wolf's call pending on the design fork):** step 2 — the bounded
publish-article enforcement hook + one-time frontmatter normalization of the
93 posts via the committed `RAW_TO_CANONICAL` map. Fork presented to Wolf:
normalize frontmatter to canonical SLUGS per §5.5 + teach the blog renderer to
look up display labels from the registry (recommended — labels become
registry-governed), or normalize to canonical LABELS (zero renderer change,
display strings stay in frontmatter). Awaiting his pick before writing the
sanctioned publish-article exception.

## Session 2026-07-11 E (W3 DECIDED + SEEDED: tax_drlurie — curated agent-editable vocabulary)

**The taxonomy checkpoint is answered.** Wolf first proposed converting the whole
article pipeline (publish-article + workflow) to the new schema so taxonomy
would be unblocked; assessment: right destination, wrong prerequisite — the
pipeline is ~4,700 lines / 31 tool surfaces / 27 test files of load-bearing,
deliberately-frozen contract (§3.10 protects ContentSourceV1; OQ-8 unresolved),
and taxonomy enforcement needs only a HOOK in the publish step, not a new
envelope. **Wolf approved the recommended path:**

1. **Curated registry now (this session):** `tax_drlurie` = agent-editable
   vocabulary, seeded from a CLEANED canonical set Wolf approved term-by-term —
   5 categories + 26 tags distilled from the raw frontmatter of 93 posts
   (158 distinct tag strings; ~2/3 of usage pipeline-test junk; real terms split
   across casing variants — e.g. skin-barrier ×3 spellings = 18 uses). The
   approved raw→canonical mapping is committed as `RAW_TO_CANONICAL` in the
   seed module (step 2's normalization input). Judgment calls recorded:
   Market→skincare, retinol+retinoids→retinoids, photoaging/sun damage→
   sun-protection, essays kept under `reflections`, melanin-rich-skin dropped
   (promotable later — the registry is editable data; nothing is locked in).
2. **Step 2 (next): bounded publish-article enforcement hook** — a third
   sanctioned additive exception to the off-limits rule (resolve article terms
   against the registry at publish time per §5.5/§5.6-step-2, following
   `merged_into` aliases) + one-time frontmatter normalization via the map.
3. **Full content_item→ObjectRecord conversion**: deferred as its own wave
   (OQ-8 adapter-vs-migration decided then) — explicitly NOT a prerequisite.

Built: `scripts/lib/taxonomy-seed-data.mjs` (registry body + mapping); driver
extended to taxonomy (drill = all 5 term ops via a probe tag — add → relabel →
deprecate → reactivate → remove, byte-identical; reactivate_term is
inverse-machinery but advertised, so the drill exercises it; reconcile =
wholesale per-kind rebuild, since there is no reorder op and slug renames mint
aliases; materialize → src/data/site/taxonomy.json). Local rehearsal all-green
(create → 5 ops → validate → publish at sandbox boundary → contract 5/5 →
inventory → export). Gates: **976/976 tests**, astro 0 errors, build OK,
build-diff EMPTY (the registry renders nothing itself; its first live consumer
is store-side validation — resolveTaxonomyTerm wires automatically in
production the moment the record exists, so content_grid query terms start
validating for real).

**Status: tax_drlurie is SEEDED, not CONVERTED** — one-command credentialed run:
`node scripts/home-conversion-roundtrip.mjs --production --release --seeds scripts/lib/taxonomy-seed-data.mjs`
(after merge + deploy — schema-vintage gate: the taxonomy drill needs nothing
new server-side, but run on latest main anyway).

## Session 2026-07-11 D (BATCHED CREDENTIALED RUN: 13 objects CONVERTED — the page + template backlog is cleared)

Wolf ran `./scripts/convert-pending-production.sh --verify-only` (all green) then
the real `./scripts/convert-pending-production.sh` from his credentialed laptop.
The single run created/reconciled, drilled every permitted op, published, and
released all 13 SEEDED objects in one deploy (`release poll: released` →
`SUCCESS — store-backed, round-trips every permitted op, and published`):

- **8 W1 pages** — page_start_here, page_member_updates, page_newsletter,
  page_free_guide, page_early_access (lede); page_privacy, page_terms (prose),
  page_404 (cta_banner).
- **3 W2.5 templates** — tpl_interior, tpl_landing, tpl_legal (all 4 template
  ops round-tripped + instantiate `dry_run` proven).
- **2 W2 form pages** — page_contact, page_thank_you.

Every `ensure` reported "already matches the seed" (store === seed); the 13
`Publish …` commits are on main and carry the decomposed exports (store ===
export); inventory returned all 13. All five criteria met → flipped to
🟢 **CONVERTED** across object-inventory / conversion-map / this log /
CLAUDE.md / AGENTS.md.

**Converted count: 16 → 29.** All 12 page objects + all 3 templates + the 3 nav
objects are now store-backed and agent-editable. **The rendered-stub backlog is
empty** — no page renders from an unbacked export anymore. The now-cleared batch
harness (pending-conversion-seeds.mjs + convert-pending-production.sh + its test)
is retired; the batching PATTERN stays documented in the playbook for the next
wave. `PUBLISH_SECRET` was pasted in chat and the run went live — **rotate it
before any real go-live** (standing caveat, still open).

Next: W3 taxonomy (Wolf's source-of-truth decision — the open checkpoint) and
W4 site singleton.

## Session 2026-07-11 C (W2 SHIPPED: /contact + /thank-you decomposed — the palette is now FULLY GENERIC)

Wolf: "Continue with W2." Answered the three framing questions (generic
decomposition + accept a scoped diff; reuse content_grid cards with an added
optional icon rather than a new feature_grid type; rename thank_you). The last
two bespoke per-page section types are retired — **no single-use page type
remains** (design-principles rule 1 fully satisfied):

- **/contact** decomposed off the bespoke `contact` type into 3 inline GENERIC
  sections: `lede` (kicker + heading) + `contact_form` + `content_grid` (`cards`
  source). To carry the current copy without a new type:
  - `gridCardCellSchema` gained an optional `icon` (Tabler name); ContentGrid
    renders it above the cell — the "how we can help" feature-grid shape as
    curated cards.
  - `contact_form` gained optional `subtitle`/`description`; ContactForm renders
    them (the name/email/message field set stays fixed furniture).
    The bespoke `contact` type + `ContactPage.astro` + `contact.ts` are REMOVED
    (compile-lockstep gate). Intentional **scoped rule-4 visual diff on /contact**
    (build-diff: 1 changed page; all copy + 6 icons + the Netlify form preserved,
    only the widget→generic-component markup changed).
- **/thank-you**: the `thank_you` type was RENAMED to the reusable
  `form_confirmation` (ThankYou.astro → FormConfirmation.astro, thank-you.ts →
  form-confirmation.ts; the `?form=` swap script is unchanged). It was already
  fully data-driven — this makes the palette name honest. **Renders
  byte-identically** (build-diff: /thank-you unchanged). The route `/thank-you`
  and the `?form=` post targets are untouched.
- Seeds: `scripts/lib/pages-forms-seed-data.mjs` (page_contact + page_thank_you,
  both `standard`, sections inline). Exports regenerated via the driver.
- Gates: **969/969 tests**, astro check 0 errors, build OK, build-diff = exactly
  1 scoped change (/contact), reviewed. Local round-trip proven for both pages.

**Status: page_contact + page_thank_you are RENDERS (decomposed, local proof),
not CONVERTED** — production store records land with the batched credentialed
run (`--seeds scripts/lib/pages-forms-seed-data.mjs`). Sixteen converted objects
unchanged. Remaining waves: W3 taxonomy (Wolf's decision), W4 site, W5+ pages.

## Session 2026-07-11 B (W2.5 SHIPPED: templates activated — instantiate verb + 3 starter recipes)

Wolf confirmed the two understandings (the MCP edit surface varies per
object/PageType through the always-exact, self-describing contract; the W1
credentialed run is postponed until all page types are ready) and said
"proceed" — so W2.5 was built end-to-end:

- **`src/lib/template-instantiate.ts`** — pure builder: template slots → page
  body. Blueprint → deep-copy with a fresh deterministic `s_` id; required
  slot without blueprint → registry `defaultData` of its first allowed type
  (the exact promise the `template_required` warning makes); optional empty
  slot → skipped; `page.template = {ref, instantiated_at}` provenance stamped;
  pageType defaults to `appliesTo[0]` (explicit `page_type` must be within a
  non-empty `appliesTo`).
- **`instantiate` verb** (object-verbs.ts) — loads the template (must EXIST,
  draft fine), builds the body, then **delegates to the existing `create`
  case**: one write path, so route uniqueness, PageType law, reference
  integrity, and reader safety all gate an instantiated page exactly like a
  hand-authored one ("law beats recipe" is a pinned test). `dry_run: true`
  returns the built body + would-be id + `id_available` + full validation and
  persists NOTHING. Exposed as the **`object_instantiate_template`** MCP tool
  (also available to the admin mirror via the shared verb core); surfaced in
  `object_contract('template')` and `('page')` workflow sequences.
- **Starter recipes** (`scripts/lib/templates-seed-data.mjs`): `tpl_interior`
  (standard: lede + prose + optional cta), `tpl_landing` (standard: hero +
  curated card grid + cta), `tpl_legal` (system: one required blueprint-less
  prose slot — keeps the defaultData fallback exercised). Blueprints are
  self-contained; blueprint ids are `s_<alnum>` (no underscores — the id
  regex bit once).
- **Driver extended**: seeds may be `objectType: 'template'`; drill covers all
  4 template ops via an always-legal probe slot; reconcile heals templates
  (meta diff excludes `slots`; positioned wholesale slot upserts + stray
  removal + explicit ordering); `--write-exports` materializes to
  `src/data/site/templates/`; and a per-template **instantiate dry_run proof**
  runs after the drill (no probe pages left behind, production-safe).
- **Local rehearsal all-green**: ensure(create) → all 4 ops byte-identical →
  validate → publish blocked at the expected sandbox boundary → 3/3
  instantiate dry_runs eligible → contract 4/4 ops → inventory 3/3 →
  exports written. Gates: **963/963 tests**, astro check 0 errors, build OK,
  **build-diff EMPTY** (templates render nothing — expected).
- Docs: playbook "Template families" section + `object_instantiate_template`
  call-table row; conversion-map TEMPLATES node → 🟡 ACTIVATED/SEEDED; W2.5
  row → DONE (code + seeds); inventory "Singletons & templates" table added.

**Status: the three templates are SEEDED (local proof), not CONVERTED** — the
production store records land with the batched credentialed run
(`node scripts/home-conversion-roundtrip.mjs --production --release --seeds
scripts/lib/templates-seed-data.mjs`, after merge+deploy; batch it with the
postponed W1 run). Sixteen converted objects unchanged.

## Session 2026-07-11 A (ARCHITECTURE DECISION: templates are recipes, PageTypes are law)

Wolf posed the standing tension directly — flexibility (generic components,
agent responsibility) vs strict rules (encoded per set page) — and proposed:
generic objects only + a template per specialty page. Repo survey confirmed the
template machinery is BUILT and dormant (template.v1 schema with
slots/allowed/required/repeatable/blueprint, 4 patch ops, validation,
materializer — but zero instances and NO instantiate flow; deferred to P6 by
the original plan). **Decision (Wolf): adopt the sharpened form — recipes + law
split** (now design-principles.md rule 5, GOVERNING):

- Palette stays generic-only and grows ON DEMAND (Wolf's second choice — no
  speculative upfront library).
- Templates = data recipes, agent-editable, creation-time COPY + provenance
  only (D§3.6 stands; live inheritance explicitly rejected — the propagation
  trap).
- PageTypes (code registry + validation criteria) remain the only enforced
  structural law. Behavior stays in generic components, never templates.
- PageType-as-data (OQ-4) considered and deferred: guardrails must not become
  agent-mutable unless agents should invent page _kinds_.

**Implementation queued as W2.5 in the map** (~1–2 sessions, net-new):
`instantiate_template` MCP verb (copy slot blueprints → new page body, stamp
`page.template`), a starter recipe set (tpl_interior / tpl_landing /
tpl_legal), a template drill in the round-trip driver, contract surfacing,
docs. Remaining W2 (contact/thank_you) now explicitly decomposes into generic
types per rule 5 — the last two bespoke types retire with it.

## Session 2026-07-10 G (W1 batch: 5 lede + 3 system pages seeded for conversion)

Wolf: do the next low-question conversions. The cleanest batch is the 8
interior + system pages — all already thin `PageObjectRenderer` loaders with
committed single-section exports (no restructure needed, unlike home/about):

- **One combined seed module** `scripts/lib/pages-interior-seed-data.mjs`
  (`SEED_SITE` + `CONVERSION_SEEDS`, 8 `page` entries): the 5 `lede` bodies
  reused verbatim from `page-lede-family-seed-data.mjs`, the 3 `system` bodies
  (privacy/terms `prose`, 404 `cta_banner`) inlined verbatim from their
  committed exports (the large legal copy taken exactly, not re-transcribed).
  page_newsletter stays a plain `lede` (Wolf's D2 choice; the shared newsletter
  section can be added later).
- **No rendering change**: these pages already render from committed exports, so
  the conversion adds only the store-backed + round-trip half. The PR is just
  the seed module + test; the 8 seed bodies byte-match the committed exports
  (materialized exports reverted as marker-only churn).
- **Gates:** astro check 0 errors; 899 netlify/src + 37 scripts tests green (3
  new); build green (202 pages); dist grep confirms all 8 render; local
  `--seeds pages-interior` round-trip all-green (every page drilled all 6
  permitted ops via the inline-section probe).

**Status: RENDERS, not yet CONVERTED** — the credentialed
`node scripts/home-conversion-roundtrip.mjs --production --release --seeds
scripts/lib/pages-interior-seed-data.mjs` run creates the 8 store records and
proves the production round-trip (criteria 2/3). After it, 10 pages are
converted (home, about, + these 8), leaving only contact + thank_you.

**Also this session (Wolf's D1 = yes, separate PR):** the now-orphaned bespoke
`about` section TYPE was RETIRED — union member, `About.astro`, its registry
module + binding, the registered-types/object-contract/resolve.ts entries, and
two test artifacts all removed (the `componentRegistry` `Record` forces the
union + binding to change in lockstep, so a miss is a compile error). No live
data migration (zero objects were `type: 'about'`); build-diff EMPTY (203/203)
— nothing rendered it. 17 registered section types remain.

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

**Status: CONVERTED (all five criteria).** Wolf ran the credentialed
`--production --release --seeds page-about` run: all 9 objects created,
every permitted op drilled, published (9 export commits `e0a36af`…`029142c`
on main), and `release_to_production` confirmed `released:true` (the resilient
poller's first `build_not_confirmed_live` then `released` — the 504 fix
working as designed). Byte-check: all 9 published exports === seed (no drift);
page_about record_version 10; the intro bio kept the portrait. **Sixteen
objects converted total** (3 nav + home family + /about family); the reality
lines were flipped across CLAUDE.md/AGENTS.md/playbook/inventory/map/core-structure.

**Follow-up flagged:** the `about` section TYPE is now orphaned (no object uses
it) — retire it (union member + About.astro + registry + resolve.ts entry +
fixtures) in a separate focused change.

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
