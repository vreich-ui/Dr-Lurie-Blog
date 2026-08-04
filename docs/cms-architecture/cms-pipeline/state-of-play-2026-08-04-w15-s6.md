# State-of-play entry — 2026-08-04 (W15 S6)

> **Standalone-file note:** same constraint the S2 and S3 sessions hit —
> this session also has no working `git push` (direct push to the git
> remote returns 403 in this sandbox; only the GitHub contents/PR API is
> available), and `state-of-play.md` is 412 KB, too large to safely carry
> as a full-file replacement through that API. Committed as its own file
> in the same style as `state-of-play-2026-08-04-w15-s2.md` (still unfolded
> as of this session — see note below). **Fold BOTH this entry and the S2
> entry into the top of `state-of-play.md` (below the header, in
> chronological order: this S6 entry above S2's) in the next local commit,
> then delete both standalone files.**

## Session 2026-08-04 (W15 S6 — fleet verification + status)

Final stage of the scheduled [W15-fleet] sequence: an autonomous verification
pass over everything the earlier sessions produced, run against a fresh
clone of `main` and the live GitHub PR/branch state (read-only — nothing in
this session merged, deployed, or released anything).

**Headline finding: two PRs report "merged" on GitHub but their commits are
NOT reachable from `main`.** `git merge-base --is-ancestor` against
`origin/main` was run for every [W15-fleet] PR's head commit:

- **#500 (S1)** — squashed into `main` as `27696ed`. Confirmed present.
- **#502 (S2)** — squashed into `main` as `776e59e` (current `main` HEAD at
  the time of this session). Confirmed present.
- **#503 (S3 — tenant retrofit)** — GitHub reports `merged: true`,
  `merged_at: 2026-08-04T12:08:17Z`. Its head commit
  `676de97ff207f991ba1a666ee3e7fb35ef91f171` is **not an ancestor of
  `main`** and no `w15/*` branch remains that contains it — the commit only
  still exists because GitHub hasn't garbage-collected it yet (fetchable by
  SHA). S3's own PR body already flagged the risk: it was based on
  `w15/s1-admin-core-repairs` because "S2 never ran" at the time it was
  authored; S2 landed 17 minutes later and squash-merged/deleted that base
  branch out from under it. The apparent GitHub merge afterward did not
  bring the diff into `main`.
- **#504 (S4x — canvas Ask-AI context enrichment, NOT the Marginalia
  editor)** — same pattern. `merged: true`, `merged_at: 2026-08-04T12:19:31Z`,
  head `6dd7f4d3dde2be6d23d488aa4b4a2f65d79a0266`, **not an ancestor of
  `main`**. This PR was not part of the originally scheduled S1–S5 sequence
  — it appears to be additional prompt-assembly work for canvas Ask-AI
  (folds `editorial_voice`, claims/compliance, section notes, and review
  state into the AI suggestion prompt; explicitly out-of-scope for
  Marginalia/canvas UI). Scoped, tested (5 new tests, 1640+89 passing per
  its own PR body), and by its own account inert in production today (no
  site has a live `editorial_voice` object yet) — but it is also orphaned
  and needs the same recovery action as S3.

Recovery for both is mechanical (cherry-pick or re-branch from the orphaned
SHA and re-open a PR against current `main`) but is a human/next-session
decision, not something this read-only verification session should do.

**What's actually verified in `main` (S1 + S2 only):**

- `npm ci` — clean, 1050 packages.
- `npm run check` — 0 errors, 0 warnings (12 pre-existing `ts(6133)`/`ts(7043)`
  hints, unrelated to W15).
- `npm test` — 1636 + 102 pass, 0 fail.
- `npm run build` (root, Dr-Lurie) — 75 pages, success.
- `astro build --config sites/platform/astro.config.ts` — 44 pages, success.
- `node scripts/audit-site-admin-parity.mjs --all` — PASS for all three
  tenants (`sites/fernwell`, `sites/platform`, root/drlurie): 12/12
  automatable checks, 3 human-gated rows each (Identity enablement,
  admin env values, live store probe — all account-authority actions,
  expected).
- `node packages/core/cli/create-site.mjs --name w15s6probe --dry-run` — full
  73-file genesis plan printed (shell routes, 34 function shims, 14 infra
  redirects, blog reader loaders, blob-store probe list, ADMIN WORKSPACE
  BOOTSTRAP checklist), zero files written. Proves a **future** client is
  born at admin parity by construction, not just the three current tenants.
- 7-assertion headless-Chromium drive (Playwright, mocked GoTrue session +
  `/.netlify/functions/admin-*` endpoints, replicating
  `sites/platform/netlify.toml`'s actual S1 rewrite rule byte-for-byte)
  against the built `sites/platform` output — **7/7 checks pass**:
  `/admin` reachable; `/admin/content` (library) loads; the S1 regression
  target `/admin/content/page_home` resolves **without** a `?type=` param;
  "Back to library" returns to the static library index with no loop;
  a signed-out visitor triggers zero admin/identity network calls and never
  fetches the real edit-mode bundle (only the ~600B always-present
  pre-check script loads, confirmed by content-matching the bundle that
  actually exports `bootEditMode`, not just filename substrings — the
  naive filename check false-positived on `policy-bindings.*.js`, which
  customer-facing header/login components also import).

**Still-open bug confirmed live**: S3 diagnosed that `sites/platform`
inherits Dr-Lurie's committed `src/data/post/test-article-dry-run.md` via
shared `postDir`, so `kugel-platform` serves a leaked test post at
`/test-article-dry-run` (and lists it on `/library`). Because S3's fix never
reached `main`, this is **still present** in the current `sites/platform`
build — confirmed by building it fresh this session: 44 pages, including
`dist-platform/test-article-dry-run/`. This is a real, currently-live defect
on the public site, not a stale audit finding.

**Deferred stages, as scheduled — not failures:**

- **S4 (Marginalia editor)** — no PR, no branch. Deferred for cost per
  standing instruction. (Not to be confused with #504/S4x above, a
  different and much narrower piece of work.)
- **S5 (client publishing chat / LibreChat)** — no PR in `platform`, and no
  `[W15-fleet]`-tagged PR in `vreich-ui/CMS-Agent` (checked both
  `search_pull_requests` and a full recent `list_pull_requests`). Deferred
  for cost per standing instruction; `deploy/librechat/librechat.yaml`
  validation and per-client publisher-agent-preset checks were skipped
  because there is nothing to check.

**Fleet parity, current state:** all three tenants (Dr-Lurie/root, Platform,
Fernwell) pass the S2 audit at 12/12. A fourth, throwaway scaffold proves
future-client genesis at the same parity. No fleet-wide gap is open on the
audit's own terms — the open items are the two orphaned PRs above and the
one live leak they would have fixed.

Full write-up, with per-stage table and the ordered human checklist:
`docs/cms-architecture/FLEET-STATUS.md`.
