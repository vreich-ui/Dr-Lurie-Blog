import assert from 'node:assert/strict';
import test from 'node:test';

import { askAiForObject, type AskAiObjectStore } from '../../netlify/lib/ask-ai-object.js';
import { handleObjectVerb, type ObjectVerbStore } from '../../netlify/lib/object-verbs.js';
import { objectRecordKey } from '../../netlify/lib/object-store-keys.js';
import type { ObjectRecord, Principal } from '../../packages/core/schema/object-record-v1.js';

const NOW = Date.parse('2026-07-06T12:00:00.000Z');
const AGENT: Principal = { kind: 'agent', agent_name: 'draft-agent', auth: 'publish_key' };

const siteRecord = (): ObjectRecord => ({
  object_id: 'site_drlurie',
  object_type: 'site',
  schema_version: 'site.v1',
  site: 'site_drlurie',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  status: 'active',
  body: {
    name: 'Dr. Lurié',
    logo: { text: 'Dr. Lurié' },
    urls: { base: 'https://drlurie.com', canonicalHost: 'drlurie.com' },
    metadataDefaults: { titleTemplate: '%s', description: 'Old description.', ogImage: '/og.png' },
    brandTokens: { colors: { primary: '#000' }, fonts: { sans: 'Inter', serif: 'Georgia', heading: 'Inter' } },
    chrome: { showRssFeed: true, showThemeToggle: true },
    defaultNavigation: { header: 'nav_header', footer: 'nav_footer' },
    blog: { listPath: '/blog', postsPerPage: 10, categoryBase: '/category', tagBase: '/tag' },
  },
  publication: { published_time: null },
  history: [{ at: '2026-07-01T00:00:00.000Z', action: 'object_create', actor: AGENT }],
  version: 3,
  content_revision: 2,
});

// In-memory store shared by the read-only Ask-AI core and the object-verb
// dispatcher, so the routing test exercises both against the same blobs.
const createStore = () => {
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
    seed(record: ObjectRecord) {
      blobs.set(objectRecordKey(record.object_type, record.object_id), JSON.stringify(record));
    },
    read(record: Pick<ObjectRecord, 'object_type' | 'object_id'>): ObjectRecord {
      return JSON.parse(blobs.get(objectRecordKey(record.object_type, record.object_id)) as string) as ObjectRecord;
    },
  };
};

/** A fake OpenAI that records the forced function it was handed and returns a fixed structured suggestion. */
const openAiMock = (suggestion: Record<string, unknown>) => {
  const calls: Array<{ toolName: string; toolSchema: unknown; userMessage: string }> = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as {
      tools: Array<{ function: { name: string; parameters: unknown } }>;
      messages: Array<{ content: string }>;
    };
    calls.push({
      toolName: payload.tools[0].function.name,
      toolSchema: payload.tools[0].function.parameters,
      userMessage: payload.messages[0].content,
    });
    // OpenAI returns tool-call arguments as a JSON STRING.
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  type: 'function',
                  function: { name: payload.tools[0].function.name, arguments: JSON.stringify(suggestion) },
                },
              ],
            },
          },
        ],
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  return { fetchImpl, calls };
};

const deps = (fetchImpl: typeof fetch) => ({ apiKey: 'test-key', model: 'gpt-test', fetchImpl });

test('returns a null-stripped suggestion derived from the object body schema', async () => {
  const store = createStore();
  store.seed(siteRecord());
  const openai = openAiMock({
    metadataDefaults: { titleTemplate: '%s', description: 'A calmer, clearer description.', ogImage: '/og.png' },
    name: null, // must be stripped
  });

  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'site', object_id: 'site_drlurie', instruction: 'Make the description calmer.' },
    deps(openai.fetchImpl)
  );

  assert.equal(result.status, 200);
  const suggestion = result.body.suggestion as Record<string, unknown>;
  assert.ok('metadataDefaults' in suggestion);
  assert.equal('name' in suggestion, false, 'null values must be stripped');
  assert.equal(result.body.applied, false);

  // The forced tool schema was derived from site.v1's zod (partial): it exposes
  // the body fields and is not required.
  assert.equal(openai.calls.length, 1);
  const toolSchema = openai.calls[0].toolSchema as Record<string, unknown>;
  assert.equal((toolSchema.properties as Record<string, unknown>).metadataDefaults !== undefined, true);
  assert.equal(toolSchema.required, undefined);
});

// ── acceptance criterion #2 ──────────────────────────────────────────────────
test('the Ask-AI call is read-only and its suggestion lands in review-state via object_patch, not a direct write', async () => {
  const store = createStore();
  store.seed(siteRecord());
  const before = store.read({ object_type: 'site', object_id: 'site_drlurie' });

  const openai = openAiMock({
    metadataDefaults: { titleTemplate: '%s', description: 'A calmer, clearer description.', ogImage: '/og.png' },
  });
  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'site', object_id: 'site_drlurie', instruction: 'Calmer description.' },
    deps(openai.fetchImpl)
  );
  assert.equal(result.status, 200);

  // Read-only: the Ask-AI call itself wrote nothing.
  assert.deepEqual(
    store.read({ object_type: 'site', object_id: 'site_drlurie' }),
    before,
    'Ask-AI must not mutate the record'
  );

  // The suggestion is applied ONLY through the reviewable path: check out, then
  // object_patch with set_site_fields carrying the suggestion. That verb is
  // what records the change in history as a discardable proposal (T1.4/C§2.4)
  // and bumps content_revision — there is no direct-write path from Ask-AI.
  const checkout = await handleObjectVerb(
    store as unknown as ObjectVerbStore,
    { action: 'checkout', object_type: 'site', object_id: 'site_drlurie' },
    AGENT,
    { nowMs: NOW }
  );
  assert.equal(checkout.status, 200);
  const lockToken = checkout.body.lockToken as string;
  const locked = store.read({ object_type: 'site', object_id: 'site_drlurie' });

  const patch = await handleObjectVerb(
    store as unknown as ObjectVerbStore,
    {
      action: 'patch',
      object_type: 'site',
      object_id: 'site_drlurie',
      lock_token: lockToken,
      expected_record_version: locked.version,
      ops: [{ op: 'set_site_fields', fields: result.body.suggestion }],
    },
    AGENT,
    { nowMs: NOW }
  );
  assert.equal(patch.status, 200, JSON.stringify(patch.body));

  const after = store.read({ object_type: 'site', object_id: 'site_drlurie' });
  // The applied change is captured in history as a review proposal (the exact
  // {op, capture} shape the review surfaces render and discard can invert).
  const lastEntry = after.history[after.history.length - 1];
  assert.equal(lastEntry.action, 'set_site_fields');
  const details = lastEntry.details as { op: { op: string }; capture: { kind: string } };
  assert.equal(details.op.op, 'set_site_fields');
  assert.equal(details.capture.kind, 'fields');
  assert.equal(after.content_revision, before.content_revision + 1, 'the reviewable patch bumps content_revision');
  assert.equal(
    (after.body as { metadataDefaults: { description: string } }).metadataDefaults.description,
    'A calmer, clearer description.'
  );
});

test('selection UX: a highlighted span is forwarded; whole-object fallback omits it', async () => {
  const store = createStore();
  store.seed(siteRecord());

  const withSelection = openAiMock({ name: 'Dr. Lurié Science' });
  await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'site', object_id: 'site_drlurie', selected_text: 'Dr. Lurié', instruction: 'Add "Science".' },
    deps(withSelection.fetchImpl)
  );
  assert.match(withSelection.calls[0].userMessage, /highlighted this specific span/);
  assert.match(withSelection.calls[0].userMessage, /Dr\. Lurié/);

  const wholeObject = openAiMock({ name: 'Dr. Lurié Science' });
  await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'site', object_id: 'site_drlurie', instruction: 'Revise the whole object.' },
    deps(wholeObject.fetchImpl)
  );
  assert.doesNotMatch(wholeObject.calls[0].userMessage, /highlighted this specific span/);
});

// ── article node scope (W7.8): the canvas asks one node at a time ────────────

const articleRecord = (): ObjectRecord => ({
  object_id: 'req_agent_barrier_myths_20260713_01',
  object_type: 'content_item',
  schema_version: 'content_item.v1',
  site: 'site_drlurie',
  created_at: '2026-07-13T00:00:00.000Z',
  updated_at: '2026-07-13T00:00:00.000Z',
  status: 'active',
  body: {
    slug: 'barrier-myths',
    title: 'Five barrier myths',
    nodes: [
      {
        id: 'n_a1',
        kind: 'content',
        public: { title: 'The myth', body: 'Everyone repeats it.', ctaText: 'Read on', ctaLink: '/start-here' },
        private: { strategy: 'hook', intent: 'persuade' },
      },
      {
        id: 'n_a2',
        kind: 'content',
        public: {
          body: {
            nodeType: 'document',
            data: {},
            content: [
              {
                nodeType: 'paragraph',
                data: {},
                content: [{ nodeType: 'text', value: 'Rich body.', marks: [], data: {} }],
              },
            ],
          },
        },
      },
    ],
  },
  publication: { published_time: null },
  history: [{ at: '2026-07-13T00:00:00.000Z', action: 'object_create', actor: AGENT }],
  version: 2,
  content_revision: 1,
});

test('node-scoped ask: tool is the node PUBLIC copy grammar; role flows into the prompt, never the suggestion', async () => {
  const store = createStore();
  store.seed(articleRecord());
  const openai = openAiMock({
    title: 'The myth everyone repeats',
    body: 'A sharper opening.',
    ctaLink: 'https://evil.example/phish', // protected — must be stripped
    media: { type: 'image', src: 'https://made-up.example/x.png' }, // non-copy — must be stripped
  });

  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    {
      object_type: 'content_item',
      object_id: 'req_agent_barrier_myths_20260713_01',
      node_id: 'n_a1',
      instruction: 'Sharpen the hook.',
    },
    deps(openai.fetchImpl)
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.node_id, 'n_a1');
  assert.equal(result.body.node_kind, 'content');
  const suggestion = result.body.suggestion as Record<string, unknown>;
  assert.deepEqual(suggestion, { title: 'The myth everyone repeats', body: 'A sharper opening.' });

  // The forced tool: node public grammar with protected fields removed.
  assert.equal(openai.calls[0].toolName, 'propose_node_changes');
  const properties = (openai.calls[0].toolSchema as { properties: Record<string, unknown> }).properties;
  assert.ok('title' in properties && 'body' in properties);
  assert.equal('media' in properties, false, 'media is protected out of the tool schema');
  assert.equal('ctaLink' in properties, false, 'ctaLink is protected out of the tool schema');
  // The node's editorial role is prompt CONTEXT (write copy for a hook)...
  assert.match(openai.calls[0].userMessage, /hook/);
  // ...and annotations are never part of the copy the model may return.
  assert.equal('private' in properties, false);
});

test('node-scoped ask: a rich_text document body is excluded from the tool (no flattening)', async () => {
  const store = createStore();
  store.seed(articleRecord());
  const openai = openAiMock({ body: 'flattened!' });
  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    {
      object_type: 'content_item',
      object_id: 'req_agent_barrier_myths_20260713_01',
      node_id: 'n_a2',
      instruction: 'Rewrite.',
    },
    deps(openai.fetchImpl)
  );
  assert.equal(result.status, 200);
  const properties = (openai.calls[0].toolSchema as { properties: Record<string, unknown> }).properties;
  assert.equal('body' in properties, false, 'a document body is not plain-text editable');
});

test('node scope pairing rules: node_id needs content_item; ghost nodes 404', async () => {
  const store = createStore();
  store.seed(siteRecord());
  store.seed(articleRecord());
  const openai = openAiMock({});
  const wrongType = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'site', object_id: 'site_drlurie', node_id: 'n_a1', instruction: 'x' },
    deps(openai.fetchImpl)
  );
  assert.equal(wrongType.status, 400);
  assert.equal(wrongType.body.code, 'node_scope_unsupported');

  const ghost = await askAiForObject(
    store as unknown as AskAiObjectStore,
    {
      object_type: 'content_item',
      object_id: 'req_agent_barrier_myths_20260713_01',
      node_id: 'n_zz',
      instruction: 'x',
    },
    deps(openai.fetchImpl)
  );
  assert.equal(ghost.status, 404);
  assert.equal(openai.calls.length, 0, 'no AI call for refused requests');
});

test('a missing object 404s without calling the model', async () => {
  const store = createStore();
  const openai = openAiMock({});
  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'navigation', object_id: 'nav_ghost', instruction: 'x' },
    deps(openai.fetchImpl)
  );
  assert.equal(result.status, 404);
  assert.equal(openai.calls.length, 0);
});

test('an OpenAI error surfaces as 502 and still writes nothing', async () => {
  const store = createStore();
  store.seed(siteRecord());
  const before = store.read({ object_type: 'site', object_id: 'site_drlurie' });
  const fetchImpl = (async () => new Response('overloaded', { status: 529 })) as typeof fetch;

  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'site', object_id: 'site_drlurie', instruction: 'x' },
    deps(fetchImpl)
  );
  assert.equal(result.status, 502);
  assert.deepEqual(store.read({ object_type: 'site', object_id: 'site_drlurie' }), before);
});
