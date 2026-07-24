import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  findMigrationChain,
  applyMigrationChain,
  reverseChain,
  applyReverseChain,
  type SchemaMigration,
} from './registry.js';

// Synthetic three-version chain for one object type, reused across tests.
// v1 -> v2 adds a required field (with a default); v2 -> v3 renames it.
// Both hops are reversible so the reverse-chain tests can exercise the full
// round trip, plus a separate irreversible hop for the blocked-rollback case.
const v1_to_v2: SchemaMigration = {
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

const v2_to_v3: SchemaMigration = {
  objectType: 'page',
  from: 'page.v2',
  to: 'page.v3',
  description: 'rename `tagline` to `subtitle`',
  migrate: (body) => {
    const { tagline, ...rest } = body as Record<string, unknown>;
    return { ...rest, subtitle: tagline };
  },
  toPatchOps: (_old, newBody) => [
    { op: 'set_page_fields', fields: { subtitle: (newBody as { subtitle: string }).subtitle } },
  ],
  inverse: (body) => {
    const { subtitle, ...rest } = body as Record<string, unknown>;
    return { ...rest, tagline: subtitle };
  },
};

const irreversibleHop: SchemaMigration = {
  objectType: 'section',
  from: 'section.v1',
  to: 'section.v2',
  description: 'drop a deprecated field permanently (no way back)',
  migrate: (body) => {
    const { legacyFlag: _legacyFlag, ...rest } = body as Record<string, unknown>;
    return rest;
  },
  irreversible: true,
};

const CHAIN = [v1_to_v2, v2_to_v3];

describe('findMigrationChain', () => {
  it('returns an empty chain (found: true) when from === to — a no-op', () => {
    const result = findMigrationChain(CHAIN, 'page', 'page.v1', 'page.v1');
    assert.deepStrictEqual(result, { found: true, chain: [] });
  });

  it('finds a direct single-hop chain', () => {
    const result = findMigrationChain(CHAIN, 'page', 'page.v1', 'page.v2');
    assert.strictEqual(result.found, true);
    if (result.found) assert.deepStrictEqual(result.chain, [v1_to_v2]);
  });

  it('finds a multi-hop chain (v1 -> v2 -> v3) via BFS composition', () => {
    const result = findMigrationChain(CHAIN, 'page', 'page.v1', 'page.v3');
    assert.strictEqual(result.found, true);
    if (result.found) assert.deepStrictEqual(result.chain, [v1_to_v2, v2_to_v3]);
  });

  it('reports found: false with a reason when no path exists', () => {
    const result = findMigrationChain(CHAIN, 'page', 'page.v1', 'page.v9');
    assert.strictEqual(result.found, false);
    if (!result.found) {
      assert.match(result.reason, /no registered migration path/);
      assert.match(result.reason, /page\.v1/);
      assert.match(result.reason, /page\.v9/);
    }
  });

  it('scopes the search to the given objectType — a same-named version on another type is not reachable', () => {
    const result = findMigrationChain([...CHAIN, irreversibleHop], 'page', 'section.v1', 'section.v2');
    assert.strictEqual(result.found, false);
  });

  it('does not revisit an already-visited version (no infinite loop on a cyclic registry)', () => {
    const cyclic: SchemaMigration[] = [
      v1_to_v2,
      { ...v1_to_v2, from: 'page.v2', to: 'page.v1', description: 'cycle back' },
    ];
    const result = findMigrationChain(cyclic, 'page', 'page.v1', 'page.v3');
    assert.strictEqual(result.found, false);
  });
});

describe('applyMigrationChain', () => {
  it('runs an empty chain as identity', () => {
    const body = { title: 'Home' };
    assert.deepStrictEqual(applyMigrationChain(body, []), body);
  });

  it('threads a body through every migrate() in order', () => {
    const body = { title: 'Home' };
    const migrated = applyMigrationChain(body, CHAIN);
    assert.deepStrictEqual(migrated, { title: 'Home', subtitle: 'untitled' });
  });
});

describe('reverseChain / applyReverseChain', () => {
  it('reverses a fully-reversible chain into inverseChain order (last hop first)', () => {
    const result = reverseChain(CHAIN);
    assert.strictEqual(result.reversible, true);
    if (result.reversible) assert.deepStrictEqual(result.inverseChain, [v2_to_v3, v1_to_v2]);
  });

  it('round-trips a body through migrate then reverse back to the original shape', () => {
    const body = { title: 'Home' };
    const migrated = applyMigrationChain(body, CHAIN);
    const rolledBack = applyReverseChain(migrated, CHAIN);
    assert.deepStrictEqual(rolledBack, body);
  });

  it('is blocked at the first irreversible/no-inverse step walking backwards', () => {
    const chainWithIrreversibleTail = [v1_to_v2, irreversibleHop as unknown as SchemaMigration];
    const result = reverseChain(chainWithIrreversibleTail);
    assert.strictEqual(result.reversible, false);
    if (!result.reversible) assert.strictEqual(result.blockedAt, irreversibleHop);
  });

  it('is blocked when a step has no inverse but is not explicitly marked irreversible either', () => {
    const noInverseHop: SchemaMigration = {
      objectType: 'page',
      from: 'page.v3',
      to: 'page.v4',
      description: 'no inverse supplied, not marked irreversible',
      migrate: (body) => body,
    };
    const result = reverseChain([...CHAIN, noInverseHop]);
    assert.strictEqual(result.reversible, false);
    if (!result.reversible) assert.strictEqual(result.blockedAt, noInverseHop);
  });

  it('applyReverseChain throws a human-readable error naming the blocked hop', () => {
    assert.throws(
      () => applyReverseChain({ legacyFlag: true }, [irreversibleHop]),
      /cannot reverse.*section\.v1.*section\.v2.*irreversible/s
    );
  });
});
