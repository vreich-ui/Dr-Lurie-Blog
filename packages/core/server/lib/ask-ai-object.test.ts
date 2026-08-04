import { describe, it } from 'node:test';
import assert from 'node:assert';

import { askAiForObject, type AskAiObjectDeps, type AskAiObjectStore } from './ask-ai-object.js';
import { objectRecordKey } from './object-store-keys.js';

const NOW = '2026-08-04T00:00:00.000Z';

/** Injected-store pattern (agent-keys.test.ts): a Map-backed store, no blobs/network. */
const makeStore = (records: Record<string, unknown>): AskAiObjectStore => {
  const backing = new Map<string, string>(Object.entries(records).map(([key, value]) => [key, JSON.stringify(value)]));
  return { get: async (key: string) => backing.get(key) ?? null };
};

type CapturedRequest = { url: string; body: Record<string, unknown> };

/** Injected-fetch pattern: captures the outbound request and returns a canned
 *  forced-tool reply — no live network call, matching the existing OpenAI/
 *  Anthropic transports' contract. */
const makeFetch = (
  capture: { last?: CapturedRequest },
  suggestion: Record<string, unknown> = { title: 'Updated title' }
) =>
  (async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capture.last = { url: String(url), body };
    const isAnthropic = String(url).includes('anthropic.com');
    const toolName = isAnthropic
      ? (body.tools as Array<{ name: string }>)[0]!.name
      : (body.tools as Array<{ function: { name: string } }>)[0]!.function.name;
    const payload = isAnthropic
      ? { content: [{ type: 'tool_use', name: toolName, input: suggestion }] }
      : {
          choices: [
            { message: { tool_calls: [{ function: { name: toolName, arguments: JSON.stringify(suggestion) } }] } },
          ],
        };
    return { ok: true, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch;

const baseDeps = (capture: { last?: CapturedRequest }): AskAiObjectDeps => ({
  apiKey: 'test-key',
  model: 'test-model',
  provider: 'openai',
  fetchImpl: makeFetch(capture),
});

const editorialVoiceRecord = {
  object_id: 'voice_drlurie',
  object_type: 'editorial_voice',
  schema_version: 'editorial_voice.v1',
  site: 'site_drlurie',
  created_at: NOW,
  updated_at: NOW,
  status: 'active',
  version: 1,
  content_revision: 1,
  history: [],
  publication: { published_time: null },
  body: {
    name: 'Dr. Lurie house voice',
    audience: 'Skincare-curious readers who distrust hype.',
    tone: ['warm', 'evidence-led'],
    cadence: 'Short paragraphs, second person.',
    lexicon: { prefer: ['dermatologist-reviewed', 'evidence'], avoid: ['miracle', 'cure-all'] },
    claim_policy: 'Every claim needs a cited source.',
    cta_policy: 'One soft CTA per article, never a countdown.',
    reader_safety_notes: 'This is educational content only, not medical advice.',
    frameworks: [
      {
        framework_id: 'fw_explainer',
        label: 'Explainer',
        description: 'Explains one skincare concept.',
        when_to_use: 'The reader needs to understand a concept before acting on it.',
        beats: ['Hook', 'Explain', 'Resolve'],
      },
    ],
    default_framework: 'fw_explainer',
  },
};

const contentItemRecord = {
  object_id: 'req_test1',
  object_type: 'content_item',
  schema_version: 'content_item.v1',
  site: 'site_drlurie',
  created_at: NOW,
  updated_at: NOW,
  status: 'active',
  version: 1,
  content_revision: 1,
  history: [],
  publication: { published_time: null },
  review: {
    state: 'changes_requested',
    decisions: [
      {
        at: NOW,
        by: { kind: 'human', id: 'u1', email: 'wolf@example.com' },
        decision: 'request_changes',
        note: 'Cut the discount framing, it reads pushy.',
        content_revision: 1,
      },
    ],
  },
  body: {
    slug: 'test-article',
    title: 'Test Article',
    taxonomy: { category: 'skincare', tags: ['spf', 'routine'] },
    publication_context: { publication_name: 'Dr. Lurie', domain: 'drluriescience.com', topic_scope: 'skincare' },
    editorial: { writer_notes: 'Keep it warm.', framework: 'fw_explainer' },
    emotional_strategy: {
      overall_texture_assessment: 'Reads a bit clinical in the middle third.',
      lines_to_preserve: ['Your skin remembers everything you put on it.'],
      rhythm_adjustments: ['Vary sentence length in paragraph 3.'],
      opportunities_for_specificity: ['Name the actual ingredient instead of "certain compounds".'],
      overly_polished_moments: ['Paragraph 2 reads like ad copy.'],
    },
    claims: {
      claim_list: [
        {
          claim_id: 'c1',
          text: 'SPF 30 blocks 97% of UVB rays.',
          node_ids: ['n_hook1'],
          status: 'verified',
          risk: 'low',
        },
        {
          claim_id: 'c2',
          text: 'This product cures acne overnight.',
          node_ids: ['n_other'],
          status: 'disputed',
          risk: 'high',
        },
      ],
    },
    compliance: {
      requirements: [
        {
          requirement_id: 'r1',
          kind: 'medical_disclaimer',
          text: 'Not medical advice.',
          satisfied: true,
          node_ids: ['n_hook1'],
        },
        {
          requirement_id: 'r2',
          kind: 'ftc_disclosure',
          text: 'Disclose the affiliate link.',
          satisfied: false,
          node_ids: ['n_other'],
        },
      ],
    },
    nodes: [
      {
        id: 'n_hook1',
        kind: 'content',
        public: { title: 'Why sunscreen matters', body: 'Some body text.' },
        private: { strategy: 'hook', intent: 'educate' },
        commercial: {
          type: 'affiliateMention',
          disclosure: { required: true, label: 'Affiliate link' },
          offer: { couponCode: 'SPF10', terms: '10% off at checkout' },
        },
        chat: { invitationText: 'Ask about SPF', suggestedQuery: 'What SPF do I need?' },
      },
      {
        id: 'n_other',
        kind: 'content',
        public: { title: 'Other block', body: 'Other body text.' },
      },
    ],
  },
};

const pageRecordWithNotes = {
  object_id: 'page_test1',
  object_type: 'page',
  schema_version: 'page.v1',
  site: 'site_drlurie',
  created_at: NOW,
  updated_at: NOW,
  status: 'active',
  version: 1,
  content_revision: 1,
  history: [],
  publication: { published_time: null },
  body: {
    title: 'Test Page',
    route: '/test-page',
    sections: [
      {
        id: 's_prose1',
        type: 'prose',
        data: { body: 'Some prose.' },
        notes: 'Keep this short; it sits above the fold.',
      },
      { id: 's_prose2', type: 'prose', data: { body: 'More prose.' } },
    ],
  },
};

describe('askAiForObject — context enrichment (S4x)', () => {
  it('folds the site editorial_voice into a whole-object ask, absent-tolerant when there is none', async () => {
    const captureWithVoice: { last?: CapturedRequest } = {};
    const storeWithVoice = makeStore({
      [objectRecordKey('content_item', 'req_test1')]: contentItemRecord,
      [objectRecordKey('editorial_voice', 'voice_drlurie')]: editorialVoiceRecord,
    });
    const resultWithVoice = await askAiForObject(
      storeWithVoice,
      { object_type: 'content_item', object_id: 'req_test1', instruction: 'Tighten the intro.' },
      baseDeps(captureWithVoice)
    );
    assert.strictEqual(resultWithVoice.status, 200);
    const promptWithVoice = String((captureWithVoice.last!.body.messages as Array<{ content: string }>)[0]!.content);
    assert.match(promptWithVoice, /House style — this site's declared editorial voice \("Dr\. Lurie house voice"\)/);
    assert.match(promptWithVoice, /Audience: Skincare-curious readers who distrust hype\./);
    assert.match(promptWithVoice, /Prefer this vocabulary: dermatologist-reviewed, evidence/);
    assert.match(promptWithVoice, /Avoid this vocabulary: miracle, cure-all/);
    assert.match(promptWithVoice, /Explainer \(default\): The reader needs to understand a concept/);

    const captureNoVoice: { last?: CapturedRequest } = {};
    const storeNoVoice = makeStore({
      [objectRecordKey('content_item', 'req_test1')]: contentItemRecord,
    });
    const resultNoVoice = await askAiForObject(
      storeNoVoice,
      { object_type: 'content_item', object_id: 'req_test1', instruction: 'Tighten the intro.' },
      baseDeps(captureNoVoice)
    );
    assert.strictEqual(resultNoVoice.status, 200);
    const promptNoVoice = String((captureNoVoice.last!.body.messages as Array<{ content: string }>)[0]!.content);
    assert.doesNotMatch(promptNoVoice, /House style/);
  });

  it('surfaces content_item editorial/emotional_strategy/claims/compliance/taxonomy/publication_context on a whole-object ask, and the review state', async () => {
    const capture: { last?: CapturedRequest } = {};
    const store = makeStore({ [objectRecordKey('content_item', 'req_test1')]: contentItemRecord });
    const result = await askAiForObject(
      store,
      { object_type: 'content_item', object_id: 'req_test1', instruction: 'Tighten the intro.' },
      baseDeps(capture)
    );
    assert.strictEqual(result.status, 200);
    const prompt = String((capture.last!.body.messages as Array<{ content: string }>)[0]!.content);

    assert.match(prompt, /Editorial notes: declared framework "fw_explainer" — Keep it warm\./);
    assert.match(prompt, /Texture assessment: Reads a bit clinical in the middle third\./);
    assert.match(prompt, /Lines to preserve verbatim: "Your skin remembers everything you put on it\."/);
    assert.match(prompt, /Rhythm adjustments wanted: Vary sentence length in paragraph 3\./);
    assert.match(prompt, /Opportunities for specificity: Name the actual ingredient/);
    // Whole-object ask is unscoped: BOTH claims appear, not just the ones touching one node.
    assert.match(prompt, /SPF 30 blocks 97% of UVB rays\.".*\[status: verified, risk: low\]/);
    assert.match(prompt, /This product cures acne overnight\.".*\[status: disputed, risk: high\]/);
    assert.match(prompt, /never contradict a verified claim, and never restate a disputed or retracted claim as fact/);
    assert.match(prompt, /\[medical_disclaimer\] Not medical advice\./);
    assert.match(prompt, /\[ftc_disclosure\] Disclose the affiliate link\. \(NOT YET SATISFIED\)/);
    assert.match(prompt, /Taxonomy: category skincare; tags spf, routine/);
    assert.match(prompt, /Publication context: Dr\. Lurie — drluriescience\.com — skincare/);

    assert.match(prompt, /This object's review state is "changes_requested"\./);
    assert.match(prompt, /Latest decision: request_changes — "Cut the discount framing, it reads pushy\."/);
    assert.match(prompt, /Do not re-propose a direction a human already rejected\./);
  });

  it('narrows claims/compliance to the scoped node, and surfaces node.commercial/node.chat, on a node-scoped ask', async () => {
    const capture: { last?: CapturedRequest } = {};
    const store = makeStore({ [objectRecordKey('content_item', 'req_test1')]: contentItemRecord });
    const result = await askAiForObject(
      store,
      { object_type: 'content_item', object_id: 'req_test1', node_id: 'n_hook1', instruction: 'Make it punchier.' },
      baseDeps(capture)
    );
    assert.strictEqual(result.status, 200);
    const prompt = String((capture.last!.body.messages as Array<{ content: string }>)[0]!.content);

    // Only n_hook1's claim/requirement — n_other's must NOT leak into a narrower scope.
    assert.match(prompt, /SPF 30 blocks 97% of UVB rays\./);
    assert.doesNotMatch(prompt, /cures acne overnight/);
    assert.match(prompt, /\[medical_disclaimer\] Not medical advice\./);
    assert.doesNotMatch(prompt, /ftc_disclosure/);

    // Existing strategy/intent role clause, extended with commercial + chat.
    assert.match(prompt, /This block's editorial role: hook, intent: educate\./);
    assert.match(
      prompt,
      /This block carries commercial metadata \(affiliateMention; disclosure REQUIRED: "Affiliate link"; offer terms: 10% off at checkout; coupon SPF10\)\. Never strip required disclosure or offer language/
    );
    assert.match(
      prompt,
      /This block also carries a chat invitation \("Ask about SPF"\) with suggested query "What SPF do I need\?" — keep any copy change consistent with it\./
    );
  });

  it("includes a section instance's own notes on a section-scoped ask, and omits the clause when notes are absent", async () => {
    const captureWithNotes: { last?: CapturedRequest } = {};
    const store = makeStore({ [objectRecordKey('page', 'page_test1')]: pageRecordWithNotes });
    const resultWithNotes = await askAiForObject(
      store,
      { object_type: 'page', object_id: 'page_test1', section_id: 's_prose1', instruction: 'Trim it.' },
      baseDeps(captureWithNotes)
    );
    assert.strictEqual(resultWithNotes.status, 200);
    const promptWithNotes = String((captureWithNotes.last!.body.messages as Array<{ content: string }>)[0]!.content);
    assert.match(
      promptWithNotes,
      /Editor\/agent notes on this section \(context only, never rendered to readers\): Keep this short; it sits above the fold\./
    );

    const captureNoNotes: { last?: CapturedRequest } = {};
    const resultNoNotes = await askAiForObject(
      store,
      { object_type: 'page', object_id: 'page_test1', section_id: 's_prose2', instruction: 'Trim it.' },
      baseDeps(captureNoNotes)
    );
    assert.strictEqual(resultNoNotes.status, 200);
    const promptNoNotes = String((captureNoNotes.last!.body.messages as Array<{ content: string }>)[0]!.content);
    assert.doesNotMatch(promptNoNotes, /Editor\/agent notes/);
  });

  it('never lets the new context flow into the returned suggestion (copy-only stripping is unchanged)', async () => {
    const capture: { last?: CapturedRequest } = {};
    const store = makeStore({
      [objectRecordKey('content_item', 'req_test1')]: contentItemRecord,
      [objectRecordKey('editorial_voice', 'voice_drlurie')]: editorialVoiceRecord,
    });
    // The mocked model "misbehaves" and echoes context-shaped keys back — the
    // copy-only guard on a node-scoped ask must still drop anything that
    // isn't plain-text copy, exactly as before this change.
    const deps: AskAiObjectDeps = {
      apiKey: 'test-key',
      model: 'test-model',
      provider: 'openai',
      fetchImpl: makeFetch(capture, {
        title: 'A punchier hook',
        claims: { claim_list: [{ text: 'sneaked in' }] },
        commercial: { type: 'offer' },
      }),
    };
    const result = await askAiForObject(
      store,
      { object_type: 'content_item', object_id: 'req_test1', node_id: 'n_hook1', instruction: 'Make it punchier.' },
      deps
    );
    assert.strictEqual(result.status, 200);
    const suggestion = result.body.suggestion as Record<string, unknown>;
    assert.deepStrictEqual(suggestion, { title: 'A punchier hook' });
    assert.strictEqual('claims' in suggestion, false);
    assert.strictEqual('commercial' in suggestion, false);
  });
});
