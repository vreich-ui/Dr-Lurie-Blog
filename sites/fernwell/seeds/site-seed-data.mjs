/**
 * Baseline site-singleton seed for 'site_fernwell' (T11.7 create-site
 * scaffold). This is a STARTER body — placeholder branding an operator
 * replaces before going live, not finished client content. Follows the
 * sites/drlurie/seeds/site-seed-data.mjs shape exactly (same driver
 * contract) so the standard round-trip/reconcile tooling works unmodified
 * for any new client.
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --site sites/fernwell --seeds sites/fernwell/seeds/site-seed-data.mjs
 */

export const SEED_SITE = 'site_fernwell';

export const siteBody = {
  name: 'Fernwell',
  logo: {
    text: 'FERNWELL',
  },
  urls: {
    base: '/',
    canonicalHost: 'https://kugel-fernwell.netlify.app',
  },
  metadataDefaults: {
    description: 'Fernwell — calm, practical houseplant care for people who have killed a few.',
    ogImage: '/Social/og-default.jpg',
    titleTemplate: '%s - Fernwell',
  },
  // Synthetic brand for the W14 T14.9 repeatability proof: a botanical,
  // green-forward palette distinct from Dr-Lurié's skincare tones, to prove the
  // fleet carries a genuinely different tenant, not a recolored clone.
  brandTokens: {
    colors: {
      primary: 'rgb(38 92 66)',
      secondary: 'rgb(24 64 46)',
      accent: 'rgb(197 122 74)',
      gold: 'rgb(182 148 66)',
      'text-heading': 'rgb(22 33 28)',
      'text-default': 'rgb(38 48 42)',
      'text-muted': 'rgb(58 72 64 / 78%)',
      'bg-page': 'rgb(252 251 247)',
      'bg-surface': 'rgb(240 244 238)',
      'bg-page-dark': 'rgb(14 20 17)',
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

export const CONVERSION_SEEDS = [{ objectType: 'site', objectId: 'site_fernwell', body: siteBody }];
