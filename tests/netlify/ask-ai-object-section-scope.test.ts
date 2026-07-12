import assert from 'node:assert/strict';
import test from 'node:test';

import { askAiForObject, type AskAiObjectStore } from '../../netlify/lib/ask-ai-object.js';
import { sectionDataSchemaForType } from '../../netlify/lib/ask-ai-schema.js';
import { handleObjectVerb, type ObjectVerbStore } from '../../netlify/lib/object-verbs.js';
import { objectRecordKey } from '../../netlify/lib/object-store-keys.js';
import type { ObjectRecord, Principal } from '../../src/schema/object-record-v1.js';

const NOW = Date.parse('2026-07-12T12:00:00.000Z');
const AGENT: Principal = { kind: 'agent', agent_name: 'canvas-agent', auth: 'publish_key' };

const PROSE_HTML = '<p>Skin behaves differently after 60. Barrier first, actives second.</p>';

const pageRecord = (): ObjectRecord => ({
  object_id: 'page_canvas_demo',
  object_type: 'page',
  schema_version: 'page.v1',
  site: 'site_drlurie',
  created_at: '2026-07-10T00:00:00.000Z',
  updated_at: '2026-07-10T00:00:00.000Z',
  status: 'active',
  body: {
    route: '/canvas-demo',
    pageType: 'standard',
    title: 'Canvas demo page',
    seo: { description: 'Demo.' },
    sections: [
      {
        id: 's_lede',
        type: 'lede',
        data: {
          heading: 'Why skin changes after 60',
          body: '<p>Most advice is written for younger skin.</p>',
          actions: [],
        },
      },
      { id: 's_prose', type: 'prose', data: { body: PROSE_HTML } },
      { id: 's_news', type: 'shared_ref', data: { section: 'sec_newsletter_signup' } },
    ],
  },
  publication: { published_time: null },
  history: [{ at: '2026-07-10T00:00:00.000Z', action: 'create', actor: AGENT }],
  version: 2,
  content_revision: 1,
});

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

const openAiMock = (suggestion: Record<string, unknown>) => {
  const calls: Array<{ toolName: string; toolSchema: Record<string, unknown>; userMessage: string }> = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as {
      tools: Array<{ function: { name: string; parameters: Record<string, unknown> } }>;
      messages: Array<{ content: string }>;
    };
    calls.push({
      toolName: payload.tools[0].function.name,
      toolSchema: payload.tools[0].function.parameters,
      userMessage: payload.messages[0].content,
    });
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

test('section scope: the tool is the SECTION data grammar, not the page body', async () => {
  const store = createStore();
  store.seed(pageRecord());
  const openai = openAiMock({ body: '<p>Warmer, more direct copy.</p>' });

  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'page', object_id: 'page_canvas_demo', section_id: 's_prose', instruction: 'Warmer voice.' },
    deps(openai.fetchImpl)
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.section_id, 's_prose');
  assert.equal(result.body.section_type, 'prose');
  assert.equal(result.body.applied, false);
  assert.deepEqual(result.body.suggestion, { body: '<p>Warmer, more direct copy.</p>' });

  assert.equal(openai.calls.length, 1);
  assert.equal(openai.calls[0].toolName, 'propose_section_changes');
  const properties = openai.calls[0].toolSchema.properties as Record<string, unknown>;
  assert.ok('body' in properties, 'the prose data field is exposed');
  assert.equal('sections' in properties, false, 'the page body grammar must NOT leak into a section scope');
  assert.equal(openai.calls[0].toolSchema.required, undefined, 'partial: nothing is required');

  // The prompt shows the SECTION, framed by its page — not the whole page body.
  assert.match(openai.calls[0].userMessage, /ONE SECTION of the page "Canvas demo page"/);
  assert.match(openai.calls[0].userMessage, /Skin behaves differently after 60/);
  assert.doesNotMatch(openai.calls[0].userMessage, /s_lede/, 'sibling sections are not serialized');
});

test('section scope round-trip: the suggestion applies as update_section_data under lock', async () => {
  const store = createStore();
  store.seed(pageRecord());
  const before = store.read({ object_type: 'page', object_id: 'page_canvas_demo' });

  const openai = openAiMock({ body: '<p>Warmer, more direct copy.</p>' });
  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'page', object_id: 'page_canvas_demo', section_id: 's_prose', instruction: 'Warmer voice.' },
    deps(openai.fetchImpl)
  );
  assert.equal(result.status, 200);
  assert.deepEqual(store.read({ object_type: 'page', object_id: 'page_canvas_demo' }), before, 'Ask-AI is read-only');

  const checkout = await handleObjectVerb(
    store as unknown as ObjectVerbStore,
    { action: 'checkout', object_type: 'page', object_id: 'page_canvas_demo' },
    AGENT,
    { nowMs: NOW }
  );
  assert.equal(checkout.status, 200);
  const locked = store.read({ object_type: 'page', object_id: 'page_canvas_demo' });

  const patch = await handleObjectVerb(
    store as unknown as ObjectVerbStore,
    {
      action: 'patch',
      object_type: 'page',
      object_id: 'page_canvas_demo',
      lock_token: checkout.body.lockToken as string,
      expected_record_version: locked.version,
      ops: [{ op: 'update_section_data', section_id: 's_prose', fields: result.body.suggestion }],
    },
    AGENT,
    { nowMs: NOW }
  );
  assert.equal(patch.status, 200, JSON.stringify(patch.body));

  const after = store.read({ object_type: 'page', object_id: 'page_canvas_demo' });
  const prose = (after.body as { sections: Array<{ id: string; data: { body: string } }> }).sections.find(
    (section) => section.id === 's_prose'
  );
  assert.equal(prose?.data.body, '<p>Warmer, more direct copy.</p>');
  assert.equal(after.content_revision, before.content_revision + 1);
});

test('a shared_ref section is refused with the target object id — never edited through the page', async () => {
  const store = createStore();
  store.seed(pageRecord());
  const openai = openAiMock({});

  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'page', object_id: 'page_canvas_demo', section_id: 's_news', instruction: 'x' },
    deps(openai.fetchImpl)
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'section_is_shared_ref');
  assert.equal(result.body.shared_object_id, 'sec_newsletter_signup');
  assert.equal(openai.calls.length, 0, 'no AI call for a refused scope');
});

test('a missing section 404s; a non-page type refuses section scope', async () => {
  const store = createStore();
  store.seed(pageRecord());
  const openai = openAiMock({});

  const missing = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'page', object_id: 'page_canvas_demo', section_id: 's_ghost', instruction: 'x' },
    deps(openai.fetchImpl)
  );
  assert.equal(missing.status, 404);

  const wrongType = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'site', object_id: 'site_drlurie', section_id: 's_prose', instruction: 'x' },
    deps(openai.fetchImpl)
  );
  assert.equal(wrongType.status, 400);
  assert.equal(wrongType.body.code, 'section_scope_unsupported');
  assert.equal(openai.calls.length, 0);
});

test('sectionDataSchemaForType serves every registered union member and nothing else', () => {
  assert.ok(sectionDataSchemaForType('prose'));
  assert.ok(sectionDataSchemaForType('hero'));
  assert.ok(sectionDataSchemaForType('shared_ref'), 'the member exists (the scope path refuses it earlier)');
  assert.equal(sectionDataSchemaForType('not_a_type'), undefined);
});

test('a shared SECTION OBJECT auto-scopes to its inner instance — inner grammar, inner id', async () => {
  const store = createStore();
  const sectionObject: ObjectRecord = {
    object_id: 'sec_newsletter_signup',
    object_type: 'section',
    schema_version: 'section.v1',
    site: 'site_drlurie',
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T00:00:00.000Z',
    status: 'active',
    body: {
      section: {
        id: 's_signup',
        type: 'newsletter_signup',
        data: { formName: 'newsletter', heading: 'Learn about healthy skin.' },
      },
    },
    publication: { published_time: null },
    history: [{ at: '2026-07-10T00:00:00.000Z', action: 'create', actor: AGENT }],
    version: 1,
    content_revision: 1,
  };
  store.seed(sectionObject);
  const openai = openAiMock({ heading: 'One useful skin letter a month.' });

  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'section', object_id: 'sec_newsletter_signup', instruction: 'Friendlier heading.' },
    deps(openai.fetchImpl)
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.section_id, 's_signup', 'the INNER instance id — what update_section_data targets');
  assert.equal(result.body.section_type, 'newsletter_signup');
  assert.deepEqual(result.body.suggestion, { heading: 'One useful skin letter a month.' });

  assert.equal(openai.calls[0].toolName, 'propose_section_changes');
  const properties = openai.calls[0].toolSchema.properties as Record<string, unknown>;
  assert.ok('heading' in properties, 'the inner copy grammar, not the wrapper');
  assert.equal('section' in properties, false, 'the wrapper must not leak');
  assert.equal('formName' in properties, false, 'formName is a form binding (protected), not copy');
  assert.match(openai.calls[0].userMessage, /shared section object "sec_newsletter_signup"/);
  assert.match(openai.calls[0].userMessage, /every page that references it/);
});

test('a hallucinated image field is dropped — a copy edit can never change the portrait (About-portrait incident)', async () => {
  const store = createStore();
  const bioObject: ObjectRecord = {
    object_id: 'sec_about_intro',
    object_type: 'section',
    schema_version: 'section.v1',
    site: 'site_drlurie',
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T00:00:00.000Z',
    status: 'active',
    body: {
      section: {
        id: 's_bio',
        type: 'bio',
        data: {
          heading: 'Dr. Leonid Lurie: the scientist behind the approach',
          body: '<p>Physician-scientist lens.</p>',
          trustNotes: ['MD, PhD in Biophysics.'],
          portrait: { alt: 'Portrait of Dr. Leonid Lurie', src: '/images/dr-lurie-portrait4.jpeg' },
        },
      },
    },
    publication: { published_time: null },
    history: [{ at: '2026-07-10T00:00:00.000Z', action: 'create', actor: AGENT }],
    version: 1,
    content_revision: 1,
  };
  store.seed(bioObject);

  // The model over-reaches: asked to tweak the heading, it ALSO returns a
  // hallucinated portrait URL (exactly the real incident). The tool schema
  // excludes portrait, and the defensive strip drops it if returned anyway.
  const openai = openAiMock({
    heading: 'Dr. Leonid Lurie, Ph.D: the scientist behind the approach',
    portrait: {
      alt: 'Portrait of Dr. Leonid Lurie',
      src: 'https://kugelmedia.netlify.app/drlurieblog/dr-lurie-portrait.jpg',
    },
    portraitAssetRef: 'made-up-ref',
  });

  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'section', object_id: 'sec_about_intro', instruction: 'Add Ph.D to the heading.' },
    deps(openai.fetchImpl)
  );

  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.suggestion,
    { heading: 'Dr. Leonid Lurie, Ph.D: the scientist behind the approach' },
    'only the heading survives — the image fields are stripped'
  );
  const properties = openai.calls[0].toolSchema.properties as Record<string, unknown>;
  assert.equal('portrait' in properties, false, 'the model was never offered the portrait field');
  assert.equal('portraitAssetRef' in properties, false, 'nor the asset ref');
});

test('copy-only drops STRUCTURED fields (arrays of objects) so a copy edit cannot repoint nested references', async () => {
  // A pricing_table stores product refs inside tiers[].product — a container
  // key ("tiers") that is not itself protected. A copy edit must not be able
  // to return it (Codex #423): text survives, structure is dropped.
  const store = createStore();
  const pageWithTable: ObjectRecord = {
    ...pageRecord(),
    object_id: 'page_pricing_demo',
    body: {
      route: '/pricing-demo',
      pageType: 'standard',
      title: 'Pricing demo',
      seo: {},
      sections: [
        {
          id: 's_pricing',
          type: 'pricing_table',
          data: { heading: 'Plans', tiers: [{ product: 'prod_a', features: ['x'] }] },
        },
      ],
    },
  };
  store.seed(pageWithTable);

  const openai = openAiMock({
    heading: 'Simple, honest pricing',
    tiers: [{ product: 'prod_HALLUCINATED', features: ['x'] }],
  });
  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    {
      object_type: 'page',
      object_id: 'page_pricing_demo',
      section_id: 's_pricing',
      instruction: 'Warmer pricing copy.',
    },
    deps(openai.fetchImpl)
  );

  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.suggestion,
    { heading: 'Simple, honest pricing' },
    'only the heading text survives — the tiers container (with its product ref) is dropped'
  );
});

test('copy-only keeps string arrays (checklist/feature copy) but drops arrays of objects', async () => {
  const store = createStore();
  const page: ObjectRecord = {
    ...pageRecord(),
    object_id: 'page_list_demo',
    body: {
      route: '/list-demo',
      pageType: 'standard',
      title: 'List demo',
      seo: {},
      sections: [{ id: 's_check', type: 'checklist', data: { heading: 'For you if', items: ['a', 'b'] } }],
    },
  };
  store.seed(page);
  const openai = openAiMock({ heading: 'This is for you if…', items: ['clearer', 'calmer', 'kinder'] });
  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'page', object_id: 'page_list_demo', section_id: 's_check', instruction: 'Punch up the list.' },
    deps(openai.fetchImpl)
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.suggestion, { heading: 'This is for you if…', items: ['clearer', 'calmer', 'kinder'] });
});

test('image_ref: the "Re:" clause with the public URL reaches the prompt; the guard still strips images', async () => {
  const store = createStore();
  const page: ObjectRecord = {
    ...pageRecord(),
    object_id: 'page_bio_demo',
    body: {
      route: '/bio-demo',
      pageType: 'standard',
      title: 'Bio demo',
      seo: {},
      sections: [
        {
          id: 's_bio',
          type: 'bio',
          data: {
            heading: 'Dr. Lurie',
            body: '<p>Bio copy.</p>',
            portrait: { src: '/images/dr-lurie-portrait4.jpeg', alt: 'Portrait' },
          },
        },
      ],
    },
  };
  store.seed(page);
  const imageRef = {
    field: 'portrait',
    name: 'dr-lurie-portrait4.jpeg',
    url: 'https://drlurie.example/img/req_canvas_page_bio_demo_20260712_01/' + 'c'.repeat(64) + '.jpg',
  };
  // The model tries to "help" with the image anyway — the guard must drop it.
  const openai = openAiMock({
    body: '<p>Bio copy that mentions the new portrait.</p>',
    portrait: { src: 'https://elsewhere.example/hallucinated.jpg', alt: 'Portrait' },
  });

  const result = await askAiForObject(
    store as unknown as AskAiObjectStore,
    {
      object_type: 'page',
      object_id: 'page_bio_demo',
      section_id: 's_bio',
      image_ref: imageRef,
      instruction: 'Update the bio to match the new portrait.',
    },
    deps(openai.fetchImpl)
  );

  assert.equal(result.status, 200);
  const prompt = openai.calls[0].userMessage;
  assert.match(prompt, /Re: dr-lurie-portrait4\.jpeg/);
  assert.ok(prompt.includes(imageRef.url), 'prompt carries the public blob URL for external image tooling');
  assert.match(prompt, /"portrait" field/);
  assert.deepEqual(
    result.body.suggestion,
    { body: '<p>Bio copy that mentions the new portrait.</p>' },
    'referencing an image never loosens the copy-only guard'
  );
});

test('image_ref is optional and absent from the prompt when not sent', async () => {
  const store = createStore();
  store.seed(pageRecord());
  const openai = openAiMock({ body: '<p>Copy.</p>' });
  await askAiForObject(
    store as unknown as AskAiObjectStore,
    { object_type: 'page', object_id: 'page_canvas_demo', section_id: 's_prose', instruction: 'Tighten.' },
    deps(openai.fetchImpl)
  );
  assert.doesNotMatch(openai.calls[0].userMessage, /Re: /);
});
