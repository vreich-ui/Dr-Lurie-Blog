import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  emptyAgentKeysDoc,
  createAgentKey,
  revokeAgentKey,
  resolveVerifiedAgentName,
  hashAgentToken,
  mintAgentToken,
  describeAgentKeys,
  type AgentKeysDoc,
} from './agent-keys.js';

const NOW = '2026-07-24T00:00:00.000Z';
const LATER = '2026-07-24T01:00:00.000Z';

describe('mintAgentToken / hashAgentToken', () => {
  it('mints a unique, sufficiently long token each call', () => {
    const a = mintAgentToken();
    const b = mintAgentToken();
    assert.notStrictEqual(a, b);
    assert.ok(a.length >= 32, 'token should be long enough to resist guessing');
  });

  it('hashes deterministically (same input -> same hash) but never returns the raw token', () => {
    const token = 'a-fixed-test-token';
    const h1 = hashAgentToken(token);
    const h2 = hashAgentToken(token);
    assert.strictEqual(h1, h2);
    assert.notStrictEqual(h1, token);
  });
});

describe('createAgentKey / revokeAgentKey', () => {
  it('mints an active key, storing only the hash — never the raw token', () => {
    const doc = emptyAgentKeysDoc('owner@example.com', NOW);
    const {
      doc: next,
      token,
      record,
    } = createAgentKey(doc, {
      agent_name: 'draft-agent',
      site: 'site_drlurie',
      created_by: 'owner@example.com',
      now: NOW,
    });
    assert.strictEqual(record.status, 'active');
    assert.strictEqual(record.token_hash, hashAgentToken(token));
    assert.notStrictEqual(record.token_hash, token);
    assert.strictEqual(next.keys.length, 1);
    assert.strictEqual(next.keys[0], record);
  });

  it('auto-revokes a prior active key for the same (agent_name, site) — one active key invariant', () => {
    const doc = emptyAgentKeysDoc('owner@example.com', NOW);
    const first = createAgentKey(doc, {
      agent_name: 'draft-agent',
      site: 'site_drlurie',
      created_by: 'owner@example.com',
      now: NOW,
    });
    const second = createAgentKey(first.doc, {
      agent_name: 'draft-agent',
      site: 'site_drlurie',
      created_by: 'owner@example.com',
      now: LATER,
    });
    assert.strictEqual(second.doc.keys.length, 2);
    const [firstKey, secondKey] = second.doc.keys;
    assert.strictEqual(firstKey.status, 'revoked');
    assert.strictEqual(firstKey.revoked_at, LATER);
    assert.strictEqual(secondKey.status, 'active');
    // The OLD token must no longer verify once superseded.
    assert.strictEqual(resolveVerifiedAgentName(first.token, 'site_drlurie', second.doc), null);
    assert.strictEqual(resolveVerifiedAgentName(second.token, 'site_drlurie', second.doc), 'draft-agent');
  });

  it('does not revoke a same-named agent key scoped to a DIFFERENT site', () => {
    const doc = emptyAgentKeysDoc('owner@example.com', NOW);
    const acme = createAgentKey(doc, { agent_name: 'draft-agent', site: 'site_acme', created_by: 'o', now: NOW });
    const drlurie = createAgentKey(acme.doc, {
      agent_name: 'draft-agent',
      site: 'site_drlurie',
      created_by: 'o',
      now: LATER,
    });
    assert.strictEqual(resolveVerifiedAgentName(acme.token, 'site_acme', drlurie.doc), 'draft-agent');
    assert.strictEqual(resolveVerifiedAgentName(drlurie.token, 'site_drlurie', drlurie.doc), 'draft-agent');
  });

  it('revokeAgentKey turns off an active key; a second revoke is a harmless no-op', () => {
    const doc = emptyAgentKeysDoc('owner@example.com', NOW);
    const { doc: withKey, token } = createAgentKey(doc, {
      agent_name: 'draft-agent',
      site: 'site_drlurie',
      created_by: 'o',
      now: NOW,
    });
    const revoked = revokeAgentKey(withKey, {
      agent_name: 'draft-agent',
      site: 'site_drlurie',
      revoked_by: 'owner@example.com',
      now: LATER,
    });
    assert.strictEqual(revoked.keys[0]?.status, 'revoked');
    assert.strictEqual(resolveVerifiedAgentName(token, 'site_drlurie', revoked), null);

    const revokedAgain = revokeAgentKey(revoked, {
      agent_name: 'draft-agent',
      site: 'site_drlurie',
      revoked_by: 'owner@example.com',
      now: LATER,
    });
    assert.deepStrictEqual(revokedAgain.keys, revoked.keys);
  });
});

describe('resolveVerifiedAgentName — the adversarial cases T11.10 requires', () => {
  const buildDoc = (): { doc: AgentKeysDoc; token: string } => {
    const empty = emptyAgentKeysDoc('owner@example.com', NOW);
    const { doc, token } = createAgentKey(empty, {
      agent_name: 'draft-agent',
      site: 'site_drlurie',
      created_by: 'owner@example.com',
      now: NOW,
    });
    return { doc, token };
  };

  it('a forged agent_name with no matching token never verifies (returns null, not a name)', () => {
    const { doc } = buildDoc();
    assert.strictEqual(resolveVerifiedAgentName('totally-made-up-token', 'site_drlurie', doc), null);
  });

  it('a revoked key fails closed even when the exact correct token is presented', () => {
    const { doc, token } = buildDoc();
    const revoked = revokeAgentKey(doc, {
      agent_name: 'draft-agent',
      site: 'site_drlurie',
      revoked_by: 'owner@example.com',
      now: LATER,
    });
    assert.strictEqual(resolveVerifiedAgentName(token, 'site_drlurie', revoked), null);
  });

  it('a per-site key never crosses bindings — the exact right token fails for a different site', () => {
    const { doc, token } = buildDoc();
    assert.strictEqual(resolveVerifiedAgentName(token, 'site_acme', doc), null);
    assert.strictEqual(resolveVerifiedAgentName(token, 'site_drlurie', doc), 'draft-agent');
  });

  it('a null doc (governance store empty/unreadable) never verifies — fails closed, not open', () => {
    assert.strictEqual(resolveVerifiedAgentName('anything', 'site_drlurie', null), null);
  });

  it('an empty-string token never verifies, even against an empty-string hash edge case', () => {
    const { doc } = buildDoc();
    assert.strictEqual(resolveVerifiedAgentName('', 'site_drlurie', doc), null);
  });
});

describe('describeAgentKeys', () => {
  it('never surfaces token_hash in the read-model', () => {
    const empty = emptyAgentKeysDoc('owner@example.com', NOW);
    const { doc } = createAgentKey(empty, {
      agent_name: 'draft-agent',
      site: 'site_drlurie',
      created_by: 'owner@example.com',
      now: NOW,
    });
    const described = describeAgentKeys(doc);
    assert.strictEqual(described.length, 1);
    assert.strictEqual(Object.hasOwn(described[0] ?? {}, 'token_hash'), false);
    assert.strictEqual(described[0]?.agent_name, 'draft-agent');
  });

  it('returns [] for a null doc', () => {
    assert.deepStrictEqual(describeAgentKeys(null), []);
  });
});
