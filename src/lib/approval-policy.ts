/**
 * Approval policy (replaces T1.4's hardcoded tiers) — the pure resolution
 * layer for the publish gate's ONE question: does publishing a change to
 * this object type require a current human approval first?
 *
 * The model, exactly (task brief, 2026-07-07):
 *   - One gate only: approval. The old Tier 3 "human must execute the
 *     publish" step no longer exists — when a gated type is approved, the
 *     AGENT executes the publish; approval is the only human touch.
 *   - Master switch: 'all-autonomous' (nothing requires approval) or
 *     'all-require-approval' (everything does).
 *   - Per-type override map: individual object types can be pinned to
 *     'require-approval' or 'autonomous', beating the master switch.
 *   - Resolution order: override if present → master switch → hardcoded
 *     default 'autonomous'. An unconfigured type in an unconfigured system
 *     is fully autonomous.
 *
 * `content_item` (articles) is deliberately NOT governable here: it stays
 * outside the generic publish gate entirely (OQ-8, the existing article
 * pipeline), and the config schema rejects it as an override key so a
 * config edit cannot even appear to reach it.
 *
 * This module is client-safe on purpose (no env, no server imports): the
 * admin objects UI reads the same committed config to decide which buttons
 * to render, while enforcement stays server-side in
 * netlify/lib/publish-gate.ts.
 *
 * The committed config lives in ONE place: `src/config/approval-policy.ts`.
 * Wolf flips the whole posture (or gates a single type) by editing that
 * file — no code changes. It is `satisfies`-checked at compile time AND
 * zod-parsed at runtime; a malformed config THROWS rather than silently
 * resolving to the permissive default.
 */
import { z } from 'zod';

import { approvalPolicyConfig } from '../config/approval-policy.js';
import type { ObjectType } from '../schema/object-record-v1.js';

/** Every object type the generic publish gate governs — all types except content_item. */
export const governedObjectTypes = ['page', 'section', 'navigation', 'taxonomy', 'site', 'template'] as const;
export type GovernedObjectType = (typeof governedObjectTypes)[number];

export const isGovernedObjectType = (objectType: ObjectType): objectType is GovernedObjectType =>
  (governedObjectTypes as readonly string[]).includes(objectType);

export const approvalPolicyConfigSchema = z.strictObject({
  /** The fast lever: flips the default posture for every governed type at once. */
  master: z.enum(['all-autonomous', 'all-require-approval']),
  /**
   * Explicit per-type pins that beat the master switch. Keys are governed
   * object types only — content_item is structurally unrepresentable, and
   * an unknown/typo'd key fails the parse instead of silently doing nothing.
   */
  overrides: z.strictObject({
    page: z.enum(['require-approval', 'autonomous']).optional(),
    section: z.enum(['require-approval', 'autonomous']).optional(),
    navigation: z.enum(['require-approval', 'autonomous']).optional(),
    taxonomy: z.enum(['require-approval', 'autonomous']).optional(),
    site: z.enum(['require-approval', 'autonomous']).optional(),
    template: z.enum(['require-approval', 'autonomous']).optional(),
  }),
});

export type ApprovalPolicyConfig = z.infer<typeof approvalPolicyConfigSchema>;
export type ApprovalPolicy = ApprovalPolicyConfig;

/**
 * Validate a config value into a usable policy. Throws (with the zod detail)
 * on anything malformed — a broken policy config must fail loudly, never
 * quietly fall back to the permissive default.
 */
export const resolveApprovalPolicy = (config: unknown): ApprovalPolicy => {
  const parsed = approvalPolicyConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid approval-policy config (src/config/approval-policy.ts): ${parsed.error.message}`);
  }
  return parsed.data;
};

/**
 * The one resolution rule: per-type override if present, else the master
 * switch. (The 'else hardcoded autonomous' leg of the spec is the DEFAULT of
 * the committed config itself — a parsed policy always carries a master.)
 */
export const publishRequiresApproval = (objectType: GovernedObjectType, policy: ApprovalPolicy): boolean => {
  const override = policy.overrides[objectType];
  if (override !== undefined) return override === 'require-approval';
  return policy.master === 'all-require-approval';
};

let activePolicy: ApprovalPolicy | undefined;

/**
 * The committed config, validated once and cached. This is what the server
 * gate and the admin UI use when no policy is injected (tests inject).
 */
export const activeApprovalPolicy = (): ApprovalPolicy => {
  if (!activePolicy) activePolicy = resolveApprovalPolicy(approvalPolicyConfig);
  return activePolicy;
};
