/**
 * Media policy — the pure resolution layer for one question: what is this
 * site's image byte budget, and how does Dr-Lurie react when an image exceeds
 * it? The creation/approval-policy twin: a committed config + a zod-validated
 * resolver, no env and no server imports (client-safe, so object_contract can
 * surface it and the browser upload UI can read the same numbers).
 *
 * The budget rides the pdf-tool storage grant
 * (netlify/lib/pdf-tool-storage-grant.ts) so every agent AND pdf-tool receives
 * the same per-site limit, and it is surfaced in object_contract. Enforcement
 * is deliberately soft by default: `overBudget: 'warn'` accepts an oversize
 * image but flags it (agents abide unless explicitly told to exceed; admins
 * keep their own judgement); `overBudget: 'block'` rejects it outright. The
 * toggle lives right next to the limit in src/config/media-policy.ts.
 *
 * The committed config lives in ONE place: `src/config/media-policy.ts`. Retune
 * the budget or flip warn↔block by editing that file — no code changes. It is
 * `satisfies`-checked at compile time AND zod-parsed at runtime; a malformed
 * config THROWS rather than silently resolving to a default.
 */
import { z } from 'zod';

/** How Dr-Lurie reacts to an image over the byte budget. Sits next to the limit. */
const overBudgetModeSchema = z.enum(['warn', 'block']);
export type OverBudgetMode = z.infer<typeof overBudgetModeSchema>;

/** Web-optimized formats pdf-tool encodes to when generating or shrinking images. */
const preferredImageFormatSchema = z.enum(['webp', 'png']);
export type PreferredImageFormat = z.infer<typeof preferredImageFormatSchema>;

export const mediaPolicyConfigSchema = z.strictObject({
  /** Hard per-image byte budget, optimized for web (default 150 KB). */
  maxImageBytes: z.number().int().positive(),
  /** The toggle, next to the limit: 'warn' (accept + flag) or 'block' (reject). */
  overBudget: overBudgetModeSchema,
  /** Format pdf-tool should target when it generates or shrinks an image. */
  preferredImageFormat: preferredImageFormatSchema,
});

export type MediaPolicyConfig = z.infer<typeof mediaPolicyConfigSchema>;
export type MediaPolicy = MediaPolicyConfig;

/**
 * Validate a config value into a usable policy. Throws (with the zod detail) on
 * anything malformed — a broken media-policy config must fail loudly, never
 * quietly fall back to a default budget.
 */
export const resolveMediaPolicy = (config: unknown): MediaPolicy => {
  const parsed = mediaPolicyConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid media-policy config (src/config/media-policy.ts): ${parsed.error.message}`);
  }
  return parsed.data;
};

/** True when a stored/declared image is over the per-site byte budget. */
export const imageExceedsBudget = (sizeBytes: number, policy: MediaPolicy): boolean =>
  Number.isFinite(sizeBytes) && sizeBytes > policy.maxImageBytes;

/**
 * The projection carried on the pdf-tool storage grant and surfaced in
 * object_contract — the exact fields agents and pdf-tool act on.
 */
export type MediaPolicyLimits = {
  maxImageBytes: number;
  preferredImageFormat: PreferredImageFormat;
  overBudget: OverBudgetMode;
};

export const mediaPolicyLimits = (policy: MediaPolicy): MediaPolicyLimits => ({
  maxImageBytes: policy.maxImageBytes,
  preferredImageFormat: policy.preferredImageFormat,
  overBudget: policy.overBudget,
});

/**
 * Provider-injection seam (W11 T11.2). Core law must not import the site's
 * committed config (`src/config/media-policy.ts` stays site-side); the site
 * registers the provider once at startup (see `src/config/policy-bindings.ts`).
 * Behavior unchanged — lazy validate-once, only the config source is injected.
 */
let activeMediaPolicyProvider: (() => MediaPolicy) | undefined;

export const setActiveMediaPolicyProvider = (provider: () => MediaPolicy): void => {
  activeMediaPolicyProvider = provider;
};

/** The active media policy, resolved through the site-registered provider (tests inject their own). */
export const activeMediaPolicy = (): MediaPolicy => {
  if (!activeMediaPolicyProvider) {
    throw new Error(
      'Active media policy provider not configured — import the site policy bindings (src/config/policy-bindings) before calling activeMediaPolicy().',
    );
  }
  return activeMediaPolicyProvider();
};
