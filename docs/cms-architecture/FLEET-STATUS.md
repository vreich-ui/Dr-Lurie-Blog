# Fleet status — W15

_Last verified: 2026-08-04, by the S6 verification session. Re-run `node scripts/audit-site-admin-parity.mjs --all` any time for a live check._

## What to review first

Two PRs — **S3 (tenant retrofit)** and **S4x (Ask-AI context enrichment)** — show as "Merged" on GitHub, but their code never reached `main`; a squash-merge race with S2 landing in between appears to have orphaned both. The practical effect you can see right now: **`kugel-platform` is serving a leaked Dr-Lurie test post** at `/test-article-dry-run` (and it's listed on `/library`) — S3 had already fixed this, but the fix isn't live. Re-landing S3 (checkbox 1 below) both closes that leak and finishes the tenant retrofit; S4x is lower-stakes (untested-in-prod prompt changes) and can wait.

## Stage status

| Stage | What it was | Status | PR |
|---|---|---|---|
| S1 | Admin core repairs | Merged (partial — 1 of 4 planned fixes; the other 3 were never diagnosed) | [#500](https://github.com/vreich-ui/platform/pull/500) |
| S2 | Fleet admin genesis + parity audit | Merged, verified | [#502](https://github.com/vreich-ui/platform/pull/502) |
| S3 | Retrofit existing tenants to parity | **Reports merged, code NOT in main** — needs re-landing | [#503](https://github.com/vreich-ui/platform/pull/503) (orphaned commit `676de97`) |
| S4 | Marginalia editor | Deferred for cost — not started | — |
| S4x | Ask-AI context enrichment (unplanned add-on, not Marginalia) | **Reports merged, code NOT in main** — needs re-landing, lower priority | [#504](https://github.com/vreich-ui/platform/pull/504) (orphaned commit `6dd7f4d`) |
| S5 | Client publishing chat (LibreChat) | Deferred for cost — not started, nothing in CMS-Agent either | — |
| S6 | This verification pass | Done (this PR) | — |

## Tenant admin parity (S2's audit, re-run this session)

| Tenant | Admin parity | Notes |
|---|---|---|
| Dr-Lurie (root) | ✅ 12/12 | |
| Platform | ✅ 12/12 (parity) — but see the leak above | test post leak is a content issue, not an admin-parity gap |
| Fernwell | ✅ 12/12 | |
| Future clients | ✅ proven | `create-site --dry-run` genesis plan checked this session; no files written |

All three tenants need the same three account-authority steps before `/admin` fully works — these were already known, not new:

- [ ] Enable Netlify Identity on each tenant site (console-only)
- [ ] Set `ADMIN_EMAILS` on each tenant site
- [ ] Run one `create-site --provision-only --netlify-token …` per tenant to prove blob stores round-trip live

## Remaining human steps, ordered by impact

- [ ] **Re-land S3** — recover commit `676de97ff207f991ba1a666ee3e7fb35ef91f171` (branch it off current `main`, re-open a PR). Fixes the live `/test-article-dry-run` leak on kugel-platform, adds Fernwell's `SECRETS_SCAN_OMIT_KEYS`, and pins `postDir` per-site so this class of leak can't recur.
- [ ] **Decide on S4x** — re-land commit `6dd7f4d3dde2be6d23d488aa4b4a2f65d79a0266` if you want the richer Ask-AI prompts (editorial voice, claims/compliance, review state). Safe to leave orphaned indefinitely — it's inert until a site has a live `editorial_voice` object.
- [ ] **Finish S1** — 3 of the original 4 admin-core fixes ("library routing, failure states, auth dedupe") were never diagnosed past the one that landed. Worth a scoped follow-up before calling S1 closed.
- [ ] **Netlify Identity + ADMIN_EMAILS + first-Owner invite**, per tenant (the three checkboxes above) — nothing in the repo can do this for you.
- [ ] **Decide on S4 (Marginalia) and S5 (publishing chat)** — both still parked on cost. No action needed unless you want to restart one.

## Verification evidence (this session, S6)

Fresh clone of `main`, `npm ci` → `npm run check` (0 errors/warnings) → `npm test` (1636+102 pass) → root build (75 pages) → `sites/platform` build (44 pages) all green. Fleet parity audit PASS on all three tenants plus a throwaway scaffold. A 7-assertion headless-Chromium drive against the built `sites/platform` confirmed: `/admin` loads, the content library loads, the S1 deep-link regression (`/admin/content/page_home` without `?type=`) is genuinely fixed, "Back to library" doesn't loop, and a signed-out visitor triggers zero admin network calls and never loads the real editor bundle. Full narrative: `docs/cms-architecture/cms-pipeline/state-of-play-2026-08-04-w15-s6.md` (pending fold into `state-of-play.md` — see `queue.tsv` row `W15.FOLD`).
