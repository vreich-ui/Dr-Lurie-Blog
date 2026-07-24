import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyRecord, classifySiteRecords, type BodySchemaLike } from './classify.js';
import type { SchemaMigration } from './registry.js';

// A minimal zod-like schema without importing zod — classifyRecord only
// needs `.safeParse()`. `pageV1Schema` accepts any body with a string
// `title`; `pageV2Schema` is the ADVERSARIAL synthetic case the T11.9 brief
// explicitly calls for — a required-field addition (`tagline`) that an
// unmigrated v1 body will not satisfy.
const pageV1Schema: BodySchemaLike = {
  safeParse: (value) => ({
    success: typeof value === 'object' && value !== null && typeof (value as { title?: unknown }).title === 'string',
  }),
};

const pageV2Schema: BodySchemaLike = {
  safeParse: (value) => {
    const body = value as { title?: unknown; tagline?: unknown };
    return { success: typeof body?.title === 'string' && typeof body?.tagline === 'string' };
  },
};

const v1_to_v2_migration: SchemaMigration = {
  objectType: 'page',
  from: 'page.v1',
  to: 'page.v2',
  description: 'add required field `tagline` with a default',
  migrate: (body) => ({ ...(body as Record<string, unknown>), tagline: 'untitled' }),
  toPatchOps: (_old, newBody) => [
    { op: 'set_page_fields', fields: { tagline: (newBody as { tagline: string }).tagline } },
  ],
  inverse: (body) => {
    const { tagline: _tagline, ...rest } = body as Record<string, unknown>;
    return rest;
  },
};

const brokenMigration: SchemaMigration = {
  ...v1_to_v2_migration,
  description: 'broken: forgets to actually add the field',
  migrate: (body) => body, // does nothing — the migrated body still fails pageV2Schema
};

describe('classifyRecord — the adversarial synthetic v1 -> v2 required-field-addition case', () => {
  it('BLOCKS a v1 body against the v2 schema when no migration is registered', () => {
    const result = classifyRecord({
      objectType: 'page',
      schemaVersion: 'page.v1',
      body: { title: 'Home' },
      currentSchema: pageV2Schema,
      currentSchemaVersion: 'page.v2',
      migrations: [], // no migration registered — this is the gate's whole point
    });
    assert.strictEqual(result.disposition, 'blocked');
    if (result.disposition === 'blocked') {
      assert.match(result.reason, /no registered migration path/);
    }
  });

  it('PASSES (migratable) the same v1 body once the migration is registered', () => {
    const result = classifyRecord({
      objectType: 'page',
      schemaVersion: 'page.v1',
      body: { title: 'Home' },
      currentSchema: pageV2Schema,
      currentSchemaVersion: 'page.v2',
      migrations: [v1_to_v2_migration],
    });
    assert.strictEqual(result.disposition, 'migratable');
    if (result.disposition === 'migratable') {
      assert.deepStrictEqual(result.chain, [v1_to_v2_migration]);
      assert.strictEqual(result.writable, true);
    }
  });

  it('reports writable: false when the chain has a preview-only (no toPatchOps) hop', () => {
    const previewOnly: SchemaMigration = { ...v1_to_v2_migration, toPatchOps: undefined };
    const result = classifyRecord({
      objectType: 'page',
      schemaVersion: 'page.v1',
      body: { title: 'Home' },
      currentSchema: pageV2Schema,
      currentSchemaVersion: 'page.v2',
      migrations: [previewOnly],
    });
    assert.strictEqual(result.disposition, 'migratable');
    if (result.disposition === 'migratable') assert.strictEqual(result.writable, false);
  });

  it('is BLOCKED (distinctly, with a "migration itself is broken" reason) when a chain exists but the migrated body still fails the head schema', () => {
    const result = classifyRecord({
      objectType: 'page',
      schemaVersion: 'page.v1',
      body: { title: 'Home' },
      currentSchema: pageV2Schema,
      currentSchemaVersion: 'page.v2',
      migrations: [brokenMigration],
    });
    assert.strictEqual(result.disposition, 'blocked');
    if (result.disposition === 'blocked') {
      assert.match(result.reason, /migration itself is broken/);
    }
  });
});

describe('classifyRecord — parses-as-is precedence', () => {
  it('reports parses-as-is when the body already satisfies the head schema, regardless of the declared schema_version', () => {
    const result = classifyRecord({
      objectType: 'page',
      schemaVersion: 'page.v1', // claims v1...
      body: { title: 'Home', tagline: 'already has it' }, // ...but the shape already satisfies v2
      currentSchema: pageV2Schema,
      currentSchemaVersion: 'page.v2',
      migrations: [], // no migration needed — parses-as-is wins even with an empty registry
    });
    assert.deepStrictEqual(result, { disposition: 'parses-as-is' });
  });

  it('is a no-op parses-as-is when schemaVersion already equals currentSchemaVersion and the body is valid', () => {
    const result = classifyRecord({
      objectType: 'page',
      schemaVersion: 'page.v1',
      body: { title: 'Home' },
      currentSchema: pageV1Schema,
      currentSchemaVersion: 'page.v1',
      migrations: [],
    });
    assert.deepStrictEqual(result, { disposition: 'parses-as-is' });
  });
});

describe('classifySiteRecords', () => {
  const resolvers = {
    currentSchema: (objectType: string) => (objectType === 'page' ? pageV2Schema : undefined),
    currentSchemaVersion: () => 'page.v2',
    migrations: [v1_to_v2_migration],
  };

  it('gatePasses is true when every record parses-as-is or is migratable', () => {
    const { results, gatePasses } = classifySiteRecords(
      [
        { objectType: 'page', objectId: 'page_home', schemaVersion: 'page.v2', body: { title: 'Home', tagline: 'x' } },
        { objectType: 'page', objectId: 'page_about', schemaVersion: 'page.v1', body: { title: 'About' } },
      ],
      resolvers
    );
    assert.strictEqual(gatePasses, true);
    assert.strictEqual(results[0]?.disposition.disposition, 'parses-as-is');
    assert.strictEqual(results[1]?.disposition.disposition, 'migratable');
  });

  it('a single blocked record fails the whole scan (gatePasses: false)', () => {
    const { results, gatePasses } = classifySiteRecords(
      [
        { objectType: 'page', objectId: 'page_home', schemaVersion: 'page.v2', body: { title: 'Home', tagline: 'x' } },
        { objectType: 'page', objectId: 'page_broken', schemaVersion: 'page.v9', body: { title: 'Broken' } },
      ],
      resolvers
    );
    assert.strictEqual(gatePasses, false);
    assert.strictEqual(results[1]?.disposition.disposition, 'blocked');
  });

  it('blocks a record whose objectType has no registered current schema at all', () => {
    const { results, gatePasses } = classifySiteRecords(
      [{ objectType: 'section', objectId: 'sec_x', schemaVersion: 'section.v1', body: {} }],
      resolvers
    );
    assert.strictEqual(gatePasses, false);
    assert.strictEqual(results[0]?.disposition.disposition, 'blocked');
    if (results[0]?.disposition.disposition === 'blocked') {
      assert.match(results[0].disposition.reason, /no current schema registered/);
    }
  });

  it('returns gatePasses: true for an empty record set (vacuously)', () => {
    const { results, gatePasses } = classifySiteRecords([], resolvers);
    assert.deepStrictEqual(results, []);
    assert.strictEqual(gatePasses, true);
  });
});
