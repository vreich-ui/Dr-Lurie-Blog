import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkArtifactTrust,
  checkIdDiscipline,
  checkReaderSafety,
  checkReferenceIntegrity,
  checkSchema,
  checkStructuralInvariants,
  summarizeValidation,
  validateObject,
  type ObjectValidationContext,
  type ReadinessCriterion,
  type ReadinessGroup,
} from '../../netlify/lib/object-validate.js';

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

test('check1 schema: content_item body is delegated (optional), not hard-failed', () => {
  const criteria = checkSchema('content_item', { anything: true });
  assert.equal(statusOf(criteria, 'schema_zod'), 'optional');
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
  const body = validPageBody(); // hero action already uses {kind:'route'}
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

// ═══ check 6: structural invariants (the in-scope warn-vs-reject axis) ════════

test('check6 structure: a page with a visible section passes', () => {
  assert.equal(statusOf(checkStructuralInvariants('page', validPageBody(), {}, true), 'structure_visible'), 'complete');
});

test('check6 structure WARN-ONLY: zero visible sections warns while drafting', () => {
  const body = validPageBody();
  for (const section of body.sections) (section as { visibility?: string }).visibility = 'hidden';
  const criteria = checkStructuralInvariants('page', body, {}, false); // atPublish = false
  assert.equal(statusOf(criteria, 'structure_visible'), 'warning');
});

test('check6 structure REJECTION: zero visible sections is a hard failure at publish', () => {
  const body = validPageBody();
  for (const section of body.sections) (section as { visibility?: string }).visibility = 'hidden';
  const criteria = checkStructuralInvariants('page', body, {}, true); // atPublish = true
  assert.equal(statusOf(criteria, 'structure_visible'), 'missing');
});

test('check6 structure REJECTION: a section type outside PageType.allowedSections is rejected', () => {
  const body = validPageBody();
  const context: ObjectValidationContext = { pageType: { id: 'home', allowedSections: ['hero'] } };
  // body has a 'bio' section, which is not allowed.
  assert.equal(statusOf(checkStructuralInvariants('page', body, context, false), 'structure_allowed'), 'missing');
});

test('check6 structure WARN-ONLY vs REJECTION: a missing required section warns in draft, rejects at publish', () => {
  const body = validPageBody(); // has hero + bio, no newsletter_signup
  const context: ObjectValidationContext = {
    pageType: { id: 'home', allowedSections: 'any', requiredSections: ['newsletter_signup'] },
  };
  assert.equal(statusOf(checkStructuralInvariants('page', body, context, false), 'structure_required'), 'warning');
  assert.equal(statusOf(checkStructuralInvariants('page', body, context, true), 'structure_required'), 'missing');
});

test('check6 structure: shared_ref effective type is resolved for allowed-section checks', () => {
  const body = validPageBody();
  body.sections = [{ id: 's_ref', type: 'shared_ref', data: { section: 'sec_news' } } as never];
  const context: ObjectValidationContext = {
    pageType: { id: 'home', allowedSections: ['hero'] },
    resolveSharedSectionType: () => 'newsletter_signup',
  };
  // The shared section resolves to newsletter_signup, which is not allowed → reject.
  assert.equal(statusOf(checkStructuralInvariants('page', body, context, false), 'structure_allowed'), 'missing');
});

test('check6 structure: non-page types have no structural invariants here', () => {
  assert.equal(statusOf(checkStructuralInvariants('navigation', {}, {}, true), 'structure'), 'optional');
});

// ═══ pipeline composition + summary ══════════════════════════════════════════

test('pipeline: validateObject returns the six-group readiness report in order', () => {
  const groups = validateObject(
    { objectType: 'page', objectId: 'page_home', body: validPageBody() },
    resolvingContext()
  );
  assert.deepEqual(
    groups.map((group) => group.id),
    ['schema', 'identifiers', 'references', 'reader_safety', 'artifact_trust', 'structure']
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
