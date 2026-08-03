/**
 * Committed fixture: the exact create-site --dry-run report for a fixed
 * example client ('acme') — T11.7's acceptance criterion 'dry-run output
 * committed as a fixture'. An .mjs module (not a plain .txt) so it gets
 * pulled into the compiled test tree the same way sites/drlurie's seed
 * .mjs files do (a relative JS import from an included .test.ts file),
 * without a fragile repoRoot/cwd guess for locating a raw text asset.
 * Regenerate with:
 *   node packages/core/cli/create-site.mjs --name acme --dry-run
 * and paste the output into the template literal below verbatim.
 */
export const expectedAcmeDryRun = `
create-site plan for 'acme' (Acme)
  site id:        site_acme
  taxonomy id:    tax_acme
  theme id:       thm_acme_default
  canonical host: https://acme.netlify.app

Files to create under sites/acme/ (73):
  + sites/acme/config/site-identity.ts
  + sites/acme/config/site-binding.ts
  + sites/acme/config/approval-policy.ts
  + sites/acme/config/creation-policy.ts
  + sites/acme/config/media-policy.ts
  + sites/acme/config/policy-bindings.ts
  + sites/acme/site.config.ts
  + sites/acme/netlify.toml
  + sites/acme/package.json
  + sites/acme/seeds/site-seed-data.mjs
  + sites/acme/seeds/navigation-seed-data.mjs
  + sites/acme/seeds/taxonomy-seed-data.mjs
  + sites/acme/seeds/themes-seed-data.mjs
  + sites/acme/seeds/section-templates-seed-data.mjs
  + sites/acme/data/site/navigation/.gitkeep
  + sites/acme/data/site/pages/.gitkeep
  + sites/acme/data/site/products/.gitkeep
  + sites/acme/data/site/section-templates/.gitkeep
  + sites/acme/data/site/sections/.gitkeep
  + sites/acme/data/site/templates/.gitkeep
  + sites/acme/data/site/themes/.gitkeep
  + sites/acme/data/site/articles/.gitkeep
  + sites/acme/astro.config.ts
  + sites/acme/config.yaml
  + sites/acme/app/content/config.ts
  + sites/acme/app/pages/index.astro
  + sites/acme/app/pages/404.astro
  + sites/acme/app/pages/[...objectPage].astro
  + sites/acme/app/pages/[...blog]/index.astro
  + sites/acme/app/pages/[...blog]/[...page].astro
  + sites/acme/app/pages/[...blog]/[category]/[...page].astro
  + sites/acme/app/pages/[...blog]/[tag]/[...page].astro
  + sites/acme/netlify/functions/admin-agent-chat.ts
  + sites/acme/netlify/functions/admin-agent-chat-run-background.ts
  + sites/acme/netlify/functions/admin-artifact-upload-intent.ts
  + sites/acme/netlify/functions/admin-ask-ai-object.ts
  + sites/acme/netlify/functions/admin-audit.ts
  + sites/acme/netlify/functions/admin-auth-state.ts
  + sites/acme/netlify/functions/admin-blob-manager.ts
  + sites/acme/netlify/functions/admin-blob-store-diagnostics.ts
  + sites/acme/netlify/functions/admin-get-blob-image.ts
  + sites/acme/netlify/functions/admin-get-blob-pdf.ts
  + sites/acme/netlify/functions/admin-governance.ts
  + sites/acme/netlify/functions/admin-list-blob-images.ts
  + sites/acme/netlify/functions/admin-object.ts
  + sites/acme/netlify/functions/admin-release.ts
  + sites/acme/netlify/functions/admin-taxonomy.ts
  + sites/acme/netlify/functions/admin-users.ts
  + sites/acme/netlify/functions/artifact-upload.ts
  + sites/acme/netlify/functions/checkout-session-status.ts
  + sites/acme/netlify/functions/claim-free.ts
  + sites/acme/netlify/functions/create-checkout-session.ts
  + sites/acme/netlify/functions/deploy-status.ts
  + sites/acme/netlify/functions/get-public-image.ts
  + sites/acme/netlify/functions/get-public-pdf.ts
  + sites/acme/netlify/functions/get-purchase.ts
  + sites/acme/netlify/functions/mcp.ts
  + sites/acme/netlify/functions/mcp-keepalive.ts
  + sites/acme/netlify/functions/mcp-oauth.ts
  + sites/acme/netlify/functions/object-store.ts
  + sites/acme/netlify/functions/run-publisher-agent.ts
  + sites/acme/netlify/functions/save-artifact.ts
  + sites/acme/netlify/functions/save-commerce-event.ts
  + sites/acme/netlify/functions/save-opt-in.ts
  + sites/acme/netlify/functions/stripe-webhook.ts
  + sites/acme/netlify/functions/track-ingest.ts
  + sites/acme/public/.gitkeep
  + sites/acme/assets/images/.gitkeep
  + sites/acme/data/site/site.json
  + sites/acme/data/site/navigation/nav_header.json
  + sites/acme/data/site/navigation/nav_footer.json
  + sites/acme/data/site/pages/page_home.json
  + sites/acme/data/site/pages/page_404.json

Netlify actions: none (no --netlify-token supplied — scaffold only).

Env checklist:
  Core publish + repo binding:
    PUBLISH_SECRET                   [per-site]  ☐ human-supplied — see the provisioning runbook
      Publish/release gate secret.
    NETLIFY_SITE_ID                  [per-site]  ☐ human-supplied — see the provisioning runbook
      Set AUTOMATICALLY by the provisioning run (W14 — blob runtime detection keys on it; a site without it runs its functions on the file-backed test store and fails at the first write). Only set by hand if provisioning reported a failure for it.
    NETLIFY_BUILD_HOOK_URL           [per-site]  ☐ human-supplied — see the provisioning runbook
      Create a build hook on the new site, then paste its URL here.
    GITHUB_REPOSITORY                [per-site]  ☐ human-supplied — see the provisioning runbook
      The client's content repo (owner/name).
    GITHUB_BRANCH                    [per-site]  ☐ human-supplied — see the provisioning runbook
      Content branch (defaults to main if unset).
    GITHUB_CONTENT_TOKEN             [per-site]  ☐ human-supplied — see the provisioning runbook
      Write token scoped to the client's content repo (may be a fleet machine account, per-repo scoped — T11.10).
    GITHUB_COMMIT_AUTHOR_EMAIL       [per-site]  ☐ human-supplied — see the provisioning runbook
      Git committer identity fallback (site-config-derived).
    GITHUB_COMMIT_AUTHOR_NAME        [per-site]  ☐ human-supplied — see the provisioning runbook
      As above.
  Access, identity, governance:
    MCP_HTTP_AUTH_TOKEN              [per-site]  ☐ human-supplied — see the provisioning runbook
      Shared MCP auth key (deprecated-fallback once T11.10 per-agent tokens land).
    ADMIN_EMAILS                     [per-site]  ☐ human-supplied — see the provisioning runbook
      Admin allowlist (Identity bootstrap) — human-owned.
    ROLE_EMAILS_ADMIN                [per-site]  ☐ human-supplied — see the provisioning runbook
      Role allowlist — human-owned.
    ROLE_EMAILS_EDITOR               [per-site]  ☐ human-supplied — see the provisioning runbook
      Role allowlist — human-owned.
    ROLE_EMAILS_PUBLISHER            [per-site]  ☐ human-supplied — see the provisioning runbook
      Role allowlist — human-owned.
    IDENTITY_URL                     [per-site]  ☐ human-supplied — see the provisioning runbook
      Netlify Identity endpoint for the new site.
    ARTIFACT_UPLOAD_TOKEN_SECRET     [per-site]  ☐ human-supplied — see the provisioning runbook
      Signs artifact-upload intents.
    ARTIFACT_URL_INGEST_ALLOWED_HOSTS [per-site]  ☐ human-supplied — see the provisioning runbook
      Allowed hosts for URL-based artifact ingest — human-owned policy choice.
  pdf-tool + tracking tenancy axes:
    PDF_TOOL_PROJECT_ID              [per-site]  ☐ human-supplied — see the provisioning runbook
      Escape hatch for the canonical project id committed in sites/<client>/config/site-identity.ts.
    PDF_TOOL_BASE_URL                [fleet-shared]  inherited automatically from the shared pdf-tool service
      Inherited automatically from the shared pdf-tool Netlify service for the server-side artifact bridge.
    PDF_TOOL_AGENT_RUN_TOKEN         [fleet-shared]  inherited automatically from the shared pdf-tool service
      Inherited automatically and stored as a Functions-only secret; never written to the scaffold or printed.
    PDF_TOOL_STORAGE_SITE_ID         [fleet-shared]  reuse the fleet value — do not create a new one
      Points at the ONE shared pdf-tool storage service — reuse the fleet value, do not create a new one.
    PDF_TOOL_STORAGE_TOKEN           [fleet-shared]  reuse the fleet value — do not create a new one
      Auth for that shared service — reuse the fleet value.
    TRACKING_PROJECT_ID              [per-site]  ☐ human-supplied — see the provisioning runbook
      This client's partition in the tracking owner-DB (trk_<shortId> convention).
    TRACKING_SALT                    [per-site]  ☐ human-supplied — see the provisioning runbook
      Hashing salt — MUST differ per site for cross-client privacy isolation.
    TRACKING_SINK_URL                [per-site (may be fleet-shared)]  ☐ human-supplied — see the provisioning runbook
      Owner-DB sink endpoint — one shared DB is allowed with TRACKING_PROJECT_ID as the partition.
    TRACKING_SINK_TOKEN              [per-site (may be fleet-shared)]  ☐ human-supplied — see the provisioning runbook
      Bearer for the sink; pairs with TRACKING_SINK_URL.
  AI + integrations:
    ANTHROPIC_API_KEY                [fleet-shared]  reuse the fleet value — do not create a new one
      AI provider key — reuse the fleet value.
    OPENAI_API_KEY                   [fleet-shared]  reuse the fleet value — do not create a new one
      AI provider key — reuse the fleet value.
    OPENAI_CHATKIT_WORKFLOW_ID       [per-site]  ☐ human-supplied — see the provisioning runbook
      ChatKit workflow id for this site's admin chat.
    NETLIFY_AUTH_TOKEN               [fleet-shared]  reuse the fleet value — do not create a new one
      Netlify account API token (provisioning/build automation) — reuse the fleet value.
    STRIPE_SECRET_KEY                [per-site, optional]  ☐ human-supplied — see the provisioning runbook
      Shop module only, if this client sells — the client's own Stripe account.
    STRIPE_SECRET_KEY_TEST           [per-site, optional]  ☐ human-supplied — see the provisioning runbook
      Shop test key.
    STRIPE_WEBHOOK_SECRET            [per-site, optional]  ☐ human-supplied — see the provisioning runbook
      Shop webhook signing secret.
    STRIPE_WEBHOOK_SECRET_TEST       [per-site, optional]  ☐ human-supplied — see the provisioning runbook
      Shop test webhook secret.
  Transitional site-identity env overrides (escape hatch only; prefer the config file):
    SITE_OBJECT_ID, SITE_SLUG, SITE_BRAND_NAME, SITE_TAXONOMY_ID, SITE_TRACKING_PROJECT_ID, MCP_SERVER_NAME, MCP_SERVER_DIAGNOSTIC_NAME, SITE_ASSET_HOST, SITE_ASSET_FOLDER, PDF_TOOL_PROJECT_ID
`;
