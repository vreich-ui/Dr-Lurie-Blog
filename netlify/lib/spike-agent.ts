/**
 * T9.12 SPIKE — THROWAWAY. Deleted by T9.13; do not import from product code.
 *
 * Proves the four mechanics the chat-first design stands on (plan §4/§6):
 *   1. a provider adapter running a turn inside a background function;
 *   2. an event-log chat doc a client polls with since_seq;
 *   3. a read tool executing via handleObjectVerb;
 *   4. an ask-gated write that PAUSES the run (function exits), survives the
 *      pause in the blob store, and RESUMES on a later invocation — with the
 *      resume re-verifying the stored pending call (never client args).
 *
 * Design decisions being de-risked for T9.13 (recorded in T9.12-findings.md):
 *   - single chat doc per chat: seq-ordered events + run state in one JSON;
 *   - single-writer state machine (queued → running → awaiting_approval →
 *     queued → … → idle) so read-modify-write needs no CAS;
 *   - one-shot trigger tokens authenticate background invocations (the
 *     background URL is public; a token is minted per hop and consumed on
 *     start, so replays and forged triggers are inert);
 *   - a provider-neutral transcript stored in the run; the adapter maps it
 *     to provider wire format per call (stateless re-send — what makes
 *     pause/resume trivial).
 */
import { createHash, randomUUID } from 'node:crypto';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { handleObjectVerb, objectVerbRequestSchema, type ObjectVerbStore } from './object-verbs.js';
import type { Principal } from '../../src/schema/object-record-v1.js';

// ─── neutral transcript ───────────────────────────────────────────────────────

export type SpikeToolCall = { id: string; name: string; args: Record<string, unknown> };
export type SpikeMsg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; tool_calls?: SpikeToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string; is_error?: boolean };

// ─── chat doc ────────────────────────────────────────────────────────────────

export const spikeEventSchema = z.object({
  seq: z.number().int().positive(),
  at: z.string(),
  type: z.enum([
    'user_message',
    'run_started',
    'assistant_text',
    'tool_call',
    'tool_result',
    'tool_approval_required',
    'tool_approved',
    'tool_denied',
    'run_finished',
    'run_error',
  ]),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type SpikeEvent = z.infer<typeof spikeEventSchema>;

const spikeMsgSchema: z.ZodType<SpikeMsg> = z.union([
  z.object({ role: z.literal('user'), text: z.string() }),
  z.object({
    role: z.literal('assistant'),
    text: z.string().optional(),
    tool_calls: z
      .array(z.object({ id: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) }))
      .optional(),
  }),
  z.object({
    role: z.literal('tool'),
    tool_call_id: z.string(),
    content: z.string(),
    is_error: z.boolean().optional(),
  }),
]);

export const spikePendingCallSchema = z.object({
  call_id: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  /** sha256 of stableStringify(args) at pause time — the resume re-verifies it. */
  args_hash: z.string(),
});
export type SpikePendingCall = z.infer<typeof spikePendingCallSchema>;

export const spikeChatDocSchema = z.object({
  schema_version: z.literal('spike-chat.v1'),
  chat_id: z.string(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  status: z.enum(['idle', 'queued', 'running', 'awaiting_approval', 'error']),
  seq: z.number().int().nonnegative(),
  events: z.array(spikeEventSchema),
  run: z
    .object({
      run_id: z.string(),
      /** Captured server-side at send time from the verified identity. */
      principal: z.object({ kind: z.literal('human'), id: z.string(), email: z.string() }),
      /** One-shot background-invocation token; consumed (cleared) on run start. */
      trigger_token: z.string().optional(),
      transcript: z.array(spikeMsgSchema),
      /** Tool calls from the current assistant turn not yet executed (pause queue). */
      call_queue: z.array(z.object({ id: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) })),
      pending: spikePendingCallSchema.optional(),
      provider_turns: z.number().int().nonnegative(),
      tool_calls_used: z.number().int().nonnegative(),
      output_tokens_used: z.number().int().nonnegative(),
    })
    .optional(),
});
export type SpikeChatDoc = z.infer<typeof spikeChatDocSchema>;

export interface SpikeChatStore {
  get(key: string): Promise<string | null>;
  setJSON(key: string, value: unknown): Promise<void | { modified: boolean; etag?: string }>;
}

export const spikeChatKey = (chatId: string) => `chats/${chatId.replaceAll(':', '__')}.json`;

export const loadSpikeChat = async (store: SpikeChatStore, chatId: string): Promise<SpikeChatDoc | undefined> => {
  const raw = await store.get(spikeChatKey(chatId));
  if (!raw) return undefined;
  return spikeChatDocSchema.parse(JSON.parse(raw));
};

export const saveSpikeChat = async (store: SpikeChatStore, doc: SpikeChatDoc): Promise<void> => {
  await store.setJSON(spikeChatKey(doc.chat_id), spikeChatDocSchema.parse(doc));
};

export const appendEvent = (
  doc: SpikeChatDoc,
  at: string,
  type: SpikeEvent['type'],
  detail?: Record<string, unknown>
): void => {
  doc.seq += 1;
  doc.events.push({ seq: doc.seq, at, type, ...(detail ? { detail } : {}) });
  doc.updated_at = at;
};

// ─── args hashing (the re-verification primitive) ─────────────────────────────

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object' && !Array.isArray(value))
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

export const spikeArgsHash = (args: Record<string, unknown>): string =>
  createHash('sha256').update(stableStringify(args)).digest('hex');

// ─── tools ───────────────────────────────────────────────────────────────────

/** Read tool: auto-executes. */
const getObjectArgs = z.object({ object_type: z.string(), object_id: z.string() });
/** Ask-gated write: checkout → patch → checkin under the run's human principal. */
const proposePatchArgs = z.object({
  object_type: z.string(),
  object_id: z.string(),
  ops: z.array(z.unknown()).min(1),
});

export const SPIKE_TOOLS = [
  {
    name: 'get_object',
    description: 'Read a CMS object record by type and id.',
    input_schema: {
      type: 'object',
      properties: { object_type: { type: 'string' }, object_id: { type: 'string' } },
      required: ['object_type', 'object_id'],
      additionalProperties: false,
    } as Record<string, unknown>,
  },
  {
    name: 'propose_patch',
    description:
      'Propose patch ops for a CMS object. The human must approve before anything is written. ' +
      'Ops use the object contract patch grammar (deep-merge fields semantics).',
    input_schema: {
      type: 'object',
      properties: {
        object_type: { type: 'string' },
        object_id: { type: 'string' },
        ops: { type: 'array', items: { type: 'object' } },
      },
      required: ['object_type', 'object_id', 'ops'],
      additionalProperties: false,
    } as Record<string, unknown>,
  },
] as const;

export const SPIKE_ASK_TOOLS = new Set(['propose_patch']);

const verb = async (
  objectStore: ObjectVerbStore,
  request: unknown,
  principal: Principal
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const parsed = objectVerbRequestSchema.safeParse(request);
  if (!parsed.success) return { status: 400, body: { error: 'invalid verb request', issues: parsed.error.issues } };
  return handleObjectVerb(objectStore, parsed.data, principal);
};

/** Execute one tool call under the run's principal. Returns the tool-result content string. */
export const executeSpikeTool = async (
  objectStore: ObjectVerbStore,
  call: SpikeToolCall,
  principal: Principal
): Promise<{ content: string; is_error: boolean }> => {
  if (call.name === 'get_object') {
    const args = getObjectArgs.safeParse(call.args);
    if (!args.success) return { content: `Invalid args: ${args.error.message}`, is_error: true };
    const result = await verb(objectStore, { action: 'get', ...args.data }, principal);
    return { content: JSON.stringify(result.body), is_error: result.status !== 200 };
  }
  if (call.name === 'propose_patch') {
    const args = proposePatchArgs.safeParse(call.args);
    if (!args.success) return { content: `Invalid args: ${args.error.message}`, is_error: true };
    const { object_type, object_id, ops } = args.data;
    const checkout = await verb(objectStore, { action: 'checkout', object_type, object_id }, principal);
    if (checkout.status !== 200) {
      return { content: `Checkout failed (${checkout.status}): ${JSON.stringify(checkout.body)}`, is_error: true };
    }
    const lockToken = checkout.body.lockToken as string; // top-level; body.lock is sanitized (never the token)
    const version = checkout.body.record_version as number;
    const patch = await verb(
      objectStore,
      { action: 'patch', object_type, object_id, lock_token: lockToken, expected_record_version: version, ops },
      principal
    );
    await verb(objectStore, { action: 'checkin', object_type, object_id, lock_token: lockToken }, principal);
    return { content: JSON.stringify(patch.body), is_error: patch.status !== 200 };
  }
  return { content: `Unknown tool: ${call.name}`, is_error: true };
};

// ─── provider adapter ────────────────────────────────────────────────────────

export interface SpikeProviderResult {
  text?: string;
  toolCalls: SpikeToolCall[];
  outputTokens: number;
}
export type SpikeProviderAdapter = (input: {
  system: string;
  transcript: SpikeMsg[];
}) => Promise<SpikeProviderResult>;

/** Map the neutral transcript to Anthropic Messages wire format. Consecutive
 *  tool results merge into ONE user turn (parallel tool_use contract). */
const toAnthropicMessages = (transcript: SpikeMsg[]): Anthropic.MessageParam[] => {
  const messages: Anthropic.MessageParam[] = [];
  for (const msg of transcript) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.text });
    } else if (msg.role === 'assistant') {
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.text) content.push({ type: 'text', text: msg.text });
      for (const call of msg.tool_calls ?? []) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      }
      if (content.length > 0) messages.push({ role: 'assistant', content });
    } else {
      const block: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: msg.content,
        ...(msg.is_error ? { is_error: true } : {}),
      };
      const last = messages[messages.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as Anthropic.ContentBlockParam[]).push(block);
      } else {
        messages.push({ role: 'user', content: [block] });
      }
    }
  }
  return messages;
};

/** The real adapter (Anthropic default — OQ-W9-3; both providers land in T9.13). */
export const anthropicSpikeAdapter = (options?: { apiKey?: string; model?: string }): SpikeProviderAdapter => {
  const client = new Anthropic({ apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY });
  const model = options?.model ?? 'claude-opus-4-8';
  return async ({ system, transcript }) => {
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      system,
      messages: toAnthropicMessages(transcript),
      tools: SPIKE_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
      })),
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    const toolCalls = response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> }));
    return { ...(text ? { text } : {}), toolCalls, outputTokens: response.usage.output_tokens };
  };
};

// ─── the loop (runs inside the background function) ──────────────────────────

const SPIKE_SYSTEM =
  'You are the Dr-Lurie CMS spike agent. Use get_object to read. Use propose_patch to change content — ' +
  'a human approves every write. Refer to things by name, never raw ids. Be brief.';

export const SPIKE_CAPS = { maxProviderTurns: 5, maxToolCalls: 8 } as const;

export interface SpikeRunDeps {
  chatStore: SpikeChatStore;
  objectStore: ObjectVerbStore;
  adapter: SpikeProviderAdapter;
  nowIso?: () => string;
}

/**
 * Process the run until it finishes, pauses on an ask-gated call, or hits a
 * cap. Invoked by the background function (fresh invocation per hop) — the
 * pause is literally "persist + return".
 */
export const runSpikeLoop = async (
  deps: SpikeRunDeps,
  chatId: string,
  triggerToken: string
): Promise<{ ok: boolean; status?: SpikeChatDoc['status']; error?: string }> => {
  const now = deps.nowIso ?? (() => new Date().toISOString());
  const doc = await loadSpikeChat(deps.chatStore, chatId);
  if (!doc || !doc.run) return { ok: false, error: 'chat or run not found' };

  // One-shot trigger-token gate: the background URL is public; only the holder
  // of the token minted by send/approve may start this hop, exactly once.
  if (doc.status !== 'queued' || !doc.run.trigger_token || doc.run.trigger_token !== triggerToken) {
    return { ok: false, error: 'not queued or bad trigger token' };
  }
  delete doc.run.trigger_token;
  doc.status = 'running';
  appendEvent(doc, now(), 'run_started', { run_id: doc.run.run_id });
  await saveSpikeChat(deps.chatStore, doc);

  const principal: Principal = doc.run.principal;

  try {
    for (;;) {
      // Drain any queued tool calls left from the paused assistant turn first.
      while (doc.run.call_queue.length > 0) {
        const call = doc.run.call_queue[0]!;
        if (SPIKE_ASK_TOOLS.has(call.name)) {
          doc.run.pending = { call_id: call.id, tool: call.name, args: call.args, args_hash: spikeArgsHash(call.args) };
          doc.status = 'awaiting_approval';
          appendEvent(doc, now(), 'tool_approval_required', { call_id: call.id, tool: call.name, args: call.args });
          await saveSpikeChat(deps.chatStore, doc);
          return { ok: true, status: doc.status }; // ← THE PAUSE
        }
        doc.run.call_queue.shift();
        doc.run.tool_calls_used += 1;
        appendEvent(doc, now(), 'tool_call', { call_id: call.id, tool: call.name, args: call.args });
        const result = await executeSpikeTool(deps.objectStore, call, principal);
        doc.run.transcript.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.content,
          ...(result.is_error ? { is_error: true } : {}),
        });
        appendEvent(doc, now(), 'tool_result', { call_id: call.id, is_error: result.is_error });
        await saveSpikeChat(deps.chatStore, doc);
      }

      if (doc.run.provider_turns >= SPIKE_CAPS.maxProviderTurns || doc.run.tool_calls_used >= SPIKE_CAPS.maxToolCalls) {
        doc.status = 'idle';
        appendEvent(doc, now(), 'run_finished', { reason: 'caps' });
        await saveSpikeChat(deps.chatStore, doc);
        return { ok: true, status: doc.status };
      }

      doc.run.provider_turns += 1;
      const turn = await deps.adapter({ system: SPIKE_SYSTEM, transcript: doc.run.transcript });
      doc.run.output_tokens_used += turn.outputTokens;
      doc.run.transcript.push({
        role: 'assistant',
        ...(turn.text ? { text: turn.text } : {}),
        ...(turn.toolCalls.length > 0 ? { tool_calls: turn.toolCalls } : {}),
      });
      if (turn.text) appendEvent(doc, now(), 'assistant_text', { text: turn.text });

      if (turn.toolCalls.length === 0) {
        doc.status = 'idle';
        appendEvent(doc, now(), 'run_finished', { reason: 'end_turn' });
        await saveSpikeChat(deps.chatStore, doc);
        return { ok: true, status: doc.status };
      }
      doc.run.call_queue = turn.toolCalls;
      await saveSpikeChat(deps.chatStore, doc);
    }
  } catch (error) {
    doc.status = 'error';
    appendEvent(doc, now(), 'run_error', { message: error instanceof Error ? error.message : String(error) });
    await saveSpikeChat(deps.chatStore, doc);
    return { ok: false, status: doc.status, error: 'run failed' };
  }
};

// ─── approve / deny (invoked from the interactive function) ──────────────────

/**
 * Approve the pending call. SECURITY MECHANIC UNDER TEST: args come from the
 * STORED pending call only — the client supplies (chat_id, call_id) and
 * nothing else. The stored args are re-hashed and compared against the hash
 * recorded at pause time; any mismatch (tampered doc, forged call_id, stale
 * approval) is rejected without executing.
 */
export const approveSpikeCall = async (
  deps: Omit<SpikeRunDeps, 'adapter'>,
  chatId: string,
  callId: string,
  approver: { id: string; email: string }
): Promise<{ status: number; body: Record<string, unknown>; resume?: { triggerToken: string } }> => {
  const now = deps.nowIso ?? (() => new Date().toISOString());
  const doc = await loadSpikeChat(deps.chatStore, chatId);
  if (!doc?.run) return { status: 404, body: { error: 'chat not found' } };
  if (doc.status !== 'awaiting_approval' || !doc.run.pending) {
    return { status: 409, body: { error: 'no approval pending' } };
  }
  const pending = doc.run.pending;
  if (pending.call_id !== callId) {
    return { status: 409, body: { error: 'call_id does not match the pending call', code: 'forged_resume' } };
  }
  if (spikeArgsHash(pending.args) !== pending.args_hash) {
    return { status: 409, body: { error: 'stored call failed re-verification', code: 'forged_resume' } };
  }

  // Execute the STORED call under the run's original principal.
  const call: SpikeToolCall = { id: pending.call_id, name: pending.tool, args: pending.args };
  doc.run.call_queue = doc.run.call_queue.filter((queued) => queued.id !== callId);
  doc.run.tool_calls_used += 1;
  appendEvent(doc, now(), 'tool_approved', { call_id: callId, by: approver.email });
  const result = await executeSpikeTool(deps.objectStore, call, doc.run.principal);
  doc.run.transcript.push({
    role: 'tool',
    tool_call_id: callId,
    content: result.content,
    ...(result.is_error ? { is_error: true } : {}),
  });
  appendEvent(doc, now(), 'tool_result', { call_id: callId, is_error: result.is_error });
  delete doc.run.pending;

  // Re-arm the background loop for the next hop.
  const triggerToken = randomUUID();
  doc.run.trigger_token = triggerToken;
  doc.status = 'queued';
  await saveSpikeChat(deps.chatStore, doc);
  return { status: 200, body: { approved: true, is_error: result.is_error }, resume: { triggerToken } };
};

export const denySpikeCall = async (
  deps: Omit<SpikeRunDeps, 'adapter'>,
  chatId: string,
  callId: string,
  denier: { id: string; email: string },
  reason?: string
): Promise<{ status: number; body: Record<string, unknown>; resume?: { triggerToken: string } }> => {
  const now = deps.nowIso ?? (() => new Date().toISOString());
  const doc = await loadSpikeChat(deps.chatStore, chatId);
  if (!doc?.run) return { status: 404, body: { error: 'chat not found' } };
  if (doc.status !== 'awaiting_approval' || !doc.run.pending || doc.run.pending.call_id !== callId) {
    return { status: 409, body: { error: 'no matching approval pending' } };
  }
  doc.run.call_queue = doc.run.call_queue.filter((queued) => queued.id !== callId);
  appendEvent(doc, now(), 'tool_denied', { call_id: callId, by: denier.email, reason });
  doc.run.transcript.push({
    role: 'tool',
    tool_call_id: callId,
    content: `The human denied this action${reason ? `: ${reason}` : '.'} Do not retry it; adjust or finish.`,
    is_error: true,
  });
  delete doc.run.pending;
  const triggerToken = randomUUID();
  doc.run.trigger_token = triggerToken;
  doc.status = 'queued';
  await saveSpikeChat(deps.chatStore, doc);
  return { status: 200, body: { denied: true }, resume: { triggerToken } };
};

// ─── send (create/extend a run) ──────────────────────────────────────────────

export const startSpikeRun = async (
  deps: Omit<SpikeRunDeps, 'adapter'>,
  chatId: string,
  text: string,
  principal: { id: string; email: string }
): Promise<{ status: number; body: Record<string, unknown>; resume?: { triggerToken: string } }> => {
  const now = deps.nowIso ?? (() => new Date().toISOString());
  let doc = await loadSpikeChat(deps.chatStore, chatId);
  if (!doc) {
    doc = {
      schema_version: 'spike-chat.v1',
      chat_id: chatId,
      created_by: principal.email,
      created_at: now(),
      updated_at: now(),
      status: 'idle',
      seq: 0,
      events: [],
    };
  }
  if (doc.status === 'running' || doc.status === 'queued' || doc.status === 'awaiting_approval') {
    return { status: 409, body: { error: `a run is already ${doc.status}` } };
  }
  const triggerToken = randomUUID();
  doc.run = {
    run_id: randomUUID(),
    principal: { kind: 'human', ...principal },
    trigger_token: triggerToken,
    transcript: [...(doc.run?.transcript ?? []), { role: 'user', text }],
    call_queue: [],
    provider_turns: 0,
    tool_calls_used: 0,
    output_tokens_used: 0,
  };
  doc.status = 'queued';
  appendEvent(doc, now(), 'user_message', { text });
  await saveSpikeChat(deps.chatStore, doc);
  return { status: 200, body: { chat_id: chatId, run_id: doc.run.run_id }, resume: { triggerToken } };
};
