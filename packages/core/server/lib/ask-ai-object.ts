/**
 * Generic Ask-AI core (T1.6) — the legacy article Ask-AI (admin-ask-ai-node.ts,
 * A§1.4, retired T9.24) generalized to any object type, with the tool schema
 * DERIVED from the type's zod body schema (ask-ai-schema.ts) instead of
 * hand-written.
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
 *     1:1 onto an `update_node` op's `fields.public`. The legacy article
 *     Ask-AI (admin-ask-ai-node.ts, workflow records) is gone (T9.24) — every
 *     article is a content_item object now, served by this path.
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
 *
 * CONTEXT ENRICHMENT (S4x): the object schema already carries a non-reader-
 * facing context layer — the site's declared `editorial_voice`, a
 * content_item's `editorial`/`emotional_strategy`/`claims`/`compliance`/
 * `taxonomy`/`publication_context`, a node's `commercial`/`chat`, a section
 * instance's own `notes`, and the object's `review` state — that this file
 * did not read until now. This is a PROMPT-ASSEMBLY change only: every field
 * below flows one way, into the model's input text, never into the returned
 * suggestion (the copy-only field-stripping rules a few screens down are
 * untouched). See `buildVoiceClause`, `buildContentItemContextClause`,
 * `buildNodeRoleClause`, `buildSectionNotesClause`, and `buildReviewClause`.
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
import {
  contentItemNodePublicSchema,
  type ContentItemBody,
  type ContentItemNode,
} from '../../schema/bodies/content-item-v1.js';
import { editorialVoiceBodySchema, type EditorialVoiceBody } from '../../schema/bodies/editorial-voice-v1.js';
import type { ObjectRecord } from '../../schema/object-record-v1.js';

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

// ── context enrichment (S4x) ─────────────────────────────────────────────────

/** `voice_<site>` — the site_/tax_/trk_ singleton convention applied to editorial_voice
 *  (editorial-voice-v1.ts). `record.site` is the site OBJECT id ('site_drlurie'); strip
 *  the prefix and re-add the voice one, e.g. sites/platform/seeds/voice-seed-data.mjs
 *  seeds exactly 'voice_platform' for SEED_SITE 'site_platform'. */
const editorialVoiceObjectId = (site: string): string => `voice_${site.replace(/^site_/, '')}`;

/**
 * Fetch the site's declared editorial voice, once per request. Absent-tolerant
 * by design (mandate item 1) — not every site has authored one yet, so a
 * missing record, an unparseable body, or a store miss all resolve to
 * `undefined` rather than failing the ask.
 */
const fetchEditorialVoice = async (store: AskAiObjectStore, site: string): Promise<EditorialVoiceBody | undefined> => {
  const raw = await store.get(objectRecordKey('editorial_voice', editorialVoiceObjectId(site)));
  if (!raw) return undefined;
  try {
    const record = JSON.parse(raw) as ObjectRecord;
    const parsed = editorialVoiceBodySchema.safeParse(record.body);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** House style, folded into every ask (whole-object, section, node) when the site has one. */
const buildVoiceClause = (voice: EditorialVoiceBody | undefined): string => {
  if (!voice) return '';
  const lexiconLines = [
    voice.lexicon.prefer.length ? `  Prefer this vocabulary: ${voice.lexicon.prefer.join(', ')}` : undefined,
    voice.lexicon.avoid.length ? `  Avoid this vocabulary: ${voice.lexicon.avoid.join(', ')}` : undefined,
  ].filter((line): line is string => line !== undefined);
  const frameworkLines = voice.frameworks.map(
    (framework) =>
      `  - ${framework.label}${framework.framework_id === voice.default_framework ? ' (default)' : ''}: ${framework.when_to_use}`
  );
  return (
    `\nHouse style — this site's declared editorial voice ("${voice.name}"), which the suggestion must respect:\n` +
    [
      `  Audience: ${voice.audience}`,
      `  Tone: ${voice.tone.join(', ')}`,
      `  Cadence: ${voice.cadence}`,
      ...lexiconLines,
      `  Claim policy: ${voice.claim_policy}`,
      `  CTA policy: ${voice.cta_policy}`,
      `  Reader safety notes: ${voice.reader_safety_notes}`,
      '  Article frameworks this site publishes with:',
      ...frameworkLines,
    ].join('\n') +
    '\n'
  );
};

/** The object's review state, folded into every ask so a suggestion doesn't re-propose a rejected direction. */
const buildReviewClause = (record: ObjectRecord): string => {
  const review = record.review;
  if (!review) return '';
  const latest = review.decisions.at(-1);
  const latestClause = latest ? ` Latest decision: ${latest.decision}${latest.note ? ` — "${latest.note}"` : ''}.` : '';
  return `\nThis object's review state is "${review.state}".${latestClause} Do not re-propose a direction a human already rejected.\n`;
};

type ContentItemClaim = NonNullable<ContentItemBody['claims']>['claim_list'][number];
type ContentItemComplianceRequirement = NonNullable<ContentItemBody['compliance']>['requirements'][number];

/** Claims whose `node_ids` touch the scoped node/selection; unscoped (whole-object) asks see every claim. */
const relevantClaims = (body: ContentItemBody, nodeId: string | undefined): ContentItemClaim[] => {
  const claims = body.claims?.claim_list ?? [];
  return nodeId ? claims.filter((claim) => claim.node_ids?.includes(nodeId)) : claims;
};

/** Compliance requirements whose `node_ids` touch the scoped node/selection; unscoped asks see every requirement. */
const relevantCompliance = (body: ContentItemBody, nodeId: string | undefined): ContentItemComplianceRequirement[] => {
  const requirements = body.compliance?.requirements ?? [];
  return nodeId ? requirements.filter((requirement) => requirement.node_ids?.includes(nodeId)) : requirements;
};

/**
 * content_item judge/score substrate (mandate item 2): editorial notes, the
 * texture-facing emotional_strategy fields, claims/compliance touching the
 * scope, taxonomy, and publication_context. Used for whole-object asks on a
 * content_item AND for every node-scoped ask (node scope only exists on this
 * type) — `nodeId` narrows claims/compliance to the scoped block; `undefined`
 * (whole-object) surfaces every claim/requirement in the article.
 */
const buildContentItemContextClause = (body: ContentItemBody, nodeId: string | undefined): string => {
  const parts: string[] = [];

  const editorial = body.editorial;
  if (editorial?.writer_notes || editorial?.framework) {
    parts.push(
      `Editorial notes: ${[editorial.framework && `declared framework "${editorial.framework}"`, editorial.writer_notes]
        .filter(Boolean)
        .join(' — ')}`
    );
  }

  const strategy = body.emotional_strategy;
  if (strategy?.overall_texture_assessment) {
    parts.push(`Texture assessment: ${strategy.overall_texture_assessment}`);
  }
  if (strategy?.lines_to_preserve?.length) {
    parts.push(`Lines to preserve verbatim: ${strategy.lines_to_preserve.map((line) => `"${line}"`).join('; ')}`);
  }
  if (strategy?.rhythm_adjustments?.length) {
    parts.push(`Rhythm adjustments wanted: ${strategy.rhythm_adjustments.join('; ')}`);
  }
  if (strategy?.opportunities_for_specificity?.length) {
    parts.push(`Opportunities for specificity: ${strategy.opportunities_for_specificity.join('; ')}`);
  }

  const claims = relevantClaims(body, nodeId);
  if (claims.length) {
    const claimLines = claims
      .map(
        (claim) =>
          `  - "${claim.text}" [status: ${claim.status ?? 'unverified'}${claim.risk ? `, risk: ${claim.risk}` : ''}]`
      )
      .join('\n');
    parts.push(
      `${nodeId ? 'Claims touching this block' : 'Claims in this article'} — never contradict a verified claim, ` +
        `and never restate a disputed or retracted claim as fact:\n${claimLines}`
    );
  }

  const compliance = relevantCompliance(body, nodeId);
  if (compliance.length) {
    const complianceLines = compliance
      .map(
        (requirement) =>
          `  - [${requirement.kind}] ${requirement.text}${requirement.satisfied ? '' : ' (NOT YET SATISFIED)'}`
      )
      .join('\n');
    parts.push(`Compliance requirements${nodeId ? ' touching this block' : ''}:\n${complianceLines}`);
  }

  const taxonomyLine = [
    body.taxonomy?.category && `category ${body.taxonomy.category}`,
    body.taxonomy?.tags?.length && `tags ${body.taxonomy.tags.join(', ')}`,
  ]
    .filter(Boolean)
    .join('; ');
  if (taxonomyLine) parts.push(`Taxonomy: ${taxonomyLine}`);

  const publicationLine = [
    body.publication_context?.publication_name,
    body.publication_context?.domain,
    body.publication_context?.topic_scope,
  ]
    .filter(Boolean)
    .join(' — ');
  if (publicationLine) parts.push(`Publication context: ${publicationLine}`);

  return parts.length ? `\n${parts.join('\n')}\n` : '';
};

const buildUserMessage = (
  record: ObjectRecord,
  request: AskAiObjectRequest,
  voice: EditorialVoiceBody | undefined
): string => {
  const selectionClause = request.selected_text
    ? `\nThe editor highlighted this specific span: """${request.selected_text}"""\n`
    : '';
  const contentItemClause =
    record.object_type === 'content_item'
      ? buildContentItemContextClause(record.body as ContentItemBody, undefined)
      : '';
  return [
    `You are editing a "${record.object_type}" CMS object (id ${record.object_id}).`,
    '',
    'Current object body:',
    '```json',
    JSON.stringify(record.body, null, 2),
    '```',
    buildVoiceClause(voice),
    contentItemClause,
    buildReviewClause(record),
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
type PageSectionInstance = { id: string; type: string; data: unknown; notes?: string };

/** Plain-text copy: a string, or an array whose every element is a string. */
const isCopyTextValue = (value: unknown): boolean =>
  typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'));

/** The section instance's own `notes` — editor/agent context, never rendered (section-v1.ts). */
const buildSectionNotesClause = (section: PageSectionInstance): string =>
  section.notes && section.notes.trim() !== ''
    ? `\nEditor/agent notes on this section (context only, never rendered to readers): ${section.notes}\n`
    : '';

const buildSectionUserMessage = (
  record: ObjectRecord,
  section: PageSectionInstance,
  request: AskAiObjectRequest,
  voice: EditorialVoiceBody | undefined
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
    buildVoiceClause(voice),
    buildSectionNotesClause(section),
    buildReviewClause(record),
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

/**
 * The node's declared ROLE is context the model should write FOR (a hook
 * reads differently from a resolution) — it flows one way: into the prompt,
 * never into the suggestion (the tool schema has no annotation fields).
 * Extended (mandate item 3) to also surface `node.commercial` — so a
 * suggestion never accidentally strips required disclosure/offer language —
 * and `node.chat` when present.
 */
const buildNodeRoleClause = (node: ContentItemNode): string => {
  const strategy = node.private?.strategy;
  const intent = node.private?.intent;
  const roleLine =
    strategy || intent
      ? `This block's editorial role: ${[strategy, intent && `intent: ${intent}`].filter(Boolean).join(', ')}. Write copy that serves that role.`
      : '';

  const commercial = node.commercial;
  const commercialLine = commercial
    ? `This block carries commercial metadata (${[
        commercial.type,
        commercial.disclosure?.required
          ? `disclosure REQUIRED${commercial.disclosure.label ? `: "${commercial.disclosure.label}"` : ''}`
          : undefined,
        commercial.offer?.terms && `offer terms: ${commercial.offer.terms}`,
        commercial.offer?.couponCode && `coupon ${commercial.offer.couponCode}`,
      ]
        .filter(Boolean)
        .join('; ')}). Never strip required disclosure or offer language unless the instruction explicitly asks for it.`
    : '';

  const chat = node.chat;
  const chatLine =
    chat && (chat.invitationText || chat.suggestedQuery)
      ? `This block also carries a chat invitation${chat.invitationText ? ` ("${chat.invitationText}")` : ''}${
          chat.suggestedQuery ? ` with suggested query "${chat.suggestedQuery}"` : ''
        } — keep any copy change consistent with it.`
      : '';

  const lines = [roleLine, commercialLine, chatLine].filter((line) => line !== '');
  return lines.length ? `\n${lines.join(' ')}\n` : '';
};

const buildNodeUserMessage = (
  record: ObjectRecord,
  node: ContentItemNode,
  request: AskAiObjectRequest,
  voice: EditorialVoiceBody | undefined
): string => {
  const article = record.body as { title?: unknown };
  const selectionClause = request.selected_text
    ? `\nThe editor highlighted this specific span: """${request.selected_text}"""\n`
    : '';
  const roleClause = buildNodeRoleClause(node);
  const contentItemClause = buildContentItemContextClause(record.body as ContentItemBody, node.id);
  return [
    `You are editing ONE BLOCK of the article "${typeof article.title === 'string' ? article.title : record.object_id}".`,
    `The block is a "${node.kind}" node (id ${node.id}). Its current public copy:`,
    '```json',
    JSON.stringify(node.public, null, 2),
    '```',
    buildVoiceClause(voice),
    contentItemClause,
    buildReviewClause(record),
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

  // Site house style (mandate item 1) — fetched once, independent of scope,
  // and folded into every builder below (absent-tolerant: undefined when the
  // site has no editorial_voice object yet).
  const voice = await fetchEditorialVoice(store, record.site);

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
    userMessage = buildNodeUserMessage(record, node, request, voice);
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
    userMessage = buildSectionUserMessage(record, section, request, voice);
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
    userMessage = buildSectionUserMessage(record, inner, request, voice);
  } else {
    // Tool schema derived from the type's zod body schema at request time.
    tool = deriveAskAiToolSchema(bodySchema);
    userMessage = buildUserMessage(record, request, voice);
  }

  const aiResult =
    deps.provider === 'anthropic'
      ? await callAnthropic(userMessage, tool, deps)
      : await callOpenAI(userMessage, tool, deps);
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
