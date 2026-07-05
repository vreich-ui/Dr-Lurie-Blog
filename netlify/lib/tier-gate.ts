/**
 * Tier-gate enforcement (T1.4) — the project's security boundary, enforcing
 * the C§2.2 publish column exactly:
 *
 *   Tier 1 — content_item: direct agent publish through the EXISTING
 *     article pipeline; deliberately unreachable via this gate (OQ-8 — the
 *     adapter decision is open, so the generic surface refuses rather than
 *     half-gates).
 *   Tier 2 — page / section / template: anyone publishing needs a CURRENT
 *     approval (first publish and every publish, C§2.3). An agent may
 *     execute only if the approval additionally pins the exact publish
 *     action it is attempting (M-6). A human with publish authority
 *     (admin/publisher) is not constrained by the pin — the pin constrains
 *     delegated execution, humans carry publish authority in themselves
 *     (C§2.2).
 *   Tier 3 — navigation / taxonomy / site: approval on every publish PLUS
 *     human-executed publish, no exceptions — an agent holding a valid
 *     approval must still not be able to time a site-wide change (C§2.2).
 *     Approval is still required for humans; only the execution is
 *     human-only, not the whole flow.
 *
 * Approval currency (D§3.9, via effectiveApproval): an approval is
 * invalidated the moment `content_revision` moves past the pinned value —
 * i.e. by any body write, including a discard's compensating inverse. It is
 * NOT invalidated by lock checkout/refresh/checkin or by the publish
 * stamp itself, which bump only `version` (D§3.1 counter independence).
 *
 * M-6 action matching (agents only, exact rules from C§2.2):
 *   pin 'immediate'  ⇔ the publish call omits published_time
 *   pin <ISO>        ⇔ the call supplies the same instant
 *   pin null         ⇔ the call requests null — the ONLY thing that
 *                      authorizes an agent unpublish
 * Anything else requires re-approval. (Whether the action is executable at
 * all — future times, null — is the publish operation's own T1.3 scheduling
 * gate; this gate answers authorization, not schedulability.)
 *
 * The gate is pure and composable: callers resolve roles (roles.ts) and
 * hand in the record; the publish endpoint runs the gate BEFORE
 * publishObject (which by design assumes it is already authorized).
 */
import { effectiveApproval, type PublishAction } from './review-state.js';
import { canExecutePublish, type Role } from './roles.js';
import type { ObjectRecord, ObjectType, Principal } from '../../src/schema/object-record-v1.js';

export type Tier = 1 | 2 | 3;

export const tierForObjectType = (objectType: ObjectType): Tier => {
  switch (objectType) {
    case 'content_item':
      return 1;
    case 'page':
    case 'section':
    case 'template':
      return 2;
    case 'navigation':
    case 'taxonomy':
    case 'site':
      return 3;
    default: {
      const exhaustive: never = objectType;
      throw new Error(`No tier defined for object type: ${String(exhaustive)}`);
    }
  }
};

export type RequestedPublishAction = {
  /** As the publish call supplies it: ISO string, null (unpublish), or omitted (= immediate). */
  published_time?: string | null;
};

export type PublishGateDenialCode =
  | 'tier1_not_gated'
  | 'human_execution_required'
  | 'approval_required'
  | 'changes_requested'
  | 'approval_stale'
  | 'publish_role_required'
  | 'publish_action_not_pinned'
  | 'publish_action_mismatch';

export type PublishGateResult =
  | { allow: true; tier: Tier; approval: { content_revision: number; publish_action?: PublishAction } }
  | { allow: false; tier: Tier; status: 403; code: PublishGateDenialCode; reason: string };

const deny = (tier: Tier, code: PublishGateDenialCode, reason: string): PublishGateResult => ({
  allow: false,
  tier,
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
};

export const checkPublishGate = (input: PublishGateInput): PublishGateResult => {
  const tier = tierForObjectType(input.record.object_type);

  if (tier === 1) {
    return deny(
      tier,
      'tier1_not_gated',
      'content_item publishes through the existing article pipeline; the generic gate does not serve it (OQ-8).'
    );
  }

  // Tier 3, agents: unconditional — checked before approval state so a valid
  // approval never even appears to be the missing piece (C§2.2 defense in depth).
  if (tier === 3 && input.principal.kind === 'agent') {
    return deny(
      tier,
      'human_execution_required',
      `Publishing ${input.record.object_type} is human-executed, always; agents may prepare and submit but never execute (C§2.2 Tier 3).`
    );
  }

  const approval = effectiveApproval(input.record);
  if (approval.state === 'changes_requested') {
    return deny(tier, 'changes_requested', 'Changes were requested; resubmit for review before publishing.');
  }
  if (approval.state === 'none' || approval.state === 'open') {
    return deny(tier, 'approval_required', 'Publishing requires an approved review (first and every publish).');
  }
  if (approval.state === 'approved_stale') {
    return deny(
      tier,
      'approval_stale',
      `The approval pins content_revision ${approval.approval.content_revision} but the body has moved to ${input.record.content_revision}; re-approval is required (D§3.9).`
    );
  }

  // approval.state === 'approved_current'
  if (input.principal.kind === 'human') {
    if (!canExecutePublish(input.roles)) {
      return deny(tier, 'publish_role_required', 'Executing a publish requires the admin or publisher role.');
    }
    // Humans are not constrained by the pin (C§2.2): publish authority is
    // their own; the pin constrains delegated (agent) execution.
    return {
      allow: true,
      tier,
      approval: {
        content_revision: approval.approval.content_revision,
        ...(approval.approval.publish_action !== undefined ? { publish_action: approval.approval.publish_action } : {}),
      },
    };
  }

  // Agent on Tier 2: the approval must pin the exact action being attempted.
  const pin = approval.approval.publish_action;
  if (pin === undefined) {
    return deny(
      tier,
      'publish_action_not_pinned',
      'The approval carries no pinned publish action; an approval authorizes agent execution only for the exact action reviewed (M-6).'
    );
  }
  if (!publishActionMatchesPin(pin, input.requested)) {
    return deny(
      tier,
      'publish_action_mismatch',
      'The requested publish action differs from the approved one; any different action requires re-approval (M-6).'
    );
  }
  return {
    allow: true,
    tier,
    approval: { content_revision: approval.approval.content_revision, publish_action: pin },
  };
};
