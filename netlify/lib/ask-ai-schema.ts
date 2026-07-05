/**
 * Ask-AI tool-schema derivation (T1.6).
 *
 * The article Ask-AI (admin-ask-ai-node.ts, A§1.4) hand-writes the forced
 * tool's `input_schema` as a literal listing the editable node.public fields.
 * That is exactly the per-type-agreement cost the CMS design set out to remove
 * (A§1.9): a seventh object type would mean a seventh hand-maintained schema.
 *
 * Instead, the tool schema is DERIVED from the object type's own zod body
 * schema (the T0.2 modules) at request time. `deriveAskAiToolSchema` takes any
 * zod schema and produces the Anthropic tool descriptor — so adding a new
 * object type needs nothing here beyond its zod schema existing. The function
 * is deliberately type-agnostic; the only thing that knows the six concrete
 * types is the `ASK_AI_BODY_SCHEMAS` registry below, which simply re-exports
 * the T0.2 schemas (content_item is excluded — Tier 1 keeps the article path).
 *
 * "Partial" is the whole point: the AI returns ONLY the fields it changed, the
 * same contract the article tool states ("include only fields that should
 * change"). Dropping top-level `required` (via zod's `.partial()` where the
 * schema supports it, else by deleting the `required` array) encodes that.
 */
import { z } from 'zod';

import { navigationBodySchema } from '../../src/schema/bodies/navigation-v1.js';
import { pageBodySchema } from '../../src/schema/bodies/page-v1.js';
import { sectionBodySchema } from '../../src/schema/bodies/section-v1.js';
import { siteBodySchema } from '../../src/schema/bodies/site-v1.js';
import { taxonomyBodySchema } from '../../src/schema/bodies/taxonomy-v1.js';
import { templateBodySchema } from '../../src/schema/bodies/template-v1.js';
import type { ObjectType } from '../../src/schema/object-record-v1.js';

export type JsonSchema = Record<string, unknown>;

export interface AskAiTool {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

/** Object types the generic Ask-AI serves — every type except content_item (Tier 1, article path). */
export type AskAiObjectType = Exclude<ObjectType, 'content_item'>;

/**
 * Registry of T0.2 body schemas keyed by object type. This is the ONLY place a
 * concrete type list appears; `deriveAskAiToolSchema` itself never enumerates
 * types. A seventh type is registered here once its T0.2 schema exists — the
 * derivation code is untouched (the T1.6 acceptance property).
 */
export const ASK_AI_BODY_SCHEMAS = {
  page: pageBodySchema,
  section: sectionBodySchema,
  navigation: navigationBodySchema,
  taxonomy: taxonomyBodySchema,
  site: siteBodySchema,
  template: templateBodySchema,
} satisfies Record<AskAiObjectType, z.ZodType>;

export const isAskAiObjectType = (value: string): value is AskAiObjectType =>
  Object.prototype.hasOwnProperty.call(ASK_AI_BODY_SCHEMAS, value);

export const bodySchemaForObjectType = (objectType: string): z.ZodType | undefined =>
  isAskAiObjectType(objectType) ? ASK_AI_BODY_SCHEMAS[objectType] : undefined;

const hasPartial = (schema: z.ZodType): schema is z.ZodType & { partial: () => z.ZodType } =>
  typeof (schema as { partial?: unknown }).partial === 'function';

export interface DeriveAskAiToolOptions {
  /** Forced-tool name; defaults to a stable generic name. */
  toolName?: string;
  /** Tool description shown to the model. */
  description?: string;
}

const DEFAULT_TOOL_NAME = 'propose_object_changes';
const DEFAULT_DESCRIPTION =
  'Return ONLY the fields of this object that should change to satisfy the instruction. ' +
  'Omit every field that stays the same. Preserve the existing voice, tone, and structure.';

/**
 * Derive an Anthropic forced-tool descriptor from ANY zod schema. Generic by
 * construction: no per-type branching, so a new object type is served the
 * moment its zod schema exists (T1.6 acceptance property).
 */
export const deriveAskAiToolSchema = (bodySchema: z.ZodType, options: DeriveAskAiToolOptions = {}): AskAiTool => {
  // The AI proposes a partial (only changed fields). `.partial()` drops the
  // top-level `required` list for object schemas; schemas that can't be made
  // partial (e.g. a union) fall through and have any `required` stripped below.
  const source = hasPartial(bodySchema) ? bodySchema.partial() : bodySchema;

  const jsonSchema = z.toJSONSchema(source, { unrepresentable: 'any', io: 'input' }) as JsonSchema;

  // Anthropic's tool input_schema is a plain JSON Schema object; the $schema
  // dialect marker is noise there. Strip it and any residual top-level
  // `required` (belt-and-suspenders for the non-partial fallback).
  delete jsonSchema.$schema;
  delete jsonSchema.required;

  return {
    name: options.toolName ?? DEFAULT_TOOL_NAME,
    description: options.description ?? DEFAULT_DESCRIPTION,
    input_schema: jsonSchema,
  };
};

/** Convenience: derive the tool for a registered object type, or undefined if unknown. */
export const deriveAskAiToolForObjectType = (
  objectType: string,
  options?: DeriveAskAiToolOptions
): AskAiTool | undefined => {
  const schema = bodySchemaForObjectType(objectType);
  return schema ? deriveAskAiToolSchema(schema, options) : undefined;
};
