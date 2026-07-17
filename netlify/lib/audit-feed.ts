/**
 * Audit feed + attention inbox (T9.11) — the read-only "what changed and what
 * needs me" aggregation over ObjectRecord envelopes. Pure derivation: no writes,
 * no new stored state, every value computed from what the verbs already persist
 * (`history[]`, `review`, `lock`, `publication`).
 *
 * Records are read from the store WITHOUT schema validation (object-verbs'
 * loadRecord JSON.parses and casts), so everything here is defensive: a
 * half-healed or malformed record yields skipped entries, never a thrown sweep.
 *
 * The chat-run outcome stream (T9.13) joins in later: `buildAuditFeed` takes a
 * pre-normalized entry list, so the function layer can concat chat-run entries
 * before sorting once that store exists — no shape change needed here.
 */
import { inventoryRowFromRecord } from './object-inventory.js';
import type { ApprovalPolicy } from '../../src/lib/approval-policy.js';
import { objectDisplayName, verbToPhrase, idTooltip } from '../../src/lib/admin/display-name.js';
import type { ObjectRecord, ObjectType, HistoryEntry } from '../../src/schema/object-record-v1.js';

// ─── activity feed ────────────────────────────────────────────────────────────

export interface AuditFeedEntry {
  /** ISO timestamp of the history entry. */
  at: string;
  object_id: string;
  object_type: ObjectType;
  /** Human title of the object (never a naked id). */
  display_name: string;
  /** Raw history action key, kept for filtering/keys — not for display. */
  action: string;
  /** "<Person> <verb>" — the object name is rendered separately by the surface. */
  actor_phrase: string;
  /** The raw id, framed for a title/tooltip only. */
  id_tooltip: string;
}

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** A history entry is only usable if it carries the fields the phrasing needs. */
const usableHistoryEntry = (value: unknown): value is HistoryEntry => {
  if (!isRecordLike(value)) return false;
  return isString(value.at) && isString(value.action) && isRecordLike(value.actor);
};

export interface AuditFeedOptions {
  /** Newest-first cap (sane bound; no pagination — T9.11 non-goal). */
  limit?: number;
}

const DEFAULT_FEED_LIMIT = 40;

/**
 * Flatten every record's history into one bounded, newest-first activity feed.
 * Malformed records / entries are skipped, not thrown on.
 */
export const buildAuditFeed = (records: ObjectRecord[], options: AuditFeedOptions = {}): AuditFeedEntry[] => {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_FEED_LIMIT, 200));
  const entries: AuditFeedEntry[] = [];

  for (const record of records) {
    if (!record || !Array.isArray(record.history)) continue;
    const displayName = objectDisplayName(record);
    const tooltip = idTooltip(record.object_id);
    for (const raw of record.history) {
      if (!usableHistoryEntry(raw)) continue;
      entries.push({
        at: raw.at,
        object_id: record.object_id,
        object_type: record.object_type,
        display_name: displayName,
        action: raw.action,
        actor_phrase: verbToPhrase(raw),
        id_tooltip: tooltip,
      });
    }
  }

  // Newest first; ISO strings sort lexicographically by time. Ties keep input
  // order via a stable-sort-friendly comparator (return 0 → preserved).
  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return entries.slice(0, limit);
};

// ─── attention inbox ──────────────────────────────────────────────────────────

export interface PendingReviewItem {
  object_id: string;
  object_type: ObjectType;
  display_name: string;
  review_state: 'open' | 'changes_requested';
  updated_at: string;
  id_tooltip: string;
}

export interface UnpublishedChangeItem {
  object_id: string;
  object_type: ObjectType;
  display_name: string;
  never_published: boolean;
  content_revision: number;
  published_content_revision: number | null;
  updated_at: string;
  id_tooltip: string;
}

export interface HeldLockItem {
  object_id: string;
  object_type: ObjectType;
  display_name: string;
  owner_label: string;
  acquired_at: string;
  expires_at: string;
  /** Milliseconds the lock has been held (atMs − acquired_at); 0 if unparseable. */
  age_ms: number;
  id_tooltip: string;
}

export interface AttentionStats {
  published: number;
  in_review: number;
  unpublished: number;
  locked: number;
  total: number;
}

export interface AttentionInbox {
  pending_reviews: PendingReviewItem[];
  unpublished_changes: UnpublishedChangeItem[];
  held_locks: HeldLockItem[];
  stats: AttentionStats;
}

export interface AttentionInboxOptions {
  atMs: number;
  /** Feeds inventory row derivation (requires_approval); inbox itself is policy-independent. */
  policy?: ApprovalPolicy;
  /** Per-section sane cap (T9.11 non-goal: no pagination). */
  sectionLimit?: number;
}

const DEFAULT_SECTION_LIMIT = 50;

const parseMsOr = (iso: string, fallbackMs: number): number => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? fallbackMs : ms;
};

/**
 * Build the "needs me" inbox: open reviews, unpublished active changes, and
 * held locks — plus headline stats. Derived through inventoryRowFromRecord so
 * review/lock/unpublished logic stays single-sourced with the library surface.
 */
export const buildAttentionInbox = (records: ObjectRecord[], options: AttentionInboxOptions): AttentionInbox => {
  const { atMs } = options;
  const sectionLimit = Math.max(1, Math.min(options.sectionLimit ?? DEFAULT_SECTION_LIMIT, 200));

  const pending_reviews: PendingReviewItem[] = [];
  const unpublished_changes: UnpublishedChangeItem[] = [];
  const held_locks: HeldLockItem[] = [];
  const stats: AttentionStats = { published: 0, in_review: 0, unpublished: 0, locked: 0, total: 0 };

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    let row;
    try {
      row = inventoryRowFromRecord(record, atMs, options.policy);
    } catch {
      continue; // a record too malformed to derive — skip, never break the sweep
    }
    stats.total += 1;
    if (row.published_time) stats.published += 1;

    const isReviewPending = row.review_state === 'open' || row.review_state === 'changes_requested';
    if (isReviewPending) {
      stats.in_review += 1;
      pending_reviews.push({
        object_id: row.object_id,
        object_type: row.object_type,
        display_name: row.display_name,
        review_state: row.review_state,
        updated_at: row.updated_at,
        id_tooltip: idTooltip(row.object_id),
      });
    }

    // Only active records surface as unpublished work; archived is intentional.
    if (row.status === 'active' && row.unpublished_changes) {
      stats.unpublished += 1;
      unpublished_changes.push({
        object_id: row.object_id,
        object_type: row.object_type,
        display_name: row.display_name,
        never_published: row.published_time === null,
        content_revision: row.content_revision,
        published_content_revision: row.published_content_revision,
        updated_at: row.updated_at,
        id_tooltip: idTooltip(row.object_id),
      });
    }

    if (row.lock.held) {
      stats.locked += 1;
      held_locks.push({
        object_id: row.object_id,
        object_type: row.object_type,
        display_name: row.display_name,
        owner_label: row.lock.owner_label,
        acquired_at: row.lock.acquired_at,
        expires_at: row.lock.expires_at,
        age_ms: Math.max(0, atMs - parseMsOr(row.lock.acquired_at, atMs)),
        id_tooltip: idTooltip(row.object_id),
      });
    }
  }

  // Reviews + changes: most recently touched first. Locks: oldest first (a
  // long-held lock is the likeliest stale one worth a nudge).
  pending_reviews.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  unpublished_changes.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  held_locks.sort((a, b) => b.age_ms - a.age_ms);

  return {
    pending_reviews: pending_reviews.slice(0, sectionLimit),
    unpublished_changes: unpublished_changes.slice(0, sectionLimit),
    held_locks: held_locks.slice(0, sectionLimit),
    stats,
  };
};
