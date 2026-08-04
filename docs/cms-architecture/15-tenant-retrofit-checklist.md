# 15 — Tenant retrofit checklist (W15 S3): admin/editor parity for every existing tenant

**What this is.** W15 S3 audited every EXISTING tenant against what
`create-site` emits for a brand-new client (the fleet reference shape) and
closed every gap that is closable in code. This file is the per-tenant record:
what was verified, what was fixed, and the remaining **human** steps with
console paths. The audit ran twice, independently: by hand against
`packages/core/cli/create-site.mjs`'s emissions (this stage started before
S2's branch surfaced), and through S2's `scripts/audit-site-admin-parity.mjs`
after `w15/s2-fleet-admin-genesis` was reconciled into this branch — **12/12
automatable checks PASS on all three tenants at this branch head.** The two
audits agreed everywhere they overlap; the gaps only S3's hand audit caught
(postDir, secrets-scan) are recorded below as what the parity machinery
should learn. Standing verification, any time:
`node scripts/audit-site-admin-parity.mjs --all`.

**The parity definition used** (from the create-site reference shape):

1. **Function shims** — `<site>/netlify/functions/` carries one shim per stem
   in `packages/core/server/functions/` (34 today), each with the right
   v1/v2 export style and the composite `mcp` wiring.
2. **Rewrites** — the tenant's `netlify.toml` `[[redirects]]` equals its
   `site.config.ts` `redirects`, including the W15 S1 single-segment
   `/admin/content/:objectId` form (unforced).
3. **Shell routes** — the full `/admin/*` workspace (11 routes) is injected by
   `packages/core/app/shell-routes.ts` into every build that uses
   `defineSiteAstroConfig`; the edit-mode canvas rides the shared shell
   (`EditMode.astro` → `@site/config/policy-bindings`). Nothing per-site to
   copy — verified present in every tenant's built output.
4. **Config bundle** — `config/{site-identity,site-binding,approval-policy,creation-policy,media-policy,policy-bindings}.ts`,
   `site.config.ts`, `astro.config.ts`, `config.yaml`, `app/content/config.ts`,
   reader routes, seeds, bootstrap exports.

**Fleet-wide results (all three tenants):** shims 34/34 with correct export
styles ✓ · rewrites in exact parity with site.config ✓ (S1 landed the
corrected `/admin/content` form everywhere) · `/admin` workspace + canvas in
every build ✓ · schema-migration gate PASS (drlurie 65, platform 42,
fernwell 12 records, zero blocked) ✓.

**What S3 changed in code (this PR):**

- **fernwell**: added the four blog reader routes
  (`app/pages/[...blog]/…` — article, library list, category, tag),
  byte-identical to platform's. Fernwell was scaffolded before T14.7 added
  these to the scaffold; without them a published `content_item` on fernwell
  was live in the store but unreachable on the site. Its 13 pre-existing
  pages rebuild content-identical; `/learn/library` is the one new page.
- **platform + fernwell**: pinned `postDir` in `app/content/config.ts` to the
  site's own (empty) `data/post/` shelf. The shared default is
  `src/data/post` — Dr-Lurie's preserved legacy shelf — and inheriting it
  published Dr-Lurie's committed **Test Article Dry Run** post on every tenant
  with blog routes (it was live on platform's `/test-article-dry-run` and
  listed on its `/library` page). That page and listing entry drop off
  platform's next deploy; every other page is content-identical.
- **platform + fernwell**: `SECRETS_SCAN_OMIT_KEYS = "GITHUB_REPOSITORY"` in
  the per-site `netlify.toml`s, mirroring the root file (the T9.24 lesson —
  repo docs legitimately name the repo).
- **create-site**: scaffold now emits the `postDir` pin, the `data/post/`
  shelf, and the secrets-scan omission, so the next client starts at parity.
- **CI guard**: `tests/netlify/site-config-drift.test.ts` now checks ALL
  three tenants' `netlify.toml` ↔ `site.config.ts` redirect tables and
  `config.yaml` hosts (it covered only Dr-Lurie before — which is exactly why
  S1 had to fix six files by hand).

**What the parity machinery should learn** (recorded, not built here): S2's
`migrate-site --admin-parity [--write]` now IS the retrofit tool for shims,
canonical redirects, the keepalive schedule, and the reader loaders — it
reports "nothing automatable to fix" on both per-site tenants at this head.
Two S3 finds are not yet in its requirement inventory
(`packages/core/cli/admin-parity.mjs`): the `postDir` pin in
`app/content/config.ts` (without it a tenant serves Dr-Lurie's legacy shelf)
and the per-site `SECRETS_SCAN_OMIT_KEYS` omission. Both are one-shot fixed
on every current tenant and emitted by `create-site` for future ones, but a
site scaffolded from an old checkout would drift silently — add them as
audit checks + `--write` fixes in a follow-up.

**Client sites outside this repo: none.** `13-separation-plan.md` confirms
all clients share this one monorepo today ("the only thing NOT yet separated
is the physical asset boundary"); the live tenants are exactly the three
below. `kugelmedia.netlify.app` appears in docs but is an external asset CDN,
not a client site. Per-client repos are a designed, unbuilt future (the
separation plan).

---

## Dr. Lurie (root deployment → Netlify project `drluriescience`)

The worked example — the root `netlify.toml` + `netlify/functions/` ARE this
tenant's wiring (`sites/drlurie/` has no netlify dir of its own; the root
build entry re-exports `sites/drlurie/astro.config.ts`).

**Code parity: YES (nothing to fix).** 34/34 shims + the preserved
`verify-article-images` extra (deliberate — legacy committed-asset serving,
not a gap). Root build-diff vs the S1 branch head: 76 pages, EMPTY DIFF —
this retrofit changes nothing here.

Human steps:

- ✅ **Netlify Identity enabled** — done (live logins since T14.0; Google
  provider confirmed 2026-07-27).
- ✅ **First Owner** — done (Wolf signs in via Google today).
- ✅ **ADMIN_EMAILS + env checklist** — done (every admin surface, publish,
  release, and `/mcp` proven live repeatedly; latest release 2026-08-02).
- ✅ **Blob stores** — done for the 8 long-probed stores (production store is
  the live source of truth; 65 committed export records match it through the
  migration gate).
- ⏳ **One store-probe run for the 4 stores S2 found were never probed**
  (`agent-profiles`, `opt-ins`, `commerce-events`, `tracking-events` — used
  by core, absent from the old probe list). One command verifies all 12:
  `node packages/core/cli/create-site.mjs --name drlurie --provision-only
  --netlify-site-name drluriescience --netlify-token <token>`.
  (`--netlify-site-name` matters: without it the CLI would look up — and on
  a miss CREATE — a project named `drlurie`.) Netlify Blobs auto-creates on
  first write, so this is verification, not repair — but /admin/agents'
  profile store being unproven is worth the two minutes.

## Platform (`sites/platform` → Netlify project `kugel-platform`)

**Code parity: YES (after this PR).** 34/34 shims ✓, rewrites ✓, admin
workspace + canvas already in its build ✓. Fixed here: the leaked Dr-Lurie
test post (see above) and the secrets-scan omission.

Human steps:

- ✅ **Netlify Identity enabled** — done 2026-07-27, Google provider on.
- ✅ **ADMIN_EMAILS** — done (set to Wolf, 2026-07-27).
- ⏳ **Confirm the first Owner sign-in** — Wolf reported login failing before
  the 2026-07-27 fix; a confirmed post-fix Google sign-in on
  kugel-platform's `/admin` is not recorded. Console: Netlify →
  **kugel-platform** → Integrations → Identity (the stale 2026-07-26 pending
  email invite can stay — Google links to the same address on sign-in).
  Then just open the site's `/admin` and sign in with Google.
- ✅ **Env checklist** — done in substance: publish → release → deploy proven
  live on this tenant (2026-08-02, 45 records through the production `/mcp`).
  If anything acts up, the reference list is `ENV_CHECKLIST` in
  `packages/core/cli/create-site.mjs`; console: Netlify → **kugel-platform** →
  Site configuration → Environment variables.
- ✅ **Blob stores** — done for the 8 long-probed stores (42 committed
  records match the store through the gate).
- ⏳ **One store-probe run for the 4 never-probed stores** (same as Dr-Lurie
  above): `node packages/core/cli/create-site.mjs --name platform
  --provision-only --netlify-site-name kugel-platform --netlify-token
  <token>` verifies all 12.
- ⏳ **Redeploy after this PR merges** so `/test-article-dry-run` (Dr-Lurie's
  leaked test post) drops off the live site. Merging to main triggers all
  three builds automatically — no console action unless you want it sooner
  (Netlify → **kugel-platform** → Deploys → Trigger deploy).

## Fernwell (`sites/fernwell` → Netlify project `kugel-fernwell`)

**Not retired — retrofitted.** Checked against the F6 entries in
`state-of-play.md`: F6 was the *retire-verb drill* (a page, `/drill-retire`,
retired end-to-end ON fernwell as the live proof), not a retirement OF
fernwell. T14.9 CLOSED says it plainly: "Fernwell stays up for feature
testing"; its optional project deletion is explicitly Wolf's to trigger and
has not been. So it was treated as a full tenant here.

**Code parity: YES (after this PR).** 34/34 shims ✓, rewrites ✓, admin
workspace + canvas already in its build ✓. Fixed here: the four missing blog
reader routes, the `postDir` pin, the secrets-scan omission.

Human steps:

- ✅ **Netlify Identity enabled** — done (via API, T14.9; Google provider on,
  2026-07-27).
- ✅ **ADMIN_EMAILS** — done (set to Wolf, 2026-07-27).
- ⏳ **Confirm the first Owner sign-in** — same situation as platform:
  fernwell had ZERO Identity users when the 2026-07-27 fix landed, and no
  confirmed sign-in is recorded since. Open kugel-fernwell's `/admin`, sign
  in with Google; the ADMIN_EMAILS fallback makes that first sign-in an
  Owner. (Console, if needed: Netlify → **kugel-fernwell** → Integrations →
  Identity → Invite users.)
- ✅ **Env checklist** — done (all 17 vars set via API in the T14.9 run;
  live round-trip + release proven the same day).
- ✅ **Blob stores** — done for the 8 stores in the T14.9 probe list
  (write→read→delete verified; 12 records live).
- ⏳ **One store-probe run for the 4 never-probed stores** (same as the other
  tenants): `node packages/core/cli/create-site.mjs --name fernwell
  --provision-only --netlify-site-name kugel-fernwell --netlify-token
  <token>` verifies all 12.
- ⏳ **Redeploy after this PR merges** to pick up the new reader routes —
  after it, `/learn/library` serves (empty until fernwell has articles) and a
  published `content_item` becomes reachable at its permalink. Automatic on
  merge to main; manual path: Netlify → **kugel-fernwell** → Deploys →
  Trigger deploy.

---

**Deliberate non-changes** (so nobody "fixes" them later without context):
the root netlify.toml's CSP report-only header, `/_astro/*` cache header, and
`pretty_urls` remain Dr-Lurie-only — they are the W13 CSP soak and root-build
particulars, not part of the scaffold reference shape; promoting them
fleet-wide is its own decision. `verify-article-images` stays root-only
(legacy committed assets exist only on Dr-Lurie). `sites/drlurie` keeps the
default `src/data/post` shelf — that IS its preserved legacy content.
