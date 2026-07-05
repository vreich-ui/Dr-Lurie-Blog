/**
 * Reviewer action-availability for the generic objects surface (T1.5) —
 * DISPLAY ONLY. This answers "which buttons should render for this
 * principal," never "is this write authorized" — that is exclusively
 * `netlify/lib/tier-gate.ts`'s `checkPublishGate`, enforced server-side on
 * every `publish_by_time`/`review_decide` call regardless of what this
 * module renders. A bug here can show a stale or missing button; it cannot
 * grant a publish the server would refuse.
 *
 * Kept client-safe on purpose: `tier-gate.ts` pulls in `netlify/lib/roles.ts`
 * → `admin-auth.ts` (Netlify Identity/server env), which has no business in
 * a browser bundle. This module duplicates only the two small, non-secret
 * facts a reviewer's screen needs — the tier mapping (which object types are
 * human-executed-only, D§ audit fork resolution — public information, not a
 * security decision) and the content_revision approval-currency comparison
 * (D§3.9; the same comparison `effectiveApproval` makes, over fields the
 * client already received in the `object_get` response).
 */
import type { ObjectType } from '../../schema/object-record-v1.js';

export type PrincipalKind = 'human' | 'agent';
export type Role = 'admin' | 'publisher' | 'editor';

export type ReviewSummary = {
  state: 'open' | 'changes_requested' | 'approved';
  decisions: ReadonlyArray<{ content_revision: number }>;
};

export type ReviewerAvailabilityInput = {
  objectType: Exclude<ObjectType, 'content_item'>;
  principalKind: PrincipalKind;
  roles: readonly Role[];
  hasActiveLock: boolean;
  review?: ReviewSummary;
  contentRevision: number;
};

export type ReviewerActionAvailability = {
  tier: 2 | 3;
  canSubmitForReview: boolean;
  canRequestChanges: boolean;
  canApprove: boolean;
  /** Tier 3, always human-executed (C§2.2); Tier 2 requires a current approval too — only the EXECUTOR differs by tier. */
  canPublish: boolean;
};

const TIER_2_TYPES: ReadonlySet<ObjectType> = new Set(['page', 'section', 'template']);

export const tierForDisplay = (objectType: Exclude<ObjectType, 'content_item'>): 2 | 3 =>
  TIER_2_TYPES.has(objectType) ? 2 : 3;

const isApprovedCurrent = (review: ReviewSummary | undefined, contentRevision: number): boolean => {
  if (!review || review.state !== 'approved') return false;
  const last = review.decisions[review.decisions.length - 1];
  return last !== undefined && last.content_revision === contentRevision;
};

const canExecutePublish = (roles: readonly Role[]): boolean => roles.includes('admin') || roles.includes('publisher');

export const reviewerAvailableActions = (input: ReviewerAvailabilityInput): ReviewerActionAvailability => {
  const tier = tierForDisplay(input.objectType);
  const isHuman = input.principalKind === 'human';
  const approvedCurrent = isApprovedCurrent(input.review, input.contentRevision);

  return {
    tier,
    canSubmitForReview: input.hasActiveLock,
    // Deciding a review is human-only (T1.4 review-state.ts) and only meaningful while open.
    canRequestChanges: isHuman && input.roles.length > 0 && input.review?.state === 'open',
    canApprove: isHuman && input.roles.length > 0 && input.review?.state === 'open',
    // Both tiers require a current approval. Tier 2's agent-pin-matched execution path
    // (M-6) is NOT modeled here — this surface is human-only by construction (Netlify
    // Identity gate), so the only "who may click Publish" question this UI ever answers
    // is the human one, and a non-human principalKind (below) always renders it absent.
    canPublish: isHuman && canExecutePublish(input.roles) && approvedCurrent,
  };
};
