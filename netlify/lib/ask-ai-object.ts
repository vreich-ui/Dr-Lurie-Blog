/**
 * Generic Ask-AI core (T1.6) — the article Ask-AI (admin-ask-ai-node.ts,
 * A§1.4) generalized to any object type, with the tool schema DERIVED from the
 * type's zod body schema (ask-ai-schema.ts) instead of hand-written.
 *
 * Same contract as the article version, deliberately:
 *   - Read-only. Takes no lock and writes NOTHING to the store. The proposed
 *     change is a suggestion, not a mutation — persistence happens only when a
 *     reviewer applies it through the object_patch verb under lock, which is
 *     what records it in history and puts it under the T1.4 review-state
 *     machine (a discardable proposal, D§3.9/C§2.4). Ask-AI never bypasses
 *     that path with a direct write.
 *   - Selection-based UX with whole-object fallback: `selected_text` focuses
 *     the edit on a highlighted span; absent, the model revises the whole
 *     object (the article "revise this block" fallback, A§1.4).
 *
 * content_item is refused here — Tier 1 keeps the existing article Ask-AI
 * (admin-ask-ai-node.ts), which this task does not touch.
 *
 * Pure/testable like object-verbs.ts: auth, the real blob store, and env come
 * from the thin HTTP wrapper (admin-ask-ai-object.ts); this core takes an
 * injected store and fetch so it can be exercised without network or disk.
 */
import { objectRecordKey } from './object-store-keys.js';
import {
  bodySchemaForObjectType,
  deriveAskAiToolSchema,
  isAskAiObjectType,
  type AskAiTool,
} from './ask-ai-schema.js';
import type { ObjectRecord } from '../../src/schema/object-record-v1.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = 1500;

export type AskAiObjectStore = { get(key: string): Promise<string | null> };

export interface AskAiObjectRequest {
  object_type: string;
  object_id: string;
  /** Highlighted span the editor is focusing on; omitted = revise the whole object. */
  selected_text?: string;
  instruction: string;
}

export interface AskAiObjectDeps {
  apiKey: string;
  model: string;
  /** Injected for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export type AskAiObjectResult = { status: number; body: Record<string, unknown> };

const err = (status: number, body: Record<string, unknown>): AskAiObjectResult => ({ status, body });

const buildUserMessage = (record: ObjectRecord, request: AskAiObjectRequest): string => {
  const selectionClause = request.selected_text
    ? `\nThe editor highlighted this specific span: """${request.selected_text}"""\n`
    : '';
  return [
    `You are editing a "${record.object_type}" CMS object (id ${record.object_id}).`,
    '',
    'Current object body:',
    '```json',
    JSON.stringify(record.body, null, 2),
    '```',
    selectionClause,
    `Editor's instruction: ${request.instruction}`,
    '',
    'Call the tool with ONLY the fields that should change. Do not include fields that stay the same. ' +
      'Preserve the voice, tone, and structure of the surrounding content.',
  ]
    .filter((line) => line !== '')
    .join('\n');
};

const callAnthropic = async (
  userMessage: string,
  tool: AskAiTool,
  deps: AskAiObjectDeps
): Promise<{ ok: true; input: Record<string, unknown> } | { ok: false; status: number; error: string }> => {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': deps.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: deps.model,
      max_tokens: MAX_TOKENS,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, status: 502, error: `Anthropic API ${response.status}: ${text.slice(0, 200)}` };
  }

  const payload = (await response.json()) as {
    content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
  };
  const toolUse = payload.content?.find((block) => block.type === 'tool_use' && block.name === tool.name);
  if (!toolUse?.input) {
    return { ok: false, status: 502, error: 'AI did not return a structured suggestion' };
  }
  return { ok: true, input: toolUse.input };
};

/**
 * Produce an Ask-AI suggestion for an object. READ-ONLY: never writes the
 * store. Returns `{ suggestion }` — a partial body the reviewer can apply
 * through the reviewable object_patch path (never a direct write).
 */
export const askAiForObject = async (
  store: AskAiObjectStore,
  request: AskAiObjectRequest,
  deps: AskAiObjectDeps
): Promise<AskAiObjectResult> => {
  if (request.object_type === 'content_item') {
    return err(400, {
      error: 'content_item uses the existing article Ask-AI (admin-ask-ai-node); the generic endpoint does not serve it.',
      code: 'unsupported_object_type',
    });
  }
  if (!isAskAiObjectType(request.object_type)) {
    return err(400, { error: `Unknown object type: ${request.object_type}`, code: 'unknown_object_type' });
  }

  const bodySchema = bodySchemaForObjectType(request.object_type);
  if (!bodySchema) {
    return err(400, { error: `No body schema registered for ${request.object_type}`, code: 'no_schema' });
  }

  const raw = await store.get(objectRecordKey(request.object_type, request.object_id));
  if (!raw) return err(404, { error: 'Object record not found', not_found: true });
  const record = JSON.parse(raw) as ObjectRecord;

  // Tool schema derived from the type's zod body schema at request time.
  const tool = deriveAskAiToolSchema(bodySchema);

  const aiResult = await callAnthropic(buildUserMessage(record, request), tool, deps);
  if (!aiResult.ok) return err(aiResult.status, { error: aiResult.error });

  // Strip null/undefined, exactly as the article version does before returning.
  const suggestion: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(aiResult.input)) {
    if (value !== undefined && value !== null) suggestion[key] = value;
  }

  return {
    status: 200,
    body: {
      suggestion,
      object_type: request.object_type,
      object_id: request.object_id,
      // Read-only marker: this endpoint proposes; it does not persist. The
      // reviewer applies `suggestion` via object_patch (the T1.4 review path).
      applied: false,
    },
  };
};
