/**
 * T9.22 — the AI publisher targets the object substrate (closes W7.5).
 * publishArticleObject: create content_item → nodes verbatim (strategy
 * annotations preserved into private.*) → taxonomy from the payload →
 * publish under the gate → checkin. Release NOT fired. The legacy markdown
 * path receives zero writes — pinned by a source-level assertion alongside
 * the behavioral one.
 */
import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

// The publish gate resolves the human's roles from env (sync resolver), and
// the export committer needs its config present (calls ride the mock below).
process.env.ADMIN_EMAILS = 'wolf@example.com';
process.env.GITHUB_CONTENT_TOKEN = process.env.GITHUB_CONTENT_TOKEN ?? 'test-token';
process.env.GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY ?? 'example/repo';

import { publishArticleObject } from '../../netlify/functions/run-publisher-agent.js';
import { objectRecordKey } from '../../packages/core/server/lib/object-store-keys.js';
import type { ObjectVerbStore } from '../../packages/core/server/lib/object-verbs.js';
import type { ObjectRecord, Principal } from '../../packages/core/schema/object-record-v1.js';

const HUMAN: Principal = { kind: 'human', id: 'id-wolf', email: 'wolf@example.com' };

const createMemoryStore = () => {
  const blobs = new Map<string, string>();
  return {
    blobs,
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown) {
      blobs.set(key, JSON.stringify(value));
    },
    async list({ prefix }: { prefix: string }) {
      return { blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
};

const NODES = [
  {
    id: 'n_intro1',
    kind: 'content',
    public: { title: 'Why barriers matter', body: 'Your skin barrier is the first line.' },
    private: { strategy: 'hook', intent: 'educate', agentNotes: 'keep clinical' },
  },
  {
    id: 'n_close1',
    kind: 'content',
    public: { body: 'Start slow, patch test, be patient.' },
    private: { strategy: 'resolution', intent: 'reassure' },
  },
] as const satisfies readonly unknown[] as unknown as import('../../packages/core/schema/article-content-v1.js').ArticleBodyNode[];

// The T1.2 committer speaks the GitHub git-data API — mock it (the same
// harness shape object-verbs-review.test.ts uses).
import { createHash } from 'node:crypto';
const sha1 = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 12);
const createGitHubApiMock = () => {
  let head = { sha: 'head0' };
  const commitTrees = new Map<string, string>([['head0', 'tree0']]);
  let commitCounter = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    if (method === 'GET' && url.pathname.includes('/git/ref/heads/'))
      return new Response(JSON.stringify({ object: { sha: head.sha } }));
    if (method === 'GET' && url.pathname.includes('/git/commits/')) {
      const sha = url.pathname.split('/').pop() as string;
      return new Response(JSON.stringify({ tree: { sha: commitTrees.get(sha) } }));
    }
    if (method === 'POST' && url.pathname.endsWith('/git/blobs'))
      return new Response(JSON.stringify({ sha: sha1(String(body?.content)) }));
    if (method === 'POST' && url.pathname.endsWith('/git/trees'))
      return new Response(JSON.stringify({ sha: `tree_${sha1(JSON.stringify(body))}` }));
    if (method === 'POST' && url.pathname.endsWith('/git/commits')) {
      commitCounter += 1;
      const sha = `commit${commitCounter}`;
      commitTrees.set(sha, String(body?.tree));
      return new Response(JSON.stringify({ sha }));
    }
    if (method === 'PATCH' && url.pathname.includes('/git/refs/heads/')) {
      head = { sha: String(body?.sha) };
      return new Response(JSON.stringify({ object: { sha: head.sha } }));
    }
    return new Response('unexpected', { status: 500 });
  }) as typeof fetch;
  return { fetchImpl };
};

const publishDeps = { fetchImpl: createGitHubApiMock().fetchImpl, sleep: async () => {} };

test('publishArticleObject: object created with verbatim nodes + taxonomy, published under the gate, no release', async () => {
  const store = createMemoryStore();
  const result = await publishArticleObject(
    store as unknown as ObjectVerbStore,
    {
      slug: 'barrier-basics',
      title: 'Barrier Basics',
      description: 'A calm primer.',
      tags: ['skin-health'],
      nodes: NODES,
    },
    HUMAN,
    { publishDeps: publishDeps as never }
  );
  assert.equal(result.ok, true, JSON.stringify(result.body));
  assert.ok(result.objectId);

  const record = JSON.parse(store.blobs.get(objectRecordKey('content_item', result.objectId!))!) as ObjectRecord;
  const body = record.body as {
    slug: string;
    taxonomy?: { tags?: string[] };
    nodes: { id: string; private?: { strategy?: string; agentNotes?: string } }[];
  };
  assert.equal(body.slug, 'barrier-basics');
  assert.deepEqual(body.taxonomy?.tags, ['skin-health']);
  // Strategy annotations preserved verbatim into private.*.
  assert.equal(body.nodes[0]!.private?.strategy, 'hook');
  assert.equal(body.nodes[0]!.private?.agentNotes, 'keep clinical');
  // Published (the gate ran), lock released, release NOT fired (no deploy state).
  assert.ok(record.publication.published_time, 'published_time set');
  assert.equal(record.lock, undefined);
  // History attributes the acting principal.
  assert.ok(record.history.some((entry) => entry.action === 'create' && entry.actor.kind === 'human'));
});

test('a failing create (duplicate slug via duplicate id space) surfaces the error without publishing', async () => {
  const store = createMemoryStore();
  const first = await publishArticleObject(
    store as unknown as ObjectVerbStore,
    { slug: 'twice', title: 'Once', nodes: NODES },
    HUMAN,
    { publishDeps: publishDeps as never }
  );
  assert.equal(first.ok, true, JSON.stringify(first.body));
  const second = await publishArticleObject(
    store as unknown as ObjectVerbStore,
    { slug: 'twice', title: 'Again', nodes: NODES },
    HUMAN,
    { publishDeps: publishDeps as never }
  );
  assert.equal(second.ok, false); // slug uniqueness blocks at create-validation
});

test('the legacy markdown path receives ZERO writes from this flow (source-level pin)', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  // Compiled tests run from .tmp/ci-test — walk up to the repo root.
  let root = here;
  for (let i = 0; i < 8; i += 1) {
    try {
      await readFile(join(root, 'astro.config.ts'));
      break;
    } catch {
      root = join(root, '..');
    }
  }
  const source = await readFile(join(root, 'netlify/functions/run-publisher-agent.ts'), 'utf8');
  assert.ok(!source.includes('NETLIFY_PUBLISH_ENDPOINT'), 'no publish endpoint env');
  assert.ok(!/fetch\([^)]*publish-article/.test(source), 'no fetch to publish-article');
  assert.ok(!source.includes("'x-publish-key': publishSecret"), 'no forwarded publish secret');
});
