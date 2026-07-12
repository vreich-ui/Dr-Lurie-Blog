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
 *   - SECTION SCOPE (edit-mode canvas): `section_id` narrows a PAGE request to
 *     one section instance. The tool schema is derived from that section
 *     type's own data shape (ask-ai-schema.ts sectionDataSchemaForType), so
 *     the model sees a small exact grammar and the suggestion maps 1:1 onto
 *     an `update_section_data` op. A shared_ref is refused with the target's
 *     sec_* id — the caller must ask the shared OBJECT, never the reference.
 *
 * content_item is refused here — articles keep the existing article Ask-AI
 * (admin-ask-ai-node.ts), which this task does not touch.
 *
 * Provider: OpenAI Chat Completions function-calling (OPENAI_API_KEY /
 * OPENAI_MODEL, injected by the wrapper). The zod-derived tool schema is plain
 * JSON Schema, so it is OpenAI's function `parameters` verbatim; a forced
 * `tool_choice` guarantees a structured reply. Read-only either way — swapping
 * the provider changes only how the suggestion is produced, never that a human
 * must Accept it through object_patch before anything is written.
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
  isProtectedAskAiField,
  sectionDataSchemaForType,
  type AskAiTool,
} from './ask-ai-schema.js';
import type { ObjectRecord } from '../../src/schema/object-record-v1.js';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MAX_TOKENS = 1500;

export type AskAiObjectStore = { get(key: string): Promise<string | null> };

export interface AskAiObjectRequest {
  object_type: string;
  object_id: string;
  /** Highlighted span the editor is focusing on; omitted = revise the whole object. */
  selected_text?: string;
  /** Page-only: scope the request to one section instance (edit-mode canvas). */
  section_id?: string;
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

/** A section instance as it sits in a page body — the minimal shape the scope path reads. */
type PageSectionInstance = { id: string; type: string; data: unknown };

const buildSectionUserMessage = (
  record: ObjectRecord,
  section: PageSectionInstance,
  request: AskAiObjectRequest
): string => {
  const page = record.body as { title?: unknown; route?: unknown };
  const selectionClause = request.selected_text
    ? `\nThe editor highlighted this specific span: """${request.selected_text}"""\n`
    : '';
  const framing =
    typeof page.title === 'string'
      ? `You are editing ONE SECTION of the page "${page.title}"` +
        `${typeof page.route === 'string' ? ` (route ${page.route})` : ''}.`
      : `You are editing the shared section object "${record.object_id}" — it renders on every page that references it.`;
  return [
    framing,
    `The section is a "${section.type}" (id ${section.id}). Its current data:`,
    '```json',
    JSON.stringify(section.data, null, 2),
    '```',
    selectionClause,
    `Editor's instruction: ${request.instruction}`,
    '',
    "Call the tool with ONLY this section's data fields that should change. Do not include fields that " +
      'stay the same. Rich-text fields are HTML limited to <p> <br> <strong> <em> <a> <ul> <ol> <li> <h2> <h3>; ' +
      'keep the block structure the current value uses (a paragraphs-only field must stay paragraphs-only). ' +
      'Preserve the voice, tone, and structure of the surrounding content.',
  ]
    .filter((line) => line !== '')
    .join('\n');
};

const callOpenAI = async (
  userMessage: string,
  tool: AskAiTool,
  deps: AskAiObjectDeps
): Promise<{ ok: true; input: Record<string, unknown> } | { ok: false; status: number; error: string }> => {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deps.apiKey}`,
    },
    body: JSON.stringify({
      model: deps.model,
      max_completion_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: userMessage }],
      // The zod-derived JSON Schema IS OpenAI's function `parameters`; forcing
      // this one function guarantees the reply is a structured tool call.
      tools: [
        {
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
        },
      ],
      tool_choice: { type: 'function', function: { name: tool.name } },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, status: 502, error: `OpenAI API ${response.status}: ${text.slice(0, 200)}` };
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
  };
  const call = payload.choices?.[0]?.message?.tool_calls?.find((entry) => entry.function?.name === tool.name);
  if (!call?.function?.arguments) {
    return { ok: false, status: 502, error: 'AI did not return a structured suggestion' };
  }
  try {
    // OpenAI returns function arguments as a JSON STRING (unlike Anthropic's
    // parsed input object), so parse before handing back the partial body.
    return { ok: true, input: JSON.parse(call.function.arguments) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 502, error: 'AI returned malformed tool arguments' };
  }
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
      error:
        'content_item uses the existing article Ask-AI (admin-ask-ai-node); the generic endpoint does not serve it.',
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

  // Section scope is a request-shape rule, independent of the record: refuse
  // a non-page pairing before any store read.
  if (request.section_id && request.object_type !== 'page') {
    return err(400, {
      error: 'section_id scoping applies to page objects only (a section object IS one section).',
      code: 'section_scope_unsupported',
    });
  }

  const raw = await store.get(objectRecordKey(request.object_type, request.object_id));
  if (!raw) return err(404, { error: 'Object record not found', not_found: true });
  const record = JSON.parse(raw) as ObjectRecord;

  // ── section scope (edit-mode canvas) ──────────────────────────────────────
  let tool: AskAiTool;
  let userMessage: string;
  let scopedSection: PageSectionInstance | undefined;
  if (request.section_id) {
    const sections = (record.body as { sections?: PageSectionInstance[] }).sections;
    const section = Array.isArray(sections) ? sections.find((entry) => entry.id === request.section_id) : undefined;
    if (!section) {
      return err(404, { error: `Section ${request.section_id} not found on ${request.object_id}`, not_found: true });
    }
    if (section.type === 'shared_ref') {
      // The content lives on the shared object; editing the reference would be
      // editing the wrong record. Hand the caller the real target instead.
      return err(400, {
        error: 'This section is a shared_ref — ask the shared section object itself.',
        code: 'section_is_shared_ref',
        shared_object_id: (section.data as { section?: string }).section,
      });
    }
    const dataSchema = sectionDataSchemaForType(section.type);
    if (!dataSchema) {
      return err(400, { error: `No data schema for section type ${section.type}`, code: 'no_schema' });
    }
    scopedSection = section;
    tool = deriveAskAiToolSchema(dataSchema, {
      toolName: 'propose_section_changes',
      description:
        "Return ONLY the fields of this section's data that should change to satisfy the instruction. " +
        'Omit every field that stays the same. Preserve the existing voice, tone, and structure. ' +
        'Edit text/copy ONLY — never change or invent images, assets, links, or references.',
      protectFields: true,
    });
    userMessage = buildSectionUserMessage(record, section, request);
  } else if (request.object_type === 'section') {
    // A shared section object IS one section: auto-scope to the inner
    // instance so the model answers in the section's own data grammar (the
    // wrapper schema would push it to restate id/type/data wholesale). The
    // returned section_id is the INNER instance id — exactly what an
    // update_section_data op on this object targets.
    const inner = (record.body as { section?: PageSectionInstance }).section;
    const dataSchema = inner ? sectionDataSchemaForType(inner.type) : undefined;
    if (!inner || !dataSchema || inner.type === 'shared_ref') {
      return err(422, {
        error: `Section object ${request.object_id} does not wrap an editable section instance.`,
        code: 'invalid_section_body',
      });
    }
    scopedSection = inner;
    tool = deriveAskAiToolSchema(dataSchema, {
      toolName: 'propose_section_changes',
      description:
        "Return ONLY the fields of this section's data that should change to satisfy the instruction. " +
        'Omit every field that stays the same. Preserve the existing voice, tone, and structure. ' +
        'Edit text/copy ONLY — never change or invent images, assets, links, or references.',
      protectFields: true,
    });
    userMessage = buildSectionUserMessage(record, inner, request);
  } else {
    // Tool schema derived from the type's zod body schema at request time.
    tool = deriveAskAiToolSchema(bodySchema);
    userMessage = buildUserMessage(record, request);
  }

  const aiResult = await callOpenAI(userMessage, tool, deps);
  if (!aiResult.ok) return err(aiResult.status, { error: aiResult.error });

  // Strip null/undefined (as the article version does) AND, on the copy-only
  // section path, any protected field the model returned anyway — media/asset/
  // reference/structure keys are off-limits there (ask-ai-schema.ts). The tool
  // schema already excludes them; this is the defensive backstop so a
  // hallucinated image/link URL can never reach object_patch (the About-
  // portrait incident, 2026-07-12). Whole-object admin asks keep every field.
  const copyOnly = scopedSection !== undefined;
  const suggestion: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(aiResult.input)) {
    if (value === undefined || value === null) continue;
    if (copyOnly && isProtectedAskAiField(key)) continue;
    suggestion[key] = value;
  }

  return {
    status: 200,
    body: {
      suggestion,
      object_type: request.object_type,
      object_id: request.object_id,
      ...(scopedSection ? { section_id: scopedSection.id, section_type: scopedSection.type } : {}),
      // Read-only marker: this endpoint proposes; it does not persist. The
      // reviewer applies `suggestion` via object_patch (the T1.4 review path).
      applied: false,
    },
  };
};
