/**
 * Phase 2 navigation seed data (T2.2) — the C§1.2–1.4 mapping tables as
 * literals. The mapping is the spec (05 §2/T2.2); every string below is
 * verbatim from `src/navigation.ts` / `src/pages/index.astro` at the commit
 * this file was written, INCLUDING the footNote's template-literal whitespace:
 * seeds are copied verbatim from source so the cutover's built-HTML diff is
 * byte-identical by construction (04 Part 2 point 3). Tidying that whitespace
 * later is an ordinary reviewed nav edit, not a seed concern.
 *
 * Committed amendments carried here (C§1.2–1.3):
 *   M-1  item descriptions (every header dropdown item)
 *   M-2  groups[].slot — secondary/social footer rows are groups with a slot
 *        hint; primary groups carry NO slot (absent = primary)
 *   M-5  groups[].target — header dropdown parents carry their own link;
 *        stored, deliberately unrendered (dropdown parents stay buttons)
 *   M-7  icon/ariaLabel on the RSS social item
 *
 * Target kinds (P§ Gap Note 2): every page-like destination is the
 * transitional `{kind:'route', href}` — no Page objects exist until P3; the
 * blog Library route is `{kind:'listing', list:'content_index'}`; the RSS
 * feed is `{kind:'asset'}`. Do NOT "upgrade" route targets to page-kind here
 * — that is T3.11/T4.5, after the referenced Page objects exist.
 *
 * S-4 baked in: `nav_footer_home` is seeded as a PERMANENT, distinct
 * Navigation instance — the intended end-state, not a migration artifact
 * pending merge (05 §1).
 *
 * Ids: object ids are the C§1.0 names; group/item ids are stable opaque
 * handles (g_ and i_ prefixed, the shape the verb endpoints' mintId
 * enforces), unique per record — they are what patch ops (`update_item
 * {group_id, item_id}`) address, so treat them as API, not decoration.
 */

export const NAVIGATION_SEED_SITE = 'site_drlurie';

// Verbatim from navigation.ts:105-108 / index.astro:32-35 (template literal
// with its leading newline and indentation).
const FOOT_NOTE = '\n    Educational content only — not medical advice. © Dr. Lurié.\n  ';

export const navHeaderBody = {
  role: 'header',
  groups: [
    {
      id: 'g_start_here',
      title: 'Start Here',
      target: { kind: 'route', href: '/' },
      items: [
        {
          id: 'i_home',
          label: 'Home',
          description: 'A science-first overview of what changes in skin after 60.',
          target: { kind: 'route', href: '/' },
        },
        {
          id: 'i_about',
          label: 'About Dr. Lurié',
          description: 'Meet the biophysicist behind the age-aware approach.',
          target: { kind: 'route', href: '/about' },
        },
        {
          id: 'i_start_here_guide',
          label: 'Start Here guide',
          description: 'Begin with the simplest path through Dr. Lurié skin health education.',
          target: { kind: 'route', href: '/start-here' },
        },
      ],
    },
    {
      id: 'g_learn',
      title: 'Learn',
      target: { kind: 'listing', list: 'content_index' },
      items: [
        {
          id: 'i_library',
          label: 'Education Library',
          description: 'Browse all skin science articles and practical explainers.',
          target: { kind: 'listing', list: 'content_index' },
        },
        {
          id: 'i_topics',
          label: 'Topics',
          description: 'Explore articles grouped by their category frontmatter topics.',
          target: { kind: 'route', href: '/learn/topics' },
        },
        {
          id: 'i_free_guide',
          label: 'Free Guide',
          description: 'Get the structured guide to aging skin and body odor changes.',
          target: { kind: 'route', href: '/guides/free-guide' },
        },
      ],
    },
    {
      id: 'g_solutions',
      title: 'Solutions',
      target: { kind: 'route', href: '/solutions/shop-preview' },
      items: [
        {
          id: 'i_shop_preview',
          label: 'Shop Preview',
          description: 'See the upcoming age-aware skincare product direction.',
          target: { kind: 'route', href: '/solutions/shop-preview' },
        },
        {
          id: 'i_early_access',
          label: 'Early Access',
          description: 'Join updates as research-led solutions become available.',
          target: { kind: 'route', href: '/solutions/early-access' },
        },
        // The audited duplication, carried faithfully (C§1.7-4): same target
        // as 'Early Access' above — object_validate warns, never rejects.
        // Whether to dedupe is the T2.9 CHECKPOINT (Wolf's call, not ours).
        {
          id: 'i_join_early_access',
          label: 'Join Early Access',
          description: 'Request launch notes, previews, and member-only product updates.',
          target: { kind: 'route', href: '/solutions/early-access' },
        },
      ],
    },
  ],
  actions: [
    {
      label: 'Join Early Access',
      target: { kind: 'route', href: '/solutions/early-access' },
      style: 'primary',
    },
  ],
};

export const navFooterBody = {
  role: 'footer',
  groups: [
    {
      id: 'g_explore',
      title: 'Explore',
      items: [
        { id: 'i_home', label: 'Home', target: { kind: 'route', href: '/' } },
        { id: 'i_about', label: 'About', target: { kind: 'route', href: '/about' } },
        { id: 'i_education', label: 'Education', target: { kind: 'listing', list: 'content_index' } },
        { id: 'i_topics', label: 'Topics', target: { kind: 'route', href: '/learn/topics' } },
      ],
    },
    {
      id: 'g_next_steps',
      title: 'Next steps',
      items: [
        { id: 'i_free_guide', label: 'Free Guide', target: { kind: 'route', href: '/guides/free-guide' } },
        { id: 'i_shop_preview', label: 'Shop Preview', target: { kind: 'route', href: '/solutions/shop-preview' } },
        { id: 'i_early_access', label: 'Early Access', target: { kind: 'route', href: '/solutions/early-access' } },
        { id: 'i_contact', label: 'Contact', target: { kind: 'route', href: '/contact' } },
      ],
    },
    {
      id: 'g_secondary',
      slot: 'secondary',
      items: [
        { id: 'i_terms', label: 'Terms', target: { kind: 'route', href: '/terms' } },
        { id: 'i_privacy', label: 'Privacy Policy', target: { kind: 'route', href: '/privacy' } },
      ],
    },
    {
      id: 'g_social',
      slot: 'social',
      items: [
        {
          id: 'i_rss',
          label: 'RSS',
          ariaLabel: 'RSS',
          icon: 'tabler:rss',
          target: { kind: 'asset', href: '/rss.xml' },
        },
      ],
    },
  ],
  footNote: FOOT_NOTE,
};

// S-4: permanent second instance, referenced by the homepage — via a direct
// index.astro reference at T2.5 (interim), then page_home.navigationOverrides
// at T3.5. Label differences vs nav_footer ('Library' vs 'Education',
// 'Privacy' vs 'Privacy Policy') are the audited source, kept verbatim.
export const navFooterHomeBody = {
  role: 'footer',
  brand: { text: 'Dr. Lurié Skin Care', descriptor: 'Healthy Skin for Skincare Newcomers' },
  groups: [
    {
      id: 'g_start_learning',
      title: 'Start learning',
      items: [
        { id: 'i_start_here', label: 'Start Here', target: { kind: 'route', href: '/start-here' } },
        { id: 'i_library', label: 'Library', target: { kind: 'listing', list: 'content_index' } },
        { id: 'i_topics', label: 'Topics', target: { kind: 'route', href: '/learn/topics' } },
        { id: 'i_free_guide', label: 'Free Guide', target: { kind: 'route', href: '/guides/free-guide' } },
      ],
    },
    {
      id: 'g_connect',
      title: 'Connect',
      items: [
        { id: 'i_about', label: 'About', target: { kind: 'route', href: '/about' } },
        { id: 'i_newsletter', label: 'Newsletter', target: { kind: 'route', href: '/newsletter' } },
      ],
    },
    {
      id: 'g_secondary',
      slot: 'secondary',
      items: [
        { id: 'i_terms', label: 'Terms', target: { kind: 'route', href: '/terms' } },
        { id: 'i_privacy', label: 'Privacy', target: { kind: 'route', href: '/privacy' } },
      ],
    },
    {
      id: 'g_social',
      slot: 'social',
      items: [
        {
          id: 'i_rss',
          label: 'RSS',
          ariaLabel: 'RSS',
          icon: 'tabler:rss',
          target: { kind: 'asset', href: '/rss.xml' },
        },
      ],
    },
  ],
  footNote: FOOT_NOTE,
};

/** The three records T2.2 creates, in creation order. */
export const NAVIGATION_SEEDS = [
  { objectId: 'nav_header', body: navHeaderBody, expectedWarningIds: ['nav_duplicates'] },
  { objectId: 'nav_footer', body: navFooterBody, expectedWarningIds: [] },
  { objectId: 'nav_footer_home', body: navFooterHomeBody, expectedWarningIds: [] },
];
