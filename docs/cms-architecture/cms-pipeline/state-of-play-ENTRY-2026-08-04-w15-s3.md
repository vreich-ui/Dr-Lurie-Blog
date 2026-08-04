# PENDING FOLD-IN — this is a state-of-play entry, not a standalone doc

The W15 S3 session authored this entry for the top of `state-of-play.md`
(directly below the header block, above the 2026-08-03 entry), but the
session's push channel (the GitHub MCP contents API) cannot carry that
file's full 404 KB in one call, and direct `git push` is blocked from the
sandbox. **Whoever lands this branch: paste the entry below into place and
delete this file in the same change.** The entry is written in the rolling
log's existing style and needs no edits.

---

## Session 2026-08-04 (W15 S3 — existing tenants retrofitted to admin parity)

Every EXISTING tenant now matches what `create-site` emits for a new client.
The audit ran by hand (S2's planned `audit-site-admin-parity.mjs` never
landed — that stage produced no branch or PR; noted, not rebuilt here) and
came back cleaner than expected: all three tenants already carry 34/34
function shims with correct v1/v2 export styles, redirect tables in exact
parity with their site.configs (S1's corrected `/admin/content/:objectId`
form included), and the full injected `/admin` workspace + edit-mode canvas
in their built output. Fernwell is NOT retired — the F6 entries record a
page-retire drill ON fernwell, and T14.9 leaves it up for feature testing —
so it was retrofitted like the rest.

Three real gaps, all closed on `w15/s3-tenant-retrofit` (stacked on S1):

1. **Fernwell lacked the four blog reader routes** (`[...blog]/…`) that
   T14.7 added to the scaffold after fernwell was born — a published
   `content_item` there was store-live but unreachable. Copied
   byte-identical from platform's; 13 pre-existing pages rebuild
   content-identical, `/learn/library` is the one addition.
2. **Dr-Lurie's legacy post shelf leaked fleet-wide.** `buildSiteCollections`
   defaults `postDir` to `src/data/post`, so platform (and fernwell, the
   moment routes landed) served Dr-Lurie's committed `test-article-dry-run`
   as its own article — live on kugel-platform today. Both tenants now pin
   `postDir` to their own empty `data/post/` shelf; the scaffold emits the
   pin so the next client starts isolated. Platform's next deploy drops the
   leaked page; its other 42 pages are content-identical.
3. **Nothing guarded per-site toml↔config drift.** The site-config drift
   test covered only Dr-Lurie (why S1 had to fix six files by hand);
   it now checks all three tenants' redirect tables and hosts. Per-site
   tomls also gained root's `SECRETS_SCAN_OMIT_KEYS` omission (T9.24's
   lesson would otherwise fail platform/fernwell builds the day
   GITHUB_REPOSITORY gets secret-marked there).

Verification: `npm run check` clean; full suite 1636+89 pass (fixture
updated for the one new scaffold emission); schema-migration gate PASS ×3
(65/42/12 records, zero blocked); root build-diff vs the S1 head EMPTY
(76 pages — Dr-Lurie untouched). `migrate-site` covered none of these gaps
(schema harness only) — the retrofit-shaped successor it should learn is
recorded in `15-tenant-retrofit-checklist.md`, which is also Wolf's
morning to-do: per tenant, what changed and the remaining console steps
(both pending items are sign-in confirmations + post-merge redeploys; no
provisioning is missing anywhere). No deploys were triggered from this
session. Client sites outside this repo: none exist — 13-separation-plan
confirms the monorepo is still the whole fleet.

