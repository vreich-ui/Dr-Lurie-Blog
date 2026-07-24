/**
 * The COMMITTED creation-policy config (W8.3b) — who may CREATE objects of
 * each type. Wolf's one-file lever, the approval-policy twin: edit this file
 * to restrict a type, no code changes.
 *
 *   master: 'open'                    → any principal creates any type;
 *   master: { agents: ['name', …] }   → only listed agents (humans always may);
 *   overrides.<type>                  → per-type rule beating the master,
 *                                       e.g. template: { agents: ['site-builder'] }.
 *
 * Dev-stage default: fully open — the seam exists (enforced in the create/
 * instantiate verbs, surfaced in every object_contract), the restrictions
 * arrive when Wolf writes them. ⚠️ agent names are SELF-DECLARED until OQ-3
 * per-agent credentials land: treat this as coordination, not security (full
 * caveat in src/lib/creation-policy.ts).
 */
import type { CreationPolicyConfig } from '../../packages/core/lib/creation-policy.js';

export const creationPolicyConfig = {
  master: 'open',
  // W13 (12-plan §3 governance, OQ-W13-2 ruling 2026-07-19): tracking_config
  // is human/seed-minted ONLY — agents edit the singleton, they never mint
  // one. Publish ships AUTONOMOUS (no approval-policy override; the master
  // covers it); the posture gains an owner UI toggle in T13.12.
  // T13.10: 'object-conversion-roundtrip' IS the sanctioned seed identity —
  // the ruling's "seeds mint" needs a name, and the conversion-factory
  // driver is the seed machinery (self-declared until OQ-3: coordination,
  // not security). Casual agents remain excluded.
  overrides: { tracking_config: { agents: ['object-conversion-roundtrip'] } },
} satisfies CreationPolicyConfig;
