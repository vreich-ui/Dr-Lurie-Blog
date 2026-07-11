/**
 * T3.2 — component registry v1, the node-testable half. (The render half —
 * components producing markup identical to the live homepage — is
 * scripts/verify-section-components.mjs, which needs a real astro build.)
 *
 * Pins: each per-type module's schema IS the live section-v1 variant schema
 * (identity, not equivalence — the registry cannot drift from validation);
 * every defaultData blueprint and the C§1.1 fixture data parse as full
 * section instances through the REAL union; fieldHints only name real
 * schema fields; the rich-text paragraph splitter is faithful and refuses
 * to drop content.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { splitRichTextBlocks, splitRichTextParagraphs } from '../../src/lib/richtext/paragraphs.js';
import { bioDefinition } from '../../src/lib/registry/components/bio.js';
import { checklistDefinition } from '../../src/lib/registry/components/checklist.js';
import { contactFormDefinition } from '../../src/lib/registry/components/contact-form.js';
import { contentEmbedDefinition } from '../../src/lib/registry/components/content-embed.js';
import { contentGridDefinition } from '../../src/lib/registry/components/content-grid.js';
import { ctaBannerDefinition } from '../../src/lib/registry/components/cta-banner.js';
import { faqDefinition } from '../../src/lib/registry/components/faq.js';
import { heroDefinition } from '../../src/lib/registry/components/hero.js';
import { ledeDefinition } from '../../src/lib/registry/components/lede.js';
import { linkListDefinition } from '../../src/lib/registry/components/link-list.js';
import { newsletterSignupDefinition } from '../../src/lib/registry/components/newsletter-signup.js';
import { productPreviewDefinition } from '../../src/lib/registry/components/product-preview.js';
import { proseDefinition } from '../../src/lib/registry/components/prose.js';
import { formConfirmationDefinition } from '../../src/lib/registry/components/form-confirmation.js';
import { searchDefinition } from '../../src/lib/registry/components/search.js';
import { testimonialDefinition } from '../../src/lib/registry/components/testimonial.js';
import { sectionVariantDataSchema } from '../../src/lib/registry/components/types.js';
import {
  homeAudienceGridData,
  homeBioData,
  homeHeroData,
  homeNewsletterSignupData,
  homeStartGridData,
} from '../../src/lib/registry/components/home-fixture-data.js';
import { sectionInstanceSchema } from '../../src/schema/bodies/section-v1.js';

const DEFINITIONS = [
  heroDefinition,
  checklistDefinition,
  contentGridDefinition,
  bioDefinition,
  newsletterSignupDefinition,
  // T3.13 drill: the new type is held to the SAME invariants as the audited five.
  testimonialDefinition,
  // T4.2: interior-page lede, same invariants.
  ledeDefinition,
  // Reusable primitives (bind-the-catalog): general-purpose body copy + closing CTA.
  proseDefinition,
  ctaBannerDefinition,
  faqDefinition,
  linkListDefinition,
  productPreviewDefinition,
  contactFormDefinition,
  searchDefinition,
  contentEmbedDefinition,
  formConfirmationDefinition,
] as const;

const asInstance = (type: string, data: unknown, index: number) => ({
  id: `s_fixture${index}`,
  type,
  data,
});

test('each registry schema is the SAME OBJECT as the live section-v1 variant data schema', () => {
  for (const definition of DEFINITIONS) {
    assert.equal(
      definition.schema,
      sectionVariantDataSchema(definition.type),
      `${definition.type}: registry schema must be the union's own schema, not a copy`
    );
  }
});

test('every defaultData blueprint parses as a full section instance through the real union', () => {
  DEFINITIONS.forEach((definition, index) => {
    const result = sectionInstanceSchema.safeParse(asInstance(definition.type, definition.editor.defaultData, index));
    assert.ok(
      result.success,
      `${definition.type} defaultData: ${JSON.stringify(result.success ? '' : result.error.issues)}`
    );
  });
});

test('fieldHints only name fields the schema actually has', () => {
  for (const definition of DEFINITIONS) {
    const shape = (definition.schema as unknown as { shape: Record<string, unknown> }).shape;
    for (const hinted of Object.keys(definition.editor.fieldHints)) {
      assert.ok(hinted in shape, `${definition.type}: fieldHint '${hinted}' names no schema field`);
    }
  }
});

test('the homepage fixture data parses through the real union (what the render gate builds from)', () => {
  const fixtures = [
    ['hero', homeHeroData],
    ['content_grid', homeAudienceGridData],
    ['content_grid', homeStartGridData],
    ['bio', homeBioData],
    ['newsletter_signup', homeNewsletterSignupData],
  ] as const;
  fixtures.forEach(([type, data], index) => {
    const result = sectionInstanceSchema.safeParse(asInstance(type, data, index));
    assert.ok(result.success, `${type}: ${JSON.stringify(result.success ? '' : result.error.issues)}`);
  });
});

test('splitRichTextParagraphs: faithful split, empty handling, loud refusal on non-paragraph content', () => {
  assert.deepEqual(splitRichTextParagraphs(''), []);
  assert.deepEqual(splitRichTextParagraphs('  '), []);
  assert.deepEqual(splitRichTextParagraphs('<p>One</p>'), ['One']);
  assert.deepEqual(splitRichTextParagraphs('<p>One</p><p>Two &amp; <strong>three</strong></p>'), [
    'One',
    'Two &amp; <strong>three</strong>',
  ]);
  // The audited hero body round-trips.
  const heroParagraphs = splitRichTextParagraphs(homeHeroData.body as string);
  assert.equal(heroParagraphs.length, 2);
  assert.match(heroParagraphs[0], /^A calmer, clearer way/);
  // Content outside <p> blocks must not be silently dropped.
  assert.throws(() => splitRichTextParagraphs('<p>One</p><ul><li>stray</li></ul>'), /outside top-level <p> blocks/);
  assert.throws(() => splitRichTextParagraphs('loose text'), /outside top-level <p> blocks/);
});

test('splitRichTextBlocks: prose gets the full allowlist (p/h2/h3/ul/ol), still refuses to drop content', () => {
  assert.deepEqual(splitRichTextBlocks(''), []);
  assert.deepEqual(splitRichTextBlocks('<p>One</p><h2>Two</h2>'), [
    { tag: 'p', html: 'One' },
    { tag: 'h2', html: 'Two' },
  ]);
  assert.deepEqual(splitRichTextBlocks('<ul><li>A</li><li>B</li></ul>'), [{ tag: 'ul', html: '<li>A</li><li>B</li>' }]);
  assert.deepEqual(splitRichTextBlocks('<h3>Sub</h3>'), [{ tag: 'h3', html: 'Sub' }]);
  assert.throws(() => splitRichTextBlocks('<p>One</p>loose text'), /outside top-level p\/h2\/h3\/ul\/ol blocks/);
});
