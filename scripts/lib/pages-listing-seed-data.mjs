/**
 * Seed data for the W6 listing-surface batch (T6.1, 2026-07-12): the six
 * page objects that make the blog listing surfaces and the article route
 * agent-editable — headings/copy/SEO through the object, while the query
 * machinery (getStaticPathsBlogList/Category/Tag, fetchPosts, the topics
 * derivation) stays the audited build-time derivation (A§2.5–2.7).
 *
 * Every body is a verbatim transcription of the previously hardcoded copy, so
 * the cutover is byte-identical (empty build-diff). Conventions:
 *
 *   - `listing` pages carry their header block as the FIRST `lede` section
 *     (required by the PageType); the loaders render it through the surface's
 *     existing header furniture and dispatch any EXTRA sections through the
 *     component registry after the list.
 *   - Per-term surfaces (category/tag/topic detail) are ONE object serving the
 *     whole route family: their copy is pattern copy — `%term%` interpolates
 *     to the concrete term's display label at build time (listing-term.ts).
 *     Their `route` fields are the family patterns (unique, self-describing,
 *     never emitted by the object-page catch-all — loader_owned_page_type).
 *   - `page_article` is `content_detail`: route-level SEO defaults + optional
 *     sections rendered after every article. It publishes with ZERO sections
 *     (minVisibleSections 0), so it declares a `drillProbe` — the
 *     PageType-legal section the round-trip drill clones instead of a page
 *     section. seo.robots is omitted everywhere: config.yaml stays the
 *     fallback until an editor actually wants to override robots per surface.
 *
 * None of the six reference shared sections, so ordering is irrelevant.
 */

export const SEED_SITE = 'site_drlurie';

const PAGE_SEEDS = [
  {
    objectId: 'page_library',
    body: {
      pageType: 'listing',
      route: '/learn/library',
      title: 'Library',
      seo: {},
      sections: [
        {
          id: 's_libraryhead',
          type: 'lede',
          data: {
            heading: 'Library',
            body: '<p>Browse all Dr. Lurié skin science articles and practical explainers.</p>',
            actions: [],
          },
        },
      ],
    },
  },
  {
    objectId: 'page_topics_index',
    body: {
      pageType: 'listing',
      route: '/learn/topics',
      title: 'Topics',
      seo: {
        description: 'Browse Dr. Lurié articles by the category frontmatter topic assigned to each article.',
        ogImage: 'https://kugelmedia.netlify.app/drlurieblog/dr-lurie-topics-social-preview.jpg',
      },
      sections: [
        {
          id: 's_topicshead',
          type: 'lede',
          data: {
            kicker: 'Education library',
            heading: 'Topics',
            body: '<p>Topics are generated from article category frontmatter, so this hub always mirrors the science themes used in the library.</p>',
            actions: [],
          },
        },
      ],
    },
  },
  {
    objectId: 'page_topic_detail',
    body: {
      pageType: 'listing',
      route: '/learn/topics/[topic]',
      title: '%term% articles',
      seo: {
        description: 'Science-led Dr. Lurié articles about %term%.',
      },
      sections: [
        {
          id: 's_topichead',
          type: 'lede',
          data: {
            kicker: 'Topic',
            heading: '%term%',
            body: '<p>A focused collection of Dr. Lurié education assigned to this category in article frontmatter.</p>',
            actions: [],
          },
        },
      ],
    },
  },
  {
    objectId: 'page_category',
    body: {
      pageType: 'listing',
      route: '/category/[category]',
      title: "Category '%term%'",
      seo: {},
      sections: [
        {
          id: 's_categoryhead',
          type: 'lede',
          data: {
            heading: '%term%',
            actions: [],
          },
        },
      ],
    },
  },
  {
    objectId: 'page_tag',
    body: {
      pageType: 'listing',
      route: '/tag/[tag]',
      title: "Posts by tag '%term%'",
      seo: {},
      sections: [
        {
          id: 's_taghead',
          type: 'lede',
          data: {
            heading: 'Tag: %term%',
            actions: [],
          },
        },
      ],
    },
  },
  {
    objectId: 'page_article',
    body: {
      pageType: 'content_detail',
      route: '/%slug%',
      title: 'Article',
      seo: {},
      sections: [],
    },
    // content_detail publishes section-less; the drill clones this instead of
    // a page section (PageType-legal: cta_banner is in allowedSections).
    drillProbe: {
      type: 'cta_banner',
      data: {
        heading: 'Round-trip probe',
        body: '<p>Drill probe — added and removed by the round-trip driver.</p>',
        actions: [],
      },
    },
  },
];

export const CONVERSION_SEEDS = PAGE_SEEDS.map((seed) => ({ objectType: 'page', ...seed }));
