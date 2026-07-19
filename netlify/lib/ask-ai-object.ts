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
 *   - NODE SCOPE (W7.8 canvas): `node_id` narrows a content_item request to
 *     one article node. The tool schema is the node's PUBLIC copy grammar
 *     (annotations, media, and links are outside it), and the suggestion maps
 *     1:1 onto an `update_node` op's `fields.public`. The LEGACY article
 *     Ask-AI (admin-ask-ai-node.ts, workflow records) is untouched — it keeps
 *     serving the committed .md pipeline.
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
import { contentItemNodePublicSchema, type ContentItemNode } from '../../src/schema/bodies/content-item-v1.js';
import type { ObjectRecord } from '../../src/schema/object-record-v1.js';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1500;

export type AskAiObjectStore = { get(key: string): Promise<string | null> };

export interface AskAiObjectRequest {
  object_type: string;
  object_id: string;
  /** Highlighted span the editor is focusing on; omitted = revise the whole object. */
  selected_text?: string;
  /** Page-only: scope the request to one section instance (edit-mode canvas). */
  section_id?: string;
  /** content_item-only: scope the request to one article node (W7.8 canvas). */
  node_id?: string;
  /**
   * An image the editor is referring to ("Re: portrait.png" — canvas image
   * chips). `url` is the image's PUBLIC address (blob-backed /img/* mirror,
   * so external image tooling can fetch the exact bytes). Context only: the
   * copy-only guard still strips every image field from the suggestion.
   */
  image_ref?: { field: string; name: string; url: string };
  instruction: string;
}

export interface AskAiObjectDeps {
  apiKey: string;
  model: string;
  /**
   * T9.26 (§4a): the transport comes from the object's resolved agent profile
   * — never hardcoded. Defaults to 'openai' for existing callers/tests; the
   * wrapper passes the profile's provider.
   */
  provider?: 'anthropic' | 'openai';
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

/** Plain-text copy: a string, or an array whose every element is a string. */
const isCopyTextValue = (value: unknown): boolean =>
  typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'));

const buildSectionUserMessage = (
  record: ObjectRecord,
  section: PageSectionInstance,
  request: AskAiObjectRequest
): string => {
  const page = record.body as { title?: unknown; route?: unknown };
  const selectionClause = request.selected_text
    ? `\nThe editor highlighted this specific span: """${request.selected_text}"""\n`
    : '';
  const imageClause = request.image_ref
    ? `\nRe: ${request.image_ref.name} — the editor is referring to the image in the "${request.image_ref.field}" ` +
      `field, publicly served at ${request.image_ref.url}. You cannot change image fields (they are outside your ` +
      `tool schema; image bytes are edited by external tools using that URL) — respond by updating the copy fields ` +
      `the instruction asks for.\n`
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
    imageClause,
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

const buildNodeUserMessage = (record: ObjectRecord, node: ContentItemNode, request: AskAiObjectRequest): string => {
  const article = record.body as { title?: unknown };
  const selectionClause = request.selected_text
    ? `\nThe editor highlighted this specific span: """${request.selected_text}"""\n`
    : '';
  // The node's declared ROLE is context the model should write FOR (a hook
  // reads differently from a resolution) — it flows one way: into the prompt,
  // never into the suggestion (the tool schema has no annotation fields).
  const strategy = node.private?.strategy;
  const intent = node.private?.intent;
  const roleClause =
    strategy || intent
      ? `\nThis block's editorial role: ${[strategy, intent && `intent: ${intent}`].filter(Boolean).join(', ')}. ` +
        'Write copy that serves that role.\n'
      : '';
  return [
    `You are editing ONE BLOCK of the article "${typeof article.title === 'string' ? article.title : record.object_id}".`,
    `The block is a "${node.kind}" node (id ${node.id}). Its current public copy:`,
    '```json',
    JSON.stringify(node.public, null, 2),
    '```',
    roleClause,
    selectionClause,
    `Editor's instruction: ${request.instruction}`,
    '',
    "Call the tool with ONLY this node's public copy fields that should change. Do not include fields that " +
      'stay the same. Body text is PLAIN TEXT (no HTML): blank lines separate paragraphs. ' +
      'Preserve the voice, tone, and structure of the surrounding content.',
  ]
    .filter((line) => line !== '')
    .join('\n');
};

/** Anthropic Messages transport — same forced-tool contract as the OpenAI
 *  path: the zod-derived JSON Schema is the tool's input_schema and
 *  tool_choice pins that one tool, so the reply is a structured tool call. */
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
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: deps.model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: userMessage }],
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.input_schema }],
      tool_choice: { type: 'tool', name: tool.name },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, status: 502, error: `Anthropic API ${response.status}: ${text.slice(0, 200)}` };
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }>;
  };
  const call = payload.content?.find((block) => block.type === 'tool_use' && block.name === tool.name);
  if (!call?.input || typeof call.input !== 'object') {
    return { ok: false, status: 502, error: 'AI did not return a structured suggestion' };
  }
  // Anthropic returns the tool input as a parsed object — no JSON.parse step.
  return { ok: true, input: call.input };
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
  if (!isAskAiObjectType(request.object_type)) {
    return err(400, { error: `Unknown object type: ${request.object_type}`, code: 'unknown_object_type' });
  }

  const bodySchema = bodySchemaForObjectType(request.object_type);
  if (!bodySchema) {
    return err(400, { error: `No body schema registered for ${request.object_type}`, code: 'no_schema' });
  }

  // Scope pairings are request-shape rules, independent of the record: refuse
  // an invalid pairing before any store read.
  if (request.section_id && request.object_type !== 'page') {
    return err(400, {
      error: 'section_id scoping applies to page objects only (a section object IS one section).',
      code: 'section_scope_unsupported',
    });
  }
  if (request.node_id && request.object_type !== 'content_item') {
    return err(400, {
      error: 'node_id scoping applies to content_item objects only.',
      code: 'node_scope_unsupported',
    });
  }

  const raw = await store.get(objectRecordKey(request.object_type, request.object_id));
  if (!raw) return err(404, { error: 'Object record not found', not_found: true });
  const record = JSON.parse(raw) as ObjectRecord;

  // ── section / node scope (edit-mode canvas) ───────────────────────────────
  let tool: AskAiTool;
  let userMessage: string;
  let scopedSection: PageSectionInstance | undefined;
  let scopedNode: ContentItemNode | undefined;
  if (request.node_id) {
    // Article node scope (W7.8): the tool is the node's PUBLIC copy grammar —
    // annotations (private/commercial) are not in it, media/links are
    // protected out, and a rich_text document body is excluded so a copy ask
    // can never flatten formatting into a plain string.
    const nodes = (record.body as { nodes?: ContentItemNode[] }).nodes;
    const node = Array.isArray(nodes) ? nodes.find((entry) => entry.id === request.node_id) : undefined;
    if (!node) {
      return err(404, { error: `Node ${request.node_id} not found on ${request.object_id}`, not_found: true });
    }
    scopedNode = node;
    tool = deriveAskAiToolSchema(contentItemNodePublicSchema, {
      toolName: 'propose_node_changes',
      description:
        "Return ONLY the fields of this article node's public copy that should change to satisfy the " +
        'instruction. Omit every field that stays the same. Preserve the existing voice, tone, and structure. ' +
        'Edit text/copy ONLY — never change or invent images, assets, links, or references.',
      protectFields: true,
    });
    if (typeof node.public.body !== 'string') {
      // The body is a rich_text.v1 document (or absent): editing it as plain
      // text would destroy its structure — keep it out of the model's reach.
      delete (tool.input_schema.properties as Record<string, unknown> | undefined)?.body;
    }
    userMessage = buildNodeUserMessage(record, node, request);
  } else if (request.section_id) {
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

  const aiResult =
    deps.provider === 'anthropic' ? await callAnthropic(userMessage, tool, deps) : await callOpenAI(userMessage, tool, deps);
  if (!aiResult.ok) return err(aiResult.status, { error: aiResult.error });

  // Strip null/undefined (as the article version does) AND, on the copy-only
  // section path, anything that is not PLAIN TEXT. A copy edit keeps only a
  // string or an array of strings; every protected key AND every structured
  // value (nested objects, arrays of objects) is dropped. Top-level checks
  // alone are not enough — a structured field like pricing_table `tiers`
  // carries `tiers[].product` commerce references, and content_split `images`
  // carries media, inside a container whose own key isn't protected. Dropping
  // non-text values means a copy edit can never repoint a nested reference or
  // swap buried media (the About-portrait class of bug). Structured fields are
  // agent/admin/manual work. Whole-object admin asks keep every field.
  const copyOnly = scopedSection !== undefined || scopedNode !== undefined;
  const suggestion: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(aiResult.input)) {
    if (value === undefined || value === null) continue;
    if (copyOnly && (isProtectedAskAiField(key) || !isCopyTextValue(value))) continue;
    suggestion[key] = value;
  }

  return {
    status: 200,
    body: {
      suggestion,
      object_type: request.object_type,
      object_id: request.object_id,
      ...(scopedSection ? { section_id: scopedSection.id, section_type: scopedSection.type } : {}),
      ...(scopedNode ? { node_id: scopedNode.id, node_kind: scopedNode.kind } : {}),
      // Read-only marker: this endpoint proposes; it does not persist. The
      // reviewer applies `suggestion` via object_patch (the T1.4 review path).
      applied: false,
    },
  };
};
