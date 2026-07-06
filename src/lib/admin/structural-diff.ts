/**
 * Structural diff (T1.5, surface 2 — D§/C§2.4): a before/after summary for
 * patch ops whose T0.6 capture is `element` or `move` — inserts, removals,
 * replacements, and reorders of sections / nav groups+items / template
 * slots / taxonomy terms. Field-level edits (`update_section_data`,
 * `update_item`, `update_term`, `set_*_meta`, `set_section_visibility`,
 * `deprecate_term`/`reactivate_term`) capture as `kind: 'fields'` and belong
 * to surface 1 (the word/side-by-side field diff, reusing the A§1.3
 * pattern) — this module never touches them.
 *
 * Driven by capture KIND, not a hardcoded op-name list: any current or
 * future op whose engine capture is `element`/`move` is structural by
 * construction, so this stays correct without an allowlist to maintain in
 * parallel with object-patch-apply.ts.
 *
 * Pure data in, pure data out — no DOM. The Astro page renders these
 * entries and wires each one's `entry` (the exact `{op, capture}` the
 * history stores) straight into the `discard` verb action, which derives
 * the T0.6 inverse from it (C§2.4) — this module does not compute inverses
 * itself, only describes what happened for the reviewer to read.
 */
import type { ElementSnapshot, MoveSnapshot, PatchOpCapture } from '../object-patch-apply.js';
import type { PatchOp } from '../../schema/object-patch-ops.js';
import type { HistoryEntry } from '../../schema/object-record-v1.js';

export type StructuralDiffKind = 'added' | 'removed' | 'replaced' | 'moved';

export interface StructuralDiffEntry {
  /** Index into ObjectRecord.history — stable reference for wiring Discard. */
  historyIndex: number;
  action: string;
  kind: StructuralDiffKind;
  /** Human-readable one-liner, e.g. "Added section s_hero1 (hero)". */
  label: string;
  before?: unknown;
  after?: unknown;
  /** Exactly what the history entry stores — pass straight to the discard verb. */
  entry: { op: PatchOp; capture: PatchOpCapture };
}

const elementValue = (snapshot: ElementSnapshot): unknown => (snapshot.exists ? snapshot.value : undefined);

const describeTarget = (op: PatchOp): string => {
  switch (op.op) {
    case 'upsert_section':
      return `section ${op.section.id} (${op.section.type})`;
    case 'remove_section':
    case 'move_section':
      return `section ${op.section_id}`;
    case 'upsert_group':
      return `nav group ${op.group.id}`;
    case 'remove_group':
    case 'move_group':
      return `nav group ${op.group_id}`;
    case 'upsert_item':
      return `nav item ${op.item.id} in group ${op.group_id}`;
    case 'remove_item':
    case 'move_item':
      return `nav item ${op.item_id} in group ${op.group_id}`;
    case 'upsert_slot':
      return `template slot ${op.slot.slotId}`;
    case 'remove_slot':
    case 'move_slot':
      return `template slot ${op.slot_id}`;
    case 'add_term':
      return `${op.kind} term ${op.term.term_id} (${op.term.slug})`;
    case 'remove_term':
      return `${op.kind} term ${op.term_id}`;
    default:
      return op.op;
  }
};

const labelFor = (kind: StructuralDiffKind, target: string): string => {
  switch (kind) {
    case 'added':
      return `Added ${target}`;
    case 'removed':
      return `Removed ${target}`;
    case 'replaced':
      return `Replaced ${target}`;
    case 'moved':
      return `Moved ${target}`;
  }
};

const buildElementEntry = (
  historyIndex: number,
  action: string,
  op: PatchOp,
  capture: Extract<PatchOpCapture, { kind: 'element' }>
): StructuralDiffEntry | undefined => {
  const kind: StructuralDiffKind | undefined = !capture.before.exists && capture.after.exists
    ? 'added'
    : capture.before.exists && !capture.after.exists
      ? 'removed'
      : capture.before.exists && capture.after.exists
        ? 'replaced'
        : undefined;
  if (kind === undefined) return undefined; // neither before nor after existed: not a real change

  const target = describeTarget(op);
  return {
    historyIndex,
    action,
    kind,
    label: labelFor(kind, target),
    before: elementValue(capture.before),
    after: elementValue(capture.after),
    entry: { op, capture },
  };
};

const buildMoveEntry = (
  historyIndex: number,
  action: string,
  op: PatchOp,
  capture: Extract<PatchOpCapture, { kind: 'move' }>
): StructuralDiffEntry => ({
  historyIndex,
  action,
  kind: 'moved',
  label: `Moved ${describeTarget(op)} from position ${capture.before.index} to ${capture.after.index}`,
  before: capture.before,
  after: capture.after,
  entry: { op, capture },
});

/**
 * Extracts the structural (element/move) diff entries from an object's
 * history, in history order. History entries that are not patch-op writes
 * (checkout, submit_review, publish, …) or whose capture is `fields` are
 * skipped — they belong elsewhere (lock panel, surface 1, publish receipt).
 */
export const computeStructuralDiff = (history: readonly HistoryEntry[]): StructuralDiffEntry[] => {
  const entries: StructuralDiffEntry[] = [];

  history.forEach((historyEntry, historyIndex) => {
    const details = historyEntry.details as { op?: unknown; capture?: unknown } | undefined;
    const op = details?.op as PatchOp | undefined;
    const capture = details?.capture as PatchOpCapture | undefined;
    if (!op || !capture) return;

    if (capture.kind === 'element') {
      const built = buildElementEntry(historyIndex, historyEntry.action, op, capture);
      if (built) entries.push(built);
    } else if (capture.kind === 'move') {
      entries.push(buildMoveEntry(historyIndex, historyEntry.action, op, capture));
    }
  });

  return entries;
};

/** True when a capture kind belongs to this surface (element/move) rather than surface 1 (fields). */
export const isStructuralCapture = (capture: Pick<PatchOpCapture, 'kind'>): boolean =>
  capture.kind === 'element' || capture.kind === 'move';

/**
 * The slice of history a reviewer should see as "pending" — everything
 * since the last `review_decide`, or the whole history if none yet. Both
 * diff surfaces (this module's structural entries and field-diff.ts's field
 * entries) are meant to summarize the same window, so the page computes it
 * once here and passes the same slice to both.
 */
export const pendingHistory = (history: readonly HistoryEntry[]): readonly HistoryEntry[] => {
  const lastDecisionIndex = history.reduce(
    (found, entry, index) => (entry.action === 'review_decide' ? index : found),
    -1
  );
  return lastDecisionIndex === -1 ? history : history.slice(lastDecisionIndex + 1);
};

export type { MoveSnapshot };
