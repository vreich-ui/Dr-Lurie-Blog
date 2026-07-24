/**
 * Extractable, framework-free component logic for the admin kit (T9.2).
 *
 * Kept out of the .tsx files so it can be unit-tested as plain TS (the .tsx
 * components import these). Covers: DataTable sorting, CommandPalette
 * filtering/ranking, status → tone mapping, and relative-time phrasing.
 */
import type { CriterionStatus } from '../../../packages/core/lib/admin/readiness-criteria.js';

// ─── status tone ──────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** Readiness criterion status → a kit tone (drives Badge/StatusPill colors). */
export function statusTone(status: CriterionStatus | string): Tone {
  switch (status) {
    case 'complete':
      return 'success';
    case 'warning':
      return 'warning';
    case 'missing':
      return 'danger';
    case 'optional':
      return 'neutral';
    // common object lifecycle words reused across surfaces
    case 'active':
    case 'published':
    case 'approved':
      return 'success';
    case 'draft':
    case 'open':
    case 'in_progress':
      return 'info';
    case 'archived':
    case 'changes_requested':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

// ─── DataTable sorting ────────────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc';

/**
 * Stable sort of `rows` by a derived comparable value. Strings compare with
 * locale awareness; numbers/booleans numerically; nullish sinks to the end
 * regardless of direction. Returns a new array — never mutates the input.
 */
export function sortRows<T>(rows: readonly T[], getValue: (row: T) => unknown, direction: SortDirection = 'asc'): T[] {
  const factor = direction === 'desc' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = getValue(a.row);
      const bv = getValue(b.row);
      const an = av === null || av === undefined || av === '';
      const bn = bv === null || bv === undefined || bv === '';
      if (an && bn) return a.index - b.index;
      if (an) return 1; // nullish always last
      if (bn) return -1;
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else if (typeof av === 'boolean' && typeof bv === 'boolean') cmp = Number(av) - Number(bv);
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      if (cmp === 0) return a.index - b.index; // stable
      return cmp * factor;
    })
    .map((entry) => entry.row);
}

// ─── CommandPalette filtering ─────────────────────────────────────────────────

export interface CommandLike {
  id: string;
  label: string;
  keywords?: string[];
  group?: string;
}

/**
 * Filter + rank commands for a query. Empty query returns everything in the
 * original order. Otherwise ranks: label prefix (0) > word-boundary in label
 * (1) > substring in label (2) > keyword hit (3); ties keep original order.
 */
export function filterCommands<T extends CommandLike>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];

  const scored: Array<{ item: T; rank: number; index: number }> = [];
  items.forEach((item, index) => {
    const label = item.label.toLowerCase();
    let rank = Number.POSITIVE_INFINITY;
    if (label.startsWith(q)) rank = 0;
    else if (new RegExp(`\\b${escapeRegExp(q)}`).test(label)) rank = 1;
    else if (label.includes(q)) rank = 2;
    else if (item.keywords?.some((k) => k.toLowerCase().includes(q))) rank = 3;
    if (rank !== Number.POSITIVE_INFINITY) scored.push({ item, rank, index });
  });

  return scored.sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank)).map((s) => s.item);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── relative time ────────────────────────────────────────────────────────────

/**
 * Compact human relative time for history timelines: "just now", "5m ago",
 * "3h ago", "2d ago", then an absolute date past a week. Future timestamps
 * read "just now" (clock skew shouldn't render "-3m ago").
 */
export function relativeTimeFromNow(iso: string | undefined, nowMs: number): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = nowMs - then;
  if (diff < 45_000) return 'just now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
