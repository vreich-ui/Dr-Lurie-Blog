/**
 * Seed data for the starter section-template recipes (W8.1 —
 * 09-template-system-plan §2.6; "templates are recipes; PageTypes are law",
 * design-principles rule 5).
 *
 * Five recipes distilled from real converted sections — the shapes the site
 * actually reuses:
 *
 *   stpl_hero_landing      hero               the page_home s_hero shape
 *   stpl_audience_grid     content_grid       curated `cards` source (the
 *                                             sec_home_audience_grid shape)
 *   stpl_related_articles  content_grid       `related`/tag_similarity feed
 *                                             (the page_article s_related shape)
 *   stpl_newsletter_cta    newsletter_signup  the sec_newsletter_signup shape
 *   stpl_cta_banner        cta_banner         the W1/about closing-CTA shape
 *
 * Recipes are DATA: agents evolve them freely with the section_template patch
 * ops, and every blueprint here is self-contained (no shared_refs, no content
 * refs, no asset refs) so a stamped section validates with zero external
 * targets. Blueprint copy is neutral starter text an agent replaces before
 * publishing — a recipe supplies structure, never finished site content.
 * Blueprint s_* ids are placeholders: instantiation always re-mints them.
 *
 * Consumed by scripts/home-conversion-roundtrip.mjs via
 *   --seeds scripts/lib/section-templates-seed-data.mjs
 * which drills every section_template patch op (set_section_template_meta,
 * replace_blueprint, update_blueprint_data) ending byte-identical to the seed.
 */

export const SEED_SITE = 'site_drlurie';

// ─── the five recipes ────────────────────────────────────────────────────────

export const sectionTemplateHeroLandingBody = {
  name: 'Landing hero',
  description: 'Opening hero for a landing or campaign page: kicker + heading + intro copy + action slots.',
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
  blueprint: {
    id: 's_stplaudience',
    type: 'content_grid',
    data: {
      kicker: 'Who this is for',
      heading: 'New audience heading',
      limit: 4,
      source: {
        kind: 'cards',
        cards: [{ description: 'First audience or feature cell.' }, { description: 'Second audience or feature cell.' }],
      },
    },
  },
};

export const sectionTemplateRelatedArticlesBody = {
  name: 'Related articles',
  description: 'Automatic related-content strip: three tiles picked by tag similarity from published articles.',
  blueprint: {
    id: 's_stplrelated',
    type: 'content_grid',
    data: {
      heading: 'More to read',
      limit: 3,
      columns: 3,
      source: { kind: 'related', algorithm: 'tag_similarity' },
    },
  },
};

export const sectionTemplateNewsletterCtaBody = {
  name: 'Newsletter signup',
  description: 'The standing newsletter capture block wired to the Netlify "newsletter" form.',
  blueprint: {
    id: 's_stplnewsletter',
    type: 'newsletter_signup',
    data: {
      kicker: 'Newsletter',
      heading: 'Get the next letter',
      formName: 'newsletter',
    },
  },
};

export const sectionTemplateCtaBannerBody = {
  name: 'Closing CTA banner',
  description: 'Closing call-to-action banner: heading + action slots (the interior-page closer).',
  blueprint: {
    id: 's_stplcta',
    type: 'cta_banner',
    data: { heading: 'Keep exploring', actions: [] },
  },
};

// ─── driver contract ─────────────────────────────────────────────────────────

export const CONVERSION_SEEDS = [
  { objectType: 'section_template', objectId: 'stpl_hero_landing', body: sectionTemplateHeroLandingBody },
  { objectType: 'section_template', objectId: 'stpl_audience_grid', body: sectionTemplateAudienceGridBody },
  { objectType: 'section_template', objectId: 'stpl_related_articles', body: sectionTemplateRelatedArticlesBody },
  { objectType: 'section_template', objectId: 'stpl_newsletter_cta', body: sectionTemplateNewsletterCtaBody },
  { objectType: 'section_template', objectId: 'stpl_cta_banner', body: sectionTemplateCtaBannerBody },
];
