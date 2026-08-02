# pdf-tool storage grants — Dr-Lurie as the grant provider

pdf-tool is stateless: it holds **no blob credentials of its own**. Platform
mints a short-lived storage grant and forwards it server-side with each bridged
pdf-tool call; pdf-tool uses the grant
to write artifacts, templates, image-search state, and its job records
directly into Dr-Lurie's Netlify Blob stores. Dr-Lurie therefore owns the
storage, the credential, and the full artifact-job audit trail.

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
| `artifacts`     | `artifacts`       | Final artifact bytes (same store Dr-Lurie already uses)                                  |
| `artifactIndex` | `artifact-index`  | ArtifactReference indexes (same store as Dr-Lurie)                                       |
| `templates`     | `pdf-templates`   | PDF template definitions                                                                 |
| `imageSearch`   | `image-search`    | Image-search banks, policies, candidate state                                            |
| `renderData`    | `pdf-render-data` | Render-job input/intermediate data                                                       |
| `jobs`          | `pdf-tool-jobs`   | **New**: pdf-tool job records — Dr-Lurie's own copy of the full artifact-job audit trail |

Netlify Blob stores are created implicitly on first write; run
`node scripts/provision-pdf-tool-stores.mjs` (with the two env vars set) to
prove all six exist and are writable with the grant credentials — it does a
write → read → delete probe per store and prints a per-store verdict without
ever printing the credentials.

## Credential provisioning (human runbook)

1. **Create a dedicated Netlify machine account** (a fresh Netlify user, e.g.
   `pdf-tool-storage@…`) and give it access to **only** the Dr-Lurie
   site/team — no other sites, no admin roles. This bounds the blast radius
   of a leak to this one site.
2. From that machine account, generate a **personal access token**
   (Netlify → User settings → Applications → New access token).
3. In the Dr-Lurie site's Netlify environment variables, set:
   - `PDF_TOOL_STORAGE_TOKEN` — the machine-account PAT
   - `PDF_TOOL_STORAGE_SITE_ID` — the Dr-Lurie site API ID (Site settings →
     Site details → Site ID)
     Scope both to Functions (and Builds if the provisioning probe runs in
     CI). **Never** expose either in client-side code, logs, or workflow JSON;
     do not prefix with `PUBLIC_`.
4. Run the provisioning probe (step above) once after setting the vars.
5. Set `PDF_TOOL_BASE_URL` and `PDF_TOOL_AGENT_RUN_TOKEN` on the site, then
   verify the visible Platform bridge end-to-end: create one job, poll it, and
   retrieve the verified request-scoped artifact. No grant/proof may appear in
   the MCP response or structured logs.

The Platform bridge fails closed with
`pdf_tool_storage_grant_not_configured` until step 3 is done. It never returns
or logs the token and never writes it to any stored record.

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
Dr-Lurie exposes a server-to-server exchange endpoint that pdf-tool calls to
swap the opaque token for the real credential. The PAT then never transits
agent context. Because consumers already treat `token` as opaque and the
shape stays stable, this is a drop-in change: agents and workflow rules are
unaffected, pdf-tool switches on `grantType`.
