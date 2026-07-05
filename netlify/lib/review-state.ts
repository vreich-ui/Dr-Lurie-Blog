/**
 * Review-state machine (T1.4) — submit / approve / request_changes /
 * discard on the ObjectRecord envelope (D§3.9, C§2.0 state machine).
 *
 * Counter discipline (D§3.1, the twice-hardened invariant): every operation
 * here is review BOOKKEEPING — it bumps `version` (every write does) and
 * NEVER `content_revision` — except discard, which is a genuine body write
 * through the T0.6 engine and therefore bumps `content_revision`, correctly
 * invalidating any approval granted while the rejected change was still in
 * the draft (C§2.4, stated consequence).
 *
 * Approvals pin `{content_revision, publish_action}` together (M-6): the
 * decision entry is the durable home of the pin the tier gate reads.
 * Invalidation is LOGICAL, not stored — nothing here rewrites review.state
 * when the body later moves; the gate compares the pinned content_revision
 * against the record's current one (effectiveApproval), so lock churn and
 * the publish stamp (which never touch content_revision) cannot invalidate
 * an approval, and any body write inherently does.
 *
 * Discard (C§2.4): agents write to the live draft under lock, so a rejected
 * op has already mutated the draft — Discard is a compensating inverse
 * write. Inverses come from T0.6's derivePatchInverse over exactly what the
 * op's history entry stores (`details: {op, capture}`), are applied
 * newest-first as one atomic batch attributed to the reviewer, and carry
 * guards: if intervening accepted ops moved the same field, the engine
 * refuses the blind revert and the surface demands manual resolution.
 *
 * Lock enforcement is deliberately NOT here: like the T0.6 engine itself,
 * these are pure record transforms; the verb endpoints own auth, locks, and
 * persistence (A§1.2 discipline, T0.8 pattern).
 */
import { z } from 'zod';

import {
  applyPatchOps,
  derivePatchInverse,
  PatchApplyError,
  type PatchOpCapture,
} from '../../src/lib/object-patch-apply.js';
import { patchOpSchema, type PatchOp } from '../../src/schema/object-patch-ops.js';
import type { ObjectRecord, Principal, ReviewState } from '../../src/schema/object-record-v1.js';
import { canDecideReview, type Role } from './roles.js';

export const publishActionSchema = z.strictObject({
  published_time: z.union([z.string(), z.null(), z.literal('immediate')]),
});
export type PublishAction = z.infer<typeof publishActionSchema>;

export type ReviewOpResult =
  | { ok: true; status: 200; record: ObjectRecord; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

const err = (status: number, code: string, body: Record<string, unknown> = {}): ReviewOpResult => ({
  ok: false,
  status,
  body: { code, ...body },
});

/** A pinned ISO time must actually be an instant; 'immediate' and null are literal. */
const validatePublishAction = (value: unknown): { action?: PublishAction; error?: ReviewOpResult } => {
  if (value === undefined) return {};
  const parsed = publishActionSchema.safeParse(value);
  if (!parsed.success) {
    return { error: err(400, 'invalid_publish_action', { error: 'publish_action must be {published_time: ISO | null | "immediate"}.' }) };
  }
  const time = parsed.data.published_time;
  if (typeof time === 'string' && time !== 'immediate' && Number.isNaN(Date.parse(time))) {
    return { error: err(400, 'invalid_publish_action', { error: 'publish_action.published_time is not a valid instant.' }) };
  }
  return { action: parsed.data };
};

// ─── submit ──────────────────────────────────────────────────────────────────

export type SubmitReviewInput = {
  actor: Principal;
  /** ISO timestamp for updated_at/history. */
  at: string;
  note?: string;
  /**
   * M-6: REQUIRED (by contract, enforced at the gate) whenever a Tier 2
   * agent-executed publish is intended — the reviewer approves this exact
   * action and the decision pins it.
   */
  requested_publish_action?: PublishAction;
};

export const submitReview = (record: ObjectRecord, input: SubmitReviewInput): ReviewOpResult => {
  const { action, error } = validatePublishAction(input.requested_publish_action);
  if (error) return error;

  const review: ReviewState = {
    state: 'open',
    decisions: record.review?.decisions ?? [],
  };
  const next: ObjectRecord = {
    ...record,
    review,
    updated_at: input.at,
    history: [
      ...record.history,
      {
        at: input.at,
        action: 'submit_review',
        actor: input.actor,
        details: {
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(action !== undefined ? { requested_publish_action: action } : {}),
        },
      },
    ],
    version: record.version + 1,
    // Review bookkeeping never moves content_revision (D§3.1).
    content_revision: record.content_revision,
  };
  return { ok: true, status: 200, record: next, body: { review_state: 'open' } };
};

// ─── decide (approve / request_changes) — human-only ─────────────────────────

export type DecideReviewInput = {
  actor: Principal;
  /** Resolved via roles.ts by the caller; deciding requires ≥1 configured role. */
  actorRoles: readonly Role[];
  at: string;
  decision: 'approve' | 'request_changes';
  note?: string;
  /** M-6 pin; meaningful on approvals. Ignored-by-gate on request_changes. */
  publish_action?: PublishAction;
};

export const decideReview = (record: ObjectRecord, input: DecideReviewInput): ReviewOpResult => {
  if (input.actor.kind !== 'human') {
    return err(403, 'human_only', { error: 'review_decide is human-only (C§2.0); agents cannot decide reviews.' });
  }
  if (!canDecideReview(input.actorRoles)) {
    return err(403, 'review_role_required', { error: 'Deciding a review requires a configured role.' });
  }
  const { action, error } = validatePublishAction(input.publish_action);
  if (error) return error;

  const review: ReviewState = {
    state: input.decision === 'approve' ? 'approved' : 'changes_requested',
    decisions: [
      ...(record.review?.decisions ?? []),
      {
        at: input.at,
        by: input.actor,
        decision: input.decision,
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(action !== undefined ? { publish_action: action } : {}),
        // The pin: approval is valid only while the body stays at this
        // revision. Deliberately NOT `version` (D§3.9 — lock ops and the
        // publish stamp bump version and must not invalidate approvals).
        content_revision: record.content_revision,
      },
    ],
  };
  const next: ObjectRecord = {
    ...record,
    review,
    updated_at: input.at,
    history: [
      ...record.history,
      {
        at: input.at,
        action: 'review_decide',
        actor: input.actor,
        details: {
          decision: input.decision,
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(action !== undefined ? { publish_action: action } : {}),
          content_revision: record.content_revision,
        },
      },
    ],
    version: record.version + 1,
    content_revision: record.content_revision,
  };
  return { ok: true, status: 200, record: next, body: { review_state: review.state } };
};

// ─── effective approval (what the tier gate reads) ───────────────────────────

export type EffectiveApproval =
  | { state: 'none' }
  | { state: 'open' }
  | { state: 'changes_requested' }
  | { state: 'approved_stale'; approval: ReviewState['decisions'][number] }
  | { state: 'approved_current'; approval: ReviewState['decisions'][number] };

/**
 * Derives approval currency from the pin, never from review.state alone: an
 * 'approved' record whose content_revision has moved past the pinned one is
 * stale (a body write happened after approval — D§3.9 invalidation), while
 * version-only churn (locks, publish stamps) leaves it current.
 */
export const effectiveApproval = (record: ObjectRecord): EffectiveApproval => {
  const review = record.review;
  if (!review) return { state: 'none' };
  if (review.state === 'open') return { state: 'open' };
  if (review.state === 'changes_requested') return { state: 'changes_requested' };

  const last = review.decisions[review.decisions.length - 1];
  if (!last || last.decision !== 'approve') return { state: 'none' };
  return last.content_revision === record.content_revision
    ? { state: 'approved_current', approval: last }
    : { state: 'approved_stale', approval: last };
};

// ─── discard (C§2.4 compensating inverse write) ──────────────────────────────

export type DiscardInput = {
  /** The rejected ops, exactly as their history entries store them. */
  entries: Array<{ op: unknown; capture: unknown }>;
  /** The reviewer — the inverse writes are authored and attributed to them. */
  actor: Principal;
  at: string;
};

export const discardProposal = (record: ObjectRecord, input: DiscardInput): ReviewOpResult => {
  if (input.entries.length === 0) return err(400, 'nothing_to_discard', { error: 'No ops to discard.' });

  let inverses: PatchOp[];
  try {
    // Newest-first: unwinding a batch must revert in reverse application order.
    inverses = [...input.entries].reverse().map(({ op, capture }) => {
      const parsedOp = patchOpSchema.parse(op);
      return derivePatchInverse(parsedOp, capture as PatchOpCapture);
    });
  } catch (error) {
    return err(400, 'discard_invalid_entry', {
      error: 'A discard entry is not a valid {op, capture} history payload.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const applied = applyPatchOps(record, inverses, { actor: input.actor, at: input.at });
    return {
      ok: true,
      status: 200,
      record: applied.record,
      body: {
        discarded: input.entries.length,
        inverses,
        // Stated C§2.4 consequence, surfaced for callers: the discard is a
        // body write and invalidates approvals granted over the old draft.
        content_revision: applied.record.content_revision,
      },
    };
  } catch (error) {
    if (error instanceof PatchApplyError && error.code === 'blind_revert_refused') {
      return err(409, 'discard_conflict', {
        error:
          'The draft no longer matches the state the rejected op expects (intervening accepted ops); blind revert refused — resolve manually (C§2.4).',
        detail: error.message,
        details: error.details,
      });
    }
    if (error instanceof PatchApplyError) {
      return err(400, 'discard_failed', { error: error.message, code_detail: error.code, details: error.details });
    }
    throw error;
  }
};
