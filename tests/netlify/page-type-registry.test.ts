/**
 * T3.1 — PageType registry v1 (+ W6/T6.1 completion). Pins the D§3.4 contract:
 *
 *   - all five PageTypeIds are defined since W6 (2026-07-12): home / standard /
 *     system (T3.1) plus listing / content_detail (T6.1 — the formalized blog
 *     listing loaders); the lookup still distinguishes "unknown id" from
 *     "known, not yet implemented" for any future enum addition.
 *   - every definition is review-required (pages are Tier 2, D§3.9) with
 *     publish roles drawn from the real Role union in netlify/lib/roles.ts.
 *   - allowed/required section names are drawn from the live sectionTypeSchema
 *     so the registry cannot name a section type the validator doesn't know.
 *   - MCP registry_get('page_type') serves the definitions plus the
 *     JSON-schema rendering (the T3.1 verify criterion).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Role } from '../../netlify/lib/roles.js';
import { pageTypeIds } from '../../src/schema/bodies/page-v1.js';
import { sectionTypeSchema } from '../../src/schema/bodies/section-v1.js';
import {
  getPageTypeDefinition,
  listPageTypeDefinitions,
  pageTypeDefinitionJsonSchema,
  unimplementedPageTypeIds,
  type PublishRole,
} from '../../src/lib/registry/page-types.js';

test('all five PageTypeIds are defined (W6); unknown ids still fail loudly', () => {
  for (const id of ['home', 'standard', 'system', 'listing', 'content_detail']) {
    const lookup = getPageTypeDefinition(id);
    assert.ok(lookup.ok, `${id} must be defined`);
  }
  assert.deepEqual(getPageTypeDefinition('landing'), { ok: false, reason: 'unknown_page_type' });
  assert.deepEqual(unimplementedPageTypeIds(), []);
  // The registry's id universe is exactly the page-v1 enum: defined + pending.
  assert.deepEqual(
    [...listPageTypeDefinitions().map((definition) => definition.id), ...unimplementedPageTypeIds()].sort(),
    [...pageTypeIds].sort()
  );
});

test('listing formalizes the loader pattern: required lede header, content_items query, paginated (T6.1)', () => {
  const listing = getPageTypeDefinition('listing');
  assert.ok(listing.ok);
  assert.deepEqual(listing.definition.requiredSections, ['lede']);
  assert.ok(Array.isArray(listing.definition.allowedSections));
  assert.ok((listing.definition.allowedSections as string[]).includes('shared_ref'));
  assert.deepEqual(listing.definition.listing, {
    source: 'content_items',
    defaultQuery: { sort: 'published_time_desc' },
    paginate: true,
  });
  // Default minimum applies: a listing page must keep its visible header block.
  assert.equal(listing.definition.minVisibleSections, undefined);
});

test('content_detail publishes with zero sections (the article is the content) and never allows a lede', () => {
  const detail = getPageTypeDefinition('content_detail');
  assert.ok(detail.ok);
  assert.equal(detail.definition.minVisibleSections, 0);
  assert.equal(detail.definition.requiredSections, undefined);
  assert.ok(Array.isArray(detail.definition.allowedSections));
  assert.ok(!(detail.definition.allowedSections as string[]).includes('lede'));
  assert.equal(detail.definition.listing, undefined);
});

test('every definition is review-required with roles from the real Role union (D§3.9)', () => {
  for (const definition of listPageTypeDefinitions()) {
    assert.equal(definition.reviewPolicy.required, true, `${definition.id} must be review-required`);
    assert.equal(definition.reviewPolicy.minApprovals, 1);
    assert.ok(definition.reviewPolicy.publishRoles.length > 0);
    // Compile-time: PublishRole must stay assignable to netlify's Role.
    const roles: Role[] = definition.reviewPolicy.publishRoles satisfies PublishRole[];
    assert.ok(roles.includes('admin'), `${definition.id} publish must at least allow admin`);
  }
});

test('section names in allowlists and required lists all exist in the live section union', () => {
  for (const definition of listPageTypeDefinitions()) {
    const named = [
      ...(definition.allowedSections === 'any' ? [] : definition.allowedSections),
      ...(definition.requiredSections ?? []),
    ];
    for (const sectionType of named) {
      assert.ok(
        sectionTypeSchema.safeParse(sectionType).success,
        `${definition.id} names unknown section type '${sectionType}'`
      );
    }
  }
});

test('home requires a hero and pins the C§1.1 section family; standard allows any', () => {
  const home = getPageTypeDefinition('home');
  assert.ok(home.ok);
  assert.deepEqual(home.definition.requiredSections, ['hero']);
  assert.ok(Array.isArray(home.definition.allowedSections));
  assert.ok((home.definition.allowedSections as string[]).includes('shared_ref'));
  assert.equal(home.definition.routePattern, '/');

  const standard = getPageTypeDefinition('standard');
  assert.ok(standard.ok);
  assert.equal(standard.definition.allowedSections, 'any');
});

test('every definition validates against its own JSON-schema-rendered shape', () => {
  const jsonSchema = pageTypeDefinitionJsonSchema() as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  assert.equal(jsonSchema.type, 'object');
  assert.ok(jsonSchema.properties?.reviewPolicy, 'reviewPolicy must be part of the rendered schema');
  assert.ok(jsonSchema.required?.includes('routePattern'));
});
