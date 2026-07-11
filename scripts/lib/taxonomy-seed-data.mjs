/**
 * Seed data for the taxonomy registry — `tax_drlurie` (W3, 2026-07-11).
 *
 * The CURATED canonical vocabulary Wolf approved (session 2026-07-11), distilled
 * from the raw frontmatter of all 93 posts: 5 categories + 26 tags. The raw
 * vocabulary had drifted (158 distinct tag strings, ~2/3 of usage pipeline-test
 * junk, real terms split across casing/hyphen variants); this registry is the
 * cleaned starting point — and it is EDITABLE DATA: agents add, rename (slug
 * renames auto-mint deprecated `merged_into` aliases), or deprecate terms with
 * the taxonomy patch ops. Nothing here is locked in.
 *
 * Scope boundary (the approved plan): this object is the source of truth for
 * OBJECT-SIDE consumers — content_grid query term validation (the store
 * validation context wires resolveTaxonomyTerm the moment this record exists),
 * listing labels, the future topics hub (W6). Article frontmatter remains the
 * article-side input until the bounded publish-article enforcement hook lands
 * (step 2 of the plan; a sanctioned additive exception to the off-limits rule).
 *
 * RAW_TO_CANONICAL maps every real raw frontmatter string to its canonical
 * slug — the input for step 2's one-time normalization pass over the posts.
 * Raw strings absent from the map are pipeline-test junk / one-offs with no
 * editorial cluster (dropped; promotable later with one add_term op).
 *
 * Term ids follow the server-mint convention: t_<alnum(slug)>. Category and
 * tag registries are separate (uniqueness is per kind), so the same slug may
 * appear in both kinds.
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --seeds scripts/lib/taxonomy-seed-data.mjs
 */

export const SEED_SITE = 'site_drlurie';

const term = (slug, label, description) => ({
  term_id: `t_${slug.replace(/[^a-z0-9]/g, '')}`,
  slug,
  label,
  ...(description ? { description } : {}),
  status: 'active',
});

// ─── categories (5) ──────────────────────────────────────────────────────────

const CATEGORY_TERMS = [
  term(
    'skin-health',
    'Skin Health',
    'The science and health of skin — barrier function, biology, and what actually changes it.'
  ),
  term('skincare', 'Skincare', 'Products, routines, and the industry around them.'),
  term('skin-after-40', 'Skin After 40', 'How skin changes with age — and what to do about it.'),
  term('ingredients', 'Ingredients Wiki', 'Plain-language entries on individual skincare ingredients.'),
  term('reflections', 'Reflections', 'Personal essays and observations.'),
];

// ─── tags (26) ───────────────────────────────────────────────────────────────

const TAG_TERMS = [
  term('skin-barrier', 'Skin Barrier'),
  term('skincare', 'Skincare'),
  term('skin-after-40', 'Skin After 40'),
  term('reflections', 'Reflections'),
  term('skincare-basics', 'Skincare Basics'),
  term('dry-skin', 'Dry Skin'),
  term('retinoids', 'Retinoids'),
  term('sun-protection', 'Sun Protection'),
  term('pigmentation', 'Pigmentation'),
  term('sensitive-skin', 'Sensitive Skin'),
  term('dtc', 'Direct-to-Consumer'),
  term('skin-science', 'Skin Science'),
  term('skin-health', 'Skin Health'),
  term('dermatology', 'Dermatology'),
  term('menopause', 'Menopause & Skin'),
  term('moisturizers', 'Moisturizers'),
  term('marketing-claims', 'Marketing Claims'),
  term('guides', 'Guides & Downloads'),
  term('acne', 'Acne'),
  term('body-odor', 'Body Odor'),
  term('skincare-routine', 'Skincare Routine'),
  term('supplements', 'Supplements'),
  term('patient-education', 'Patient Education'),
  term('ingredients', 'Ingredients'),
  term('microbiome', 'Microbiome'),
  term('body-care', 'Body Care'),
];

// ─── the registry body ───────────────────────────────────────────────────────

export const taxonomyBody = {
  kinds: {
    category: { terms: CATEGORY_TERMS },
    tag: { terms: TAG_TERMS },
  },
};

// ─── raw frontmatter → canonical slug (step 2's normalization input) ─────────
// Keys are the EXACT raw strings found in post frontmatter (case-sensitive).
// A raw string absent here is dropped junk, not an oversight — see header.

export const RAW_TO_CANONICAL = {
  category: {
    'Skin Health': 'skin-health',
    Health: 'skin-health',
    Skincare: 'skincare',
    Market: 'skincare',
    'Skin after 40': 'skin-after-40',
    'Ingredients Wiki': 'ingredients',
    Essay: 'reflections',
    Reflection: 'reflections',
  },
  tag: {
    // skin-barrier (18)
    'skin-barrier': 'skin-barrier',
    'skin barrier': 'skin-barrier',
    'Skin Barrier': 'skin-barrier',
    // skincare (12)
    skincare: 'skincare',
    'skin care': 'skincare',
    'skin-care': 'skincare',
    skin: 'skincare',
    // skin-after-40 (11)
    'over-40-skin': 'skin-after-40',
    'skin over 40': 'skin-after-40',
    '40+ skincare': 'skin-after-40',
    'Midlife Skin': 'skin-after-40',
    'midlife skincare': 'skin-after-40',
    'aging skin': 'skin-after-40',
    // reflections (11)
    reflection: 'reflections',
    essay: 'reflections',
    'everyday life': 'reflections',
    'everyday-observations': 'reflections',
    'small moments': 'reflections',
    nostalgia: 'reflections',
    'city-life': 'reflections',
    attention: 'reflections',
    knowledge: 'reflections',
    wellbeing: 'reflections',
    // skincare-basics (10)
    'Skincare Basics': 'skincare-basics',
    'Beginner Skincare': 'skincare-basics',
    'beginner skincare': 'skincare-basics',
    'beginner-skincare': 'skincare-basics',
    'beginner guide': 'skincare-basics',
    'skin basics': 'skincare-basics',
    'skincare-basics': 'skincare-basics',
    // dry-skin (8)
    'dry-skin': 'dry-skin',
    'dry skin': 'dry-skin',
    'Dry Skin': 'dry-skin',
    // retinoids (8)
    retinol: 'retinoids',
    retinoids: 'retinoids',
    // sun-protection (11)
    'sun protection': 'sun-protection',
    sunscreen: 'sun-protection',
    Sunscreen: 'sun-protection',
    photoaging: 'sun-protection',
    'sun damage': 'sun-protection',
    // pigmentation (7)
    'dark spots': 'pigmentation',
    'age spots': 'pigmentation',
    hyperpigmentation: 'pigmentation',
    'uneven tone': 'pigmentation',
    melasma: 'pigmentation',
    // sensitive-skin (7)
    'sensitive skin': 'sensitive-skin',
    'reactive-skin': 'sensitive-skin',
    irritation: 'sensitive-skin',
    'over-exfoliation': 'sensitive-skin',
    // dtc (7)
    dtc: 'dtc',
    DTC: 'dtc',
    'dtc-health': 'dtc',
    'dtc-skincare': 'dtc',
    // skin-science (7)
    'science blog': 'skin-science',
    'health science': 'skin-science',
    'evidence-based skincare': 'skin-science',
    cells: 'skin-science',
    'cellular biology': 'skin-science',
    mitochondria: 'skin-science',
    // skin-health (4)
    'skin health': 'skin-health',
    'skin-health': 'skin-health',
    // dermatology (4)
    dermatology: 'dermatology',
    // menopause (4)
    menopause: 'menopause',
    perimenopause: 'menopause',
    'menopause-care': 'menopause',
    'hormonal skin changes': 'menopause',
    // moisturizers (4)
    Moisturizer: 'moisturizers',
    Creams: 'moisturizers',
    Lotions: 'moisturizers',
    Gels: 'moisturizers',
    // marketing-claims (4)
    'Skincare Marketing': 'marketing-claims',
    'Skincare Labels': 'marketing-claims',
    'Cosmetic Claims': 'marketing-claims',
    'clean beauty': 'marketing-claims',
    // guides (3)
    worksheet: 'guides',
    'pdf-download': 'guides',
    // acne (2)
    acne: 'acne',
    'adult acne': 'acne',
    // body-odor (2)
    'Body Odor': 'body-odor',
    Smell: 'body-odor',
    // skincare-routine (2)
    'Skincare Routine': 'skincare-routine',
    'Routine Reset': 'skincare-routine',
    // supplements (2)
    'supplement routine': 'supplements',
    // patient-education (2)
    'patient education': 'patient-education',
    // ingredients (2)
    ingredients: 'ingredients',
    wiki: 'ingredients',
    // microbiome (1)
    microbiome: 'microbiome',
    // body-care (1)
    'body care': 'body-care',
  },
};

// ─── driver contract ─────────────────────────────────────────────────────────

export const CONVERSION_SEEDS = [{ objectType: 'taxonomy', objectId: 'tax_drlurie', body: taxonomyBody }];
