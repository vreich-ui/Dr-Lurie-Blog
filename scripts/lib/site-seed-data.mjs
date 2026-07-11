/**
 * Seed data for the site singleton — `site_drlurie` (W4, 2026-07-11).
 *
 * The body carries the CURRENT live values, transcribed from where each one
 * was hardcoded (byte-identical cutover: seeding these values changes nothing
 * on the rendered site):
 *
 *   - name / urls / metadataDefaults / blog — src/config.yaml (site, metadata,
 *     apps.blog blocks);
 *   - logo.text — the Logo.astro default literal;
 *   - brandTokens — the CustomStyles.astro `:root` / `.dark` custom-property
 *     literals. Colors are keyed by CSS var name minus the `--aw-color-`
 *     prefix; the `.dark` block's overrides carry a `dark:` key prefix.
 *     Values are verbatim CSS (the odd comma form in `dark:text-heading` is
 *     the current literal — do not "fix" it, byte-identity is the gate);
 *   - chrome — PageLayout's hardcoded Header flags (both true today);
 *   - defaultNavigation — the nav object ids PageLayout hardcodes (D§5.4:
 *     this is the ONLY place default menus bind).
 *
 * Scope boundary (Wolf's B2, 2026-07-11): `urls` and `blog` are CARRIED in
 * the object (agents can read and patch them) but config.yaml remains
 * authoritative for routing/permalink wiring — repointing listPath or base
 * here does not yet move routes. metadataDefaults, brandTokens, chrome,
 * logo, name and defaultNavigation ARE live: the renderers read them from
 * the derived export (src/data/site/site.json) with the old hardcoded
 * values as fallback. chrome.announcement is deferred (B3) and omitted.
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --seeds scripts/lib/site-seed-data.mjs
 */

export const SEED_SITE = 'site_drlurie';

export const siteBody = {
  name: 'Dr. Lurié',
  logo: {
    text: 'DR. LURIÉ SCIENCE',
  },
  urls: {
    base: '/',
    canonicalHost: 'https://drluriescience.netlify.app',
  },
  metadataDefaults: {
    titleTemplate: '%s — Dr. Lurié',
    description:
      'Science-led education on aging skin, age-related scent changes, and future age-aware skincare solutions.',
    ogImage: '/Social/og-default.jpg',
    twitterHandle: '@drlurie',
  },
  brandTokens: {
    colors: {
      primary: 'rgb(46 111 149)',
      secondary: 'rgb(37 90 120)',
      accent: 'rgb(94 140 138)',
      gold: 'rgb(194 168 120)',
      'text-heading': 'rgb(22 26 29)',
      'text-default': 'rgb(36 41 46)',
      'text-muted': 'rgb(58 65 73 / 76%)',
      'bg-page': 'rgb(252 251 248)',
      'bg-surface': 'rgb(247 245 240)',
      'bg-page-dark': 'rgb(3 6 32)',
      'dark:primary': 'rgb(46 111 149)',
      'dark:secondary': 'rgb(37 90 120)',
      'dark:accent': 'rgb(94 140 138)',
      'dark:gold': 'rgb(194 168 120)',
      'dark:text-heading': 'rgb(247, 248, 248)',
      'dark:text-default': 'rgb(229 236 246)',
      'dark:text-muted': 'rgb(229 236 246 / 66%)',
      'dark:bg-page': 'rgb(3 6 32)',
      'dark:bg-surface': 'rgb(19 24 46)',
    },
    fonts: {
      sans: "'Inter Variable'",
      serif: "'Source Serif 4', Georgia, serif",
      heading: "'Playfair Display', 'Times New Roman', serif",
    },
  },
  chrome: {
    showRssFeed: true,
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

export const CONVERSION_SEEDS = [{ objectType: 'site', objectId: 'site_drlurie', body: siteBody }];
