/**
 * T9.13 — the chat tool registry (plan §4): a curated wrapper over the verb
 * surface, executed server-side via `handleObjectVerb` under the signed-in
 * HUMAN's Principal. No new write paths — every mutation rides the same core
 * as forms, canvas chips, and MCP.
 *
 * Classes and default autonomy (§4 table; adjustable via governance
 * `chat_tools` + per-profile overrides, resolved at run start):
 *   read        auto   get_object, get_contract, list_objects, inventory,
 *                      validate, search_artifacts
 *   draft       ask    checkout, patch, checkin, refresh_lock
 *   creation    ask    create_object, create_variant, instantiate_template,
 *                      instantiate_section_template (dry-run first — the
 *                      preview rides the approval card)
 *   publication ask    submit_review, publish, discard
 *   privileged  ask    apply_theme (dry-run first + Owner-only at EXECUTION —
 *                      the role gate is independent of autonomy, so even a
 *                      misconfigured 'auto' cannot bypass it)
 *
 * Args are zod-validated BEFORE any pause: garbage never reaches an approval
 * card. `patch` additionally constrains each op's name to the target type's
 * agent-authored contract ops (the engine still re-validates the full
 * grammar). Tool descriptions encode the conversion-playbook trap table —
 * deep-merge patch semantics, explicit key-nulling on variant switches,
 * checkout-before-patch, version threading.
 */
import { z } from 'zod';

import type { Role } from '../roles.js';
import { objectTypeSchema, type ObjectType } from '../../../src/schema/object-record-v1.js';

export type ToolClass = 'read' | 'draft' | 'creation' | 'publication' | 'privileged';
export type ToolAutonomy = 'auto' | 'ask' | 'off';

export interface ToolResult {
  content: string;
  is_error: boolean;
}

/** The execution surface the background function wires up (verb calls carry
 *  the same store validation context as admin-object — enforced there). */
export interface ToolContext {
  verb(request: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }>;
  contract(objectType: ObjectType): Record<string, unknown>;
  /** Synthetic create preview: mint-a-candidate-id + validate, persist nothing. */
  validateNewObject(objectType: ObjectType, body: unknown, requestedId?: string): Promise<Record<string, unknown>>;
  listArtifacts(requestId: string): Promise<Record<string, unknown>>;
  /** Agent-authored patch op names for a type (from the contract). */
  agentAuthoredOps(objectType: ObjectType): Set<string>;
  roles: readonly Role[];
}

export interface ChatTool {
  name: string;
  toolClass: ToolClass;
  description: string;
  input_schema: Record<string, unknown>;
  /** Server-side validation; runs before auto-execution AND before any pause. */
  parse(args: Record<string, unknown>, ctx: ToolContext): { ok: true; value: unknown } | { ok: false; error: string };
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
  /** Present on creation/privileged tools: the preview attached to the approval card. */
  dryRun?(ctx: ToolContext, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** One-line human phrase for cards/feeds ("Patch page_home: 2 ops"). */
  describe(args: Record<string, unknown>): string;
}

const json = (body: unknown) => JSON.stringify(body);
const verbResult = async (ctx: ToolContext, request: Record<string, unknown>): Promise<ToolResult> => {
  const result = await ctx.verb(request);
  return { content: json(result.body), is_error: result.status !== 200 };
};

const zodParse =
  <T>(schema: z.ZodType<T>) =>
  (args: Record<string, unknown>): { ok: true; value: T } | { ok: false; error: string } => {
    const parsed = schema.safeParse(args);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : {
          ok: false,
          error: `Invalid arguments: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
        };
  };

// Shared arg fragments.
const objectRef = { object_type: objectTypeSchema, object_id: z.string().min(1) };
const objectRefJson = {
  object_type: { type: 'string', description: 'One of the ten governed object types.' },
  object_id: { type: 'string' },
};

// ─── read tools ──────────────────────────────────────────────────────────────

const getObject: ChatTool = {
  name: 'get_object',
  toolClass: 'read',
  description:
    'Read a governed object record (body, history, lock, publication state). Use before proposing any change.',
  input_schema: {
    type: 'object',
    properties: objectRefJson,
    required: ['object_type', 'object_id'],
    additionalProperties: false,
  },
  parse: zodParse(z.object(objectRef)),
  execute: (ctx, args) => verbResult(ctx, { action: 'get', ...args }),
  describe: (args) => `Read ${args.object_type} ${args.object_id}`,
};

const getContract: ChatTool = {
  name: 'get_contract',
  toolClass: 'read',
  description:
    'The authoritative contract for an object type: body schema, permitted patch ops with arg schemas, constraints, publish/creation policy, recipe usage hints. Read it before your first write to a type.',
  input_schema: {
    type: 'object',
    properties: { object_type: objectRefJson.object_type },
    required: ['object_type'],
    additionalProperties: false,
  },
  parse: zodParse(z.object({ object_type: objectTypeSchema })),
  execute: async (ctx, args) => ({
    content: json(ctx.contract(args.object_type as ObjectType)),
    is_error: false,
  }),
  describe: (args) => `Read the ${args.object_type} contract`,
};

const listObjects: ChatTool = {
  name: 'list_objects',
  toolClass: 'read',
  description: 'List objects of a type (id, status, version, published_time).',
  input_schema: {
    type: 'object',
    properties: {
      object_type: objectRefJson.object_type,
      status: { type: 'string', enum: ['active', 'archived'] },
    },
    required: ['object_type'],
    additionalProperties: false,
  },
  parse: zodParse(z.object({ object_type: objectTypeSchema, status: z.enum(['active', 'archived']).optional() })),
  execute: (ctx, args) => verbResult(ctx, { action: 'list', ...args }),
  describe: (args) => `List ${args.object_type} objects`,
};

const inventory: ChatTool = {
  name: 'inventory',
  toolClass: 'read',
  description:
    'The live catalog: per object — tier, lock state, review state, unpublished changes, recipe summaries (REUSE FIRST: check for an existing recipe before creating anything).',
  input_schema: {
    type: 'object',
    properties: {
      object_type: objectRefJson.object_type,
      object_id: { type: 'string' },
      status: { type: 'string', enum: ['active', 'archived'] },
      review_state: { type: 'string', enum: ['none', 'open', 'changes_requested', 'approved'] },
      pending_changes: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  parse: zodParse(
    z.object({
      object_type: objectTypeSchema.optional(),
      object_id: z.string().min(1).optional(),
      status: z.enum(['active', 'archived']).optional(),
      review_state: z.enum(['none', 'open', 'changes_requested', 'approved']).optional(),
      pending_changes: z.boolean().optional(),
    })
  ),
  execute: (ctx, args) => verbResult(ctx, { action: 'inventory', ...args }),
  describe: () => 'Browse the object inventory',
};

const validate: ChatTool = {
  name: 'validate',
  toolClass: 'read',
  description:
    'Validate an object as it stands, or preview a candidate patch (candidate_patch) without persisting. Run before publish; blockers explain themselves.',
  input_schema: {
    type: 'object',
    properties: { ...objectRefJson, candidate_patch: { type: 'array', items: { type: 'object' } } },
    required: ['object_type', 'object_id'],
    additionalProperties: false,
  },
  parse: zodParse(z.object({ ...objectRef, candidate_patch: z.array(z.unknown()).optional() })),
  execute: (ctx, args) => verbResult(ctx, { action: 'validate', ...args }),
  describe: (args) => `Validate ${args.object_type} ${args.object_id}`,
};

const searchArtifacts: ChatTool = {
  name: 'search_artifacts',
  toolClass: 'read',
  description:
    'List the artifact references (images/PDFs with public paths) indexed for a request id — how you find media to reference from content.',
  input_schema: {
    type: 'object',
    properties: { request_id: { type: 'string' } },
    required: ['request_id'],
    additionalProperties: false,
  },
  parse: zodParse(z.object({ request_id: z.string().min(1) })),
  execute: async (ctx, args) => ({
    content: json(await ctx.listArtifacts(args.request_id as string)),
    is_error: false,
  }),
  describe: (args) => `List artifacts for ${args.request_id}`,
};

// ─── draft-write tools ───────────────────────────────────────────────────────

const checkout: ChatTool = {
  name: 'checkout',
  toolClass: 'draft',
  description:
    'Take the edit lock on an object. Returns lockToken + record_version — thread BOTH into every patch. One lock per object; check in when done.',
  input_schema: {
    type: 'object',
    properties: { ...objectRefJson, lease_seconds: { type: 'integer', minimum: 1 } },
    required: ['object_type', 'object_id'],
    additionalProperties: false,
  },
  parse: zodParse(z.object({ ...objectRef, lease_seconds: z.number().int().positive().optional() })),
  execute: (ctx, args) => verbResult(ctx, { action: 'checkout', ...args }),
  describe: (args) => `Check out ${args.object_type} ${args.object_id} for editing`,
};

const patchArgsSchema = z.object({
  ...objectRef,
  lock_token: z.string().min(1),
  expected_record_version: z.number().int().nonnegative(),
  ops: z.array(z.record(z.string(), z.unknown())).min(1),
});
const patch: ChatTool = {
  name: 'patch',
  toolClass: 'draft',
  description:
    "Apply contract patch ops under YOUR checkout. TRAPS: `fields` DEEP-MERGES — set a key to null to remove it; switching a section variant requires nulling the old variant's keys explicitly. expected_record_version comes from checkout (and bumps on every write — re-read on 409). Ops must be ops the type's contract permits (get_contract).",
  input_schema: {
    type: 'object',
    properties: {
      ...objectRefJson,
      lock_token: { type: 'string' },
      expected_record_version: { type: 'integer' },
      ops: { type: 'array', items: { type: 'object' }, minItems: 1 },
    },
    required: ['object_type', 'object_id', 'lock_token', 'expected_record_version', 'ops'],
    additionalProperties: false,
  },
  parse: (args, ctx) => {
    const parsed = patchArgsSchema.safeParse(args);
    if (!parsed.success) {
      return { ok: false, error: `Invalid arguments: ${parsed.error.issues.map((issue) => issue.message).join('; ')}` };
    }
    // Contract constraint: each op's name must be agent-authored for this type.
    const allowed = ctx.agentAuthoredOps(parsed.data.object_type);
    for (const op of parsed.data.ops) {
      const opName = typeof op.op === 'string' ? op.op : undefined;
      if (!opName || !allowed.has(opName)) {
        return {
          ok: false,
          error:
            `Op "${opName ?? '(missing op name)'}" is not a permitted agent-authored op for ${parsed.data.object_type}. ` +
            `Permitted: ${[...allowed].join(', ')}.`,
        };
      }
    }
    return { ok: true, value: parsed.data };
  },
  execute: (ctx, args) => verbResult(ctx, { action: 'patch', ...args }),
  describe: (args) =>
    `Patch ${args.object_type} ${args.object_id}: ${Array.isArray(args.ops) ? args.ops.length : '?'} op(s)`,
};

const checkin: ChatTool = {
  name: 'checkin',
  toolClass: 'draft',
  description: 'Release your edit lock when the editing pass is done.',
  input_schema: {
    type: 'object',
    properties: { ...objectRefJson, lock_token: { type: 'string' } },
    required: ['object_type', 'object_id', 'lock_token'],
    additionalProperties: false,
  },
  parse: zodParse(z.object({ ...objectRef, lock_token: z.string().min(1) })),
  execute: (ctx, args) => verbResult(ctx, { action: 'checkin', ...args }),
  describe: (args) => `Check in ${args.object_type} ${args.object_id}`,
};

const refreshLock: ChatTool = {
  name: 'refresh_lock',
  toolClass: 'draft',
  description: 'Extend your lock lease during a long editing pass.',
  input_schema: {
    type: 'object',
    properties: { ...objectRefJson, lock_token: { type: 'string' }, lease_seconds: { type: 'integer', minimum: 1 } },
    required: ['object_type', 'object_id', 'lock_token'],
    additionalProperties: false,
  },
  parse: zodParse(
    z.object({ ...objectRef, lock_token: z.string().min(1), lease_seconds: z.number().int().positive().optional() })
  ),
  execute: (ctx, args) => verbResult(ctx, { action: 'refresh_lock', ...args }),
  describe: (args) => `Refresh the lock on ${args.object_type} ${args.object_id}`,
};

// ─── creation tools (dry-run first) ──────────────────────────────────────────

const createArgs = z.object({
  object_type: objectTypeSchema,
  site: z.string().min(1),
  body: z.unknown(),
  requested_id: z.string().min(1).optional(),
});
const createObject: ChatTool = {
  name: 'create_object',
  toolClass: 'creation',
  description:
    'Create a new governed object. REUSE FIRST: check inventory for an existing object or recipe before minting. The approval card shows a validation preview; invalid bodies are rejected without persisting.',
  input_schema: {
    type: 'object',
    properties: {
      object_type: objectRefJson.object_type,
      site: { type: 'string', description: 'Site id, e.g. site_drlurie.' },
      body: { type: 'object' },
      requested_id: { type: 'string' },
    },
    required: ['object_type', 'site', 'body'],
    additionalProperties: false,
  },
  parse: zodParse(createArgs),
  execute: (ctx, args) => verbResult(ctx, { action: 'create', ...args }),
  dryRun: (ctx, args) =>
    ctx.validateNewObject(args.object_type as ObjectType, args.body, args.requested_id as string | undefined),
  describe: (args) => `Create a new ${args.object_type}`,
};

const createVariant: ChatTool = {
  name: 'create_variant',
  toolClass: 'creation',
  description:
    'Clone an article (content_item) as a draft variant with lineage. Variants may not share the source slug.',
  input_schema: {
    type: 'object',
    properties: {
      source_object_id: { type: 'string' },
      slug: { type: 'string' },
      requested_id: { type: 'string' },
    },
    required: ['source_object_id'],
    additionalProperties: false,
  },
  parse: zodParse(
    z.object({
      source_object_id: z.string().min(1),
      slug: z.string().min(1).optional(),
      requested_id: z.string().min(1).optional(),
    })
  ),
  execute: (ctx, args) => verbResult(ctx, { action: 'create_variant', object_type: 'content_item', ...args }),
  dryRun: async (ctx, args) =>
    (await ctx.verb({ action: 'create_variant', object_type: 'content_item', ...args, dry_run: true })).body,
  describe: (args) => `Create a variant of ${args.source_object_id}`,
};

const instantiateTemplate: ChatTool = {
  name: 'instantiate_template',
  toolClass: 'creation',
  description:
    'Create a PAGE from a template recipe (tpl_*). REUSE FIRST — inventory lists recipes with description/whenToUse/scope. The approval card shows the dry-run body + validation.',
  input_schema: {
    type: 'object',
    properties: {
      template_id: { type: 'string' },
      site: { type: 'string' },
      route: { type: 'string' },
      title: { type: 'string' },
      page_type: { type: 'string' },
      requested_id: { type: 'string' },
    },
    required: ['template_id', 'site', 'route', 'title'],
    additionalProperties: false,
  },
  parse: zodParse(
    z.object({
      template_id: z.string().min(1),
      site: z.string().min(1),
      route: z.string().min(1),
      title: z.string().min(1),
      page_type: z.string().min(1).optional(),
      requested_id: z.string().min(1).optional(),
    })
  ),
  execute: (ctx, args) => verbResult(ctx, { action: 'instantiate', ...args }),
  dryRun: async (ctx, args) => (await ctx.verb({ action: 'instantiate', ...args, dry_run: true })).body,
  describe: (args) => `Create a page at ${args.route} from ${args.template_id}`,
};

const instantiateSectionTarget = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('page'),
    page_id: z.string().min(1),
    position: z.number().int().nonnegative().optional(),
    lock_token: z.string().min(1).optional(),
    expected_record_version: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal('standalone'), requested_id: z.string().min(1).optional() }),
]);
const instantiateSectionTemplate: ChatTool = {
  name: 'instantiate_section_template',
  toolClass: 'creation',
  description:
    'Stamp a section from a recipe (stpl_*): into a page you hold the checkout for (target.kind=page, lock_token + expected_record_version required on execute), or as a standalone shared sec_* object.',
  input_schema: {
    type: 'object',
    properties: {
      section_template_id: { type: 'string' },
      target: {
        type: 'object',
        description:
          '{kind:"page", page_id, position?, lock_token?, expected_record_version?} or {kind:"standalone", requested_id?}',
      },
    },
    required: ['section_template_id', 'target'],
    additionalProperties: false,
  },
  parse: zodParse(z.object({ section_template_id: z.string().min(1), target: instantiateSectionTarget })),
  execute: (ctx, args) => verbResult(ctx, { action: 'instantiate_section', ...args }),
  dryRun: async (ctx, args) => (await ctx.verb({ action: 'instantiate_section', ...args, dry_run: true })).body,
  describe: (args) => {
    const target = args.target as { kind?: string; page_id?: string } | undefined;
    return target?.kind === 'page'
      ? `Stamp ${args.section_template_id} into ${target.page_id}`
      : `Mint a shared section from ${args.section_template_id}`;
  },
};

// ─── publication tools ───────────────────────────────────────────────────────

const submitReview: ChatTool = {
  name: 'submit_review',
  toolClass: 'publication',
  description: 'Open review on your drafted changes (approval-gated types), under your checkout.',
  input_schema: {
    type: 'object',
    properties: { ...objectRefJson, lock_token: { type: 'string' }, note: { type: 'string' } },
    required: ['object_type', 'object_id', 'lock_token'],
    additionalProperties: false,
  },
  parse: zodParse(z.object({ ...objectRef, lock_token: z.string().min(1), note: z.string().optional() })),
  execute: (ctx, args) => verbResult(ctx, { action: 'submit_review', ...args }),
  describe: (args) => `Submit ${args.object_type} ${args.object_id} for review`,
};

const publish: ChatTool = {
  name: 'publish',
  toolClass: 'publication',
  description:
    'Publish an object (export commit; the deploy stays deferred — release is a separate human step). published_time omitted = now; an explicit ISO timestamp backdates/forward-stamps. Unpublish is not supported.',
  input_schema: {
    type: 'object',
    properties: { ...objectRefJson, lock_token: { type: 'string' }, published_time: { type: 'string' } },
    required: ['object_type', 'object_id', 'lock_token'],
    additionalProperties: false,
  },
  parse: zodParse(z.object({ ...objectRef, lock_token: z.string().min(1), published_time: z.string().optional() })),
  execute: (ctx, args) => verbResult(ctx, { action: 'publish_by_time', ...args }),
  describe: (args) => `Publish ${args.object_type} ${args.object_id}`,
};

const discard: ChatTool = {
  name: 'discard',
  toolClass: 'publication',
  description:
    'Revert drafted-but-unpublished changes by replaying history inverses. entries = the exact {op, capture} pairs from the history entries being rejected (newest first).',
  input_schema: {
    type: 'object',
    properties: {
      ...objectRefJson,
      lock_token: { type: 'string' },
      entries: { type: 'array', items: { type: 'object' }, minItems: 1 },
    },
    required: ['object_type', 'object_id', 'lock_token', 'entries'],
    additionalProperties: false,
  },
  parse: zodParse(
    z.object({
      ...objectRef,
      lock_token: z.string().min(1),
      entries: z.array(z.object({ op: z.unknown(), capture: z.unknown() })).min(1),
    })
  ),
  execute: (ctx, args) => verbResult(ctx, { action: 'discard', ...args }),
  describe: (args) => `Discard drafted changes on ${args.object_type} ${args.object_id}`,
};

// ─── privileged ──────────────────────────────────────────────────────────────

const applyTheme: ChatTool = {
  name: 'apply_theme',
  toolClass: 'privileged',
  description:
    "OWNER-ONLY. Apply a theme's tokens to the site singleton (exact-replace; stale keys unset) under YOUR site checkout. The palette changes ONLY through this verb. Publish/release stay separate deliberate steps.",
  input_schema: {
    type: 'object',
    properties: {
      theme_id: { type: 'string' },
      site_id: { type: 'string' },
      lock_token: { type: 'string' },
      expected_record_version: { type: 'integer' },
    },
    required: ['theme_id', 'site_id', 'lock_token', 'expected_record_version'],
    additionalProperties: false,
  },
  parse: zodParse(
    z.object({
      theme_id: z.string().min(1),
      site_id: z.string().min(1),
      lock_token: z.string().min(1),
      expected_record_version: z.number().int().nonnegative(),
    })
  ),
  execute: async (ctx, args) => {
    // The role wall is here, at execution — independent of autonomy config.
    if (!ctx.roles.includes('owner')) {
      return { content: json({ error: 'apply_theme requires the Owner role.' }), is_error: true };
    }
    return verbResult(ctx, { action: 'apply_theme', ...args });
  },
  dryRun: async (ctx, args) =>
    (
      await ctx.verb({
        action: 'apply_theme',
        theme_id: args.theme_id,
        site_id: args.site_id,
        dry_run: true,
      })
    ).body,
  describe: (args) => `Apply theme ${args.theme_id} to ${args.site_id}`,
};

// ─── registry ────────────────────────────────────────────────────────────────

export const CHAT_TOOLS: readonly ChatTool[] = [
  getObject,
  getContract,
  listObjects,
  inventory,
  validate,
  searchArtifacts,
  checkout,
  patch,
  checkin,
  refreshLock,
  createObject,
  createVariant,
  instantiateTemplate,
  instantiateSectionTemplate,
  submitReview,
  publish,
  discard,
  applyTheme,
];

export const chatToolByName = (name: string): ChatTool | undefined => CHAT_TOOLS.find((tool) => tool.name === name);

/** §4 defaults by class. */
export const defaultAutonomyFor = (tool: ChatTool): ToolAutonomy => (tool.toolClass === 'read' ? 'auto' : 'ask');

/**
 * Resolve the frozen per-run autonomy map: defaults ← governance chat_tools
 * (site-wide, Owner-set) ← profile overrides (most specific wins). Both
 * layers are Owner-managed; apply_theme's Owner gate is enforced at
 * execution regardless of what this resolves to.
 */
export const resolveAutonomy = (
  governanceChatTools: Record<string, ToolAutonomy> | undefined,
  profileOverrides: Record<string, ToolAutonomy> | undefined
): Record<string, ToolAutonomy> => {
  const autonomy: Record<string, ToolAutonomy> = {};
  for (const tool of CHAT_TOOLS) {
    autonomy[tool.name] = profileOverrides?.[tool.name] ?? governanceChatTools?.[tool.name] ?? defaultAutonomyFor(tool);
  }
  return autonomy;
};
