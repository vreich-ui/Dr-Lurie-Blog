/**
 * Creation policy (W8.3b) — the pure resolution layer for one question: may
 * this principal CREATE an object of this type?
 *
 * The model mirrors the approval policy exactly:
 *   - Master rule: 'open' (any principal creates) or an allowlist of agent
 *     names.
 *   - Per-type override map beating the master.
 *   - HUMANS ALWAYS CREATE — the policy constrains agents only.
 *   - Resolution order: override if present → master → (the committed
 *     config's default, which is fully open).
 *
 * ⚠️ HONEST CAVEAT (Wolf, 2026-07-14 — insert the ability now, teeth later):
 * `agent_name` is SELF-DECLARED over the shared publish key (per-agent
 * credentials are OQ-3, deferred). This policy is a **coordination seam, not
 * a security boundary**: it stops well-behaved agents from creating types
 * Wolf has reserved and names who is expected to create what — it does not
 * stop impersonation. When OQ-3 lands, the same allowlist becomes verifiable
 * identity with no schema change here.
 *
 * The policy keys on the type BEING CREATED: restricting `template` restricts
 * who mints new page recipes, not who instantiates pages from them (an
 * instantiate-created page is checked as a `page` create); a standalone
 * section stamp is checked as a `section` create; page-mode stamping and
 * theme application are patches, never gated here.
 *
 * The committed config lives in ONE place: `src/config/creation-policy.ts`.
 * Wolf restricts a type by editing that file — no code changes. It is
 * `satisfies`-checked at compile time AND zod-parsed at runtime; a malformed
 * config THROWS rather than silently resolving to the permissive default.
 * Client-safe (no env, no server imports).
 */
import { z } from 'zod';

import { creationPolicyConfig } from '../config/creation-policy.js';
import type { ObjectType, Principal } from '../schema/object-record-v1.js';
import { isGovernedObjectType, type GovernedObjectType } from './approval-policy.js';

/** 'open', or an allowlist of self-declared agent names (see the caveat above). */
const creationRuleSchema = z.union([z.literal('open'), z.strictObject({ agents: z.array(z.string().min(1)).min(1) })]);
export type CreationRule = z.infer<typeof creationRuleSchema>;

export const creationPolicyConfigSchema = z.strictObject({
  /** The fast lever: the default rule for every governed type at once. */
  master: creationRuleSchema,
  /**
   * Explicit per-type rules that beat the master. Keys are governed object
   * types only — an unknown/typo'd key fails the parse instead of silently
   * doing nothing.
   */
  overrides: z.strictObject({
    page: creationRuleSchema.optional(),
    section: creationRuleSchema.optional(),
    navigation: creationRuleSchema.optional(),
    taxonomy: creationRuleSchema.optional(),
    site: creationRuleSchema.optional(),
    template: creationRuleSchema.optional(),
    section_template: creationRuleSchema.optional(),
    theme: creationRuleSchema.optional(),
    product: creationRuleSchema.optional(),
    content_item: creationRuleSchema.optional(),
  }),
});

export type CreationPolicyConfig = z.infer<typeof creationPolicyConfigSchema>;
export type CreationPolicy = CreationPolicyConfig;

/**
 * Validate a config value into a usable policy. Throws (with the zod detail)
 * on anything malformed — a broken policy config must fail loudly, never
 * quietly fall back to the permissive default.
 */
export const resolveCreationPolicy = (config: unknown): CreationPolicy => {
  const parsed = creationPolicyConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid creation-policy config (src/config/creation-policy.ts): ${parsed.error.message}`);
  }
  return parsed.data;
};

/** The effective rule for one type: override if present, else the master. */
export const creationRuleFor = (objectType: GovernedObjectType, policy: CreationPolicy): CreationRule =>
  policy.overrides[objectType] ?? policy.master;

/** Humans always create; agents resolve through the rule. Ungoverned types are open. */
export const isCreationAllowed = (objectType: ObjectType, principal: Principal, policy: CreationPolicy): boolean => {
  if (principal.kind === 'human') return true;
  if (!isGovernedObjectType(objectType)) return true;
  const rule = creationRuleFor(objectType, policy);
  return rule === 'open' || rule.agents.includes(principal.agent_name);
};

let activePolicy: CreationPolicy | undefined;

/**
 * The committed config, validated once and cached. This is what the verbs
 * use when no policy is injected (tests inject).
 */
export const activeCreationPolicy = (): CreationPolicy => {
  if (!activePolicy) activePolicy = resolveCreationPolicy(creationPolicyConfig);
  return activePolicy;
};
