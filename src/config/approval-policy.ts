/**
 * THE approval posture of the CMS publish gate — the single editable place.
 *
 * Editing this file (and nothing else) changes who may publish what:
 *
 *   master: 'all-autonomous'        → no object type requires approval;
 *                                     agents propose AND publish directly.
 *   master: 'all-require-approval'  → every type waits for a human approval
 *                                     before anyone (agent included) may
 *                                     publish it.
 *
 *   overrides                       → pin individual types against the
 *                                     master. Examples:
 *                                       overrides: { navigation: 'require-approval' }
 *                                         gates navigation while everything
 *                                         else stays autonomous;
 *                                       overrides: { page: 'autonomous' }
 *                                         frees pages under an
 *                                         all-require-approval master.
 *
 * When a type requires approval: an agent proposes → the change waits → a
 * human approves (in /admin/objects/…) → the AGENT publishes. Any body edit
 * after the approval invalidates it (content_revision moves) and the change
 * waits again. There is no separate "human executes the publish" step.
 *
 * Articles (content_item) are NOT governed by this config — they keep their
 * own pipeline, and the schema rejects them as an override key.
 *
 * Every publish — autonomous or approved — still writes the full audit
 * trail (actor, patch + inverse, receipt); this switch changes who must say
 * yes, never what gets recorded.
 *
 * Dev-stage default: all-autonomous, no overrides.
 */
import type { ApprovalPolicyConfig } from '../lib/approval-policy.js';

export const approvalPolicyConfig = {
  master: 'all-autonomous',
  overrides: {},
} satisfies ApprovalPolicyConfig;
