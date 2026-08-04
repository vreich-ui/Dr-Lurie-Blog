# State-of-play entry — 2026-08-04 (W15 S3)

> **Standalone-file note:** this is a `state-of-play.md` entry, authored for
> top-insertion in the rolling log's usual style. It is committed as its own
> file because the rolling log (405 KB) exceeds what an API-push session can
> safely carry, and direct `git push` is blocked from the sandbox. **Fold
> this entry into the top of `state-of-play.md` (below the header, above the
> 2026-08-03 entry), fold the W15 S2 sidecar
> (`state-of-play-2026-08-04-w15-s2.md`) directly below it, and delete both
> sidecar files in the same local commit.**

## Session 2026-08-04 (W15 S3 — existing tenants retrofitted to admin parity; the whole W15 stack landed on main)

Every EXISTING tenant now matches what `create-site` emits for a new client,
and the W15 stack is MERGED: main carries S1 (partial, 1/4), S2 (audit
machinery + genesis completeness), S3 (this retrofit, landed as PR #505),
plus the PDF template bridge (was draft PR #501) and an S4x Ask-AI context
enrichment (PR #504) that rode the same landing window.

**Session-topology note (nothing hidden):** this stage ran as MULTIPLE
concurrent sessions racing on the same branch. One session pushed the
retrofit in four commits off S1 and opened PR #503 — unaware S2's branch and
PR #502 had surfaced mid-flight. A second session verified that work end to
end, merged `w15/s2-fleet-admin-genesis` into the branch, and re-verified
the union. A third actor restacked and landed everything: it recreated
S1+S2 on main, redid the S3 content against that base
(`w15/s3-resolved`, PR #505, squash-merged 15:30 +03), and closed the
morning's PR queue. The result on main was then INDEPENDENTLY verified by
the second session (below). The S3 retrofit content on main and the
verified reconciliation tree agree file-for-file; the only casualties of
the race were process, not content. Stale branches from the race
(`w15/s3-tenant-retrofit` with post-restack reconcile commits,
`w15/s1-admin-core-repairs` with a dead-end #503 merge) can be deleted —
nothing on them is missing from main except this entry and the checklist
refinements landed alongside it.

**The retrofit itself (what W15 S3 changed):** fernwell's four missing
`[...blog]` reader loaders (now byte-identical to
`site-reader-route-templates.mjs`'s F14 block-body output); the `postDir`
pin on platform + fernwell (`buildSiteCollections` defaulted to
`src/data/post` — Dr-Lurie's preserved legacy shelf — so Dr-Lurie's
committed `test-article-dry-run` was PUBLICLY SERVED on kugel-platform's
`/test-article-dry-run` and listed on `/library`; each tenant now has its
own empty `data/post/` shelf and `create-site` emits the pin); per-site
`SECRETS_SCAN_OMIT_KEYS = "GITHUB_REPOSITORY"` (root parity, the T9.24
lesson); and the site-config drift test widened from Dr-Lurie-only to all
three tenants. Fernwell is NOT retired — F6 was a page-retire drill ON
fernwell, and T14.9 leaves it up for feature testing — so it was
retrofitted like the rest. Client sites outside this repo: none
(13-separation-plan is design-only; the monorepo is the whole fleet).

**Verification at current main (084198b), independent of the landing
actor:** `npm run check` clean (astro check 0 errors); full suite
**1647 + 102 pass, 0 fail** (includes S2's 13 admin-parity tests, which run
the audit against every real tenant on every `npm test`, the widened drift
guards, the PDF-bridge tests, and the S4x test);
`audit-site-admin-parity.mjs --all` — **12/12 automatable checks PASS ×3
tenants**; `migrate-site --admin-parity` — nothing automatable to fix; all
three builds green (root 75 pages, platform 43, fernwell 15 incl.
`/learn/library`), every `/admin` route present in each dist. **Build-diff
discipline:** root reader pages byte-identical; platform/fernwell reader
pages identical EXCEPT the documented leak removal (`/test-article-dry-run`
+ library listing + sitemap). One pre-existing oddity worth its own look:
the admin `_astro` chunk hashes churn on every same-tree rebuild (verified
by building an identical tree twice) — build nondeterminism in the admin
React bundles, not a W15 change.

**What the parity machinery should learn** (recorded in
`15-tenant-retrofit-checklist.md`): the `postDir` pin and the per-site
secrets-scan omission as `admin-parity.mjs` audit checks + `--write` fixes.
**Wolf's remaining human steps** are in that checklist — first-Owner
sign-in confirmation on platform/fernwell, one 12-store probe run per
tenant (4 stores were never probed pre-S2 — use `--netlify-site-name`, see
the checklist warning), and verifying the three post-merge production
deploys went green. The audit ran twice over (by hand against `create-site`
emissions, and via S2's script) and the two agree everywhere they overlap.
