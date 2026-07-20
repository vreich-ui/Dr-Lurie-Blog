/**
 * T9.13 — provider adapters. BOTH Anthropic and OpenAI behind one interface
 * (v1 requirement, Wolf 2026-07-16 / OQ-W9-3); provider + model come from the
 * resolved agent profile, never hardcoded.
 *
 * Contract: an adapter runs ONE model turn over the provider-neutral
 * transcript (chat-store.ts ChatMsg[]) and returns text + tool calls + output
 * tokens. The transcript is re-sent statelessly per call — that's what makes
 * the pause/resume protocol trivial (T9.12 finding). v1 runs WITHOUT extended
 * thinking: no thinking blocks means the neutral transcript round-trips
 * exactly on both providers (enabling adaptive thinking requires persisting
 * provider-native blocks — a marked seam, not a default).
 *
 * Anthropic notes (claude-opus-4-8 default): no temperature/top_p/top_k and
 * no budget_tokens (both 400 on Opus 4.7+); parallel tool_use is on by
 * default and every tool_use must be answered in the NEXT message —
 * consecutive tool results merge into ONE user turn. OpenAI notes: tools ride
 * the chat-completions function-calling shape; arguments arrive as a JSON
 * string and are parsed defensively.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import type { ChatMsg, ChatToolCall } from './chat-store.js';

export interface WireTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ProviderTurnResult {
  text?: string;
  toolCalls: ChatToolCall[];
  outputTokens: number;
}

export type ProviderAdapter = (input: {
  system: string;
  transcript: ChatMsg[];
  tools: WireTool[];
}) => Promise<ProviderTurnResult>;

export interface AdapterOptions {
  model: string;
  apiKey?: string;
  /** Injected for tests; both SDKs accept a custom fetch. */
  fetchImpl?: typeof fetch;
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 16000;

// ─── Anthropic ───────────────────────────────────────────────────────────────

export const toAnthropicMessages = (transcript: ChatMsg[]): Anthropic.MessageParam[] => {
  const messages: Anthropic.MessageParam[] = [];
  // tool_use ids opened by the most recently emitted assistant turn that a
  // tool_result hasn't answered yet; null once that turn is fully answered
  // (or no assistant tool_use turn is open). A defensive invariant, not just
  // a merge convenience: a tool_result that can't match here means SOME
  // upstream step (loop.ts recording, pause/resume, ...) desynced the
  // transcript — better to fail loudly here than send Anthropic a request
  // it will reject with a cryptic 400.
  let openToolUseIds: Set<string> | null = null;
  for (const msg of transcript) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.text });
      openToolUseIds = null;
    } else if (msg.role === 'assistant') {
      const calls = msg.tool_calls ?? [];
      const content: Anthropic.ContentBlockParam[] = [];
      if (msg.text) content.push({ type: 'text', text: msg.text });
      for (const call of calls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      }
      if (content.length > 0) messages.push({ role: 'assistant', content });
      openToolUseIds = calls.length > 0 ? new Set(calls.map((call) => call.id)) : null;
    } else {
      if (openToolUseIds === null || !openToolUseIds.has(msg.tool_call_id)) {
        throw new Error(
          `toAnthropicMessages: tool_result "${msg.tool_call_id}" does not answer a tool_use in the ` +
            'immediately preceding assistant turn (transcript is desynced).'
        );
      }
      const block: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: msg.content,
        ...(msg.is_error ? { is_error: true } : {}),
      };
      const last = messages[messages.length - 1];
      // Parallel-tool-use contract: ALL results for a turn in ONE user message.
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as Anthropic.ContentBlockParam[]).push(block);
      } else {
        messages.push({ role: 'user', content: [block] });
      }
      openToolUseIds.delete(msg.tool_call_id);
    }
  }
  return messages;
};

export const anthropicAdapter = (options: AdapterOptions): ProviderAdapter => {
  const client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
  });
  return async ({ system, transcript, tools }) => {
    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages: toAnthropicMessages(transcript),
      tools: tools.map((tool) => ({
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

// ─── OpenAI ──────────────────────────────────────────────────────────────────

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export const toOpenAIMessages = (system: string, transcript: ChatMsg[]): OpenAIMessage[] => {
  const messages: OpenAIMessage[] = [{ role: 'system', content: system }];
  // Mirrors toAnthropicMessages' invariant check: every tool message must
  // follow an assistant message that declared that tool_call id.
  let openToolCallIds: Set<string> | null = null;
  for (const msg of transcript) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.text });
      openToolCallIds = null;
    } else if (msg.role === 'assistant') {
      const calls = msg.tool_calls ?? [];
      messages.push({
        role: 'assistant',
        content: msg.text ?? null,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            }
          : {}),
      });
      openToolCallIds = calls.length > 0 ? new Set(calls.map((call) => call.id)) : null;
    } else {
      if (openToolCallIds === null || !openToolCallIds.has(msg.tool_call_id)) {
        throw new Error(
          `toOpenAIMessages: tool message "${msg.tool_call_id}" does not answer a tool_call in the ` +
            'immediately preceding assistant turn (transcript is desynced).'
        );
      }
      // OpenAI mirrors errors inside the content string; there is no is_error flag.
      messages.push({ role: 'tool', tool_call_id: msg.tool_call_id, content: msg.content });
      openToolCallIds.delete(msg.tool_call_id);
    }
  }
  return messages;
};

const parseArgs = (raw: string | undefined): Record<string, unknown> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const openaiAdapter = (options: AdapterOptions): ProviderAdapter => {
  const client = new OpenAI({
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
    ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
  });
  return async ({ system, transcript, tools }) => {
    const response = await client.chat.completions.create({
      model: options.model,
      max_completion_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toOpenAIMessages(system, transcript),
      tools: tools.map((tool) => ({
        type: 'function' as const,
        function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
      })),
    });
    const choice = response.choices[0];
    const message = choice?.message;
    const toolCalls: ChatToolCall[] = (message?.tool_calls ?? [])
      .filter((call): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => call.type === 'function')
      .map((call) => ({ id: call.id, name: call.function.name, args: parseArgs(call.function.arguments) }));
    const text = message?.content ?? undefined;
    return {
      ...(text ? { text } : {}),
      toolCalls,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  };
};

/** The one place a provider name becomes an adapter. */
export const adapterForProfile = (
  profile: { provider: 'anthropic' | 'openai'; model: string },
  options: Omit<AdapterOptions, 'model'> = {}
): ProviderAdapter =>
  profile.provider === 'anthropic'
    ? anthropicAdapter({ ...options, model: profile.model })
    : openaiAdapter({ ...options, model: profile.model });
