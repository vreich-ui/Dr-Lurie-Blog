import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers
import assert from 'node:assert/strict';
import test from 'node:test';

import { retireObject } from '../../packages/core/server/lib/object-retire.js';
import { upsertRedirect, toNetlifyRedirectsFile } from '../../packages/core/server/lib/site-redirects.js';
import type { ObjectRecord } from '../../packages/core/schema/object-record-v1.js';

const NOW = Date.parse('2026-07-27T12:00:00.000Z');
const LOCK = {
  token: 'lock-1',
  agent_name: 'tester',
  acquired_at: '2026-07-27T11:55:00.000Z',
  expires_at: '2026-07-27T12:10:00.000Z',
};

const pageRecord = (overrides: Partial<ObjectRecord> = {}): ObjectRecord =>
  ({
    object_id: 'page_gone',
    object_type: 'page',
    schema_version: 'page.v1',
    site: 'site_drlurie',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    status: 'active',
    body: { pageType: 'system', route: '/old-offer', title: 'Old offer', seo: {}, sections: [] },
    publication: { published_time: '2026-07-02T00:00:00.000Z' },
    history: [],
    version: 4,
    content_revision: 2,
    lock: { ...LOCK },
    ...overrides,
  }) as ObjectRecord;

/** In-memory store matching the real get(string|null)/setJSON/delete shape. */
const createStore = (seed: ObjectRecord) => {
  const data = new Map<string, string>();
  data.set(`objects/page/by-id/${seed.object_id}.json`, JSON.stringify(seed));
  const deleted: string[] = [];
  return {
    data,
    deleted,
    get: async (key: string) => data.get(key) ?? null,
    setJSON: async (key: string, value: unknown) => {
      data.set(key, JSON.stringify(value));
      return undefined;
    },
    delete: async (key: string) => {
      deleted.push(key);
      data.delete(key);
      return undefined;
    },
  };
};

const commitOk = () => {
  const commits: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method === 'GET' && url.pathname.includes('/git/ref/heads/')) {
      return new Response(JSON.stringify({ object: { sha: 'head0' } }), { status: 200 });
    }
    if (method === 'GET' && url.pathname.includes('/git/commits/')) {
      return new Response(JSON.stringify({ tree: { sha: 'tree0' } }), { status: 200 });
    }
    if (method === 'POST' && url.pathname.endsWith('/git/blobs')) {
      return new Response(JSON.stringify({ sha: 'blob1' }), { status: 200 });
    }
    if (method === 'POST' && url.pathname.endsWith('/git/trees')) {
      commits.push(body);
      return new Response(JSON.stringify({ sha: 'tree1' }), { status: 200 });
    }
    if (method === 'POST' && url.pathname.endsWith('/git/commits')) {
      return new Response(JSON.stringify({ sha: 'commitA' }), { status: 200 });
    }
    if (method === 'PATCH' && url.pathname.includes('/git/refs/heads/')) {
      return new Response(JSON.stringify({ object: { sha: 'commitA' } }), { status: 200 });
    }
    return new Response('unexpected', { status: 500 });
  }) as typeof fetch;
  return { fetchImpl, commits };
};

const withGitEnv = async (fn: () => Promise<void>) => {
  const saved = { t: process.env.GITHUB_CONTENT_TOKEN, r: process.env.GITHUB_REPOSITORY };
  process.env.GITHUB_CONTENT_TOKEN = 'test-token';
  process.env.GITHUB_REPOSITORY = 'owner/name';
  try {
    await fn();
  } finally {
    if (saved.t === undefined) delete process.env.GITHUB_CONTENT_TOKEN;
    else process.env.GITHUB_CONTENT_TOKEN = saved.t;
    if (saved.r === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = saved.r;
  }
};

const baseInput = {
  object_type: 'page' as const,
  object_id: 'page_gone',
  lock_token: 'lock-1',
  actor: { kind: 'agent' as const, agent_name: 'tester', auth: 'publish_key' as const },
};
const baseDeps = (extra: Record<string, unknown> = {}) => ({
  nowMs: NOW,
  exportRoot: 'sites/drlurie/data/site',
  ...extra,
});

// ─── the rulings ─────────────────────────────────────────────────────────────

test('retire archives the record, removes its export, and redirects the route (Wolf rulings 1-3)', async () => {
  await withGitEnv(async () => {
    const store = createStore(pageRecord());
    const git = commitOk();

    const result = await retireObject(
      store,
      { ...baseInput, redirect_to: '/offers' },
      baseDeps({ fetchImpl: git.fetchImpl })
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.retired, true);
    assert.equal(result.body.status, 'archived');

    // Ruling 2: the EXPORT is removed, in the same commit.
    const tree = git.commits[0] as { tree: Array<{ path: string; sha: string | null }> };
    const deletion = tree.tree.find((entry) => entry.sha === null);
    assert.ok(deletion, 'the export must be deleted');
    assert.match(String(deletion.path), /page_gone\.json$/);

    // Ruling 3: the retired route forwards rather than 404ing.
    const redirectFile = tree.tree.find((entry) => String(entry.path).endsWith('redirects.json'));
    assert.ok(redirectFile, 'a redirect must be written for a retired page');
    assert.deepEqual(result.body.redirect, {
      from: '/old-offer',
      to: '/offers',
      status: 301,
      retired_object_id: 'page_gone',
      at: '2026-07-27T12:00:00.000Z',
    });

    // Ruling 1: archived, not destroyed — history and body survive.
    const stored = JSON.parse(store.data.get('objects/page/by-id/page_gone.json') as string) as ObjectRecord;
    assert.equal(stored.status, 'archived');
    assert.equal(stored.history.at(-1)?.action, 'retire');
    assert.ok(stored.body, 'the body is preserved for the grace period');

    // The status index moves so the purge sweep and inventory both see it.
    assert.ok(store.data.has('objects/page/index/by-status/archived/page_gone'));
    assert.ok(store.deleted.includes('objects/page/index/by-status/active/page_gone'));
  });
});

test('retire is refused while something still references the object', async () => {
  await withGitEnv(async () => {
    const store = createStore(pageRecord());
    const git = commitOk();

    const result = await retireObject(
      store,
      baseInput,
      baseDeps({ fetchImpl: git.fetchImpl, findReferrers: () => ['nav_header', 'page_home'] })
    );

    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'still_referenced');
    assert.deepEqual(result.body.referrers, ['nav_header', 'page_home']);
    assert.equal(git.commits.length, 0, 'nothing is committed when the retire is refused');
    const stored = JSON.parse(store.data.get('objects/page/by-id/page_gone.json') as string) as ObjectRecord;
    assert.equal(stored.status, 'active', 'the object stays live');
  });
});

test('retire requires the lock (423) and refuses over an open review (409)', async () => {
  await withGitEnv(async () => {
    const noLock = await retireObject(createStore(pageRecord({ lock: undefined })), baseInput, baseDeps());
    assert.equal(noLock.status, 423);

    const reviewed = pageRecord({ review: { state: 'open', decisions: [] } } as Partial<ObjectRecord>);
    const openReview = await retireObject(createStore(reviewed), baseInput, baseDeps());
    assert.equal(openReview.status, 409);
    assert.equal(openReview.body.code, 'review_open');
  });
});

test('the site singleton is not retirable', async () => {
  const store = createStore(pageRecord());
  const result = await retireObject(
    store,
    { ...baseInput, object_type: 'site', object_id: 'site_drlurie' },
    baseDeps()
  );
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'not_retirable');
});

test('retiring an already-archived object is idempotent, not an error', async () => {
  const store = createStore(pageRecord({ status: 'archived' }));
  const result = await retireObject(store, baseInput, baseDeps());
  assert.equal(result.status, 200);
  assert.equal(result.body.already_archived, true);
});

test('a failed export removal leaves the object live and active (reader-safe direction)', async () => {
  await withGitEnv(async () => {
    const store = createStore(pageRecord());
    const failing = (async () => new Response('boom', { status: 500 })) as typeof fetch;

    const result = await retireObject(store, baseInput, baseDeps({ fetchImpl: failing }));

    assert.ok(result.status >= 400);
    const stored = JSON.parse(store.data.get('objects/page/by-id/page_gone.json') as string) as ObjectRecord;
    assert.equal(stored.status, 'active', 'the record is only archived AFTER the export is gone');
  });
});

// ─── redirect table semantics ────────────────────────────────────────────────

test('the redirect table keeps one rule per route and stays sorted', () => {
  const first = upsertRedirect([], { from: '/b', to: '/', status: 301 });
  const second = upsertRedirect(first, { from: '/a', to: '/', status: 301 });
  const replaced = upsertRedirect(second, { from: '/b', to: '/new', status: 301 });

  assert.deepEqual(
    replaced.map((entry) => [entry.from, entry.to]),
    [
      ['/a', '/'],
      ['/b', '/new'],
    ]
  );
});

test('the table renders as a Netlify _redirects file', () => {
  const file = toNetlifyRedirectsFile([
    { from: '/old', to: '/new', status: 301 },
    { from: '/gone', to: '/', status: 301 },
  ]);
  assert.equal(file, '/old  /new  301\n/gone  /  301');
});
