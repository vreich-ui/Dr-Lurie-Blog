/**
 * Home data client (T9.11) — one read over admin-audit returns the attention
 * inbox and the activity feed. Any admin may read; the server enforces it.
 */
import type { GetToken } from '../edit-mode/verbs-client.js';
import type { ObjectType } from '../../../packages/core/schema/object-record-v1.js';

const ENDPOINT = '/.netlify/functions/admin-audit';

export interface AuditFeedEntry {
  at: string;
  object_id: string;
  object_type: ObjectType;
  display_name: string;
  action: string;
  actor_phrase: string;
  id_tooltip: string;
}

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

export interface HomeData {
  feed: AuditFeedEntry[];
  inbox: AttentionInbox;
  generated_at: string;
}

export async function fetchHomeData(getToken: GetToken, limit = 40): Promise<HomeData> {
  const token = await getToken();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((json.error as string) || `Home data request failed (${res.status}).`);
  return {
    feed: (json.feed as AuditFeedEntry[] | undefined) ?? [],
    inbox: (json.inbox as AttentionInbox | undefined) ?? {
      pending_reviews: [],
      unpublished_changes: [],
      held_locks: [],
      stats: { published: 0, in_review: 0, unpublished: 0, locked: 0, total: 0 },
    },
    generated_at: (json.generated_at as string | undefined) ?? '',
  };
}

/** Deep-link to an object's workspace (T9.9). */
export const objectHref = (item: { object_id: string; object_type: ObjectType }): string =>
  `/admin/content/${encodeURIComponent(item.object_id)}?type=${item.object_type}`;
