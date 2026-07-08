/**
 * T4.3 — seed data for the five interior "lede" pages (start-here,
 * member-updates, newsletter, free-guide, early-access). Copy is verbatim from
 * the audited standalone .astro pages; each maps to one `lede` section (kicker
 * + heading + intro + actions). Action targets mirror the audited hrefs:
 * getBlogPermalink() → {kind:'listing'}, getPermalink('/x') → {kind:'route'}.
 *
 * Plain-node seed file (cannot import TypeScript), same split as
 * navigation-seed-data.mjs / page-home-seed-data.mjs. The materialized exports
 * are byte-identical to what object_publish commits; the production publish
 * reconciles only the __generated marker.
 */

export const LEDE_FAMILY_SITE = 'site_drlurie';

const ledePage = ({ objectId, route, title, description, kicker, heading, body, actions }) => ({
  objectId,
  body: {
    route,
    pageType: 'standard',
    title,
    seo: { description },
    sections: [{ id: 's_lede', type: 'lede', data: { kicker, heading, body, actions } }],
  },
});

const listing = { kind: 'listing', list: 'content_index' };
const route = (href) => ({ kind: 'route', href });

export const LEDE_FAMILY_SEEDS = [
  ledePage({
    objectId: 'page_start_here',
    route: '/start-here',
    title: 'Start Here',
    description: 'A simple path into Dr. Lurié skin health education for skincare newcomers.',
    kicker: 'Start here',
    heading: 'Begin with the basics.',
    body: '<p>Use this hub as a calm first step: learn what healthy skin means, browse the library, then decide whether early access updates are useful for you.</p>',
    actions: [
      { label: 'Browse the library', target: listing, style: 'primary' },
      { label: 'Explore topics', target: route('/learn/topics'), style: 'secondary' },
    ],
  }),
  ledePage({
    objectId: 'page_member_updates',
    route: '/member-updates',
    title: 'Member Updates',
    description: 'Member updates and early access notes from Dr. Lurié.',
    kicker: 'Account',
    heading: 'Member updates',
    body: '<p>This account hub will collect member notes, early access announcements, and product updates as they become available.</p>',
    actions: [{ label: 'Join early access', target: route('/solutions/early-access'), style: 'secondary' }],
  }),
  ledePage({
    objectId: 'page_newsletter',
    route: '/newsletter',
    title: 'Newsletter',
    description: 'Join the Dr. Lurié newsletter for skin science notes and launch updates.',
    kicker: 'Newsletter',
    heading: 'Skin science notes in your inbox.',
    body: '<p>Newsletter sign-up will share practical education, research notes, and early access announcements from Dr. Lurié.</p>',
    actions: [{ label: 'Read the library', target: listing, style: 'primary' }],
  }),
  ledePage({
    objectId: 'page_free_guide',
    route: '/guides/free-guide',
    title: 'Free Guide',
    description: 'Request the Dr. Lurié free guide to aging skin and practical skincare decisions.',
    kicker: 'Free guide',
    heading: 'A clearer guide to changing skin.',
    body: '<p>This guide will collect the essentials: barrier comfort, lipid shifts, age-related scent changes, and practical questions to ask before adding products.</p>',
    actions: [{ label: 'Join the newsletter', target: route('/newsletter'), style: 'primary' }],
  }),
  ledePage({
    objectId: 'page_early_access',
    route: '/solutions/early-access',
    title: 'Early Access',
    description: 'Join Dr. Lurié early access for product previews, research notes, and launch updates.',
    kicker: 'Early access',
    heading: 'Follow the product work before launch.',
    body: '<p>Early access is the place for launch timing, product previews, and research-led updates as Dr. Lurié solutions are prepared.</p>',
    actions: [
      { label: 'Join newsletter', target: route('/newsletter'), style: 'primary' },
      { label: 'View shop preview', target: route('/solutions/shop-preview'), style: 'secondary' },
    ],
  }),
];
