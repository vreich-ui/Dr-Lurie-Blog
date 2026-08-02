# Secrets runbook (W11 T11.10)

One page: what secrets exist, where each lives, how to generate/rotate it,
and the one standing rotation debt. This is the fleet-wide index; a new
`sites/<client>` only needs its own copy of the **per-site** rows.

## How to read this

- **Scope** — `shared` (one value for the whole Netlify deployment/CI,
  regardless of how many sites the fleet grows to) vs `per-site` (a distinct
  value the runbook's steps must be repeated for, once per `sites/<client>`).
- **Storage** — where the live value is set. Everything here is a Netlify
  environment variable (Site settings → Environment variables) unless noted.
  None of these are committed to git; `.env` files are local-dev-only and
  gitignored.
- **Rotation** — the actual procedure. "None yet" means no rotation has ever
  been performed — call this out explicitly rather than implying a cadence
  that doesn't exist.

## Inventory

| Secret | Scope | What it gates | Storage | Rotation |
| --- | --- | --- | --- | --- |
| `PUBLISH_SECRET` | per-site | The object-store MCP proxy's internal shared secret — every `object_*`/`product_*`/`order_*` write action authenticates with it (see `netlify/functions/object-store.ts`'s `agentPrincipal`). Also doubles as the `auth: 'publish_key'` value recorded on every write's `Principal`. | Netlify env var, Functions scope | **Standing debt, not yet done** — see "The PUBLISH_SECRET rotation debt" below. |
| `MCP_HTTP_AUTH_TOKEN` | per-site (recommend distinct per site once real per-site tokens exist; today the fleet has one site) | The outer MCP HTTP endpoint's shared-secret gate (`Authorization: Bearer <token>` or `x-mcp-auth-token`). Deprecated fallback as of T11.10 — verified per-agent tokens (below) satisfy the gate on their own and this is not a forced cutover. | Netlify env var, Functions scope | Generate a new random value (`openssl rand -base64 32`), set it, redeploy. No forced client migration — this is the fallback path, not the primary one going forward. |
| Per-agent tokens (`agent-keys.v1` records) | per-(agent_name, site) | The verified-identity path T11.10 adds: a bearer token that resolves to an ACTIVE key in the `governance` blob store's `agent-keys.v1` doc overrides self-declared `agent_name` for the 7 CMS attribution tools (`object_create`, `object_create_variant`, `object_instantiate_template`, `object_instantiate_section_template`, `site_apply_theme`, `product_set_price`, `order_reissue`). Does **not** touch workflow-stage `agent_name` (the `save_json_blob_*` enum) — a deliberate carve-out. | Netlify Blobs (`governance` store, `agent-keys.v1` doc) — hashed (sha256), never the raw token | Mint via `admin-governance.ts`'s `agent_keys_create` verb (Owner-only, `packages/core/admin` → the governance surface once wired into the UI, or a direct authenticated POST today). One ACTIVE key per (agent_name, site) — minting a replacement auto-revokes the prior one. Revoke via `agent_keys_revoke` (also Owner-only) the moment an agent's key is suspected leaked; there's no grace period, revocation is immediate and fails closed. |
| `ADMIN_EMAILS` | shared | Bootstrap Owner-role fallback (`resolveRolesFromEvent`/`isOwner`) before any invite-based role exists. | Netlify env var | Not a secret in the classic sense (email addresses, not a token) but still access-control-bearing — update it, don't rotate it; remove an address the moment that person's access should end. |
| `NETLIFY_AUTH_TOKEN` / `NETLIFY_API_TOKEN` | shared (CI) | GitHub Actions' ability to call the Netlify API (deploy status checks, `trigger_netlify_build`, `release_to_production`). | GitHub Actions repo secret | Rotate via Netlify → User settings → Applications → regenerate PAT; update the GitHub secret in the same sitting (no overlap window — plan for a short CI outage or stage the new token first if the platform allows two live tokens). |
| `GITHUB_CONTENT_TOKEN` | shared (CI + the CMS's own git-write path) | The CMS's mechanism for committing exports back to the repo (publish/materialize flows). Also the value `GITHUB_REPOSITORY` compares against in the secrets-scan carve-out (see CLAUDE.md's "Known gotchas" — unrelated rotation concern, don't conflate). | Netlify env var, Functions scope (+ GitHub Actions secret if CI needs equivalent write access) | Regenerate a fine-scoped GitHub PAT (repo contents write only, this one repo), update both the Netlify env var and the GitHub secret, verify one real publish end-to-end before considering the old token safe to revoke. |
| `NETLIFY_BLOBS_TOKEN` / `NETLIFY_API_TOKEN` (blobs path) | shared | Direct Netlify Blobs API access outside the Netlify Functions runtime context (used by CLI/CI tooling like `migrate-site.mjs`, `provision-pdf-tool-stores.mjs`, when not running inside a Netlify Function where blobs auth is ambient). | Netlify env var / local `.env` for CLI runs | Same PAT-regeneration procedure as `NETLIFY_AUTH_TOKEN` above; scope to the minimum needed (blobs read/write, this site only) if the platform supports fine-grained scoping. |
| `PDF_TOOL_STORAGE_TOKEN` / `PDF_TOOL_STORAGE_SITE_ID` | per-site | The storage grant pdf-tool exchanges to write directly into this site's Netlify Blob stores (artifacts, templates, image-search, job records). Full detail: `docs/agents/pdf-tool-storage-grant.md`. | Netlify env var, Functions scope | Documented in `pdf-tool-storage-grant.md`'s "Credential provisioning" section — dedicated machine account PAT, scoped to this site only. Re-run `scripts/provision-pdf-tool-stores.mjs` after rotation to confirm all six stores are still writable with the new credential before considering the old one safe to revoke. |
| `PDF_TOOL_BASE_URL` / `PDF_TOOL_AGENT_RUN_TOKEN` | fleet-shared | Server-side Platform artifact bridge endpoint and bearer. The bearer authorizes Platform to call pdf-tool; it never enters MCP responses or logs. `create-site` installs the current bridge values on every future client and fails closed if it cannot. | Netlify env var, Functions scope; bearer marked secret | Rotate with pdf-tool's `AGENT_RUN_TOKEN`, update every existing site deployment, then run the create → poll → verify bridge test. Future `create-site` runs inherit the rotated value from `pdf-x`, or from the provisioning process's `PDF_TOOL_AGENT_RUN_TOKEN` when the source is secret. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | shared (or per-site if per-client billing is ever wanted) | Model calls from the in-house agent chat hub / any server-side LLM call. | Netlify env var, Functions scope | Standard provider-console key rotation; no CMS-specific procedure. |
| `ARTIFACT_UPLOAD_TOKEN_SECRET` | per-site | Signs/validates artifact-upload intent tokens (`create_artifact_upload_intent`) so an upload URL can't be forged. | Netlify env var, Functions scope | Generate a new random value, set it — any in-flight upload intents signed with the old value will fail validation (acceptable; upload intents are short-lived by design). |
| Stripe keys (secret key, webhook signing secret) | per-site | Shop module (06-shop-module-plan.md) checkout + webhook verification. Not yet live in production. | Netlify env var, Functions scope | Stripe dashboard rotation; **must** happen before shop launch per the plan's launch gate ("Stripe keys marked as secrets"). Re-verify webhook signature checks against the new secret before flipping traffic. |

## Generation conventions

Where this runbook says "generate a new random value" with no product-specific
mechanism, the project's convention (matching `mintAgentToken` in
`packages/core/server/lib/agent-keys.ts`) is **256 bits of randomness,
URL-safe-encoded** — equivalently, `openssl rand -base64 32` from a shell, or
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
Long enough to defeat guessing, short enough to paste into an `Authorization`
header or a Netlify env-var field by hand.

## The PUBLISH_SECRET rotation debt

`PUBLISH_SECRET` was exposed on 2026-07-11 (an accepted risk at the time —
nothing was live yet) and **has never been rotated since**. Two things have
changed the urgency:

1. **The shop module launch gate already requires it** — 06-shop-module-plan.md
   §0.5 lists "rotate `PUBLISH_SECRET`" as one of two standing caveats that
   become hard launch blockers the moment commerce goes live (money moving
   changes the blast radius of a leaked write-secret from "an agent could
   forge a page edit" to "an agent could forge a price change or a fake
   order"). It is **not optional** — the shop plan says so in its own words.
2. **T11.10 does not retire `PUBLISH_SECRET`.** The per-agent-credential
   mechanism this task adds is a verified-identity layer for *attribution*
   (which agent did this), layered on top of the object-store proxy's
   existing `PUBLISH_SECRET`-gated write path — it is not a replacement
   authentication mechanism for that proxy. Rotating `PUBLISH_SECRET` is
   still a fully separate, still-pending action.

**Rotation procedure (when Wolf schedules it):**

1. Generate a new value per the "Generation conventions" above.
2. Set the new value as `PUBLISH_SECRET` in the Dr-Lurie site's Netlify
   environment variables (Functions scope).
3. Redeploy (or trigger a function reload) so the new value is live.
4. Any client currently holding the old `PUBLISH_SECRET` (agents, scripts,
   the admin UI's internal proxy calls) must pick up the new value — this is
   a **breaking, coordinated rotation**, not a rolling one (there is no
   dual-accept window built into `agentPrincipal`/the object-store proxy
   today; adding one, if a zero-downtime rotation is ever needed, is future
   scope, not part of this runbook).
5. Verify with one real write end-to-end (e.g. a `object_create` dry-run
   followed by a real create) before considering the rotation complete.

This runbook makes the rotation itself a known, one-page, five-step
procedure — executing it remains a human/Wolf-scheduled act, not something
this task performs.

## Related docs

- `docs/agents/pdf-tool-storage-grant.md` — the pdf-tool grant's own
  provisioning/rotation detail (referenced above, not duplicated here).
- `docs/cms-architecture/06-shop-module-plan.md` §0.5 — the shop module's
  launch-gate list, including the `PUBLISH_SECRET` rotation blocker this
  runbook tracks.
- `packages/core/server/lib/agent-keys.ts` — the per-agent-credential
  implementation (mint/hash/revoke/resolve) this runbook's per-agent-token
  row describes.
