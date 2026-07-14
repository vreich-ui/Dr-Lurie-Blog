import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkArtifactTrust,
  checkIdDiscipline,
  checkProduct,
  checkReaderSafety,
  checkReferenceIntegrity,
  checkRenderableImageRefs,
  checkSchema,
  checkStructuralInvariants,
  checkTaxonomyRegistry,
  checkTemplate,
  summarizeValidation,
  validateCandidatePatch,
  validateObject,
  type ObjectValidationContext,
  type ReadinessCriterion,
  type ReadinessGroup,
} from '../../netlify/lib/object-validate.js';
import { publicPathForArtifactRef } from '../../netlify/lib/artifact-trust.js';
import type { ObjectRecord } from '../../src/schema/object-record-v1.js';

// ── shared helpers ───────────────────────────────────────────────────────────

const statusOf = (criteria: ReadinessCriterion[], id: string): string | undefined =>
  criteria.find((criterion) => criterion.id === id)?.status;

const flatten = (groups: ReadinessGroup[]): ReadinessCriterion[] => groups.flatMap((group) => group.criteria);

// A valid, published-shaped page body used as the clean baseline. Deliberately
// free of the reader-safety forbidden tokens in every renderable field.
const validPageBody = () => ({
  route: '/',
  pageType: 'home' as const,
  title: 'Dr. Lurié Skin Care',
  seo: { description: 'Science-first skincare education.', robots: { index: true, follow: true } },
  // A 'home' PageType page must carry this (structure_home_footer) — see
  // check6's dedicated tests for what happens when it's absent.
  navigationOverrides: { footer: 'nav_footer_home' },
  sections: [
    {
      id: 's_hero',
      type: 'hero' as const,
      data: {
        heading: 'Age-aware skincare is coming.',
        body: '<p>Skin after 60 behaves <strong>differently</strong>.</p>',
        actions: [{ label: 'Start Here', target: { kind: 'route' as const, href: '/start-here' } }],
      },
    },
    {
      id: 's_bio',
      type: 'bio' as const,
      data: { heading: 'Meet Dr. Lurié', body: '<p>Biophysicist.</p>', trustNotes: ['PhD'] },
    },
  ],
});

// ═══ check 1: per-type zod + RichText allowlist ══════════════════════════════

test('check1 schema: a valid body passes zod and the RichText allowlist', () => {
  const criteria = checkSchema('page', validPageBody());
  assert.equal(statusOf(criteria, 'schema_zod'), 'complete');
  assert.equal(statusOf(criteria, 'schema_richtext'), 'complete');
});

test('check1 schema REJECTION: an invalid body fails zod', () => {
  const body = { ...validPageBody(), pageType: 'landing' }; // unknown PageType id
  const criteria = checkSchema('page', body);
  assert.equal(statusOf(criteria, 'schema_zod'), 'missing');
});

test('check1 schema REJECTION: disallowed RichText tags and non-http links are rejected', () => {
  const badTag = validPageBody();
  badTag.sections[0].data.body = '<p>Hi</p><script>alert(1)</script>';
  assert.equal(statusOf(checkSchema('page', badTag), 'schema_richtext'), 'missing');

  const badLink = validPageBody();
  badLink.sections[1].data.body = '<p><a href="javascript:alert(1)">x</a></p>';
  assert.equal(statusOf(checkSchema('page', badLink), 'schema_richtext'), 'missing');
});

test('check1 schema: content_item bodies validate against content_item.v1 (W7.3)', () => {
  assert.equal(statusOf(checkSchema('content_item', { anything: true }), 'schema_zod'), 'missing');
  assert.equal(
    statusOf(
      checkSchema('content_item', {
        slug: 'probe-article',
        title: 'Probe',
        nodes: [{ id: 'n_a1', kind: 'content', public: { body: 'One paragraph.' } }],
      }),
      'schema_zod'
    ),
    'complete'
  );
});

// ═══ check 2: ID discipline ══════════════════════════════════════════════════

test('check2 ids: a well-formed object id and section ids pass', () => {
  const criteria = checkIdDiscipline('page', 'page_home', validPageBody());
  assert.equal(statusOf(criteria, 'id_object'), 'complete');
  assert.equal(statusOf(criteria, 'id_sections'), 'complete');
});

test('check2 ids REJECTION: a malformed object id is rejected', () => {
  const criteria = checkIdDiscipline('page', 'home', validPageBody()); // missing page_ prefix
  assert.equal(statusOf(criteria, 'id_object'), 'missing');
});

test('check2 ids REJECTION: a malformed section instance id is rejected', () => {
  const body = validPageBody();
  body.sections[0].id = 'hero1'; // must be s_<alnum>
  const criteria = checkIdDiscipline('page', 'page_home', body);
  assert.equal(statusOf(criteria, 'id_sections'), 'missing');
});

test('check2 ids: content_item keeps validateRequestId (the req_ contract)', () => {
  const ok = checkIdDiscipline('content_item', 'req_smoke_pdf_cta_20260630_01', {});
  assert.equal(statusOf(ok, 'id_object'), 'complete');
  const bad = checkIdDiscipline('content_item', 'page_home', {});
  assert.equal(statusOf(bad, 'id_object'), 'missing');
});

// ═══ check 3: reference integrity ════════════════════════════════════════════

const resolvingContext = (overrides: Partial<ObjectValidationContext> = {}): ObjectValidationContext => ({
  resolveObject: () => ({ exists: true, published: true }),
  resolveTaxonomyTerm: () => ({ active: true }),
  ...overrides,
});

test('check3 refs: all references resolve → complete', () => {
  const body = validPageBody();
  body.sections.push({
    id: 's_grid',
    type: 'content_grid',
    data: { source: { kind: 'manual', items: ['req_a_b_20260101_01'] }, limit: 3 },
  } as never);
  const criteria = checkReferenceIntegrity('page', body, resolvingContext());
  assert.equal(statusOf(criteria, 'references'), 'complete');
});

test('check3 refs REJECTION: an unresolvable NavTarget.page is rejected', () => {
  const body = validPageBody();
  body.sections[0].data.actions = [{ label: 'Go', target: { kind: 'page', page: 'page_ghost' } as never }];
  const context = resolvingContext({ resolveObject: () => ({ exists: false }) });
  assert.equal(statusOf(checkReferenceIntegrity('page', body, context), 'references'), 'missing');
});

test('check3 refs REJECTION: a shared_ref to a missing section is rejected', () => {
  const body = validPageBody();
  body.sections.push({ id: 's_ref', type: 'shared_ref', data: { section: 'sec_missing' } } as never);
  const context = resolvingContext({
    resolveObject: (type) => (type === 'section' ? { exists: false } : { exists: true }),
  });
  assert.equal(statusOf(checkReferenceIntegrity('page', body, context), 'references'), 'missing');
});

test('check3 refs REJECTION: a content_grid query naming an inactive term is rejected', () => {
  const body = validPageBody();
  body.sections.push({
    id: 's_grid',
    type: 'content_grid',
    data: { source: { kind: 'query', query: { category: 't_dead' } }, limit: 3 },
  } as never);
  const context = resolvingContext({ resolveTaxonomyTerm: () => ({ active: false }) });
  assert.equal(statusOf(checkReferenceIntegrity('page', body, context), 'references'), 'missing');
});

test('check3 refs: route-kind targets are ALLOWED (Gap Note 2 lifecycle), never rejected', () => {
  // navigationOverrides dropped: irrelevant to what this test proves, and the
  // stub resolver below (everything "exists:false") would otherwise make ITS
  // real reference report missing, which isn't what this test is about.
  const { navigationOverrides: _drop, ...body } = validPageBody(); // hero action already uses {kind:'route'}
  void _drop;
  // Even with a resolver that would reject any object lookup, a route-kind target
  // triggers no lookup at all, so reference integrity never reports `missing`.
  const context = resolvingContext({ resolveObject: () => ({ exists: false }) });
  assert.notEqual(statusOf(checkReferenceIntegrity('page', body, context), 'references'), 'missing');

  // And a route target sitting next to a resolvable (passing) page ref stays clean.
  body.sections.push({
    id: 's_ref',
    type: 'shared_ref',
    data: { section: 'sec_present' },
  } as never);
  const passing = resolvingContext();
  assert.equal(statusOf(checkReferenceIntegrity('page', body, passing), 'references'), 'complete');
});

test('check3 refs: without resolvers, references are optional (not verifiable here)', () => {
  const body = validPageBody();
  body.sections[0].data.actions = [{ label: 'Go', target: { kind: 'page', page: 'page_x' } as never }];
  assert.equal(statusOf(checkReferenceIntegrity('page', body, {}), 'references'), 'optional');
});

// ═══ check 4: reader safety ══════════════════════════════════════════════════

test('check4 reader safety: clean renderable content passes', () => {
  assert.equal(statusOf(checkReaderSafety(validPageBody()), 'reader_safety'), 'complete');
});

test('check4 reader safety: private markers inside a notes field are exempt (never rendered)', () => {
  const body = validPageBody();
  (body.sections[0] as { notes?: string }).notes = 'strategy: push the offer harder';
  assert.equal(statusOf(checkReaderSafety(body), 'reader_safety'), 'complete');
});

test('check4 reader safety REJECTION: a private marker leaked into a renderable field is rejected', () => {
  const body = validPageBody();
  body.sections[1].data.body = '<p>agentNotes: do not show this</p>';
  assert.equal(statusOf(checkReaderSafety(body), 'reader_safety'), 'missing');
});

// ═══ check 5: media / artifact trust ═════════════════════════════════════════

const TRUSTED_REF = 'image/req_a_b_20260101_01/' + 'a'.repeat(64) + '.jpg';

test('check5 artifact trust: a trusted Major-Key asset ref passes', () => {
  const body = validPageBody();
  (body.sections[1].data as { portraitAssetRef?: string }).portraitAssetRef = TRUSTED_REF;
  const context: ObjectValidationContext = { trustedAssetRefs: new Set([TRUSTED_REF]) };
  assert.equal(statusOf(checkArtifactTrust(body, context), 'artifact_trust'), 'complete');
});

test('check5 artifact trust: no asset refs → optional', () => {
  assert.equal(statusOf(checkArtifactTrust(validPageBody(), {}), 'artifact_trust'), 'optional');
});

test('check5 artifact trust REJECTION: data URIs, remote URLs, legacy paths, and untrusted refs are rejected', () => {
  const cases: string[] = [
    'data:image/png;base64,AAAA',
    'https://evil.example.com/x.jpg',
    'src/assets/images/x.jpg',
    'not-a-major-key',
  ];
  for (const value of cases) {
    const body = validPageBody();
    (body.sections[1].data as { portraitAssetRef?: string }).portraitAssetRef = value;
    assert.equal(
      statusOf(checkArtifactTrust(body, { trustedAssetRefs: new Set([TRUSTED_REF]) }), 'artifact_trust'),
      'missing',
      `${value} must be rejected`
    );
  }

  // Well-formed Major-Key ref that is not in the trust set.
  const body = validPageBody();
  const untrusted = 'image/req_a_b_20260101_01/' + 'b'.repeat(64) + '.jpg';
  (body.sections[1].data as { portraitAssetRef?: string }).portraitAssetRef = untrusted;
  assert.equal(
    statusOf(checkArtifactTrust(body, { trustedAssetRefs: new Set([TRUSTED_REF]) }), 'artifact_trust'),
    'missing'
  );
});

// ═══ check 5b: raw artifact refs in renderable fields (build-breaker guard) ═══

test('publicPathForArtifactRef maps raw keys to their servable path (inverse of the netlify redirect)', () => {
  const sha = 'a'.repeat(64);
  assert.equal(publicPathForArtifactRef(`image/req_x_20260713_01/${sha}.png`), `/img/req_x_20260713_01/${sha}.png`);
  assert.equal(publicPathForArtifactRef(`pdf/req_x_20260713_01/${sha}.pdf`), `/pdf/req_x_20260713_01/${sha}.pdf`);
  // Already-public paths and URLs pass through untouched.
  assert.equal(publicPathForArtifactRef('/img/req_x/abc.png'), '/img/req_x/abc.png');
  assert.equal(publicPathForArtifactRef('https://cdn.example/x.png'), 'https://cdn.example/x.png');
  assert.equal(publicPathForArtifactRef('/images/portrait.jpg'), '/images/portrait.jpg');
});

test('check5b: a raw artifact key in seo.ogImage or images[].src is a blocker (naming the /img path)', () => {
  const sha = 'c'.repeat(64);
  const rawRef = `image/req_publish_premium_skus_20260713_01/${sha}.png`;

  // seo.ogImage — the real 2026-07-13 build-breaker (getImage throws).
  const ogBody = { ...validPageBody(), seo: { description: 'x', ogImage: rawRef } };
  const og = checkRenderableImageRefs(ogBody);
  assert.equal(statusOf(og, 'render_image_ref'), 'missing');
  assert.match(og[0].message, new RegExp(`/img/req_publish_premium_skus_20260713_01/${sha}\\.png`));

  // content_split images[].src — a plain <img> that would 404.
  const splitBody = validPageBody();
  splitBody.sections.push({
    id: 's_split',
    type: 'content_split',
    data: { heading: 'H', body: '<p>b</p>', actions: [], images: [{ src: rawRef, alt: 'a' }] },
  } as never);
  assert.equal(statusOf(checkRenderableImageRefs(splitBody), 'render_image_ref'), 'missing');
});

test('check5b: *AssetRef fields, public /img paths, and notes are all exempt', () => {
  const sha = 'd'.repeat(64);
  // A raw ref in an *AssetRef field is CORRECT there — not flagged by this check.
  const assetRefBody = validPageBody();
  (assetRefBody.sections[1].data as { portraitAssetRef?: string }).portraitAssetRef =
    `image/req_x_20260713_01/${sha}.png`;
  assert.equal(statusOf(checkRenderableImageRefs(assetRefBody), 'render_image_ref'), 'complete');

  // The healed /img/ public path passes.
  const healed = { ...validPageBody(), seo: { description: 'x', ogImage: `/img/req_x_20260713_01/${sha}.png` } };
  assert.equal(statusOf(checkRenderableImageRefs(healed), 'render_image_ref'), 'complete');

  // A raw ref buried in private `notes` is never rendered — exempt.
  const notesBody = validPageBody();
  (notesBody.sections[1].data as { notes?: string }).notes = `see image/req_x_20260713_01/${sha}.png`;
  assert.equal(statusOf(checkRenderableImageRefs(notesBody), 'render_image_ref'), 'complete');
});

// ═══ check 6: structural invariants (the in-scope warn-vs-reject axis) ════════

test('check6 structure: a page with a visible section passes', () => {
  assert.equal(
    statusOf(checkStructuralInvariants('page', 'page_home', validPageBody(), {}, true), 'structure_visible'),
    'complete'
  );
});

test('check6 structure WARN-ONLY: zero visible sections warns while drafting', () => {
  const body = validPageBody();
  for (const section of body.sections) (section as { visibility?: string }).visibility = 'hidden';
  const criteria = checkStructuralInvariants('page', 'page_home', body, {}, false); // atPublish = false
  assert.equal(statusOf(criteria, 'structure_visible'), 'warning');
});

test('check6 structure REJECTION: zero visible sections is a hard failure at publish', () => {
  const body = validPageBody();
  for (const section of body.sections) (section as { visibility?: string }).visibility = 'hidden';
  const criteria = checkStructuralInvariants('page', 'page_home', body, {}, true); // atPublish = true
  assert.equal(statusOf(criteria, 'structure_visible'), 'missing');
});

test('check6 structure (W6): minVisibleSections 0 lets a content_detail page publish with zero sections', () => {
  const body = { route: '/%slug%', pageType: 'content_detail', title: 'Article', seo: {}, sections: [] };
  const context: ObjectValidationContext = {
    pageType: { id: 'content_detail', allowedSections: ['prose', 'cta_banner'], minVisibleSections: 0 },
  };
  assert.equal(
    statusOf(checkStructuralInvariants('page', 'page_article', body, context, true), 'structure_visible'),
    'complete'
  );
});

test('check6 structure (W6): the constraint may also arrive via resolvePageType (the live wiring path)', () => {
  const body = { route: '/%slug%', pageType: 'content_detail', title: 'Article', seo: {}, sections: [] };
  const context: ObjectValidationContext = {
    resolvePageType: (id) =>
      id === 'content_detail' ? { id, allowedSections: ['prose'], minVisibleSections: 0 } : undefined,
  };
  assert.equal(
    statusOf(checkStructuralInvariants('page', 'page_article', body, context, true), 'structure_visible'),
    'complete'
  );
  // A pageType WITHOUT the exemption still hard-fails empty at publish.
  const standard = { ...body, pageType: 'standard' };
  assert.equal(
    statusOf(checkStructuralInvariants('page', 'page_article', standard, context, true), 'structure_visible'),
    'missing'
  );
});

test('check6 structure REJECTION: a section type outside PageType.allowedSections is rejected', () => {
  const body = validPageBody();
  const context: ObjectValidationContext = { pageType: { id: 'home', allowedSections: ['hero'] } };
  // body has a 'bio' section, which is not allowed.
  assert.equal(
    statusOf(checkStructuralInvariants('page', 'page_home', body, context, false), 'structure_allowed'),
    'missing'
  );
});

test('check6 structure WARN-ONLY vs REJECTION: a missing required section warns in draft, rejects at publish', () => {
  const body = validPageBody(); // has hero + bio, no newsletter_signup
  const context: ObjectValidationContext = {
    pageType: { id: 'home', allowedSections: 'any', requiredSections: ['newsletter_signup'] },
  };
  assert.equal(
    statusOf(checkStructuralInvariants('page', 'page_home', body, context, false), 'structure_required'),
    'warning'
  );
  assert.equal(
    statusOf(checkStructuralInvariants('page', 'page_home', body, context, true), 'structure_required'),
    'missing'
  );
});

test('check6 structure: shared_ref effective type is resolved for allowed-section checks', () => {
  const body = validPageBody();
  body.sections = [{ id: 's_ref', type: 'shared_ref', data: { section: 'sec_news' } } as never];
  const context: ObjectValidationContext = {
    pageType: { id: 'home', allowedSections: ['hero'] },
    resolveSharedSectionType: () => 'newsletter_signup',
  };
  // The shared section resolves to newsletter_signup, which is not allowed → reject.
  assert.equal(
    statusOf(checkStructuralInvariants('page', 'page_home', body, context, false), 'structure_allowed'),
    'missing'
  );
});

test('check6 structure: types without their own structural rules report optional', () => {
  // navigation gained its own rules with T2.1 (an unrecognized body reports
  // nav_structure optional; the real rules are tested in
  // object-validate-navigation.test.ts). Site gained the brand-token value
  // check in W8.3 — a body without unsafe token values reports complete.
  assert.equal(statusOf(checkStructuralInvariants('navigation', 'nav_x', {}, {}, true), 'nav_structure'), 'optional');
  assert.equal(
    statusOf(checkStructuralInvariants('site', 'site_x', {}, {}, true), 'brand_token_values'),
    'complete'
  );
});

// Regression guard for the 2026-07-10 incident: four real production publishes
// stripped page_home down to one section with no navigationOverrides, which
// passed validation the whole way (schema-optional) and only surfaced as a
// site-wide Netlify build crash (src/pages/index.astro hardcodes loading id
// 'page_home' and unconditionally throws without navigationOverrides.footer).
test('check6 structure: page_home (by id) REQUIRES navigationOverrides.footer — warn draft, reject publish', () => {
  const { navigationOverrides: _drop, ...body } = validPageBody();
  void _drop;
  const draft = checkStructuralInvariants('page', 'page_home', body, {}, false);
  assert.equal(statusOf(draft, 'structure_home_footer'), 'warning');
  const publish = checkStructuralInvariants('page', 'page_home', body, {}, true);
  assert.equal(statusOf(publish, 'structure_home_footer'), 'missing');
});

test('check6 structure: pageType "home" REQUIRES it too, even under a DIFFERENT object id', () => {
  // Proves the OR-gate: the incident also changed page_home's OWN pageType away
  // from 'home' partway through, which did nothing to stop the crash (the
  // renderer's coupling is id-based, not pageType-based) — so this checks the
  // other direction: a page declaring pageType 'home' under a different id is
  // caught too, not just literal id 'page_home'.
  const { navigationOverrides: _drop, ...body } = validPageBody();
  void _drop;
  const criteria = checkStructuralInvariants('page', 'page_other', body, {}, true);
  assert.equal(statusOf(criteria, 'structure_home_footer'), 'missing');
});

test('check6 structure: a complete navigationOverrides.footer passes; an ordinary non-home page is exempt', () => {
  assert.equal(
    statusOf(checkStructuralInvariants('page', 'page_home', validPageBody(), {}, true), 'structure_home_footer'),
    'complete'
  );
  const ordinary = { ...validPageBody(), pageType: 'standard' as const, navigationOverrides: undefined };
  assert.equal(
    statusOf(checkStructuralInvariants('page', 'page_other', ordinary, {}, true), 'structure_home_footer'),
    undefined
  );
});

// ═══ pipeline composition + summary ══════════════════════════════════════════

test('pipeline: validateObject returns the eight-group readiness report in order', () => {
  const groups = validateObject(
    { objectType: 'page', objectId: 'page_home', body: validPageBody() },
    resolvingContext()
  );
  assert.deepEqual(
    groups.map((group) => group.id),
    [
      'schema',
      'identifiers',
      'references',
      'reader_safety',
      'renderability',
      'deploy_safety',
      'artifact_trust',
      'structure',
    ]
  );
  // Report shape matches the readiness convention: every criterion has the status vocabulary.
  for (const criterion of flatten(groups)) {
    assert.ok(['complete', 'warning', 'missing', 'optional'].includes(criterion.status));
    assert.equal(typeof criterion.id, 'string');
    assert.equal(typeof criterion.label, 'string');
    assert.equal(typeof criterion.message, 'string');
  }
});

test('summary: a clean draft is eligible and ready; a warning keeps eligibility', () => {
  const clean = validateObject(
    { objectType: 'page', objectId: 'page_home', body: validPageBody() },
    resolvingContext()
  );
  const cleanSummary = summarizeValidation(clean);
  assert.equal(cleanSummary.eligible, true);
  assert.equal(cleanSummary.level, 'ready');

  // Draft with all sections hidden → a warning, still eligible for review.
  const draftBody = validPageBody();
  for (const section of draftBody.sections) (section as { visibility?: string }).visibility = 'hidden';
  const warned = validateObject(
    { objectType: 'page', objectId: 'page_home', body: draftBody, published: false },
    resolvingContext()
  );
  const warnedSummary = summarizeValidation(warned);
  assert.equal(warnedSummary.level, 'warning');
  assert.equal(warnedSummary.eligible, true);
  assert.equal(warnedSummary.warnings.length >= 1, true);
});

test('summary: a hard failure blocks eligibility (rejection surfaces as a blocker)', () => {
  const body = validPageBody();
  body.sections[1].data.body = '<p>agentNotes leaked</p>'; // reader-safety violation
  const groups = validateObject({ objectType: 'page', objectId: 'page_home', body }, resolvingContext());
  const summary = summarizeValidation(groups);
  assert.equal(summary.eligible, false);
  assert.equal(summary.level, 'missing');
  assert.ok(summary.blockers.some((criterion) => criterion.id === 'reader_safety'));
});

test('summary: publish intent turns the draft warning into a hard blocker', () => {
  const body = validPageBody();
  for (const section of body.sections) (section as { visibility?: string }).visibility = 'hidden';
  const groups = validateObject(
    { objectType: 'page', objectId: 'page_home', body },
    resolvingContext({ publishIntent: true })
  );
  const summary = summarizeValidation(groups);
  assert.equal(summary.eligible, false);
  assert.ok(summary.blockers.some((criterion) => criterion.id === 'structure_visible'));
});

// ── other object types parse through the pipeline cleanly ────────────────────

test('pipeline: a valid navigation body validates clean', () => {
  const body = {
    role: 'footer',
    groups: [
      {
        id: 'g1',
        slot: 'social',
        items: [
          {
            id: 'i_rss',
            label: 'RSS',
            icon: 'tabler:rss',
            ariaLabel: 'RSS',
            target: { kind: 'asset', href: '/rss.xml' },
          },
        ],
      },
    ],
  };
  const groups = validateObject({ objectType: 'navigation', objectId: 'nav_footer', body }, resolvingContext());
  assert.equal(summarizeValidation(groups).eligible, true);
});

test('pipeline: a valid taxonomy body validates clean', () => {
  const body = {
    kinds: {
      category: {
        terms: [{ term_id: 't_skinscience', slug: 'skin-science', label: 'Skin Science', status: 'active' }],
      },
      tag: { terms: [] },
    },
  };
  const groups = validateObject({ objectType: 'taxonomy', objectId: 'tax_drlurie', body }, resolvingContext());
  assert.equal(summarizeValidation(groups).eligible, true);
});

// ═══ T0.6 cross-check: candidate_patch runs through the real engine ═══════════

const pageRecord = (): ObjectRecord<unknown> => ({
  object_id: 'page_home',
  object_type: 'page',
  schema_version: 'page.v1',
  site: 'site_drlurie',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  status: 'active',
  body: validPageBody(),
  publication: { published_time: null },
  history: [],
  version: 3,
  content_revision: 2,
});

test('candidate_patch: a valid op applies via T0.6 then the resulting body validates', () => {
  const result = validateCandidatePatch(
    pageRecord(),
    [{ op: 'update_section_data', section_id: 's_hero', fields: { heading: 'A calmer, clearer start' } }],
    resolvingContext()
  );
  assert.equal(result.applyError, undefined);
  assert.equal(
    statusOf(
      result.groups.flatMap((g) => g.criteria),
      'patch_apply'
    ),
    'complete'
  );
  assert.equal(result.eligible, true);
});

// The acceptance-criteria test: a typo'd / renamed op discriminant must error
// LOUDLY (T0.6's invalid_op), never fall through silently.
test('candidate_patch: a typo’d op discriminant errors loudly (invalid_op), not silently', () => {
  const result = validateCandidatePatch(
    pageRecord(),
    [{ op: 'update_sekshun_data', section_id: 's_hero', fields: { heading: 'x' } }],
    resolvingContext()
  );
  assert.equal(result.eligible, false);
  assert.equal(result.applyError?.code, 'invalid_op');
  assert.equal(
    statusOf(
      result.groups.flatMap((g) => g.criteria),
      'patch_apply'
    ),
    'missing'
  );
});

test('candidate_patch: an op from the wrong family errors loudly (op_not_applicable)', () => {
  const result = validateCandidatePatch(
    pageRecord(),
    [{ op: 'add_term', kind: 'tag', term: { term_id: 't_x', slug: 'x', label: 'X' } }],
    resolvingContext()
  );
  assert.equal(result.applyError?.code, 'op_not_applicable');
  assert.equal(result.eligible, false);
});

test('candidate_patch: a valid apply that produces an unsafe body fails on the body check, not the apply', () => {
  const result = validateCandidatePatch(
    pageRecord(),
    [{ op: 'update_section_data', section_id: 's_bio', fields: { body: '<p>agentNotes: leak</p>' } }],
    resolvingContext()
  );
  assert.equal(result.applyError, undefined); // the patch APPLIED
  assert.equal(
    statusOf(
      result.groups.flatMap((g) => g.criteria),
      'patch_apply'
    ),
    'complete'
  );
  assert.equal(result.eligible, false); // …but the resulting body is not reader-safe
  assert.ok(summarizeValidation(result.groups).blockers.some((c) => c.id === 'reader_safety'));
});

// The acceptance-criteria test: taxonomy usage-resolution is DEFERRED to the
// injected resolver, never re-derived. A term that only resolves through the
// resolver's alias knowledge (no local registry available in a page validation)
// passes purely because the resolver says active — proving T0.7 trusts it.
test('taxonomy resolution defers to the injected resolver rather than re-deriving aliases', () => {
  const body = validPageBody();
  body.sections.push({
    id: 's_grid',
    type: 'content_grid',
    data: { source: { kind: 'query', query: { category: 't_old_alias' } }, limit: 3 },
  } as never);

  // Resolver stands in for T0.8 following merged_into (D§5.5): the alias id is
  // reported active. T0.7 has no taxonomy registry in a page validation, so a
  // 'complete' here can only come from trusting the resolver.
  const seen: string[] = [];
  const context = resolvingContext({
    resolveTaxonomyTerm: (kind, termId) => {
      seen.push(`${kind}:${termId}`);
      return { active: termId === 't_old_alias' };
    },
  });
  assert.equal(statusOf(checkReferenceIntegrity('page', body, context), 'references'), 'complete');
  assert.ok(seen.includes('category:t_old_alias'), 'the resolver was consulted for the alias');

  // And when the resolver reports inactive, T0.7 rejects — it never second-guesses.
  const rejecting = resolvingContext({ resolveTaxonomyTerm: () => ({ active: false }) });
  assert.equal(statusOf(checkReferenceIntegrity('page', body, rejecting), 'references'), 'missing');
});

// ═══ #7 shared_ref reference-chain policy ═════════════════════════════════════

test('refs: a shared_ref whose target is itself a shared_ref is rejected (no chains)', () => {
  const body = validPageBody();
  body.sections.push({ id: 's_ref', type: 'shared_ref', data: { section: 'sec_chain' } } as never);
  const context = resolvingContext({ resolveSharedSectionType: () => 'shared_ref' });
  assert.equal(statusOf(checkReferenceIntegrity('page', body, context), 'references'), 'missing');
});

test('refs: a shared_ref to a real non-ref section stays clean', () => {
  const body = validPageBody();
  body.sections.push({ id: 's_ref', type: 'shared_ref', data: { section: 'sec_news' } } as never);
  const context = resolvingContext({ resolveSharedSectionType: () => 'newsletter_signup' });
  assert.equal(statusOf(checkReferenceIntegrity('page', body, context), 'references'), 'complete');
});

// ═══ #6 route shape + uniqueness ══════════════════════════════════════════════

test('structure: a route already used by another page is rejected', () => {
  const criteria = checkStructuralInvariants('page', 'page_home', validPageBody(), { isRouteTaken: () => true }, false);
  assert.equal(statusOf(criteria, 'structure_route'), 'missing');
});

test('structure: a unique route passes; a malformed route is rejected; no resolver → optional', () => {
  assert.equal(
    statusOf(
      checkStructuralInvariants('page', 'page_home', validPageBody(), { isRouteTaken: () => false }, false),
      'structure_route'
    ),
    'complete'
  );
  const bad = { ...validPageBody(), route: 'start-here' }; // missing leading slash
  assert.equal(statusOf(checkStructuralInvariants('page', 'page_home', bad, {}, false), 'structure_route'), 'missing');
  assert.equal(
    statusOf(checkStructuralInvariants('page', 'page_home', validPageBody(), {}, false), 'structure_route'),
    'optional'
  );
});

// ═══ #9 taxonomy registry integrity ═══════════════════════════════════════════

const taxonomyBody = (categoryTerms: unknown[], tagTerms: unknown[] = []) => ({
  kinds: { category: { terms: categoryTerms }, tag: { terms: tagTerms } },
});

test('taxonomy registry: a clean registry passes slug + merge checks', () => {
  const body = taxonomyBody([
    { term_id: 't_sleep', slug: 'sleep', label: 'Sleep', status: 'active' },
    { term_id: 't_colic', slug: 'colic', label: 'Colic', status: 'deprecated', merged_into: 't_sleep' },
  ]);
  const criteria = checkTaxonomyRegistry(body, {});
  assert.equal(statusOf(criteria, 'taxonomy_slugs'), 'complete');
  assert.equal(statusOf(criteria, 'taxonomy_merges'), 'complete');
});

test('taxonomy registry REJECTION: malformed slug and duplicate slug per kind', () => {
  const badShape = taxonomyBody([{ term_id: 't_a', slug: 'Not A Slug', label: 'A', status: 'active' }]);
  assert.equal(statusOf(checkTaxonomyRegistry(badShape, {}), 'taxonomy_slugs'), 'missing');

  const dupe = taxonomyBody([
    { term_id: 't_a', slug: 'sleep', label: 'A', status: 'active' },
    { term_id: 't_b', slug: 'sleep', label: 'B', status: 'active' },
  ]);
  assert.equal(statusOf(checkTaxonomyRegistry(dupe, {}), 'taxonomy_slugs'), 'missing');
});

test('taxonomy registry REJECTION: merged_into missing, inactive, or cyclic', () => {
  const missing = taxonomyBody([
    { term_id: 't_a', slug: 'a', label: 'A', status: 'deprecated', merged_into: 't_ghost' },
  ]);
  assert.equal(statusOf(checkTaxonomyRegistry(missing, {}), 'taxonomy_merges'), 'missing');

  const inactive = taxonomyBody([
    { term_id: 't_a', slug: 'a', label: 'A', status: 'deprecated', merged_into: 't_b' },
    { term_id: 't_b', slug: 'b', label: 'B', status: 'deprecated', merged_into: 't_a' }, // b inactive AND cycle
  ]);
  assert.equal(statusOf(checkTaxonomyRegistry(inactive, {}), 'taxonomy_merges'), 'missing');
});

test('taxonomy registry: deprecation-with-usage requires merged_into (via usage resolver)', () => {
  const body = taxonomyBody([{ term_id: 't_a', slug: 'a', label: 'A', status: 'deprecated' }]);
  // No usage resolver → not verifiable → optional.
  assert.equal(statusOf(checkTaxonomyRegistry(body, {}), 'taxonomy_usage'), 'optional');
  // Usage resolver reports live usage → hard failure (would strand references).
  const withUsage = checkTaxonomyRegistry(body, { resolveTaxonomyTermUsage: () => ({ inUse: true }) });
  assert.equal(statusOf(withUsage, 'taxonomy_usage'), 'missing');
  // Usage resolver reports no usage → complete.
  const noUsage = checkTaxonomyRegistry(body, { resolveTaxonomyTermUsage: () => ({ inUse: false }) });
  assert.equal(statusOf(noUsage, 'taxonomy_usage'), 'complete');
});

test('taxonomy registry: reached through the full pipeline for a taxonomy object', () => {
  const groups = validateObject(
    {
      objectType: 'taxonomy',
      objectId: 'tax_drlurie',
      body: taxonomyBody([{ term_id: 't_a', slug: 'bad slug', label: 'A', status: 'active' }]),
    },
    {}
  );
  const structure = groups.find((g) => g.id === 'structure');
  assert.ok(structure);
  assert.equal(statusOf(structure.criteria, 'taxonomy_slugs'), 'missing');
});

// ═══ #10 template slot integrity ══════════════════════════════════════════════

test('template: a well-formed template passes', () => {
  const body = {
    name: 'Standard',
    appliesTo: ['standard'],
    slots: [
      {
        slotId: 'main',
        allowed: ['hero', 'prose'],
        required: true,
        repeatable: false,
        blueprint: { id: 's_x', type: 'hero', data: { heading: 'H', actions: [] } },
      },
    ],
  };
  const criteria = checkTemplate(body, {}, false);
  assert.equal(statusOf(criteria, 'template_blueprints'), 'complete');
  assert.equal(statusOf(criteria, 'template_required'), 'complete');
});

test('template REJECTION: a blueprint whose type is not in the slot allowed set', () => {
  const body = {
    name: 'Standard',
    appliesTo: ['standard'],
    slots: [
      {
        slotId: 'main',
        allowed: ['hero'],
        required: false,
        repeatable: false,
        blueprint: { id: 's_x', type: 'bio', data: { heading: 'H', body: '<p>x</p>', trustNotes: [] } },
      },
    ],
  };
  assert.equal(statusOf(checkTemplate(body, {}, false), 'template_blueprints'), 'missing');
});

test('template WARN: a required slot without a blueprint warns', () => {
  const body = {
    name: 'T',
    appliesTo: ['standard'],
    slots: [{ slotId: 'main', allowed: ['hero'], required: true, repeatable: false }],
  };
  assert.equal(statusOf(checkTemplate(body, {}, false), 'template_required'), 'warning');
});

test('template: component-registry membership is optional until a resolver is supplied, then enforced', () => {
  const body = {
    name: 'T',
    appliesTo: ['standard'],
    slots: [{ slotId: 'main', allowed: ['hero', 'imaginary'], required: false, repeatable: false }],
  };
  assert.equal(statusOf(checkTemplate(body, {}, false), 'template_registry'), 'optional');
  const enforced = checkTemplate(body, { componentTypeExists: (t) => t === 'hero' }, false);
  assert.equal(statusOf(enforced, 'template_registry'), 'missing');
});

// ═══ check 6d: product commerce/fulfillment invariants (06-shop-module-plan §1/§3) ═══

const PRODUCT_ARTIFACT_REF = 'pdf/guides/2f4d1b6f9d1e4c1a8e1b3c5d7f9a1b2c3d4e5f60718293a4b5c6d7e8f9012345.pdf';

const validProductBody = () => ({
  slug: 'barrier-repair-guide',
  presentation: { title: 'The Barrier Repair Guide', page_ref: 'page_prod_barrier_guide' },
  commerce: {
    provider: 'stripe',
    mode: 'fixed',
    price: { amount_cents: 1900, currency: 'usd' },
    stripe: { product_id: 'prod_Abc123', price_id: 'price_Abc123' },
    availability: 'available',
  },
  fulfillment: { kind: 'download', artifact_ref: PRODUCT_ARTIFACT_REF, filename: 'barrier-repair-guide.pdf' },
});

const productContext: ObjectValidationContext = {
  isSlugTaken: () => false,
  trustedAssetRefs: new Set([PRODUCT_ARTIFACT_REF]),
  resolveStripePrice: (priceId) => (priceId === 'price_Abc123' ? { amount_cents: 1900, currency: 'usd' } : undefined),
};

test('product: a coherent fixed-download product passes every criterion', () => {
  const criteria = checkProduct(validProductBody(), productContext, true);
  for (const id of ['product_slug', 'product_commerce', 'product_linkage', 'product_artifact', 'commerce_price_sync']) {
    assert.equal(statusOf(criteria, id), 'complete', id);
  }
});

test('product slug REJECTION: shape and uniqueness are hard write failures; no resolver → optional', () => {
  const body = { ...validProductBody(), slug: 'Not A Slug' };
  assert.equal(statusOf(checkProduct(body, productContext, false), 'product_slug'), 'missing');

  const taken = checkProduct(validProductBody(), { ...productContext, isSlugTaken: () => true }, false);
  assert.equal(statusOf(taken, 'product_slug'), 'missing');

  const noResolver = checkProduct(validProductBody(), { trustedAssetRefs: productContext.trustedAssetRefs }, false);
  assert.equal(statusOf(noResolver, 'product_slug'), 'optional');
});

test('product commerce REJECTION: mode↔fields incoherence is a hard write failure', () => {
  const base = validProductBody();

  // free forbids Stripe linkage and requires provider 'none'.
  const free = { ...base, commerce: { ...base.commerce, mode: 'free' } };
  assert.equal(statusOf(checkProduct(free, productContext, false), 'product_commerce'), 'missing');

  // fixed requires the price display cache.
  const noPrice = { ...base, commerce: { ...base.commerce, price: undefined } };
  assert.equal(statusOf(checkProduct(noPrice, productContext, false), 'product_commerce'), 'missing');

  // pwyw has no Stripe Price and no fixed cache; suggested must cover min.
  const pwyw = {
    ...base,
    commerce: {
      provider: 'stripe',
      mode: 'pwyw',
      pwyw: { min_cents: 900, suggested_cents: 300 },
      stripe: { product_id: 'prod_Abc123', price_id: 'price_Abc123' },
      price: { amount_cents: 900, currency: 'usd' },
      availability: 'available',
    },
  };
  const criteria = checkProduct(pwyw, productContext, false);
  assert.equal(statusOf(criteria, 'product_commerce'), 'missing');

  // …and the coherent PWYW tip passes.
  const tip = {
    slug: 'leave-a-tip',
    presentation: { title: 'Leave a tip' },
    commerce: {
      provider: 'stripe',
      mode: 'pwyw',
      pwyw: { min_cents: 300, suggested_cents: 900 },
      stripe: { product_id: 'prod_Tip1' },
      availability: 'available',
    },
    fulfillment: { kind: 'none' },
  };
  assert.equal(statusOf(checkProduct(tip, productContext, true), 'product_commerce'), 'complete');
});

test('product linkage is PUBLISH-gated and only binds available fixed-price products', () => {
  const base = validProductBody();
  const unlinked = { ...base, commerce: { ...base.commerce, stripe: undefined } };
  assert.equal(statusOf(checkProduct(unlinked, productContext, false), 'product_linkage'), 'warning');
  assert.equal(statusOf(checkProduct(unlinked, productContext, true), 'product_linkage'), 'missing');

  // The pre-launch stripe_test mirror satisfies it (§8.7)…
  const testLinked = {
    ...base,
    commerce: { ...base.commerce, stripe: undefined, stripe_test: { product_id: 'prod_T1', price_id: 'price_T1' } },
  };
  assert.equal(statusOf(checkProduct(testLinked, productContext, true), 'product_linkage'), 'complete');

  // …and a coming_soon product publishes without linkage.
  const comingSoon = { ...base, commerce: { ...base.commerce, stripe: undefined, availability: 'coming_soon' } };
  assert.equal(statusOf(checkProduct(comingSoon, productContext, true), 'product_linkage'), 'complete');
});

test('product artifact REJECTION: URLs and untrusted refs are hard write failures; non-download kinds are exempt', () => {
  const base = validProductBody();
  const url = { ...base, fulfillment: { ...base.fulfillment, artifact_ref: 'https://example.com/x.pdf' } };
  assert.equal(statusOf(checkProduct(url, productContext, false), 'product_artifact'), 'missing');

  const untrusted = {
    ...base,
    fulfillment: { ...base.fulfillment, artifact_ref: PRODUCT_ARTIFACT_REF.replace('2f4d', 'ffff') },
  };
  assert.equal(statusOf(checkProduct(untrusted, productContext, false), 'product_artifact'), 'missing');

  const tipLike = { ...base, fulfillment: { kind: 'none' } };
  assert.equal(statusOf(checkProduct(tipLike, productContext, false), 'product_artifact'), 'optional');
});

test('commerce_price_sync (§3 backstop): mismatch is publish-gated; no resolver → optional, never a false failure', () => {
  const body = validProductBody();
  const drifted: ObjectValidationContext = {
    ...productContext,
    resolveStripePrice: () => ({ amount_cents: 2400, currency: 'usd' }),
  };
  assert.equal(statusOf(checkProduct(body, drifted, false), 'commerce_price_sync'), 'warning');
  assert.equal(statusOf(checkProduct(body, drifted, true), 'commerce_price_sync'), 'missing');

  const { resolveStripePrice, ...noResolver } = productContext;
  void resolveStripePrice;
  assert.equal(statusOf(checkProduct(body, noResolver, true), 'commerce_price_sync'), 'optional');

  const unknownId: ObjectValidationContext = { ...productContext, resolveStripePrice: () => undefined };
  assert.equal(statusOf(checkProduct(body, unknownId, true), 'commerce_price_sync'), 'optional');
});

test('product refs: presentation.page_ref resolves through check 3 like any object reference', () => {
  const resolves: ObjectValidationContext = {
    resolveObject: (type, id) => ({ exists: type === 'page' && id === 'page_prod_barrier_guide' }),
  };
  assert.equal(statusOf(checkReferenceIntegrity('product', validProductBody(), resolves), 'references'), 'complete');

  const ghost: ObjectValidationContext = { resolveObject: () => ({ exists: false }) };
  assert.equal(statusOf(checkReferenceIntegrity('product', validProductBody(), ghost), 'references'), 'missing');
});

test('product: validateObject dispatches the product criteria through the structure group', () => {
  const groups = validateObject(
    { objectType: 'product', objectId: 'prod_barrier_repair_guide', body: validProductBody() },
    productContext
  );
  const structure = groups.find((group) => group.id === 'structure');
  assert.ok(structure && statusOf(structure.criteria, 'product_slug') === 'complete');
  assert.equal(summarizeValidation(groups).eligible, true);
});
