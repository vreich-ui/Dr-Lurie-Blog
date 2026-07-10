/**
 * Seed data for the /about object family (2026-07-10 decomposition).
 *
 * The bespoke single-use `about` section is retired in favour of EIGHT
 * standalone, individually-converted shared `section` objects composed from
 * REUSABLE types (design-principles rule 1) — an agent can now edit, reorder,
 * repoint, or reuse any piece of the About page independently:
 *
 *   sec_about_intro      bio         intro heading + copy + portrait photo
 *   sec_about_thinking   prose       "A Different Way of Thinking About Health"
 *   sec_about_products   prose       "Why Most Products Fall Short"
 *   sec_about_science    prose       "The Science Behind Real Results"
 *   sec_about_research   prose       "From Research to Real Life"
 *   sec_about_blog       prose       "Why This Blog Exists"
 *   sec_about_note       prose       "A Personal Note"
 *   sec_about_cta        cta_banner  closing "Start With the Science" + actions
 *
 * `page_about` becomes a `standard` page of eight `shared_ref`s to them.
 *
 * Copy is transcribed verbatim from the audited About.astro furniture into the
 * RichText allowlist: bio/cta bodies are paragraph-only (splitRichTextParagraphs);
 * prose bodies carry the section h2 + paragraphs + lists (splitRichTextBlocks:
 * p/h2/h3/ul/ol). The portrait moves onto the reusable bio type's new URL
 * `portrait` field (a site-asset URL, not the artifact-ref path).
 *
 * The bespoke `about` section TYPE is now orphaned (nothing references it after
 * this cutover) — its removal is a flagged follow-up, kept out of this change to
 * hold the diff to the conversion itself.
 */

export const SEED_SITE = 'site_drlurie';
export const PAGE_ABOUT_ID = 'page_about';

/** Body of a shared `section` object: the one-instance wrapper (D§2.5). */
const sectionBody = (id, type, data) => ({ section: { id, type, data } });

// ─── the eight sections ──────────────────────────────────────────────────────

export const sectionAboutIntroBody = sectionBody('s_intro', 'bio', {
  kicker: 'About',
  heading: 'About Dr. Leonid Lurie',
  portrait: {
    src: 'https://kugelmedia.netlify.app/drlurieblog/dr-lurie-portrait.jpg',
    alt: 'Portrait of Dr. Leonid Lurie',
  },
  body:
    '<p>Let’s keep this simple.</p>' +
    '<p>If you’ve ever tried a health or skincare product that <em>promised everything</em>… and delivered very little—you’re not alone.</p>' +
    '<p>And there’s a reason for that.</p>' +
    '<p>Most products focus on <strong>what’s inside the bottle</strong>. Dr. Leonid Lurie focuses on <strong>whether it actually works in your body</strong>.</p>',
  trustNotes: [],
});

export const sectionAboutThinkingBody = sectionBody('s_thinking', 'prose', {
  body:
    '<h2>A Different Way of Thinking About Health</h2>' +
    '<p>Dr. Lurie is a physician, scientist, and developer with more than 30 years of experience in medical and pharmaceutical research.</p>' +
    '<p>But what makes his work different is this:</p>' +
    '<p>He doesn’t treat the body—especially the skin—as something passive.</p>' +
    '<p>He sees it as a <strong>living, active system</strong>.</p>' +
    '<p>And that changes everything. Because when you understand how the body really functions, you stop guessing… and start designing solutions that actually make a difference.</p>',
});

export const sectionAboutProductsBody = sectionBody('s_products', 'prose', {
  body:
    '<h2>Why Most Products Fall Short</h2>' +
    '<p>Here’s the uncomfortable truth:</p>' +
    '<p>Even the best ingredients are useless if your body can’t absorb or use them properly.</p>' +
    '<p>That’s why so many creams, treatments, and health products give <strong>temporary or disappointing results</strong>.</p>' +
    '<p>Dr. Lurie built his career solving that exact problem.</p>',
});

export const sectionAboutScienceBody = sectionBody('s_science', 'prose', {
  body:
    '<h2>The Science Behind Real Results</h2>' +
    '<p>Over decades of research, Dr. Lurie developed advanced delivery systems designed to help active ingredients:</p>' +
    '<ul><li>Reach the right place in the body</li><li>Work over time—not just for a few minutes</li><li>Stay stable and effective</li><li>Support the body without unnecessary stress</li></ul>' +
    '<p>In practical terms, this means products that are designed to <strong>work with your body—not against it</strong>.</p>',
});

export const sectionAboutResearchBody = sectionBody('s_research', 'prose', {
  body:
    '<h2>From Research to Real Life</h2>' +
    '<p>This isn’t abstract science.</p>' +
    '<p>Dr. Lurie’s work has been applied in areas such as:</p>' +
    '<ul><li>Skin health and aging</li><li>Inflammation and healing</li><li>Hygiene and long-lasting protection</li><li>Professional-grade skincare used in clinics</li></ul>' +
    '<p>The focus is always the same: <strong>Create solutions that people can actually use—and actually benefit from.</strong></p>',
});

export const sectionAboutBlogBody = sectionBody('s_blog', 'prose', {
  body:
    '<h2>Why This Blog Exists</h2>' +
    '<p>This site isn’t here to overwhelm you with complex science.</p>' +
    '<p>It’s here to help you:</p>' +
    '<ul><li>Better understand how your body works</li><li>Make smarter decisions about products and treatments</li><li>Avoid common mistakes that waste time and money</li><li>Discover approaches grounded in real science—not marketing hype</li></ul>' +
    '<p>Over time, you’ll also find carefully developed resources, products, and insights designed to support your health in a practical, realistic way.</p>',
});

export const sectionAboutNoteBody = sectionBody('s_note', 'prose', {
  body:
    '<h2>A Personal Note</h2>' +
    '<p>After decades in research, Dr. Lurie has seen what works—and what doesn’t.</p>' +
    '<p>This blog is a way to share that knowledge directly, without filters, trends, or shortcuts.</p>' +
    '<p>Because when it comes to your health, you deserve more than promises.</p>' +
    '<p><strong>You deserve solutions that make sense—and make a difference.</strong></p>' +
    '<p>If that’s what you’re looking for, you’re in the right place.</p>',
});

export const sectionAboutCtaBody = sectionBody('s_cta', 'cta_banner', {
  heading: 'Start With the Science',
  body: '<p>Explore how aging skin changes, why common approaches often fall short, and what a delivery-system approach makes possible.</p>',
  actions: [
    { label: 'Read the Insights', target: { kind: 'listing', list: 'content_index' }, style: 'primary' },
    { label: 'Get the Free Guide', target: { kind: 'route', href: '/guides/free-guide' }, style: 'secondary' },
  ],
});

// ─── the page ────────────────────────────────────────────────────────────────

const ABOUT_SECTIONS = [
  { objectId: 'sec_about_intro', body: sectionAboutIntroBody },
  { objectId: 'sec_about_thinking', body: sectionAboutThinkingBody },
  { objectId: 'sec_about_products', body: sectionAboutProductsBody },
  { objectId: 'sec_about_science', body: sectionAboutScienceBody },
  { objectId: 'sec_about_research', body: sectionAboutResearchBody },
  { objectId: 'sec_about_blog', body: sectionAboutBlogBody },
  { objectId: 'sec_about_note', body: sectionAboutNoteBody },
  { objectId: 'sec_about_cta', body: sectionAboutCtaBody },
];

export const pageAboutBody = {
  route: '/about',
  pageType: 'standard',
  title: 'About Dr. Leonid Lurie',
  seo: {},
  sections: ABOUT_SECTIONS.map(({ objectId, body }) => ({
    id: body.section.id, // page slot id reuses the section's stable inner id (home pattern)
    type: 'shared_ref',
    data: { section: objectId },
  })),
};

/**
 * Ordered: every referenced section is created BEFORE the page that references
 * it (reference-integrity validation on page_about resolves them). This is the
 * generic seed-module contract the round-trip driver consumes.
 */
export const CONVERSION_SEEDS = [
  ...ABOUT_SECTIONS.map(({ objectId, body }) => ({ objectType: 'section', objectId, body })),
  { objectType: 'page', objectId: PAGE_ABOUT_ID, body: pageAboutBody },
];
