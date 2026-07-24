/**
 * Seed data for the LEGACY-WIPE corpus (2026-07-13): ten genuine content_item
 * articles that replace the 83 committed smoke-test posts (Wolf: "mostly junk
 * … needs to be rewritten. you be the judge"). Two per registry category
 * (skin-health / skincare / skin-after-40 / ingredients / reflections), each
 * a real, on-brand, dermatologist-voice article carrying the full annotation
 * layer (per-node private.strategy/intent — a PAS-ish arc) so the corpus
 * exercises listings / tags / related-scoring / RSS with proper content, not
 * filler.
 *
 * Fresh slugs (no collision with the deleted .md). Bodies are PLAIN TEXT
 * (blank line = new paragraph, escaped at render). Taxonomy terms are all
 * registry slugs (tax_drlurie). The credentialed run creates → publishes →
 * releases each one; the .md deletion lands in the same PR.
 */

export const SEED_SITE = 'site_drlurie';

// A small builder to keep ten articles readable. `nodes` is [strategy, intent,
// publicFields] tuples; ids are minted here as opaque n_* (no strategy words).
const article = (objectId, { slug, title, deck, description, category, tags, nodes, claims }) => ({
  objectType: 'content_item',
  objectId,
  body: {
    slug,
    title,
    deck,
    description,
    taxonomy: { category, tags },
    seo: { meta_description: description },
    nodes: nodes.map(([strategy, intent, pub], index) => ({
      id: `n_s${index + 1}`,
      kind: pub.ctaText ? 'action' : 'content',
      public: pub,
      private: { strategy, intent },
    })),
    ...(claims ? { claims: { claim_list: claims } } : {}),
  },
});

const ARTICLE_SEEDS = [
  // ── skin-health ───────────────────────────────────────────────────────────
  article('req_agent_skin_barrier_basics_20260713_01', {
    slug: 'what-your-skin-barrier-does',
    title: 'What your skin barrier actually does',
    deck: 'The outer layer of your skin is a working wall. Understanding it explains most of what your skin needs.',
    description:
      'A plain-language explanation of the skin barrier — what it is, what breaks it, and how to help it recover.',
    category: 'skin-health',
    tags: ['skin-barrier', 'skin-science'],
    nodes: [
      [
        'hook',
        'educate',
        {
          eyebrow: 'Skin science',
          body: 'Most "sensitive skin" is not a skin type. It is a barrier that has been worn down — usually by doing too much, too often, to skin that was fine to begin with.',
        },
      ],
      [
        'context',
        'educate',
        {
          title: 'A wall, not a coating',
          body: 'The outermost layer of skin is built like a brick wall: flattened cells held together by a mortar of lipids. That wall keeps water in and irritants out. When it is intact, skin feels calm and looks even. When it is not, water escapes and everything stings.',
        },
      ],
      [
        'proof',
        'reassure',
        {
          title: 'What wears it down',
          items: [
            'Cleansing too often, or with anything that leaves skin squeaky.',
            'Stacking actives — an acid, a retinoid, and a scrub in the same week.',
            'Chasing every new product before the last one had time to work.',
          ],
        },
      ],
      [
        'resolution',
        'reassure',
        {
          body: 'The repair is unglamorous and reliable: fewer steps, a gentle cleanser, and a moisturizer with lipids the wall recognizes. Give it two weeks before you judge it. Barriers rebuild on their own schedule, not ours.',
        },
      ],
      ['recommendation', 'navigate', { ctaText: 'Read the library', ctaLink: '/learn/library' }],
    ],
    claims: [
      {
        text: 'A compromised skin barrier increases transepidermal water loss, which drives the sensation of tightness and stinging.',
        node_ids: ['n_s2'],
        risk: 'low',
        status: 'verified',
        notes: 'Established dermatology; barrier function and TEWL.',
      },
    ],
  }),
  article('req_agent_reactive_skin_20260713_01', {
    slug: 'why-skin-turns-reactive',
    title: 'Why skin turns reactive — and what actually helps',
    deck: 'Reactive skin is usually a signal, not a diagnosis. Here is how to read it.',
    description: 'What "reactive skin" means, why it happens, and the small changes that calm it down.',
    category: 'skin-health',
    tags: ['sensitive-skin', 'skin-barrier'],
    nodes: [
      [
        'hook',
        'educate',
        {
          body: 'Skin that suddenly reacts to products it used to tolerate is rarely allergic. More often it is overwhelmed — and the fix is subtraction, not another product.',
        },
      ],
      [
        'explanation',
        'educate',
        {
          title: 'What "reactive" really means',
          body: 'When the barrier thins, nerve endings sit closer to the surface and ordinary ingredients register as irritation. The skin has not changed its mind about a product; it has lost the buffer that made the product comfortable.',
        },
      ],
      [
        'step',
        'reassure',
        {
          title: 'A calmer week',
          items: [
            'Cleanse once a day, at night, with a non-foaming cleanser.',
            'Moisturize on damp skin, morning and night.',
            'Pause every active for one week — no acids, no retinoid, no scrub.',
          ],
        },
      ],
      [
        'resolution',
        'reassure',
        {
          body: 'If skin settles within a week, you have your answer: it was doing too much. Reintroduce one active at a time, and only after the calm holds.',
        },
      ],
      ['recommendation', 'navigate', { ctaText: 'Browse the library', ctaLink: '/learn/library' }],
    ],
  }),

  // ── skincare ────────────────────────────────────────────────────────────────
  article('req_agent_minimal_routine_20260713_01', {
    slug: 'the-three-step-routine',
    title: 'The three-step routine that is genuinely enough',
    deck: 'Cleanse, moisturize, protect. Everything else is optional.',
    description: 'A minimal, evidence-aligned skincare routine — three steps that do most of the work.',
    category: 'skincare',
    tags: ['skincare-basics', 'skincare-routine'],
    nodes: [
      [
        'hook',
        'persuade',
        {
          eyebrow: 'Routines',
          body: 'A routine you actually follow beats a perfect one you abandon by Thursday. For most skin, three steps carry the load.',
        },
      ],
      [
        'step',
        'educate',
        {
          title: 'The three steps',
          items: [
            'Cleanse at night to remove the day; rinse with water in the morning.',
            'Moisturize twice a day to hold water in the barrier.',
            'Sunscreen every morning — the single most effective anti-aging step there is.',
          ],
        },
      ],
      [
        'comparison',
        'reassure',
        {
          title: 'What the extras are for',
          body: 'Serums, acids, and retinoids solve specific problems — texture, pigment, breakouts. They are worth adding one at a time, once the three basics are automatic. Added before that, they mostly add irritation.',
        },
      ],
      [
        'resolution',
        'reassure',
        {
          body: 'Master the three, and your skin will be better than most ten-step routines deliver. Then, if a specific concern remains, add one thing and give it six weeks.',
        },
      ],
      ['recommendation', 'navigate', { ctaText: 'See the guides', ctaLink: '/learn/library' }],
    ],
  }),
  article('req_agent_reading_labels_20260713_01', {
    slug: 'reading-a-skincare-label',
    title: 'How to read a skincare label without the hype',
    deck: 'The front of the box is marketing. The back is closer to the truth.',
    description: 'A short guide to reading skincare labels — ingredient order, meaningless claims, and what to ignore.',
    category: 'skincare',
    tags: ['marketing-claims', 'ingredients'],
    nodes: [
      [
        'hook',
        'persuade',
        {
          body: '"Clinically proven," "dermatologist tested," "clean" — most front-of-box phrases are unregulated. The ingredient list on the back tells you far more.',
        },
      ],
      [
        'explanation',
        'educate',
        {
          title: 'Order is dose',
          body: 'Ingredients are listed by amount, high to low. An active you came for that sits near the end of a long list is likely present in a token amount. The first five ingredients are most of what you are buying.',
        },
      ],
      [
        'myth',
        'educate',
        {
          title: 'Phrases that mean nothing',
          items: [
            '"Chemical-free" — everything is a chemical, including water.',
            '"Hypoallergenic" — no legal definition; any brand may print it.',
            '"Natural" — unregulated, and not a measure of safety or efficacy.',
          ],
        },
      ],
      [
        'resolution',
        'reassure',
        {
          body: 'You do not need to memorize chemistry. Read the first few ingredients, check where the active you want sits, and treat the front of the box as advertising — because it is.',
        },
      ],
      ['recommendation', 'navigate', { ctaText: 'Read more', ctaLink: '/learn/library' }],
    ],
  }),

  // ── skin-after-40 ────────────────────────────────────────────────────────────
  article('req_agent_skin_after_40_20260713_01', {
    slug: 'skin-after-40-what-changes',
    title: 'Skin after 40: what actually changes',
    deck: 'The shifts are real and mostly hormonal. Knowing which is which makes them easier to work with.',
    description: 'What changes in skin after 40 — collagen, oil, hydration, and menopause — explained plainly.',
    category: 'skin-after-40',
    tags: ['skin-after-40', 'menopause'],
    nodes: [
      [
        'hook',
        'reassure',
        {
          eyebrow: 'Skin after 40',
          body: 'Skin in your forties is not failing. It is running on a different hormonal budget, and a few informed adjustments go a long way.',
        },
      ],
      [
        'context',
        'educate',
        {
          title: 'What shifts',
          body: 'Collagen production slows, so skin loses some of its bounce. Oil glands quiet down, so skin that was once shiny turns dry. Around menopause, falling estrogen accelerates both — often noticeably, over a couple of years.',
        },
      ],
      [
        'proof',
        'educate',
        {
          title: 'What helps most',
          items: [
            'A richer moisturizer, because the skin no longer makes as much of its own oil.',
            'Daily sunscreen, which prevents far more visible aging than any serum reverses.',
            'A retinoid, the best-studied ingredient for collagen — started slowly.',
          ],
        },
      ],
      [
        'resolution',
        'reassure',
        {
          body: 'None of this is about turning back a clock. It is about giving skin the support it used to make for itself. That is a reasonable, achievable goal.',
        },
      ],
      ['recommendation', 'navigate', { ctaText: 'Explore the library', ctaLink: '/learn/library' }],
    ],
  }),
  article('req_agent_retinoids_after_40_20260713_01', {
    slug: 'starting-retinoids-after-40',
    title: 'Starting retinoids after 40, slowly',
    deck: 'The best-studied anti-aging ingredient, introduced the way that keeps skin comfortable.',
    description: 'How to start a retinoid after 40 without irritation — frequency, buffering, and patience.',
    category: 'skin-after-40',
    tags: ['retinoids', 'skin-after-40'],
    nodes: [
      [
        'hook',
        'persuade',
        {
          body: 'Retinoids are the most evidence-backed anti-aging ingredient available without a prescription conversation. Most people quit them not because they fail, but because they start too fast.',
        },
      ],
      [
        'explanation',
        'educate',
        {
          title: 'Why go slow',
          body: 'A retinoid speeds skin-cell turnover. Introduced abruptly, that shows up as flaking and redness — the "retinoid uglies." Introduced gradually, skin adapts and the same product feels unremarkable.',
        },
      ],
      [
        'step',
        'reassure',
        {
          title: 'A gentle start',
          items: [
            'Twice a week for the first two weeks, at night.',
            'A pea-sized amount for the whole face — more is not better.',
            'Moisturizer before and after ("sandwiching") if you feel any tightness.',
          ],
        },
      ],
      [
        'resolution',
        'reassure',
        {
          body: 'Build to every other night over a couple of months. Results in the mirror take twelve weeks or more, so judge it by the season, not the week.',
        },
      ],
      ['recommendation', 'navigate', { ctaText: 'Read the guides', ctaLink: '/learn/library' }],
    ],
  }),

  // ── ingredients ──────────────────────────────────────────────────────────────
  article('req_agent_niacinamide_20260713_01', {
    slug: 'niacinamide-plainly',
    title: 'Niacinamide, plainly',
    deck: 'A quiet, well-tolerated ingredient that does several small things well.',
    description: 'A plain-language ingredient explainer for niacinamide — what it does, and realistic expectations.',
    category: 'ingredients',
    tags: ['ingredients', 'skin-science'],
    nodes: [
      [
        'hook',
        'educate',
        {
          eyebrow: 'Ingredients',
          body: 'Niacinamide rarely makes headlines because it does not promise miracles. It is a dependable multitasker — which is exactly why it belongs in most routines.',
        },
      ],
      [
        'explanation',
        'educate',
        {
          title: 'What it does',
          body: 'A form of vitamin B3, niacinamide supports the skin barrier, helps regulate oil, and can gently even out tone over time. It is well-tolerated, plays nicely with almost every other ingredient, and does not increase sun sensitivity.',
        },
      ],
      [
        'proof',
        'reassure',
        {
          title: 'Realistic expectations',
          items: [
            'Barrier support and less visible oil within a few weeks.',
            'Gradual tone evening over a couple of months.',
            'Not a spot treatment — its strength is steady, cumulative maintenance.',
          ],
        },
      ],
      [
        'resolution',
        'reassure',
        {
          body: 'A concentration around 4–5% covers most benefits; higher is not clearly better and can irritate. If you want one low-drama addition to a basic routine, this is a sensible one.',
        },
      ],
      ['recommendation', 'navigate', { ctaText: 'More ingredient notes', ctaLink: '/learn/library' }],
    ],
  }),
  article('req_agent_sunscreen_20260713_01', {
    slug: 'sunscreen-that-you-will-wear',
    title: 'The sunscreen you will actually wear',
    deck: 'The best sunscreen is the one that ends up on your face every morning.',
    description: 'How to choose a daily sunscreen — SPF, texture, and the habit that matters more than the label.',
    category: 'ingredients',
    tags: ['sun-protection', 'ingredients'],
    nodes: [
      [
        'hook',
        'persuade',
        {
          body: 'Sunscreen prevents more visible aging than any serum reverses. And the fanciest formula is worthless in the drawer — the one you enjoy wearing wins.',
        },
      ],
      [
        'explanation',
        'educate',
        {
          title: 'What the numbers mean',
          body: 'SPF 30 blocks about 97% of UVB; SPF 50, about 98%. The jump is small, so choose the higher number if it helps you feel covered, but do not agonize. "Broad spectrum" — covering UVA too — matters more than chasing SPF 100.',
        },
      ],
      [
        'recommendation',
        'reassure',
        {
          title: 'How to choose',
          items: [
            'Pick a texture you like — cream, gel, or fluid — so you reach for it daily.',
            'Broad spectrum, SPF 30 or higher.',
            'A visible amount: about two finger-lengths for the face and neck.',
          ],
        },
      ],
      [
        'resolution',
        'reassure',
        {
          body: 'Consistency beats perfection. A pleasant SPF 30 worn every day protects far better than an SPF 50 you skip because it feels heavy.',
        },
      ],
      ['recommendation', 'navigate', { ctaText: 'Read the library', ctaLink: '/learn/library' }],
    ],
  }),

  // ── reflections ──────────────────────────────────────────────────────────────
  article('req_agent_ten_step_myth_20260713_01', {
    slug: 'the-ten-step-myth',
    title: 'The myth of the ten-step routine',
    deck: 'More steps sell more product. They do not make better skin.',
    description: 'A short reflection on why elaborate routines persist, and what skin actually needs.',
    category: 'reflections',
    tags: ['reflections', 'marketing-claims'],
    nodes: [
      [
        'hook',
        'persuade',
        {
          eyebrow: 'Reflections',
          body: 'The ten-step routine is a marketing achievement, not a dermatological one. Each step is another product to sell — and another chance to irritate skin that was fine with three.',
        },
      ],
      [
        'agitation',
        'persuade',
        {
          body: 'The promise is control: do more, and skin will behave. But skin does not reward effort linearly. Past a point, more steps mean more ingredients competing, more irritation, and more money spent chasing a result the basics already delivered.',
        },
      ],
      [
        'context',
        'educate',
        {
          title: 'Where it came from',
          body: 'Elaborate routines spread as a lifestyle aesthetic — satisfying to perform, easy to photograph. That is a fine hobby. It is not a requirement for healthy skin, and it should not feel like one.',
        },
      ],
      [
        'resolution',
        'reassure',
        {
          body: 'If you enjoy a long routine, enjoy it. But if it has started to feel like a chore or a cost, know that subtracting is allowed — and your skin will very likely thank you.',
        },
      ],
      ['recommendation', 'navigate', { ctaText: 'Read more reflections', ctaLink: '/learn/library' }],
    ],
  }),
  article('req_agent_not_self_worth_20260713_01', {
    slug: 'skincare-is-not-self-worth',
    title: 'Skincare is not self-worth',
    deck: 'Caring for your skin is fine. Tying your value to it is not the same thing.',
    description: 'A short reflection on the line between skin care and self-worth.',
    category: 'reflections',
    tags: ['reflections'],
    nodes: [
      [
        'hook',
        'reassure',
        {
          body: 'Somewhere along the way, clear skin became shorthand for discipline, health, even virtue. It is none of those. It is skin.',
        },
      ],
      [
        'agitation',
        'reassure',
        {
          body: 'The pressure is quiet but constant: a breakout reads as a failure, a wrinkle as neglect. That framing sells product, and it borrows your self-worth as collateral. You can decline the loan.',
        },
      ],
      [
        'context',
        'educate',
        {
          title: 'What skin actually reflects',
          body: 'Skin responds to genes, hormones, sleep, stress, and age — most of which you do not control. A good routine helps at the margins. It does not, and cannot, measure whether you are trying hard enough as a person.',
        },
      ],
      [
        'resolution',
        'reassure',
        {
          body: 'Care for your skin the way you would care for a houseplant: attentively, kindly, and without moral stakes. It will do better, and so will you.',
        },
      ],
      ['recommendation', 'navigate', { ctaText: 'Browse the library', ctaLink: '/learn/library' }],
    ],
  }),
];

export const CONVERSION_SEEDS = ARTICLE_SEEDS;
