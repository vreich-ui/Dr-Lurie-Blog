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
 * human approves (in the object workspace, /admin/content/<id>) → the AGENT
 * publishes. Any body edit after the approval invalidates it (content_revision
 * moves) and the change waits again. There is no separate "human executes the
 * publish" step.
 *
 * Articles (content_item) joined the governed set at W7.3 and stay Tier 1
 * (OQ-W7-4, Wolf 2026-07-12): autonomous under the master — agents publish
 * articles directly, exactly the trust posture the article pipeline had.
 *
 * Every publish — autonomous or approved — still writes the full audit
 * trail (actor, patch + inverse, receipt); this switch changes who must say
 * yes, never what gets recorded.
 *
 * Dev-stage default: all-autonomous, with `product` pinned to
 * require-approval (commerce never publishes without a human eye).
 */
import type { ApprovalPolicyConfig } from '../../packages/core/lib/approval-policy.js';

export const approvalPolicyConfig = {
  master: 'all-autonomous',
  // Commerce is the deliberate exception to the autonomous dev posture
  // (06-shop-module-plan §0.4): an agent PROPOSING a product change is fine;
  // a price/availability change going live without a human eye is not.
  overrides: { product: 'require-approval' },
} satisfies ApprovalPolicyConfig;
