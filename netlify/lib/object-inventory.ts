/**
 * Object inventory (Part 2 of the agent-editability push) — the read-only
 * "what exists and what state is it in" view over the object store, for
 * agents deciding what to edit next and for humans auditing pending work.
 *
 * Pure derivation over ObjectRecord envelopes: no writes, no new stored
 * state. Every field is computed from what the T0.5/T1.3 verbs already
 * persist — in particular `unpublished_changes` works because the publish
 * receipt (T1.3) stamps the `content_revision` it materialized, so a record
 * whose current revision is ahead of its receipt has changes the live site
 * has not seen.
 */
import { isObjectLockActive, sanitizeObjectLock } from './object-lock.js';
import { tierForObjectType, type Tier } from './tier-gate.js';
import type { ObjectRecord } from '../../src/schema/object-record-v1.js';

export type InventoryReviewState = 'none' | 'open' | 'changes_requested' | 'approved';

export type InventoryLockState =
  | { held: false }
  | { held: true; owner_id: string; owner_label: string; acquired_at: string; expires_at: string };

export type InventoryRow = {
  object_id: string;
  object_type: ObjectRecord['object_type'];
  status: ObjectRecord['status'];
  tier: Tier;
  version: number;
  content_revision: number;
  review_state: InventoryReviewState;
  lock: InventoryLockState;
  published_time: string | null;
  /** The content_revision the last publish materialized (from the receipt), or null if never published / receipt lacks it. */
  published_content_revision: number | null;
  /**
   * True when the live site has not seen the current body: never published,
   * or content_revision has moved past the receipt's. A published record
   * whose receipt lacks a numeric content_revision reports true
   * (conservative — we cannot prove the live export is current).
   */
  unpublished_changes: boolean;
};

export type InventoryDetail = InventoryRow & {
  schema_version: string;
  site: string;
  created_at: string;
  updated_at: string;
  review: ObjectRecord['review'] | null;
  publish_receipt: Record<string, unknown> | null;
  history_length: number;
};

export type InventoryFilters = {
  tier?: Tier;
  review_state?: InventoryReviewState;
  pending_changes?: boolean;
  status?: 'active' | 'archived';
};

const publishedContentRevision = (record: ObjectRecord): number | null => {
  const receipt = record.publication.publish_receipt;
  const revision = receipt?.content_revision;
  return typeof revision === 'number' ? revision : null;
};

export const inventoryRowFromRecord = (record: ObjectRecord, atMs: number): InventoryRow => {
  const lockActive = isObjectLockActive(record.lock, atMs);
  const sanitized = lockActive ? sanitizeObjectLock(record.lock) : undefined;
  const publishedTime = record.publication.published_time;
  const receiptRevision = publishedContentRevision(record);
  return {
    object_id: record.object_id,
    object_type: record.object_type,
    status: record.status,
    tier: tierForObjectType(record.object_type),
    version: record.version,
    content_revision: record.content_revision,
    review_state: record.review?.state ?? 'none',
    lock: sanitized
      ? {
          held: true,
          owner_id: sanitized.owner_id,
          owner_label: sanitized.owner_label,
          acquired_at: sanitized.acquired_at,
          expires_at: sanitized.expires_at,
        }
      : { held: false },
    published_time: publishedTime,
    published_content_revision: receiptRevision,
    unpublished_changes:
      publishedTime === null || publishedTime === undefined
        ? true
        : receiptRevision === null || receiptRevision !== record.content_revision,
  };
};

export const inventoryDetailFromRecord = (record: ObjectRecord, atMs: number): InventoryDetail => ({
  ...inventoryRowFromRecord(record, atMs),
  schema_version: record.schema_version,
  site: record.site,
  created_at: record.created_at,
  updated_at: record.updated_at,
  review: record.review ?? null,
  publish_receipt: record.publication.publish_receipt ?? null,
  history_length: record.history.length,
});

export const matchesInventoryFilters = (row: InventoryRow, filters: InventoryFilters): boolean => {
  if (filters.status !== undefined && row.status !== filters.status) return false;
  if (filters.tier !== undefined && row.tier !== filters.tier) return false;
  if (filters.review_state !== undefined && row.review_state !== filters.review_state) return false;
  if (filters.pending_changes !== undefined && row.unpublished_changes !== filters.pending_changes) return false;
  return true;
};

/** Stable output order: object_type in canonical enum order, then object_id. */
export const compareInventoryRows =
  (typeOrder: readonly string[]) =>
  (a: InventoryRow, b: InventoryRow): number => {
    const typeDelta = typeOrder.indexOf(a.object_type) - typeOrder.indexOf(b.object_type);
    if (typeDelta !== 0) return typeDelta;
    return a.object_id < b.object_id ? -1 : a.object_id > b.object_id ? 1 : 0;
  };
