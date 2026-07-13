/**
 * Publish-gate enforcement — the project's security boundary, now driven by
 * the CONFIGURABLE approval policy (src/config/approval-policy.ts via
 * src/lib/approval-policy.ts) instead of T1.4's hardcoded tiers. The old
 * three-tier scheme (Tier 2 approval-gated, Tier 3 human-executed) is
 * replaced by exactly one question per object type: does publishing require
 * a current human approval? There is no human-execute step anymore — on a
 * gated type, approval is the only human touch and the agent executes the
 * publish.
 *
 * Per resolved posture:
 *
 *   Type does NOT require approval (the unconfigured default): agents
 *     publish directly; humans need publish authority (admin/publisher —
 *     the pre-existing role model, unchanged by the policy layer). Review
 *     state, if any exists on the record, is advisory and deliberately NOT
 *     consulted: the policy switch means what it says, and a half-gate that
 *     sometimes blocks an "open" type would be exactly the subtle bug this
 *     layer must not have. Gate anything by config, not by leftover state.
 *
 *   Type DOES require approval: the preserved T1.4 approval logic, exactly —
 *     a CURRENT approval on first publish and every publish. An agent may
 *     execute only if the approval additionally pins the exact publish
 *     action it is attempting (M-6). A human with publish authority is not
 *     constrained by the pin — the pin constrains delegated execution
 *     (C§2.2).
 *
 *   content_item: governed since W7.3 (08-articles-plan; OQ-8 resolved as
 *     migration) — Tier 1 preserved as 'autonomous' under the committed
 *     policy. The non-governed deny branch below is defensive only.
 *
 * Approval currency (D§3.9, via effectiveApproval — the twice-hardened
 * invariant, preserved verbatim): an approval is invalidated the moment
 * `content_revision` moves past the pinned value — i.e. by any body write,
 * including a discard's compensating inverse. It is NOT invalidated by lock
 * checkout/refresh/checkin or by the publish stamp itself, which bump only
 * `version` (D§3.1 counter independence).
 *
 * M-6 action matching (agents on gated types, exact rules from C§2.2):
 *   pin 'immediate'  ⇔ the publish call omits published_time
 *   pin <ISO>        ⇔ the call supplies the same instant
 *   pin null         ⇔ the call requests null — the ONLY thing that
 *                      authorizes an agent unpublish
 * Anything else requires re-approval. (Whether the action is executable at
 * all — future times, null — is the publish operation's own T1.3 scheduling
 * gate; this gate answers authorization, not schedulability.)
 *
 * Audit independence: nothing here is load-bearing for the audit trail.
 * History attribution and the patch/inverse capture happen in the T0.6
 * engine and T1.3's publish stamp regardless of which branch this gate
 * takes — an autonomous publish is as attributed and as revertible as an
 * approved one.
 *
 * The gate is pure and composable: callers resolve roles (roles.ts) and
 * hand in the record; the publish endpoint runs the gate BEFORE
 * publishObject (which by design assumes it is already authorized). The
 * policy defaults to the committed config; tests inject their own.
 */
import { effectiveApproval, type PublishAction } from './review-state.js';
import { canExecutePublish, type Role } from './roles.js';
import {
  activeApprovalPolicy,
  isGovernedObjectType,
  publishRequiresApproval,
  type ApprovalPolicy,
} from '../../src/lib/approval-policy.js';
import type { ObjectRecord, Principal } from '../../src/schema/object-record-v1.js';

export type RequestedPublishAction = {
  /** As the publish call supplies it: ISO string, null (unpublish), or omitted (= immediate). */
  published_time?: string | null;
};

export type PublishGateDenialCode =
  | 'content_item_not_gated'
  | 'approval_required'
  | 'changes_requested'
  | 'approval_stale'
  | 'publish_role_required'
  | 'publish_action_not_pinned'
  | 'publish_action_mismatch';

export type PublishGateResult =
  | {
      allow: true;
      requires_approval: boolean;
      /** Present exactly when the type required approval — the consumed approval's pin. */
      approval?: { content_revision: number; publish_action?: PublishAction };
    }
  | { allow: false; requires_approval: boolean; status: 403; code: PublishGateDenialCode; reason: string };

const deny = (requiresApproval: boolean, code: PublishGateDenialCode, reason: string): PublishGateResult => ({
  allow: false,
  requires_approval: requiresApproval,
  status: 403,
  code,
  reason,
});

/** M-6 exact-match rules. ISO comparison is by instant, not by string formatting. */
const publishActionMatchesPin = (pin: PublishAction, requested: RequestedPublishAction): boolean => {
  if (pin.published_time === 'immediate') return requested.published_time === undefined;
  if (pin.published_time === null) return requested.published_time === null;
  if (typeof requested.published_time !== 'string') return false;
  const pinned = Date.parse(pin.published_time);
  const asked = Date.parse(requested.published_time);
  return !Number.isNaN(pinned) && !Number.isNaN(asked) && pinned === asked;
};

export type PublishGateInput = {
  record: ObjectRecord;
  principal: Principal;
  /** Roles resolved for the principal (roles.ts); agents resolve to []. */
  roles: readonly Role[];
  requested: RequestedPublishAction;
  /** The approval policy; defaults to the committed src/config/approval-policy.ts. */
  policy?: ApprovalPolicy;
};

export const checkPublishGate = (input: PublishGateInput): PublishGateResult => {
  const objectType = input.record.object_type;

  if (!isGovernedObjectType(objectType)) {
    // Unreachable since W7.3 (all nine types are governed); kept so a future
    // ungoverned type fails closed instead of publishing ungated.
    return deny(false, 'content_item_not_gated', `${objectType} is not governed by the generic publish gate.`);
  }

  const policy = input.policy ?? activeApprovalPolicy();
  const requiresApproval = publishRequiresApproval(objectType, policy);

  if (!requiresApproval) {
    // Autonomous: the configured posture for this type is "no human in the
    // loop" — agents publish directly. Humans still need publish authority
    // (the pre-existing role model, orthogonal to the approval policy).
    if (input.principal.kind === 'human' && !canExecutePublish(input.roles)) {
      return deny(false, 'publish_role_required', 'Executing a publish requires the admin or publisher role.');
    }
    return { allow: true, requires_approval: false };
  }

  const approval = effectiveApproval(input.record);
  if (approval.state === 'changes_requested') {
    return deny(true, 'changes_requested', 'Changes were requested; resubmit for review before publishing.');
  }
  if (approval.state === 'none' || approval.state === 'open') {
    return deny(
      true,
      'approval_required',
      `Publishing ${objectType} requires an approved review (approval policy: ${
        policy.overrides[objectType] !== undefined ? 'per-type override' : `master ${policy.master}`
      }).`
    );
  }
  if (approval.state === 'approved_stale') {
    return deny(
      true,
      'approval_stale',
      `The approval pins content_revision ${approval.approval.content_revision} but the body has moved to ${input.record.content_revision}; re-approval is required (D§3.9).`
    );
  }

  // approval.state === 'approved_current'
  if (input.principal.kind === 'human') {
    if (!canExecutePublish(input.roles)) {
      return deny(true, 'publish_role_required', 'Executing a publish requires the admin or publisher role.');
    }
    // Humans are not constrained by the pin (C§2.2): publish authority is
    // their own; the pin constrains delegated (agent) execution.
    return {
      allow: true,
      requires_approval: true,
      approval: {
        content_revision: approval.approval.content_revision,
        ...(approval.approval.publish_action !== undefined ? { publish_action: approval.approval.publish_action } : {}),
      },
    };
  }

  // Agent on a gated type: the approval must pin the exact action attempted.
  const pin = approval.approval.publish_action;
  if (pin === undefined) {
    return deny(
      true,
      'publish_action_not_pinned',
      'The approval carries no pinned publish action; an approval authorizes agent execution only for the exact action reviewed (M-6).'
    );
  }
  if (!publishActionMatchesPin(pin, input.requested)) {
    return deny(
      true,
      'publish_action_mismatch',
      'The requested publish action differs from the approved one; any different action requires re-approval (M-6).'
    );
  }
  return {
    allow: true,
    requires_approval: true,
    approval: { content_revision: approval.approval.content_revision, publish_action: pin },
  };
};
