# pdf-tool storage grants — per-site by default

pdf-tool is stateless: it holds **no blob credentials of its own**. Whichever
site's Platform deployment bridges a call mints a short-lived storage grant,
sourced from **that site's own** `PDF_TOOL_STORAGE_TOKEN` /
`PDF_TOOL_STORAGE_SITE_ID` environment variables, and forwards it
server-side with each bridged pdf-tool call; pdf-tool uses the grant to write
artifacts, templates, image-search state, and its job records directly into
whichever Netlify Blob store that grant names.

These two env vars are read **per-site** (`packages/core/server/lib/
pdf-tool-storage-grant.ts` calls `process.env` at request time, and every
Netlify site has its own separate environment-variable scope) — so each
tenant CAN have its own dedicated storage, and as of 2026-08-04 that is the
**prescribed default for any new tenant**: provision a fresh dedicated pair
per site rather than pointing a new site at someone else's.

**Current state (2026-08-04):** historically every tenant site this repo runs
(`kugel-platform`, `kugel-fernwell`, and the Dr-Lurie root deployment) read
the exact same global pair, all pointed at Dr-Lurie's own Netlify site — so
every tenant's templates/artifacts/image-search state physically lived
inside Dr-Lurie's Blob storage, namespaced only by the `projectId` key
prefix, not by any real per-tenant boundary. As of 2026-08-04, `kugel-platform`
was given its **own dedicated** `PDF_TOOL_STORAGE_TOKEN` /
`PDF_TOOL_STORAGE_SITE_ID` (a real Netlify Blobs-scoped PAT for platform's
own site): platform's PDF templates now write to and read from its own
storage, independent of Dr-Lurie's. `kugel-fernwell` and the Dr-Lurie root
deployment were **not** changed — they remain on the original shared pair for
now, pending the same move. No data was migrated in that cutover; nothing on
the shared store was worth preserving for platform, so any platform-authored
records left on the shared store are simply orphaned from platform's
perspective, and that's intentional.

Do not "fix" a site's dedicated `PDF_TOOL_STORAGE_TOKEN`/`PDF_TOOL_STORAGE_SITE_ID`
back to another tenant's value, or to Dr-Lurie's, thinking it's a
misconfiguration — a differing value across sites is the point, not a bug.

## Parity enforcement (2026-08-05) — no longer just a reminder

The per-site rule above used to be documentation only: `create-site`'s env
checklist named the two vars and asked a human to provision fresh ones, but
nothing checked that they actually did. That's now backed by code:

- **`checkStorageGrantParity`** (`packages/core/cli/create-site.mjs`) reads
  `PDF_TOOL_STORAGE_SITE_ID` live off a list of named Netlify sites and
  reports any two that share a value — the exact shape of the pre-2026-08-04
  bug.
- **`create-site --provision-only --netlify-token … --known-tenant-site
  <name>`** (repeatable) calls it during genesis/provisioning: if the site
  being provisioned collides with a sibling tenant you named, the run
  refuses to finish. A brand-new site has nothing set yet, so this only
  bites on the follow-up `--provision-only` run after you've set the two env
  vars by hand (step 3 below) — which is exactly when it matters.
- **`node scripts/audit-storage-grant-parity.mjs --site <name> --site
  <name> …`** is the standalone check for an already-live fleet — run it any
  time against every known tenant site to prove (or disprove) parity without
  provisioning anything. Exit code 1 on any collision.

None of this can run without a live Netlify API token (these two vars are
per-site env values, never committed — there is nothing repo-only to check).
Treat the audit script as the standing verification step: run it after any
tenant's credentials are rotated, and periodically otherwise, the same way
`scripts/audit-site-admin-parity.mjs` is used for the unrelated admin-parity
surface.

**Current state (2026-08-05):** `platform` has its own dedicated pair
(2026-08-04 cutover). `fernwell` and `dr-lurie` **still share the legacy
pair** — this is the known, tracked gap the enforcement above exists to stop
from recurring once it's closed. Closing it needs a human to run the five
"Credential provisioning" steps below for each of those two sites (a fresh
Netlify machine account + PAT per site is not something an agent session can
mint); once done, `audit-storage-grant-parity.mjs` is how to prove it stuck.

Code: `packages/core/server/lib/pdf-tool-storage-grant.ts` (grant builder,
canonical store list), `packages/core/server/lib/pdf-tool-client.ts` (secret-
preserving bridge), and the artifact tools in `packages/core/server/functions/mcp.ts`.
The grant builder is server-internal and no raw grant operation is exposed over
MCP. Provisioning probe:
`scripts/provision-pdf-tool-stores.mjs`.

## The grant contract (pdf-tool accepts exactly this shape)

```json
{
  "grantVersion": 1,
  "grantType": "netlify-pat",
  "projectId": "dr-lurie",
  "siteId": "<PDF_TOOL_STORAGE_SITE_ID>",
  "token": "<PDF_TOOL_STORAGE_TOKEN>",
  "stores": {
    "artifacts": "artifacts",
    "artifactIndex": "artifact-index",
    "templates": "pdf-templates",
    "imageSearch": "image-search",
    "renderData": "pdf-render-data",
    "jobs": "pdf-tool-jobs"
  },
  "limits": {
    "maxImageBytes": 153600,
    "preferredImageFormat": "webp",
    "overBudget": "warn"
  },
  "expiresAt": "<issuance + 1 hour, ISO 8601>"
}
```

- `expiresAt` is **advisory-but-enforced**: pdf-tool rejects expired grants,
  so agents must re-fetch rather than cache long-term.
- Keep the shape stable. The future `grantType: "exchange"` (below) must be a
  drop-in change of `grantType`/`token` semantics only.
- `limits` is the per-site **media policy**, sourced from
  `src/config/media-policy.ts` (each site's repo sets its own; adjustable
  without code changes): `maxImageBytes` (the byte budget, ~150 KB
  web-optimized), `preferredImageFormat` (the web format to encode to), and
  `overBudget` (the toggle next to the limit — `warn` = store an over-limit
  image but flag it, `block` = reject it). pdf-tool MUST honor it: encode images
  to `preferredImageFormat` and compress/resize under `maxImageBytes`; if it
  can't, reject when `overBudget` is `block`, else store the smallest achieved
  and flag it over-budget. pdf-tool should also expose a **"shrink existing
  artifact"** path so an already-stored oversize image can be re-encoded under
  the budget on request. Agents receive the same numbers and keep artifacts
  within budget unless a human/admin explicitly asks for a larger one.

## The six stores

| Grant field     | Store name        | What pdf-tool writes there                                                               |
| --------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `artifacts`     | `artifacts`       | Final artifact bytes (in whichever site's storage the grant names)                       |
| `artifactIndex` | `artifact-index`  | ArtifactReference indexes (same site's storage)                                          |
| `templates`     | `pdf-templates`   | PDF template definitions                                                                 |
| `imageSearch`   | `image-search`    | Image-search banks, policies, candidate state                                            |
| `renderData`    | `pdf-render-data` | Render-job input/intermediate data                                                       |
| `jobs`          | `pdf-tool-jobs`   | **New**: pdf-tool job records — that site's own copy of the full artifact-job audit trail |

Netlify Blob stores are created implicitly on first write; run
`node scripts/provision-pdf-tool-stores.mjs` (with the two env vars set) to
prove all six exist and are writable with the grant credentials — it does a
write → read → delete probe per store and prints a per-store verdict without
ever printing the credentials.

## Credential provisioning (human runbook — run once PER TENANT SITE)

This used to read as a single one-time Dr-Lurie setup. It isn't: it's a
per-tenant procedure. Run these five steps for **every** site that needs its
own dedicated pdf-tool storage — a brand-new client via
`docs/cms-architecture/site-provisioning-runbook.md`, or an existing tenant
being moved off the legacy shared pair (the way `kugel-platform` was moved
2026-08-04). Each run targets exactly one site; never point a new run at a
site/team another tenant already uses.

1. **Create a dedicated Netlify machine account** (a fresh Netlify user, e.g.
   `pdf-tool-storage-<tenant>@…`) and give it access to **only** the target
   tenant's site/team — no other sites, no admin roles. This bounds the blast
   radius of a leak to this one site.
2. From that machine account, generate a **personal access token**
   (Netlify → User settings → Applications → New access token).
3. On **that tenant's own** Netlify site's environment variables (not
   another tenant's, not Dr-Lurie's, unless Dr-Lurie is the actual target of
   this run), set:
   - `PDF_TOOL_STORAGE_TOKEN` — the machine-account PAT
   - `PDF_TOOL_STORAGE_SITE_ID` — that tenant's own site API ID (Site
     settings → Site details → Site ID)
     Scope both to Functions (and Builds if the provisioning probe runs in
     CI). **Never** expose either in client-side code, logs, or workflow JSON;
     do not prefix with `PUBLIC_`. Do not copy another tenant's value in —
     that recreates the shared-storage arrangement this doc used to describe
     as the default, which is exactly what a new tenant should avoid.
4. Run the provisioning probe (step above) once after setting the vars.
5. Set `PDF_TOOL_BASE_URL` and `PDF_TOOL_AGENT_RUN_TOKEN` on the site (these
   two remain genuinely fleet-shared — the pdf-tool *service's* base URL and
   bridge bearer, unrelated to storage), then verify the visible Platform
   bridge end-to-end: create one job, poll it, and retrieve the verified
   request-scoped artifact. No grant/proof may appear in the MCP response or
   structured logs.

The Platform bridge fails closed with
`pdf_tool_storage_grant_not_configured` until step 3 is done for that site. It
never returns or logs the token and never writes it to any stored record.

## Agent workflow rules

1. **Use Platform's visible artifact bridge tools.** Pass `site_id` and the
   existing content-item `request_id`; Platform injects the canonical project
   and grant server-side.
2. Store returned **ArtifactReferences** in workflow JSON as usual. **NEVER**
   write the grant or its token into workflow JSON, drafts, article content,
   artifact metadata, or any persisted blob.
3. Poll the returned job id rather than creating another job.
4. Grants are minted per bridge call and never cached or exposed to agents.

## Rotation and revocation

- **Rotate `PDF_TOOL_STORAGE_TOKEN` monthly**, and immediately on any
  suspected exposure: generate a new PAT from the machine account, update the
  env var, then revoke the old PAT. The bridge always uses the current
  value, so rotation requires **no pdf-tool change** — in-flight grants
  carrying the revoked PAT simply start failing storage auth, and agents
  recover via the fetch-fresh-and-retry-once rule.
- **Revocation** (kill switch): revoke the PAT in the machine account (or
  delete the machine account's site access). Every outstanding grant dies
  with it. Clearing the env var additionally makes the bridge fail closed.

## Future (designed for, not built): `grantType: "exchange"`

The Netlify PAT currently transits agent context inside the grant. The
planned hardening keeps the grant shape identical but sets
`grantType: "exchange"` and puts an **opaque short-lived token** in `token`;
the storage-owning site (whichever site's storage the grant names — its own
site, per the per-tenant model above) exposes a server-to-server exchange
endpoint that pdf-tool calls to swap the opaque token for the real credential.
The PAT then never transits
agent context. Because consumers already treat `token` as opaque and the
shape stays stable, this is a drop-in change: agents and workflow rules are
unaffected, pdf-tool switches on `grantType`.
