/**
 * Baseline navigation SKELETON for 'site_platform' (T11.7 create-site
 * scaffold) — one header menu, one footer menu, each carrying a single
 * "Home" link to '/'. Real content replaces this before launch; it exists
 * so the site singleton's defaultNavigation refs resolve immediately and the
 * round-trip driver has a non-empty nav to drill.
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --site sites/platform --seeds sites/platform/seeds/navigation-seed-data.mjs
 */

export const SEED_SITE = 'site_platform';

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
  brand: { text: 'Platform' },
  groups: [
    {
      id: 'g_footer_primary',
      items: [{ id: 'i_home', label: 'Home', target: { kind: 'route', href: '/' } }],
    },
  ],
  footNote: '© Platform.',
};

export const CONVERSION_SEEDS = [
  { objectType: 'navigation', objectId: 'nav_header', body: navHeaderBody },
  { objectType: 'navigation', objectId: 'nav_footer', body: navFooterBody },
];
