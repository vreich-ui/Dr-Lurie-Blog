# Fleet status — W15

_Last verified: 2026-08-05, same-day follow-up on the admin-nav gap below. Re-run `node scripts/audit-site-admin-parity.mjs --all` any time for a live check._

**Correction to the original S6 report:** S6 (below) found S3 and S4x reporting "merged" on GitHub with their commits NOT reachable from `main` — a squash-merge race. That was true when S6 ran. It is no longer true: S3 was re-landed clean as PR #505 (merged), S4x's context-enrichment half landed as PR #504 (merged), and both are now real, verified, ancestor-of-`main` commits. The leaked `/test-article-dry-run` post on `kugel-platform` that S6 flagged is fixed by that same S3 landing. The S6 trigger has been disabled so it doesn't fire again and re-report this as broken.

**2026-08-05 correction — "admin parity" below means CODE parity, not content parity.** Wolf hit this directly: platform's `/admin` login and roles were fully correct, but there was no "Admin" link anywhere on the live site — `nav_header`'s header navigation had no admin-only group, so a signed-in admin had no visible door in short of typing `/admin` by hand. S3's audit (the "12/12" table below, now 13/13) never caught it and COULDN'T have: `nav_header` is live CMS content in each tenant's own blob store, not a repo file, and the audit is deliberately repo-only, no-network, no-store-access. Fixed live on `platform` (published + released 2026-08-04). `fernwell` has the identical gap, confirmed live, **not yet fixed** — see the tenant table below. `create-site`'s genesis output now includes the admin nav group by default (a new 13th automatable check, `admin-nav-genesis`, proves it), so this cannot recur for a future client. It CAN still recur for retrofits of very old site trees predating this fix — the check only proves fresh genesis, not any existing tenant's live content.

## What to review first

Everything code-side from S1–S4x is on `main` and verified. What's left is almost entirely account-authority work only a human can do: enable Netlify Identity, set `ADMIN_EMAILS` (in progress), confirm first-Owner sign-in, and run one live blob-store provisioning pass per tenant.

## Stage status

| Stage | What it was | Status | PR |
|---|---|---|---|
| S1 | Admin core repairs | Merged (partial — 1 of 4 planned fixes; the other 3 were never diagnosed) | [#500](https://github.com/vreich-ui/platform/pull/500) |
| S2 | Fleet admin genesis + parity audit | Merged, verified | [#502](https://github.com/vreich-ui/platform/pull/502) |
| S3 | Retrofit existing tenants to parity | **Merged and live in main** (re-landed clean after #503 hit real conflicts against S1+S2) | [#505](https://github.com/vreich-ui/platform/pull/505) (supersedes #503) |
| S4 | Marginalia editor (full canvas interaction model) | Deferred for cost — not started | — |
| S4x | Ask-AI context enrichment, items 1–8 (unplanned add-on, not Marginalia) | **Merged and live in main** | [#504](https://github.com/vreich-ui/platform/pull/504) |
| S4x (cont.) | Save-gated Ask-AI proposal capture for CMS Agent learning, items 9–15 | Prompt drafted, not yet scheduled or run | — |
| S5 | Client publishing chat (LibreChat) | Deferred for cost — not started, nothing in CMS-Agent either | — |
| S6 | Fleet verification pass | Done — see correction above. Trigger disabled to prevent a re-fire. | [#506](https://github.com/vreich-ui/platform/pull/506) |

Also landed same-day, unrelated to W15 but worth knowing about: the PDF template bridge ([#501](https://github.com/vreich-ui/platform/pull/501)) and a Netlify rebuild-gap fix for subdirectory-based tenant sites ([#508](https://github.com/vreich-ui/platform/pull/508)) — both merged, both green.

## Tenant admin parity (S2's audit script, current)

**This table is CODE/build parity only** — routes, function shims, redirects, config bundles, reader loaders, env-checklist coverage, blob-store probe coverage, and (new, 2026-08-05) whether genesis emits the admin nav group. It is NOT a check of any tenant's live content, so a tenant can show a clean row here and still be missing something content-side (exactly what happened with the admin nav link — see the correction above).

| Tenant | Admin parity (code) | Admin nav link (live content) | Notes |
|---|---|---|---|
| Dr-Lurie (root) | ✅ 13/13 | ✅ present | had the admin nav group from creation |
| Platform | ✅ 13/13 | ✅ present | leaked test post fixed by S3's `postDir` pin; admin nav group added + released 2026-08-05 |
| Fernwell | ✅ 13/13 | ❌ **missing** | confirmed live 2026-08-05 — no admin-only nav group in `nav_header`; `/admin` itself works fine if you go there directly, there's just no link to it |
| Future clients | ✅ proven | ✅ proven | `create-site --dry-run` genesis plan now includes the admin nav group (`admin-nav-genesis` check); `--admin-parity` on an old site tree can still miss it since the fix is genesis-side, not a retrofit-script fix |

All three tenants still need the same three account-authority steps before `/admin` fully works:

- [ ] Enable Netlify Identity on each tenant site (console-only)
- [ ] Set `ADMIN_EMAILS` on each tenant site — **Wolf is on this now**
- [ ] Run one `create-site --provision-only --netlify-token …` per tenant to prove blob stores round-trip live

## Remaining human steps, ordered by impact

- [ ] **ADMIN_EMAILS + Netlify Identity + first-Owner sign-in**, per tenant (platform, fernwell) — in progress.
- [ ] **12-store blob probe run**, per tenant — nothing in the repo can do this without a live Netlify token.
- [ ] **Decide on the S4x continuation** (items 9–15 — full rejection-history capture as CMS Agent learning data, gated strictly on the editor's Save) — prompt is ready, just needs scheduling.
- [ ] **Finish S1** — 3 of the original 4 admin-core fixes ("library routing, failure states, auth dedupe") were never diagnosed past the one that landed.
- [ ] **Decide on S4 (Marginalia) and S5 (publishing chat)** — both still parked on cost. No action needed unless you want to restart one.
- [ ] **Housekeeping, low priority**: fold the S2 and S6 state-of-play sidecar entries into `state-of-play.md` proper (queued as `W15.FOLD` in `queue.tsv`, deferred for cost — it's a ~412 KB file with no cheap partial-write path here).
- [ ] **Branch cleanup**: 7 now-dead W15 branches are safe to delete (`w15/s1-admin-core-repairs`, `w15/s2-fleet-admin-genesis`, `w15/s3-tenant-retrofit`, `w15/s3-resolved`, `w15/s3-docs-completion`, `w15/s4x-ask-ai-context-enrichment`, `w15/s6-verification-records`) — needs someone with real repo write access, the agent sessions here don't have branch-delete permission.

## Verification evidence (S6 session, 2026-08-04, still accurate for what it covered)

Fresh clone of `main` at the time, `npm ci` → `npm run check` (0 errors/warnings) → `npm test` (1636+102 pass) → root build (75 pages) → `sites/platform` build (44 pages) all green. Fleet parity audit PASS on all three tenants plus a throwaway scaffold. A 7-assertion headless-Chromium drive against the built `sites/platform` confirmed: `/admin` loads, the content library loads, the S1 deep-link regression (`/admin/content/page_home` without `?type=`) is genuinely fixed, "Back to library" doesn't loop, and a signed-out visitor triggers zero admin network calls and never loads the real editor bundle. Independently re-verified after S3/S4x landed: `npm run check` clean, 1642+102 tests passing (S3 PR #505's own verification pass).
