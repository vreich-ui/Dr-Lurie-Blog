#!/usr/bin/env node
/**
 * `create-site` — the W11 T11.7 provisioning CLI: "new client" = one command
 * (+ DNS, which stays human — see the runbook).
 *
 * `--name <client>` scaffolds `sites/<client>/`: a self-contained config
 * bundle (site-identity, SiteBinding, site.config, netlify.toml,
 * package.json) plus an empty committed-export tree and a baseline seed
 * pack (site singleton, nav skeleton, taxonomy skeleton, default theme,
 * five starter section-template recipes) — parameterized copies of the
 * canonical Dr-Lurie seed shapes with `<client>` ids, not Dr-Lurie's actual
 * content. `--dry-run` prints the full plan (files + Netlify actions + the
 * env checklist) and touches neither disk nor network. `--netlify-token`
 * additionally creates the Netlify site via the API, probes-provisions this
 * site's own blob stores (write → read → delete, the
 * scripts/provision-pdf-tool-stores.mjs pattern), and prints the real
 * per-site env checklist (docs/cms-architecture/T11.7-provisioning-cli.md's
 * table — kept in sync with docs/cms-architecture/site-provisioning-runbook.md
 * and the T11.10 governance/secrets inventory).
 *
 * Unlike the Dr-Lurie shell (`sites/drlurie/site.config.ts`, which re-exports
 * identity/binding singletons from `src/config/*` — that location is
 * Dr-Lurie's own committed config, not a shared core seam), a freshly
 * scaffolded client is FULLY self-contained under `sites/<client>/`: its own
 * `config/site-identity.ts` + `config/site-binding.ts` + `site.config.ts`,
 * importing only from `packages/core`. This is the "data + bindings only"
 * target shape (11-platformization-plan.md §2.2) with no residual
 * singleton-location assumption for the next client after this one.
 *
 * Secrets are never written to disk or printed: generatable per-site secrets
 * (PUBLISH_SECRET, TRACKING_SALT, ARTIFACT_UPLOAD_TOKEN_SECRET) are minted in
 * memory and, with a live token, pushed straight to the new Netlify site's
 * env store via the API — the checklist reports the env NAME and a ✓/☐
 * status, never the value. Human-owned values (GitHub tokens, Stripe keys,
 * admin emails…) get a placeholder line + a runbook pointer.
 *
 * Idempotent: an existing `sites/<client>/` directory is detected and left
 * untouched (this script only ever creates; re-run to see what would still
 * be missing, it never overwrites or deletes).
 *
 * Usage:
 *   node packages/core/cli/create-site.mjs --name acme --dry-run
 *   node packages/core/cli/create-site.mjs --name acme
 *   node packages/core/cli/create-site.mjs --name acme --netlify-token $NETLIFY_API_TOKEN
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ─── the per-site env checklist (T11.7-provisioning-cli.md's table; keep in
//     sync with docs/cms-architecture/site-provisioning-runbook.md and the
//     T11.10 governance/secrets inventory when either changes) ──────────────
//
// class: 'per-site' (unique per client, no safe default) | 'fleet-shared'
//   (one value across the fleet — reuse it, do not mint a new one) |
//   'optional' (feature-gated / has a safe default).
// generate: a () => string used ONLY for per-site secrets that are safe to
//   mint automatically; absent entries need a human-supplied value.
const randomSecret = (bytes) => () => crypto.randomBytes(bytes).toString('hex');

export const ENV_CHECKLIST = [
  {
    group: 'Core publish + repo binding',
    rows: [
      { name: 'PUBLISH_SECRET', cls: 'per-site', generate: randomSecret(32), note: 'Publish/release gate secret.' },
      {
        name: 'NETLIFY_SITE_ID',
        cls: 'per-site',
        note: 'Filled in from the created Netlify site (SITE_ID is the Netlify-injected alias — do not set by hand).',
      },
      {
        name: 'NETLIFY_BUILD_HOOK_URL',
        cls: 'per-site',
        note: 'Create a build hook on the new site, then paste its URL here.',
      },
      { name: 'GITHUB_REPOSITORY', cls: 'per-site', note: "The client's content repo (owner/name)." },
      { name: 'GITHUB_BRANCH', cls: 'per-site', note: 'Content branch (defaults to main if unset).' },
      {
        name: 'GITHUB_CONTENT_TOKEN',
        cls: 'per-site',
        note: "Write token scoped to the client's content repo (may be a fleet machine account, per-repo scoped — T11.10).",
      },
      {
        name: 'GITHUB_COMMIT_AUTHOR_EMAIL',
        cls: 'per-site',
        note: 'Git committer identity fallback (site-config-derived).',
      },
      { name: 'GITHUB_COMMIT_AUTHOR_NAME', cls: 'per-site', note: 'As above.' },
    ],
  },
  {
    group: 'Access, identity, governance',
    rows: [
      {
        name: 'MCP_HTTP_AUTH_TOKEN',
        cls: 'per-site',
        generate: randomSecret(24),
        note: 'Shared MCP auth key (deprecated-fallback once T11.10 per-agent tokens land).',
      },
      { name: 'ADMIN_EMAILS', cls: 'per-site', note: 'Admin allowlist (Identity bootstrap) — human-owned.' },
      { name: 'ROLE_EMAILS_ADMIN', cls: 'per-site', note: 'Role allowlist — human-owned.' },
      { name: 'ROLE_EMAILS_EDITOR', cls: 'per-site', note: 'Role allowlist — human-owned.' },
      { name: 'ROLE_EMAILS_PUBLISHER', cls: 'per-site', note: 'Role allowlist — human-owned.' },
      { name: 'IDENTITY_URL', cls: 'per-site', note: 'Netlify Identity endpoint for the new site.' },
      {
        name: 'ARTIFACT_UPLOAD_TOKEN_SECRET',
        cls: 'per-site',
        generate: randomSecret(32),
        note: 'Signs artifact-upload intents.',
      },
      {
        name: 'ARTIFACT_URL_INGEST_ALLOWED_HOSTS',
        cls: 'per-site',
        note: 'Allowed hosts for URL-based artifact ingest — human-owned policy choice.',
      },
    ],
  },
  {
    group: 'pdf-tool + tracking tenancy axes',
    rows: [
      {
        name: 'PDF_TOOL_PROJECT_ID',
        cls: 'per-site',
        note: 'Defaults to the site slug if unset — override only if it must differ.',
      },
      {
        name: 'PDF_TOOL_STORAGE_SITE_ID',
        cls: 'fleet-shared',
        note: 'Points at the ONE shared pdf-tool storage service — reuse the fleet value, do not create a new one.',
      },
      {
        name: 'PDF_TOOL_STORAGE_TOKEN',
        cls: 'fleet-shared',
        note: 'Auth for that shared service — reuse the fleet value.',
      },
      {
        name: 'TRACKING_PROJECT_ID',
        cls: 'per-site',
        note: "This client's partition in the tracking owner-DB (trk_<shortId> convention).",
      },
      {
        name: 'TRACKING_SALT',
        cls: 'per-site',
        generate: randomSecret(32),
        note: 'Hashing salt — MUST differ per site for cross-client privacy isolation.',
      },
      {
        name: 'TRACKING_SINK_URL',
        cls: 'per-site (may be fleet-shared)',
        note: 'Owner-DB sink endpoint — one shared DB is allowed with TRACKING_PROJECT_ID as the partition.',
      },
      {
        name: 'TRACKING_SINK_TOKEN',
        cls: 'per-site (may be fleet-shared)',
        note: 'Bearer for the sink; pairs with TRACKING_SINK_URL.',
      },
    ],
  },
  {
    group: 'AI + integrations',
    rows: [
      { name: 'ANTHROPIC_API_KEY', cls: 'fleet-shared', note: 'AI provider key — reuse the fleet value.' },
      { name: 'OPENAI_API_KEY', cls: 'fleet-shared', note: 'AI provider key — reuse the fleet value.' },
      { name: 'OPENAI_CHATKIT_WORKFLOW_ID', cls: 'per-site', note: "ChatKit workflow id for this site's admin chat." },
      {
        name: 'NETLIFY_AUTH_TOKEN',
        cls: 'fleet-shared',
        note: 'Netlify account API token (provisioning/build automation) — reuse the fleet value.',
      },
      {
        name: 'STRIPE_SECRET_KEY',
        cls: 'per-site, optional',
        note: "Shop module only, if this client sells — the client's own Stripe account.",
      },
      { name: 'STRIPE_SECRET_KEY_TEST', cls: 'per-site, optional', note: 'Shop test key.' },
      { name: 'STRIPE_WEBHOOK_SECRET', cls: 'per-site, optional', note: 'Shop webhook signing secret.' },
      { name: 'STRIPE_WEBHOOK_SECRET_TEST', cls: 'per-site, optional', note: 'Shop test webhook secret.' },
    ],
  },
];

// Transitional escape-hatch env overrides (src/lib/site-identity.ts) —
// surfaced for parity per the brief, but create-site prefers the config
// file: these are named here, never generated or required.
export const SITE_IDENTITY_ENV_OVERRIDES = [
  'SITE_OBJECT_ID',
  'SITE_SLUG',
  'SITE_BRAND_NAME',
  'SITE_TAXONOMY_ID',
  'SITE_TRACKING_PROJECT_ID',
  'MCP_SERVER_NAME',
  'MCP_SERVER_DIAGNOSTIC_NAME',
  'SITE_ASSET_HOST',
  'SITE_ASSET_FOLDER',
  'PDF_TOOL_PROJECT_ID',
];

// This site's own blob-store namespace (packages/core/server/lib/{blob-store,
// governance-store,users-store}.ts + agent/chat-store.ts — keep this list in
// sync with those store-name literals, the same discipline
// scripts/provision-pdf-tool-stores.mjs uses for the pdf-tool's stores).
export const CORE_BLOB_STORES = [
  'site-objects',
  'workflows',
  'artifacts',
  'artifact-index',
  'commerce',
  'agent-chats',
  'governance',
  'users',
];

const DATA_SITE_SUBDIRS = [
  'navigation',
  'pages',
  'products',
  'section-templates',
  'sections',
  'templates',
  'themes',
  'articles',
];

// ─── validation ─────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;

export const validateClientSlug = (name) => {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('--name is required, e.g. --name acme');
  }
  if (!SLUG_RE.test(name)) {
    throw new Error(
      `--name '${name}' is invalid: must be lowercase, start with a letter, and contain only letters/digits/hyphens (2-31 chars).`
    );
  }
  return name;
};

// ─── plan ids ────────────────────────────────────────────────────────────────

export const idsFor = (clientSlug) => {
  const clientId = clientSlug.replace(/-/g, '_');
  return {
    clientSlug,
    clientId,
    siteId: `site_${clientId}`,
    taxonomyId: `tax_${clientId}`,
    themeId: `thm_${clientId}_default`,
  };
};

// ─── file content templates ─────────────────────────────────────────────────

const titleCase = (slug) =>
  slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

const siteIdentityTemplate = (ids, brandName) => `/**
 * ${brandName} site-identity config (T11.7 scaffold) — every tenant-specific
 * identifier this client's deployment needs, in ONE place. Mirrors
 * src/config/site-identity.ts's shape (packages/core/lib/site-identity.ts's
 * SiteIdentityConfig) but lives under this client's own sites/<client>/ tree
 * — self-contained, no dependency on another client's committed config.
 *
 * The committed site export (data/site/site.json, materialized from the
 * site singleton record) stays authoritative: a lockstep test should fail if
 * the two drift, the same discipline Dr-Lurie's site-identity.test.ts uses.
 */
import type { SiteIdentityConfig } from '../../../packages/core/lib/site-identity.js';

export const siteIdentityConfig = {
  siteId: '${ids.siteId}',
  siteSlug: '${ids.clientSlug}',
  brandName: '${brandName}',
  mcpServerName: '${titleCase(ids.clientSlug).replace(/\s+/g, '_')}_MCP_Server',
  mcpDiagnosticName: '${titleCase(ids.clientSlug).replace(/\s+/g, '_')}_MCP',
  // Placeholder — point at this client's real asset CDN before going live.
  assetHost: 'https://example-assets.netlify.app',
  assetFolder: '${ids.clientSlug}',
} satisfies SiteIdentityConfig;
`;

const siteBindingTemplate = (ids) => `/**
 * ${ids.clientSlug} SiteBinding (T11.7 scaffold) — this client's instantiation
 * of the core server layer's per-site seam (packages/core/server/lib/
 * site-binding.ts). Carries the site id, the env-var NAMES the server
 * machinery reads (the shared \`PLATFORM_ENV_NAMES\` — every client reads the
 * same names, the platform supplies per-site values, OQ-W11-4), and this
 * site's committed-export root.
 */
import { PLATFORM_ENV_NAMES, type SiteBinding } from '../../../packages/core/server/lib/site-binding.js';
import { siteIdentityConfig } from './site-identity.js';

export const siteBinding: SiteBinding = {
  siteId: siteIdentityConfig.siteId,
  env: PLATFORM_ENV_NAMES,
  dataRoot: 'sites/${ids.clientSlug}/data/site',
};
`;

const siteConfigTemplate = (ids, brandName, canonicalHost) => `/**
 * ${brandName} site config (T11.7 scaffold) — the per-client bundle of
 * everything that binds a deployment of the core CMS to THIS site: identity,
 * canonical host, image domains, the redirect table, and the site binding.
 * Routing authority stays a committed FILE (Wolf B2) — this module IS that
 * file for this client. Mirrors sites/drlurie/site.config.ts's shape (the
 * W11 T11.6 pattern) but is fully self-contained under this client's own
 * tree — see ./config/site-identity.ts + ./config/site-binding.ts, not
 * another client's src/config/*.
 *
 * Wire this up the way sites/drlurie's shell does: astro.config.ts reads
 * canonicalHost/imageDomains from here for THIS deployment; config.yaml's
 * site URL must agree; netlify.toml's [[redirects]] must equal \`redirects\`
 * below. (Today only one Netlify build — Dr-Lurie's — reads any site.config
 * at build time; wiring an actual second deployment to read from ITS OWN
 * sites/<client>/site.config.ts, rather than sites/drlurie's, is T11.11's
 * job, not this scaffold's.)
 */
import { z } from 'zod';

import { siteIdentityConfig } from './config/site-identity.js';

const redirectSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  status: z.number().int(),
});

export const siteConfigSchema = z.strictObject({
  siteId: z.string().regex(/^site_[a-z0-9]+$/),
  canonicalHost: z.string().regex(/^https:\\/\\/[^\\s/]+$/),
  imageDomains: z.array(z.string().min(1)),
  redirects: z.array(redirectSchema),
});

export type SiteConfig = z.infer<typeof siteConfigSchema>;

export const siteConfig: SiteConfig = siteConfigSchema.parse({
  siteId: siteIdentityConfig.siteId,
  canonicalHost: '${canonicalHost}',
  imageDomains: [],
  redirects: [
    { from: '/pdf/*', to: '/.netlify/functions/get-public-pdf?blobKey=pdf/:splat', status: 200 },
    { from: '/img/*', to: '/.netlify/functions/get-public-image?blobKey=image/:splat', status: 200 },
    { from: '/mcp', to: '/.netlify/functions/mcp', status: 200 },
    { from: '/api/t', to: '/.netlify/functions/track-ingest', status: 200 },
    { from: '/admin/content/*', to: '/admin/content/__workspace', status: 200 },
  ],
});

export { siteIdentityConfig };
export { siteBinding } from './config/site-binding.js';
`;

const netlifyTomlTemplate = () => `# T11.7 scaffold — per-site Netlify config template. The redirects here MUST
# equal this client's site.config.ts \`redirects\` (the drift-guard discipline
# root netlify.toml/sites/drlurie's site.config.ts already share). This file
# is not read by any live build today (there is one Netlify build, Dr-Lurie's
# — see the site.config.ts scaffold note); it ships as the plan for this
# client's own Netlify site once T11.11-style wiring points a real deploy at
# this tree.

[build]
  publish = "dist"
  command = "npm run build"
[build.environment]
  NODE_VERSION = "20"

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"

[[redirects]]
  from = "/pdf/*"
  to = "/.netlify/functions/get-public-pdf?blobKey=pdf/:splat"
  status = 200
  force = true

[[redirects]]
  from = "/img/*"
  to = "/.netlify/functions/get-public-image?blobKey=image/:splat"
  status = 200
  force = true

[[redirects]]
  from = "/mcp"
  to = "/.netlify/functions/mcp"
  status = 200
  force = true

[[redirects]]
  from = "/api/t"
  to = "/.netlify/functions/track-ingest"
  status = 200
  force = true

[[redirects]]
  from = "/admin/content/*"
  to = "/admin/content/__workspace"
  status = 200
  force = true
`;

const packageJsonTemplate = (ids) =>
  JSON.stringify(
    {
      name: `@fleet/site-${ids.clientSlug}`,
      version: '0.0.0',
      private: true,
      type: 'module',
      description:
        'Scaffold only (T11.7 create-site). This client site (data + bindings only). Depends on @drlurie/core (link declared now; exercised once this site has content).',
      dependencies: {
        '@drlurie/core': '*',
      },
    },
    null,
    2
  ) + '\n';

const siteSeedTemplate = (ids, brandName, canonicalHost) => `/**
 * Baseline site-singleton seed for '${ids.siteId}' (T11.7 create-site
 * scaffold). This is a STARTER body — placeholder branding an operator
 * replaces before going live, not finished client content. Follows the
 * sites/drlurie/seeds/site-seed-data.mjs shape exactly (same driver
 * contract) so the standard round-trip/reconcile tooling works unmodified
 * for any new client.
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --site sites/${ids.clientSlug} --seeds sites/${ids.clientSlug}/seeds/site-seed-data.mjs
 */

export const SEED_SITE = '${ids.siteId}';

export const siteBody = {
  name: '${brandName}',
  logo: {
    text: '${brandName.toUpperCase()}',
  },
  urls: {
    base: '/',
    canonicalHost: '${canonicalHost}',
  },
  metadataDefaults: {
    description: '${brandName} — a starter site, ready for real content.',
    ogImage: '/Social/og-default.jpg',
    titleTemplate: '%s - ${brandName}',
  },
  brandTokens: {
    colors: {
      primary: 'rgb(51 102 204)',
      secondary: 'rgb(38 77 153)',
      accent: 'rgb(0 150 136)',
      gold: 'rgb(191 155 48)',
      'text-heading': 'rgb(20 24 28)',
      'text-default': 'rgb(38 43 48)',
      'text-muted': 'rgb(60 67 75 / 76%)',
      'bg-page': 'rgb(255 255 255)',
      'bg-surface': 'rgb(245 246 248)',
      'bg-page-dark': 'rgb(10 12 20)',
    },
    fonts: {
      sans: 'system-ui, sans-serif',
      serif: 'Georgia, serif',
      heading: 'Georgia, serif',
    },
  },
  chrome: {
    showRssFeed: false,
    showThemeToggle: true,
  },
  defaultNavigation: {
    header: 'nav_header',
    footer: 'nav_footer',
  },
  blog: {
    listPath: 'learn/library',
    postsPerPage: 6,
    categoryBase: 'category',
    tagBase: 'tag',
  },
};

export const CONVERSION_SEEDS = [{ objectType: 'site', objectId: '${ids.siteId}', body: siteBody }];
`;

const navigationSeedTemplate = (ids, brandName) => `/**
 * Baseline navigation SKELETON for '${ids.siteId}' (T11.7 create-site
 * scaffold) — one header menu, one footer menu, each carrying a single
 * "Home" link to '/'. Real content replaces this before launch; it exists
 * so the site singleton's defaultNavigation refs resolve immediately and the
 * round-trip driver has a non-empty nav to drill.
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --site sites/${ids.clientSlug} --seeds sites/${ids.clientSlug}/seeds/navigation-seed-data.mjs
 */

export const SEED_SITE = '${ids.siteId}';

export const navHeaderBody = {
  role: 'header',
  groups: [
    {
      id: 'g_primary',
      items: [{ id: 'i_home', label: 'Home', target: { kind: 'route', href: '/' } }],
    },
  ],
};

export const navFooterBody = {
  role: 'footer',
  brand: { text: '${brandName}' },
  groups: [
    {
      id: 'g_footer_primary',
      items: [{ id: 'i_home', label: 'Home', target: { kind: 'route', href: '/' } }],
    },
  ],
  footNote: '© ${brandName}.',
};

export const CONVERSION_SEEDS = [
  { objectType: 'navigation', objectId: 'nav_header', body: navHeaderBody },
  { objectType: 'navigation', objectId: 'nav_footer', body: navFooterBody },
];
`;

const taxonomySeedTemplate = (ids) => `/**
 * Baseline taxonomy-registry SKELETON for '${ids.taxonomyId}' (T11.7
 * create-site scaffold) — zero terms. A brand-new client has no editorial
 * vocabulary yet; agents grow it with the taxonomy patch ops (add_term, …)
 * as real content gets written. Mirrors sites/drlurie/seeds/
 * taxonomy-seed-data.mjs's shape (empty kinds.category/tag term arrays parse
 * cleanly — taxonomy.v1 imposes no minimum).
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --site sites/${ids.clientSlug} --seeds sites/${ids.clientSlug}/seeds/taxonomy-seed-data.mjs
 */

export const SEED_SITE = '${ids.siteId}';

export const taxonomyBody = {
  kinds: {
    category: { terms: [] },
    tag: { terms: [] },
  },
};

export const CONVERSION_SEEDS = [{ objectType: 'taxonomy', objectId: '${ids.taxonomyId}', body: taxonomyBody }];
`;

const themeSeedTemplate = (ids) => `/**
 * Baseline default THEME for '${ids.themeId}' (T11.7 create-site scaffold).
 * Tokens are imported from the site seed so the default theme is
 * byte-identical to the starter palette — applying it to the untouched site
 * is a provable no-op (the same W8.4 zero-risk pattern Dr-Lurie's
 * thm_drlurie_default uses).
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --site sites/${ids.clientSlug} --seeds sites/${ids.clientSlug}/seeds/themes-seed-data.mjs
 */
import { siteBody } from './site-seed-data.mjs';

export const SEED_SITE = '${ids.siteId}';

export const themeDefaultBody = {
  name: 'Default',
  description: 'The starter palette, verbatim from the site seed — applying it to the untouched site is a no-op.',
  whenToUse: 'Apply to restore the starter palette after theme experiments, or copy as the starting point for a real brand palette.',
  scope: 'evergreen',
  tokens: structuredClone(siteBody.brandTokens),
};

export const CONVERSION_SEEDS = [{ objectType: 'theme', objectId: '${ids.themeId}', body: themeDefaultBody }];
`;

const sectionTemplatesSeedTemplate = (ids) => `/**
 * Baseline starter section-template RECIPES for '${ids.siteId}' (T11.7
 * create-site scaffold) — the same five core-provided starter shapes every
 * client gets (Dr-Lurie's sites/drlurie/seeds/section-templates-seed-data.mjs,
 * W8.1): a landing hero, a curated audience/feature grid, an automatic
 * related-articles strip, a newsletter CTA, and a closing CTA banner. All
 * blueprint copy is neutral starter text — a recipe supplies structure, an
 * agent replaces the copy before publishing. Recipe ids are stable across
 * the fleet (they carry no client-specific data, so there is no reason for
 * a client's copy to diverge from the canonical starter set).
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --site sites/${ids.clientSlug} --seeds sites/${ids.clientSlug}/seeds/section-templates-seed-data.mjs
 */

export const SEED_SITE = '${ids.siteId}';

export const sectionTemplateHeroLandingBody = {
  name: 'Landing hero',
  description: 'Opening hero for a landing or campaign page: kicker + heading + intro copy + action slots.',
  whenToUse: 'Stamp as the FIRST section of a campaign or landing page.',
  scope: 'evergreen',
  blueprint: {
    id: 's_stplhero',
    type: 'hero',
    data: {
      kicker: 'Overview',
      heading: 'New hero heading',
      body: '<p>One short paragraph setting up what this page offers.</p>',
      actions: [],
    },
  },
};

export const sectionTemplateAudienceGridBody = {
  name: 'Audience grid',
  description: 'Curated text-cell grid ("who this is for" / feature highlights) — cards are hand-written copy.',
  whenToUse: '"Who this is for" and feature-highlight rows where every cell is hand-written copy.',
  scope: 'evergreen',
  blueprint: {
    id: 's_stplaudience',
    type: 'content_grid',
    data: {
      kicker: 'Who this is for',
      heading: 'New audience heading',
      limit: 4,
      source: {
        kind: 'cards',
        cards: [
          { description: 'First audience or feature cell.' },
          { description: 'Second audience or feature cell.' },
        ],
      },
    },
  },
};

export const sectionTemplateRelatedArticlesBody = {
  name: 'Related articles',
  description: 'Automatic related-content strip: three tiles picked by tag similarity from published articles.',
  whenToUse: 'End-of-article and hub pages that should surface further reading automatically.',
  scope: 'evergreen',
  blueprint: {
    id: 's_stplrelated',
    type: 'content_grid',
    data: {
      kicker: 'Keep reading',
      heading: 'Related articles',
      limit: 3,
      source: { kind: 'related', algorithm: 'tag_similarity' },
    },
  },
};

export const sectionTemplateNewsletterCtaBody = {
  name: 'Newsletter CTA',
  description: 'A single-field email capture band.',
  whenToUse: 'Anywhere the page should offer an email opt-in.',
  scope: 'evergreen',
  blueprint: {
    id: 's_stplnewsletter',
    type: 'newsletter_signup',
    data: {
      heading: 'Stay in the loop',
      body: '<p>Get occasional updates — no spam.</p>',
      formName: 'newsletter',
    },
  },
};

export const sectionTemplateCtaBannerBody = {
  name: 'CTA banner',
  description: 'A full-width closing call-to-action band.',
  whenToUse: 'End-of-page closing CTA on interior or about-style pages.',
  scope: 'evergreen',
  blueprint: {
    id: 's_stplctabanner',
    type: 'cta_banner',
    data: {
      heading: 'Ready to get started?',
      body: '<p>One short closing sentence.</p>',
      actions: [],
    },
  },
};

export const CONVERSION_SEEDS = [
  { objectType: 'section_template', objectId: 'stpl_hero_landing', body: sectionTemplateHeroLandingBody },
  { objectType: 'section_template', objectId: 'stpl_audience_grid', body: sectionTemplateAudienceGridBody },
  { objectType: 'section_template', objectId: 'stpl_related_articles', body: sectionTemplateRelatedArticlesBody },
  { objectType: 'section_template', objectId: 'stpl_newsletter_cta', body: sectionTemplateNewsletterCtaBody },
  { objectType: 'section_template', objectId: 'stpl_cta_banner', body: sectionTemplateCtaBannerBody },
];
`;

// ─── plan builder ────────────────────────────────────────────────────────────

export const buildPlan = (opts) => {
  const clientSlug = validateClientSlug(opts.name);
  const ids = idsFor(clientSlug);
  const brandName = opts.brandName || titleCase(clientSlug);
  const canonicalHost = opts.canonicalHost || `https://${clientSlug}.netlify.app`;
  const dir = `sites/${clientSlug}`;

  const files = [
    { path: `${dir}/config/site-identity.ts`, content: siteIdentityTemplate(ids, brandName) },
    { path: `${dir}/config/site-binding.ts`, content: siteBindingTemplate(ids) },
    { path: `${dir}/site.config.ts`, content: siteConfigTemplate(ids, brandName, canonicalHost) },
    { path: `${dir}/netlify.toml`, content: netlifyTomlTemplate() },
    { path: `${dir}/package.json`, content: packageJsonTemplate(ids) },
    { path: `${dir}/seeds/site-seed-data.mjs`, content: siteSeedTemplate(ids, brandName, canonicalHost) },
    { path: `${dir}/seeds/navigation-seed-data.mjs`, content: navigationSeedTemplate(ids, brandName) },
    { path: `${dir}/seeds/taxonomy-seed-data.mjs`, content: taxonomySeedTemplate(ids) },
    { path: `${dir}/seeds/themes-seed-data.mjs`, content: themeSeedTemplate(ids) },
    { path: `${dir}/seeds/section-templates-seed-data.mjs`, content: sectionTemplatesSeedTemplate(ids) },
    ...DATA_SITE_SUBDIRS.map((sub) => ({ path: `${dir}/data/site/${sub}/.gitkeep`, content: '' })),
  ];

  return { clientSlug, ids, brandName, canonicalHost, dir, files };
};

// ─── rendering (dry-run / execution report) ─────────────────────────────────

export const renderEnvChecklist = (executed) => {
  const lines = [];
  for (const { group, rows } of ENV_CHECKLIST) {
    lines.push(`  ${group}:`);
    for (const row of rows) {
      let status;
      if (executed && row.generate) status = '✓ generated + set on the new site (value not shown)';
      else if (row.cls === 'fleet-shared') status = 'reuse the fleet value — do not create a new one';
      else status = '☐ human-supplied — see the provisioning runbook';
      lines.push(`    ${row.name.padEnd(32)} [${row.cls}]  ${status}`);
      lines.push(`      ${row.note}`);
    }
  }
  lines.push('  Transitional site-identity env overrides (escape hatch only; prefer the config file):');
  lines.push(`    ${SITE_IDENTITY_ENV_OVERRIDES.join(', ')}`);
  return lines.join('\n');
};

export const renderPlan = (plan, { netlifyToken }) => {
  const lines = [];
  lines.push(`create-site plan for '${plan.clientSlug}' (${plan.brandName})`);
  lines.push(`  site id:        ${plan.ids.siteId}`);
  lines.push(`  taxonomy id:    ${plan.ids.taxonomyId}`);
  lines.push(`  theme id:       ${plan.ids.themeId}`);
  lines.push(`  canonical host: ${plan.canonicalHost}`);
  lines.push('');
  lines.push(`Files to create under ${plan.dir}/ (${plan.files.length}):`);
  for (const file of plan.files) lines.push(`  + ${file.path}`);
  lines.push('');
  if (netlifyToken) {
    lines.push('Netlify actions (would run with the provided token):');
    lines.push(`  - POST /api/v1/sites — create a site named '${plan.clientSlug}'`);
    lines.push(
      `  - probe (write → read → delete) this site's ${CORE_BLOB_STORES.length} blob stores: ${CORE_BLOB_STORES.join(', ')}`
    );
    lines.push(
      '  - generate + push per-site secrets (PUBLISH_SECRET, MCP_HTTP_AUTH_TOKEN, ARTIFACT_UPLOAD_TOKEN_SECRET, TRACKING_SALT) directly to the new site (never printed)'
    );
  } else {
    lines.push('Netlify actions: none (no --netlify-token supplied — scaffold only).');
  }
  lines.push('');
  lines.push('Env checklist:');
  lines.push(renderEnvChecklist(false));
  return lines.join('\n');
};

// ─── execution ───────────────────────────────────────────────────────────────

export const writeFiles = (plan) => {
  for (const file of plan.files) {
    const fullPath = path.join(repoRoot, file.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content);
  }
};

const createNetlifySite = async (fetchImpl, token, siteName) => {
  const response = await fetchImpl('https://api.netlify.com/api/v1/sites', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: siteName }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Netlify site creation failed: ${response.status} ${body}`);
  }
  return response.json();
};

const probeStore = async (getStore, { siteID, token }, storeName) => {
  const store = getStore({ name: storeName, siteID, token, consistency: 'strong' });
  const probeKey = `__create-site-provision-probe__/${crypto.randomUUID()}.json`;
  const payload = { probedAt: new Date().toISOString(), purpose: 'create-site provisioning probe' };
  await store.setJSON(probeKey, payload);
  const readBack = await store.get(probeKey, { type: 'json' });
  if (!readBack || readBack.probedAt !== payload.probedAt) {
    throw new Error(`probe read-back mismatch for store '${storeName}'`);
  }
  await store.delete(probeKey);
};

const setNetlifyEnvVar = async (fetchImpl, token, accountId, siteId, key, value) => {
  const response = await fetchImpl(
    `https://api.netlify.com/api/v1/accounts/${accountId}/env?site_id=${encodeURIComponent(siteId)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, scopes: ['builds', 'functions'], values: [{ value, context: 'production' }] }),
    }
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Netlify env-var set failed for ${key}: ${response.status} ${body}`);
  }
};

/**
 * Runs the credentialed half. Isolated behind an options bag (fetchImpl /
 * getStoreImpl injectable) so tests can exercise the control flow without a
 * real network call — mirroring the object-publish.ts / provision-pdf-tool-
 * stores.mjs testing seam pattern used elsewhere in this repo.
 */
export const executeNetlifyProvisioning = async (plan, { token, fetchImpl = fetch, getStoreImpl }) => {
  const site = await createNetlifySite(fetchImpl, token, plan.clientSlug);
  const siteId = site.id || site.site_id;
  const accountId = site.account_id;

  let getStore = getStoreImpl;
  if (!getStore) {
    ({ getStore } = await import('@netlify/blobs'));
  }
  const storeFailures = [];
  for (const storeName of CORE_BLOB_STORES) {
    try {
      await probeStore(getStore, { siteID: siteId, token }, storeName);
    } catch (error) {
      storeFailures.push({ storeName, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const secretsSet = [];
  const secretsFailed = [];
  if (accountId) {
    for (const { rows } of ENV_CHECKLIST) {
      for (const row of rows) {
        if (!row.generate) continue;
        try {
          await setNetlifyEnvVar(fetchImpl, token, accountId, siteId, row.name, row.generate());
          secretsSet.push(row.name);
        } catch (error) {
          secretsFailed.push({ name: row.name, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }

  return { site, siteId, accountId, storeFailures, secretsSet, secretsFailed };
};

// ─── CLI entry ───────────────────────────────────────────────────────────────

const parseArgs = (argv) => {
  const opts = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--name') {
      opts.name = argv[i + 1];
      i += 1;
    } else if (arg === '--brand-name') {
      opts.brandName = argv[i + 1];
      i += 1;
    } else if (arg === '--canonical-host') {
      opts.canonicalHost = argv[i + 1];
      i += 1;
    } else if (arg === '--netlify-token') {
      opts.netlifyToken = argv[i + 1];
      i += 1;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    }
  }
  return opts;
};

export const main = async (argv) => {
  const opts = parseArgs(argv);
  const plan = buildPlan(opts);
  const netlifyToken = opts.netlifyToken || process.env.NETLIFY_API_TOKEN;

  if (opts.dryRun) {
    console.log(renderPlan(plan, { netlifyToken: Boolean(netlifyToken) }));
    return;
  }

  const targetDir = path.join(repoRoot, plan.dir);
  if (fs.existsSync(targetDir)) {
    console.log(`[create-site] ${plan.dir}/ already exists — leaving it untouched (idempotent re-run).`);
    console.log('[create-site] Delete or rename it first if you want a clean re-scaffold.');
    return;
  }

  writeFiles(plan);
  console.log(`[create-site] scaffolded ${plan.files.length} files under ${plan.dir}/.`);

  if (netlifyToken) {
    console.log('[create-site] provisioning the Netlify site + blob stores…');
    const result = await executeNetlifyProvisioning(plan, { token: netlifyToken });
    console.log(`[create-site] Netlify site created: id=${result.siteId}`);
    for (const storeName of CORE_BLOB_STORES) {
      const failed = result.storeFailures.find((f) => f.storeName === storeName);
      console.log(failed ? `  FAILED   ${storeName}: ${failed.message}` : `  ok       ${storeName}`);
    }
    if (result.secretsSet.length) console.log(`[create-site] generated + set: ${result.secretsSet.join(', ')}`);
    if (result.secretsFailed.length) {
      console.log('[create-site] secret-set FAILURES (fix and set these by hand in the Netlify UI):');
      for (const failure of result.secretsFailed) console.log(`  FAILED   ${failure.name}: ${failure.message}`);
    }
  } else {
    console.log(
      '[create-site] no --netlify-token supplied — scaffold only. Provide one to create the Netlify site + stores.'
    );
  }

  console.log('');
  console.log('Env checklist:');
  console.log(renderEnvChecklist(Boolean(netlifyToken)));
  console.log('');
  console.log(
    'See docs/cms-architecture/site-provisioning-runbook.md for the human half (DNS, secrets, Identity bootstrap).'
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[create-site] FAILED: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
