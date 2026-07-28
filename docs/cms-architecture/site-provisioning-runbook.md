# Site provisioning runbook — the human half of `create-site`

W11 T11.7 built `packages/core/cli/create-site.mjs`: "new client" as close to
one command as the account-authority boundary allows. This doc is the other
half — the steps that need a human with Netlify/GitHub/DNS/secret custody,
because no CLI can hold those on an agent's behalf. Read
`docs/cms-architecture/cms-pipeline/T11.7-provisioning-cli.md` first for the
full per-site env table this runbook and the CLI's checklist both draw from
(kept in sync with the T11.10 governance/secrets inventory).

## 1. Scaffold the client

```
node packages/core/cli/create-site.mjs --name <client> --dry-run   # review the plan first
node packages/core/cli/create-site.mjs --name <client>              # write sites/<client>/
```

This creates `sites/<client>/` — its own `config/site-identity.ts` +
`config/site-binding.ts` + `site.config.ts` + `netlify.toml` +
`package.json`, an empty committed-export tree (`data/site/**/.gitkeep`), and
a baseline seed pack (`seeds/*-seed-data.mjs`: a starter site singleton, a
two-item nav skeleton, an empty taxonomy registry, a default theme, and the
five canonical starter section-template recipes). It is idempotent — re-run
it any time; an existing `sites/<client>/` is left untouched, never
overwritten.

Edit `config/site-identity.ts`'s `assetHost`/`assetFolder` and
`seeds/site-seed-data.mjs`'s `siteBody` (name, palette, metadata) to the
client's real brand before going further — the scaffold is a valid starting
point, not finished content.

## 2. Create the Netlify site + provision stores

```
node packages/core/cli/create-site.mjs --name <client> --netlify-token $NETLIFY_API_TOKEN
```

(Only runs the Netlify half if `sites/<client>/` doesn't exist yet — delete
it first, or pass a fresh `--name`, if you need to redo this step.) This
calls the Netlify API to create the site, probes this site's 8 blob stores
(`site-objects`, `workflows`, `artifacts`, `artifact-index`, `commerce`,
`agent-chats`, `governance`, `users` — a write→read→delete round trip per
store, the same pattern `scripts/provision-pdf-tool-stores.mjs` uses for the
separate shared pdf-tool stores), and generates + pushes the per-site secrets
that are safe to mint automatically (`PUBLISH_SECRET`,
`MCP_HTTP_AUTH_TOKEN`, `ARTIFACT_UPLOAD_TOKEN_SECRET`, `TRACKING_SALT`)
straight to the new site's env store — their values are never printed or
committed.

`NETLIFY_API_TOKEN` needs site-create rights on the Netlify account/team the
client belongs to. If you don't have one yet: Netlify → User settings →
Applications → New access token.

## 3. What's still yours to do by hand

The checklist `create-site` prints groups every per-site env var by class.
For everything NOT auto-generated in step 2:

- **GitHub repo binding** (`GITHUB_REPOSITORY`, `GITHUB_BRANCH`,
  `GITHUB_CONTENT_TOKEN`, `GITHUB_COMMIT_AUTHOR_EMAIL/NAME`): create or pick
  the client's content repo, mint a write token scoped to it (a fleet
  machine account with per-repo scope is fine — T11.10 decides the final
  posture), set the four vars on the new Netlify site.
- **`NETLIFY_BUILD_HOOK_URL`**: Netlify site → Build & deploy → Build hooks →
  add one, paste the URL.
- **Identity / roles** (`ADMIN_EMAILS`, `ROLE_EMAILS_ADMIN/EDITOR/PUBLISHER`,
  `IDENTITY_URL`): enable Netlify Identity on the site, set the allowlists to
  the real humans who administer this client.
- **`ARTIFACT_URL_INGEST_ALLOWED_HOSTS`**: the hosts this client's agents may
  pull artifact images from — a policy choice, not a secret.
- **Tenancy axes** (`PDF_TOOL_PROJECT_ID`, `TRACKING_PROJECT_ID`,
  `TRACKING_SINK_URL`/`_TOKEN`): `PDF_TOOL_PROJECT_ID` defaults to the site
  slug — only set it if it must differ. `PDF_TOOL_STORAGE_SITE_ID`/`_TOKEN`
  are **fleet-shared** — point at the existing shared pdf-tool storage
  service, do not provision a new one. Tracking sink may be one shared
  owner-DB (partitioned by `TRACKING_PROJECT_ID`) or per-site — your call.
- **AI keys** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NETLIFY_AUTH_TOKEN`):
  fleet-shared — reuse the existing fleet values, never mint per-client
  copies. `OPENAI_CHATKIT_WORKFLOW_ID` IS per-site — create a ChatKit
  workflow for this client's admin chat if it uses one.
- **Shop, only if this client sells** (`STRIPE_SECRET_KEY[_TEST]`,
  `STRIPE_WEBHOOK_SECRET[_TEST]`, `STRIPE_MODE`): the client's own Stripe
  account, not the fleet's.
- **DNS**: point the client's domain at the Netlify site (`custom_domain` in
  Netlify site settings, or a CNAME to the generated `<name>.netlify.app`),
  then update `sites/<client>/site.config.ts`'s `canonicalHost` and
  `data/site/site.json`'s `urls.canonicalHost` to match once the domain
  resolves.
- **Connecting an agent to this site's `/mcp`** — the endpoint is fail-closed,
  and there are now three ways in, in order of preference:
  1. **OAuth** (W14 F10, nothing to provision): the site IS its own
     authorization server. Point any OAuth-capable MCP client — a claude.ai
     custom connector included — at `https://<site>/mcp` and leave the client
     id/secret blank. It discovers the metadata, registers itself, and sends
     the user to `https://<site>/admin/authorize`, where a signed-in **admin or
     owner** approves it. Approval is per client and revocable; access tokens
     last an hour and refresh automatically. Nothing is pasted, nothing is
     stored on the client's side that a rotation invalidates.
  2. **Header carriers**, for scripts and SDKs: `Authorization: Bearer <token>`
     or `X-MCP-Auth-Token: <token>` with the site's `MCP_HTTP_AUTH_TOKEN`.
  3. **The URL key** (W14 F9), only for clients that can do neither:
     `https://<site>/mcp?key=<token>`. Treat that URL as the secret it contains
     — query strings land in proxy and CDN logs — and note that rotating
     `MCP_HTTP_AUTH_TOKEN` means re-pasting it everywhere.

- **Secret rotation**: `PUBLISH_SECRET`'s rotation runbook is standing debt
  tracked at T11.10 — this scaffold mints an initial value but does not
  automate rotation.

## 4. Wiring an actual second deployment (not this task)

Today exactly one Netlify build (Dr-Lurie's) reads any `site.config.ts` at
build time — `sites/<client>/` is data + bindings sitting in the monorepo,
not yet a live deployment. Pointing a REAL second Netlify build at its own
`sites/<client>/` tree (rather than `sites/drlurie/`) is T11.11's job (the
second-site acceptance proof), not this runbook's — this section exists so
nobody mistakes "the directory exists" for "the site is live."

## 5. Verifying the scaffold before any of the above

`node packages/core/cli/create-site.mjs --name <client> --dry-run` never
touches disk or network — safe to run repeatedly while deciding on a name.
Once scaffolded, `npm test` type-checks everything under `sites/**/*.ts`
(the project's `tsconfig.test.json` already includes it), and the new
client's seed bodies parse against the same `packages/core/schema/bodies/*`
zod schemas Dr-Lurie's do — `tests/scripts/create-site.test.mjs` checks both
for every scaffold this CLI can produce.
