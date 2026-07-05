import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import {
  ASK_AI_BODY_SCHEMAS,
  bodySchemaForObjectType,
  deriveAskAiToolForObjectType,
  deriveAskAiToolSchema,
  isAskAiObjectType,
} from '../../netlify/lib/ask-ai-schema.js';

// Every registered object type produces a valid Anthropic tool: partial (no
// top-level `required`), $schema stripped, additionalProperties:false, and a
// forced-tool name/description.
const EXPECTED_TOP_LEVEL_PROPS: Record<string, string[]> = {
  page: ['route', 'pageType', 'title', 'seo', 'template', 'sections', 'navigationOverrides'],
  navigation: ['role', 'brand', 'groups', 'actions', 'footNote'],
  taxonomy: ['kinds'],
  site: ['name', 'logo', 'urls', 'metadataDefaults', 'brandTokens', 'chrome', 'defaultNavigation', 'blog'],
  template: ['name', 'appliesTo', 'slots'],
};

for (const objectType of Object.keys(ASK_AI_BODY_SCHEMAS)) {
  test(`derives a partial, Anthropic-ready tool schema for ${objectType}`, () => {
    const tool = deriveAskAiToolForObjectType(objectType);
    assert.ok(tool, `${objectType} must resolve to a tool`);
    if (!tool) return;

    assert.equal(typeof tool.name, 'string');
    assert.ok(tool.name.length > 0);
    assert.ok(tool.description.length > 0);

    const schema = tool.input_schema;
    assert.equal(schema.type, 'object');
    assert.equal(schema.$schema, undefined, '$schema dialect marker must be stripped');
    assert.equal(schema.required, undefined, 'partial: no field may be required');
    assert.equal(schema.additionalProperties, false, 'Anthropic tools need additionalProperties:false');

    const props = schema.properties as Record<string, unknown>;
    // section is a discriminated-union wrapper ({ section: ... }); the others
    // list their body fields. Only assert the known non-union top-levels.
    const expected = EXPECTED_TOP_LEVEL_PROPS[objectType];
    if (expected) {
      for (const key of expected) {
        assert.ok(key in props, `${objectType} tool schema should expose the "${key}" field`);
      }
    } else {
      assert.ok(Object.keys(props).length > 0, `${objectType} tool schema should have at least one property`);
    }
  });
}

test('content_item is not an Ask-AI object type (Tier 1 keeps the article path)', () => {
  assert.equal(isAskAiObjectType('content_item'), false);
  assert.equal(bodySchemaForObjectType('content_item'), undefined);
  assert.equal(deriveAskAiToolForObjectType('content_item'), undefined);
});

test('unknown object types resolve to no schema and no tool', () => {
  assert.equal(isAskAiObjectType('widget'), false);
  assert.equal(deriveAskAiToolForObjectType('widget'), undefined);
});

// ── acceptance criterion #1 ──────────────────────────────────────────────────
// A hypothetical seventh object type's tool schema is generated with NO change
// to the derivation code — only the type's own zod schema needs to exist.
test('a hypothetical seventh object type derives a tool schema with zero derivation-code changes', () => {
  // This zod schema stands in for a future T0.2 body schema (e.g. a "banner"
  // object). deriveAskAiToolSchema is called exactly as production does — the
  // function has no knowledge of this type and is not modified for it.
  const hypotheticalSeventhBodySchema = z
    .object({
      headline: z.string().min(1),
      subtext: z.string().optional(),
      dismissible: z.boolean(),
      links: z.array(z.object({ label: z.string(), href: z.string() }).strict()),
    })
    .strict();

  const tool = deriveAskAiToolSchema(hypotheticalSeventhBodySchema, {
    toolName: 'propose_banner_changes',
    description: 'Edit the banner.',
  });

  assert.equal(tool.name, 'propose_banner_changes');
  assert.equal(tool.description, 'Edit the banner.');

  const schema = tool.input_schema;
  assert.equal(schema.type, 'object');
  assert.equal(schema.$schema, undefined);
  assert.equal(schema.required, undefined, 'partial: the AI returns only changed fields');
  assert.equal(schema.additionalProperties, false);

  const props = schema.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(props).sort(), ['dismissible', 'headline', 'links', 'subtext']);
  assert.equal(props.headline.type, 'string');
  assert.equal(props.dismissible.type, 'boolean');
  assert.equal(props.links.type, 'array');
});

test('derivation is generic for a union schema too (no .partial): required stripped, still valid', () => {
  const unionSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('a'), a: z.string() }).strict(),
    z.object({ kind: z.literal('b'), b: z.number() }).strict(),
  ]);

  const tool = deriveAskAiToolSchema(unionSchema);
  assert.equal(tool.input_schema.$schema, undefined);
  assert.equal(tool.input_schema.required, undefined);
  assert.ok(tool.input_schema.anyOf || tool.input_schema.oneOf, 'a union should surface as anyOf/oneOf');
});
