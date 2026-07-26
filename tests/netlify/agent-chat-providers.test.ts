/**
 * T9.13 — provider-adapter conformance (OQ-W9-3: both Anthropic and OpenAI
 * are v1 providers behind one interface). The SAME neutral transcript + tool
 * list goes through both adapters against an injected fetch; each must (a)
 * emit its provider's correct wire shape — including the parallel-tool-result
 * merge rule on Anthropic — and (b) parse back to the SAME neutral result.
 */
import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  anthropicAdapter,
  openaiAdapter,
  toAnthropicMessages,
  toOpenAIMessages,
  type WireTool,
} from '../../packages/core/server/lib/agent/provider.js';
import type { ChatMsg } from '../../packages/core/server/lib/agent/chat-store.js';

const TOOLS: WireTool[] = [
  {
    name: 'get_object',
    description: 'Read an object.',
    input_schema: {
      type: 'object',
      properties: { object_type: { type: 'string' }, object_id: { type: 'string' } },
      required: ['object_type', 'object_id'],
      additionalProperties: false,
    },
  },
];

/** A transcript exercising every neutral message shape, including TWO tool
 *  results for one assistant turn (the parallel-tool-use case). */
const TRANSCRIPT: ChatMsg[] = [
  { role: 'user', text: 'Read both pages.' },
  {
    role: 'assistant',
    text: 'Reading.',
    tool_calls: [
      { id: 'call_a', name: 'get_object', args: { object_type: 'page', object_id: 'page_home' } },
      { id: 'call_b', name: 'get_object', args: { object_type: 'page', object_id: 'page_about' } },
    ],
  },
  { role: 'tool', tool_call_id: 'call_a', content: '{"ok":true}' },
  { role: 'tool', tool_call_id: 'call_b', content: '{"error":"missing"}', is_error: true },
];

const capture = (response: unknown) => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, fetchImpl };
};

test('anthropic adapter: wire shape + parse conformance', async () => {
  const { requests, fetchImpl } = capture({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-8',
    content: [
      { type: 'text', text: 'Both read.' },
      { type: 'tool_use', id: 'call_c', name: 'get_object', input: { object_type: 'page', object_id: 'page_x' } },
    ],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 42 },
  });
  const adapter = anthropicAdapter({ model: 'claude-opus-4-8', apiKey: 'test-key', fetchImpl });
  const result = await adapter({ system: 'SYS', transcript: TRANSCRIPT, tools: TOOLS });

  const body = requests[0]!.body;
  assert.equal(body.model, 'claude-opus-4-8');
  assert.equal(body.system, 'SYS');
  assert.equal(body.temperature, undefined, 'no sampling params on Opus 4.7+');
  const messages = body.messages as { role: string; content: unknown }[];
  // user, assistant(text+2 tool_use), ONE merged user turn with BOTH tool_results.
  assert.equal(messages.length, 3);
  assert.equal(messages[1]!.role, 'assistant');
  const assistantBlocks = messages[1]!.content as { type: string }[];
  assert.deepEqual(
    assistantBlocks.map((block) => block.type),
    ['text', 'tool_use', 'tool_use']
  );
  const resultBlocks = messages[2]!.content as { type: string; tool_use_id: string; is_error?: boolean }[];
  assert.equal(messages[2]!.role, 'user');
  assert.deepEqual(
    resultBlocks.map((block) => [block.type, block.tool_use_id, block.is_error ?? false]),
    [
      ['tool_result', 'call_a', false],
      ['tool_result', 'call_b', true],
    ]
  );
  const tools = body.tools as { name: string; input_schema: unknown }[];
  assert.equal(tools[0]!.name, 'get_object');
  assert.ok(tools[0]!.input_schema);

  assert.deepEqual(result, {
    text: 'Both read.',
    toolCalls: [{ id: 'call_c', name: 'get_object', args: { object_type: 'page', object_id: 'page_x' } }],
    outputTokens: 42,
  });
});

test('openai adapter: wire shape + parse conformance (same neutral result)', async () => {
  const { requests, fetchImpl } = capture({
    id: 'chatcmpl_1',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-5',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Both read.',
          tool_calls: [
            {
              id: 'call_c',
              type: 'function',
              function: { name: 'get_object', arguments: '{"object_type":"page","object_id":"page_x"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 42, total_tokens: 142 },
  });
  const adapter = openaiAdapter({ model: 'gpt-5', apiKey: 'test-key', fetchImpl });
  const result = await adapter({ system: 'SYS', transcript: TRANSCRIPT, tools: TOOLS });

  const body = requests[0]!.body;
  assert.equal(body.model, 'gpt-5');
  const messages = body.messages as { role: string; content: unknown; tool_call_id?: string; tool_calls?: unknown[] }[];
  // system, user, assistant(with tool_calls), tool, tool.
  assert.deepEqual(
    messages.map((message) => message.role),
    ['system', 'user', 'assistant', 'tool', 'tool']
  );
  assert.equal(messages[0]!.content, 'SYS');
  assert.equal((messages[2]!.tool_calls as unknown[]).length, 2);
  assert.equal(messages[3]!.tool_call_id, 'call_a');
  assert.equal(messages[4]!.tool_call_id, 'call_b');
  const tools = body.tools as { type: string; function: { name: string; parameters: unknown } }[];
  assert.equal(tools[0]!.type, 'function');
  assert.equal(tools[0]!.function.name, 'get_object');

  // SAME neutral result as the anthropic adapter produced.
  assert.deepEqual(result, {
    text: 'Both read.',
    toolCalls: [{ id: 'call_c', name: 'get_object', args: { object_type: 'page', object_id: 'page_x' } }],
    outputTokens: 42,
  });
});

// ─── regression: transcript-shape defect behind the "New article" 400 ────────
//
// Production crash (2026-07-19): the Site Agent's opening turn calls
// get_contract + list_objects in parallel (both auto-execute), then the NEXT
// provider turn 400s: "messages.2.content.0: unexpected tool_use_id found in
// tool_result blocks". Root cause (loop.ts): `run.call_queue = turn.toolCalls`
// aliased the SAME array already pushed onto the transcript's assistant
// message as `tool_calls`. Draining call_queue with `.shift()` then silently
// erased tool_use entries from the persisted assistant turn as each call
// executed — by the time both had run, the assistant message's tool_calls
// had been mutated down to `[]`, while its two tool_results still referenced
// the now-vanished ids. This is exactly that corrupted shape, hand-built
// (loop.ts's own drain sequence is covered separately in
// agent-chat-protocol.test.ts, which exercises runAgentLoop directly).
const CORRUPTED_OPENING_TURN: ChatMsg[] = [
  { role: 'user', text: 'Write an article about retinoid basics.' },
  {
    role: 'assistant',
    text: "I'll check the content_item contract and the taxonomy registry first.",
    tool_calls: [], // ← should have been [get_contract, list_objects]; erased by the aliasing bug
  },
  { role: 'tool', tool_call_id: 'toolu_01contract', content: '{"body_schema":{}}' },
  { role: 'tool', tool_call_id: 'toolu_02registry', content: '{"objects":[]}' },
];

// The correctly-recorded version of the same turn (what loop.ts produces
// post-fix): both ids remain on the assistant message.
const VALID_OPENING_TURN: ChatMsg[] = [
  { role: 'user', text: 'Write an article about retinoid basics.' },
  {
    role: 'assistant',
    text: "I'll check the content_item contract and the taxonomy registry first.",
    tool_calls: [
      { id: 'toolu_01contract', name: 'get_contract', args: { object_type: 'content_item' } },
      { id: 'toolu_02registry', name: 'list_objects', args: { object_type: 'tax_drlurie' } },
    ],
  },
  { role: 'tool', tool_call_id: 'toolu_01contract', content: '{"body_schema":{}}' },
  { role: 'tool', tool_call_id: 'toolu_02registry', content: '{"objects":[]}' },
];

test('toAnthropicMessages: throws on a desynced transcript instead of building a request Anthropic would 400 on', () => {
  assert.throws(() => toAnthropicMessages(CORRUPTED_OPENING_TURN), /desynced/);
});

test('toAnthropicMessages: the anthropic adapter never even calls fetch for a desynced transcript', async () => {
  const { requests, fetchImpl } = capture({});
  const adapter = anthropicAdapter({ model: 'claude-opus-4-8', apiKey: 'test-key', fetchImpl });
  await assert.rejects(() => adapter({ system: 'SYS', transcript: CORRUPTED_OPENING_TURN, tools: TOOLS }), /desynced/);
  assert.equal(requests.length, 0, 'the doomed request must never be sent');
});

test('toAnthropicMessages: the correctly-recorded opening turn (get_contract + list_objects) round-trips clean', () => {
  const messages = toAnthropicMessages(VALID_OPENING_TURN);
  assert.equal(messages.length, 3);
  const assistantBlocks = (messages[1] as { content: { type: string; id?: string }[] }).content;
  assert.deepEqual(
    assistantBlocks.map((block) => block.type),
    ['text', 'tool_use', 'tool_use']
  );
  const resultBlocks = messages[2]!.content as { type: string; tool_use_id: string }[];
  assert.deepEqual(
    resultBlocks.map((block) => block.tool_use_id),
    ['toolu_01contract', 'toolu_02registry']
  );
});

test('toOpenAIMessages: throws directly on the same desynced transcript', () => {
  assert.throws(() => toOpenAIMessages('SYS', CORRUPTED_OPENING_TURN), /desynced/);
});

test('toOpenAIMessages (via openai adapter): throws on the same desynced shape', async () => {
  const { requests, fetchImpl } = capture({});
  const adapter = openaiAdapter({ model: 'gpt-5', apiKey: 'test-key', fetchImpl });
  await assert.rejects(() => adapter({ system: 'SYS', transcript: CORRUPTED_OPENING_TURN, tools: TOOLS }), /desynced/);
  assert.equal(requests.length, 0, 'the doomed request must never be sent');
});

test('openai adapter: malformed tool arguments parse to empty args, never throw', async () => {
  const { fetchImpl } = capture({
    id: 'chatcmpl_2',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-5',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'get_object', arguments: '{not json' } }],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const adapter = openaiAdapter({ model: 'gpt-5', apiKey: 'test-key', fetchImpl });
  const result = await adapter({ system: 'SYS', transcript: [{ role: 'user', text: 'x' }], tools: TOOLS });
  assert.deepEqual(result.toolCalls, [{ id: 'call_x', name: 'get_object', args: {} }]);
});
