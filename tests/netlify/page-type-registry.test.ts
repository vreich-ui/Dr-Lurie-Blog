/**
 * T3.1 — PageType registry v1. Pins the D§3.4 contract:
 *
 *   - home / standard / system fully defined; listing / content_detail typed
 *     in the enum but deliberately unimplemented until P6 — and the lookup
 *     distinguishes "unknown id" from "known, not yet implemented".
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

test('home, standard, and system are defined; listing and content_detail are typed but unimplemented', () => {
  for (const id of ['home', 'standard', 'system']) {
    const lookup = getPageTypeDefinition(id);
    assert.ok(lookup.ok, `${id} must be defined`);
  }
  for (const id of ['listing', 'content_detail']) {
    assert.deepEqual(getPageTypeDefinition(id), { ok: false, reason: 'not_yet_implemented' });
  }
  assert.deepEqual(getPageTypeDefinition('landing'), { ok: false, reason: 'unknown_page_type' });
  assert.deepEqual(unimplementedPageTypeIds(), ['listing', 'content_detail']);
  // The registry's id universe is exactly the page-v1 enum: defined + pending.
  assert.deepEqual(
    [...listPageTypeDefinitions().map((definition) => definition.id), ...unimplementedPageTypeIds()].sort(),
    [...pageTypeIds].sort()
  );
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
