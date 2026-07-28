/**
 * This site's approval posture. `master` sets the default for every governed
 * type; `overrides` narrows it per type.
 *
 * Commerce is the standing exception to an autonomous posture: an agent
 * PROPOSING a product change is fine, a price going live unseen is not.
 */
import type { ApprovalPolicyConfig } from '../../../packages/core/lib/approval-policy.js';

export const approvalPolicyConfig = {
  master: 'all-autonomous',
  overrides: {
    product: 'require-approval',
    // D1 (2026-07-28): the declared editorial voice governs every future
    // article on this site, so a voice edit going live unseen is the same class
    // of risk as a price going live unseen — one silent change moves all
    // downstream output at once. Agents PROPOSE voice changes; a human pins the
    // approval. (Disputable: this is a posture, not a law — flipping it is a
    // one-line edit here.)
    editorial_voice: 'require-approval',
  },
} satisfies ApprovalPolicyConfig;
