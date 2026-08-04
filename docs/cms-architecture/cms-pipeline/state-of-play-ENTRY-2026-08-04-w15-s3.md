# State-of-play entry — 2026-08-04 (W15 S3)

> **Standalone-file note:** this is a `state-of-play.md` entry, authored for
> top-insertion in the rolling log's usual style. It is committed as its own
> file because this branch was pushed through the GitHub contents API, which
> replaces whole files — and `state-of-play.md` (405 KB) exceeds what this
> session's API pushes can safely carry. **Fold this entry into the top of
> `state-of-play.md` (below the header, above the 2026-08-03 entry) in the
> next local commit, then delete this file.** The PR description carries the
> same instruction.

## Session 2026-08-04 (W15 S3 — existing tenants retrofitted to admin parity; S2 reconciled in)

Every EXISTING tenant now matches what `create-site` emits for a new client.
**Session-topology note (nothing hidden):** this stage ran as two concurrent
sessions. The first pushed the retrofit itself in four commits, based on S1 —
S2's branch and PR #502 surfaced only mid-flight. The second verified that
work end to end, merged `w15/s2-fleet-admin-genesis` into the branch
(flattened through the API push channel, which cannot carry merge commits;
conflict resolutions below), and re-verified the union. The audit therefore
ran TWICE, independently — by hand against `create-site`'s emissions, and
through S2's `audit-site-admin-parity.mjs` — and the two agree: **12/12
automatable checks PASS on all three tenants at this head**;
`migrate-site --admin-parity` reports nothing automatable to fix.

Fernwell is NOT retired — the F6 entries record a page-retire drill ON
fernwell, and T14.9 leaves it up for feature testing — so it was retrofitted
like the rest. Client sites outside this repo: none exist
(13-separation-plan is design-only; the monorepo is still the whole fleet).

Three real gaps, all closed on `w15/s3-tenant-retrofit`:

1. **Fernwell lacked the four blog reader routes** (`[...blog]/…`) added to
   the scaffold after fernwell was born — a published `content_item` there
   was store-live but unreachable. Both sessions fixed this independently
   (S2 via `migrate-site --admin-parity --write`, S3 by hand from
   platform's); resolved to the canonical template output
   (`site-reader-route-templates.mjs`, F14 block-body form), byte-identical
   to the templates, so future regeneration is a no-op.
2. **Dr-Lurie's legacy post shelf leaked fleet-wide.** `buildSiteCollections`
   defaults `postDir` to `src/data/post`, so platform served Dr-Lurie's
   committed `test-article-dry-run` as its own article — live on
   kugel-platform's `/library` until this deploy. Platform + fernwell now pin
   `postDir` to their own empty `data/post/` shelf; `create-site` emits the
   pin. Proven in the build diff: the leaked page and its listing entry are
   the ONLY reader-page changes on both tenants.
3. **Nothing guarded per-site toml↔config drift.** The site-config drift
   test covered only Dr-Lurie (why S1 had to fix six files by hand); it now
   checks all three tenants' redirect tables and hosts. Per-site tomls also
   gained root's `SECRETS_SCAN_OMIT_KEYS` omission (T9.24's lesson).

**Merge conflict resolutions (S2 ∪ S3):** the four fernwell loaders → S2's
canonical-template output (above); `create-site.mjs` → both sides' changes
coexist (S2's 12-store probe/checklist/F14 templates + S3's postDir/shelf/
secrets-scan emissions); the dry-run fixture auto-merged and is pinned green
by the fixture test.

**Verification at the merged head:** `npm run check` clean (astro check 0
errors); full suite **1637 + 102 pass, 0 fail** (includes S2's 13
admin-parity tests, which run the audit against every real tenant, and S3's
fleet drift guards); all three builds green — root 75 pages, platform 44
HTML files, fernwell 15 pages, every `/admin` route present in each dist.
**Build-diff discipline:** root reader pages byte-identical to the S2-base
build; platform/fernwell reader pages identical EXCEPT the documented leak
removal (`/test-article-dry-run` + library listing + sitemap). The admin
`_astro` chunk hashes churn on EVERY same-tree rebuild — verified by
building the identical tree twice — a pre-existing build nondeterminism in
the admin React bundles, not a change from this branch (worth its own look).

**What the parity machinery should learn** (recorded in
`15-tenant-retrofit-checklist.md`, not built here): the `postDir` pin and
the per-site secrets-scan omission as `admin-parity.mjs` checks + `--write`
fixes. Wolf's remaining human steps are in that checklist — first-Owner
sign-in confirmation on platform/fernwell, one 12-store probe run per tenant
(4 stores were never probed pre-S2), and the post-merge redeploys. No
deploys were triggered from either session. When folding this entry in,
fold the W15 S2 sidecar (`state-of-play-2026-08-04-w15-s2.md`) directly
below it and delete both sidecar files in the same commit.
