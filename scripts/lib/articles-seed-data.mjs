/**
 * Seed data for the W7.3 article-object conversion run: ONE content_item
 * object that proves the ninth type end-to-end in production (create → every
 * node op → validate → publish → release → live at its route), the way
 * page_home proved pages.
 *
 * The copy is honest DEMONSTRATION content (mockup-data directive,
 * 2026-07-12): a short, on-brand article that announces itself as a sample.
 * It carries the FULL semantic layer — per-node private.strategy/intent
 * (hook → context → proof → resolution → recommendation, a complete PAS-ish
 * arc), a claims register wired to node ids, and taxonomy from the registry —
 * so the credentialed run proves the annotations round-trip, not just the
 * copy. Wolf can rewrite the copy through the canvas (each block carries
 * chips) or replace the article entirely; slug `object-model-demo` is
 * deliberately non-editorial.
 *
 * NOTE the standing gap (OQ-2): unpublish is not supported yet — once
 * published + released this article is live at /object-model-demo until its
 * copy is edited or the record is removed store-side. The run may stop after
 * the drill (skip publish) if that is not wanted yet; criteria 1–4 are still
 * proven, and the record simply stays a draft.
 */

export const SEED_SITE = 'site_drlurie';

const ARTICLE_SEEDS = [
  {
    objectType: 'content_item',
    objectId: 'req_agent_object_model_demo_20260713_01',
    body: {
      slug: 'object-model-demo',
      title: 'How this article was made (a live demo of the new editor)',
      deck: 'This post is itself the demonstration: every block below is an editable object.',
      description:
        'A short demonstration article published through the Dr. Lurié object model — every block is agent- and canvas-editable.',
      // Registry-valid terms only (fixed by the 2026-07-13 credentialed run):
      // the production tax_drlurie registry has NO 'skin-science' CATEGORY (it
      // exists only as a tag) and no 'skincare-education' tag at all — the
      // original values blocked object_create at the article_taxonomy
      // constraint. The local rehearsal never caught it because that check is
      // registry-gated and the isolated local store has no registry.
      taxonomy: { category: 'reflections', tags: ['reflections'] },
      seo: {
        meta_description:
          'A demonstration article published through the Dr. Lurié content object model.',
      },
      nodes: [
        {
          id: 'n_demoopen',
          kind: 'content',
          public: {
            eyebrow: 'Behind the scenes',
            body:
              'Most articles hide how they were made. This one IS how it was made: every block you are reading lives in a content system that both humans and AI assistants can edit, safely, one block at a time.',
          },
          private: { strategy: 'hook', intent: 'educate' },
        },
        {
          id: 'n_demowhy',
          kind: 'content',
          public: {
            title: 'Why blocks instead of one big page?',
            body:
              'Each block carries its own job: one opens the story, one carries the evidence, one closes with a next step. Editors see the text; the system also knows each block’s role, so suggestions and reviews respect the structure instead of flattening it.',
          },
          private: { strategy: 'context', intent: 'educate' },
        },
        {
          id: 'n_demoproof',
          kind: 'content',
          public: {
            title: 'What that enables',
            items: [
              'Edits are reviewed and reversible — nothing goes live by accident.',
              'Every change is recorded: who, what, and exactly how to undo it.',
              'AI suggestions are limited to copy — never images, links, or structure.',
            ],
          },
          private: { strategy: 'proof', intent: 'reassure' },
        },
        {
          id: 'n_democlose',
          kind: 'content',
          public: {
            body:
              'If you can read this on the live site, the whole path worked: the article was created as data, reviewed, published, and rendered — with no page code written for it.',
          },
          private: { strategy: 'resolution', intent: 'reassure' },
        },
        {
          id: 'n_demonext',
          kind: 'action',
          public: { ctaText: 'Browse the library', ctaLink: '/learn/library' },
          private: { strategy: 'recommendation', intent: 'navigate' },
        },
      ],
      claims: {
        claim_list: [
          {
            text: 'Every change is recorded with an exact inverse.',
            node_ids: ['n_demoproof'],
            risk: 'low',
            status: 'verified',
            notes: 'The patch engine derives an inverse per op; history stores both.',
          },
        ],
      },
      editorial: {
        writer_notes: 'Demonstration seed for the W7.3 conversion run — replace or rewrite freely via the canvas.',
      },
    },
  },
];

export const CONVERSION_SEEDS = ARTICLE_SEEDS;
