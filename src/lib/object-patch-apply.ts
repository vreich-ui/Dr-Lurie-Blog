/**
 * Patch apply + inverse engine (T0.6).
 *
 * Applies typed patch ops (src/schema/object-patch-ops.ts) to an
 * ObjectRecord, capturing a `{before, after}` snapshot per op into history,
 * and derives the compensating inverse op the human-review Discard action
 * applies (C§2.4). Mechanics only: per-type body validation, reference
 * integrity, and the other C§2.0 safety checks are the validation pipeline's
 * job (T0.7).
 *
 * Contract highlights:
 * - **Pure**: the input record is never mutated; a successful call returns a
 *   fresh record. A batch is atomic — any failing op rejects the whole call.
 * - **Envelope counters** (D§3.1): `version` bumps once per applied op;
 *   `content_revision` bumps only for ops that actually mutated `body` —
 *   a no-op write (same value, same index) bumps `version` but not
 *   `content_revision`.
 * - **History**: one entry per op — `{at, action: <op name>, actor,
 *   details: {op, capture}}`. `derivePatchInverse(op, capture)` reconstructs
 *   the inverse from exactly what history stores.
 * - **Blind-revert refusal** (C§2.4): ops may carry `guard.expected` — the
 *   unit snapshot the draft is expected to still hold (inverse derivation
 *   sets it to the forward op's captured `after`). A mismatch, including the
 *   unit having been removed, throws `blind_revert_refused`.
 * - **Slug-rename auto-alias** (C§2.3-taxonomy): an `update_term` that
 *   changes `slug` atomically mints a deprecated alias term
 *   `{slug: <old slug>, merged_into: <this term>}` so old references keep
 *   resolving; renaming back to a slug the term previously owned consumes
 *   that alias instead of colliding with it. An alias-less rename is
 *   mechanically impossible: `mint_alias: false` is honored only when the
 *   application consumes such an alias or exactly restores the vacated
 *   slug's alias (`restore_alias`) — i.e. only when the rename is a revert.
 *
 * The engine touches bodies through minimal structural contracts mirroring
 * D§3.2–3.8 (sections arrays, nav group/item trees, taxonomy term
 * registries, template slots). The T0.2 body schemas satisfy these shapes
 * structurally; the engine asserts the containers it needs at runtime and
 * throws `invalid_body` rather than corrupting unrecognized data.
 */
import { ZodError } from 'zod';
import {
  patchOpSchema,
  patchOpNamesByObjectType,
  type PatchJsonValue,
  type PatchOp,
  type PatchOpOfName,
  type PatchTaxonomyKind,
  type TermPayload,
} from '../schema/object-patch-ops.js';
import type { HistoryEntry, ObjectRecord, ObjectType, Principal } from '../schema/object-record-v1.js';

// ——— errors ———

export type PatchApplyErrorCode =
  | 'invalid_op'
  | 'op_not_applicable'
  | 'invalid_body'
  | 'target_not_found'
  | 'duplicate_target'
  | 'blind_revert_refused'
  | 'alias_required'
  | 'alias_conflict';

export class PatchApplyError extends Error {
  readonly code: PatchApplyErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: PatchApplyErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PatchApplyError';
    this.code = code;
    this.details = details;
  }
}

// ——— JSON helpers ———
// Bodies are JSON (Netlify Blobs records); `undefined`-valued keys are
// treated as absent everywhere so in-memory and serialized states agree.

type UnknownRecord = Record<string, unknown>;

const isPlainObject = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const deepCloneJson = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((entry) => deepCloneJson(entry)) as T;
  if (isPlainObject(value)) {
    const out: UnknownRecord = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) out[key] = deepCloneJson(entry);
    }
    return out as T;
  }
  return value;
};

const deepEqualJson = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, i) => deepEqualJson(entry, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
    const keysB = Object.keys(b).filter((key) => b[key] !== undefined);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqualJson(a[key], b[key]));
  }
  return false;
};

const insertAt = <T>(list: T[], position: number | undefined, element: T): number => {
  const index = Math.min(position ?? list.length, list.length);
  list.splice(index, 0, element);
  return index;
};

const moveTo = <T>(list: T[], from: number, toIndex: number): number => {
  const [element] = list.splice(from, 1);
  const index = Math.min(toIndex, list.length);
  list.splice(index, 0, element as T);
  return index;
};

// ——— capture shapes (what history stores per op) ———

/**
 * Deep-partial tree mirroring a merge op's `fields`: leaves hold the value
 * at that path, with `null` encoding "key absent" (the grammar's null=unset
 * rule; body schemas have no null-valued fields, so this is unambiguous).
 */
export type FieldsTree = { [key: string]: PatchJsonValue };

export type ElementSnapshot =
  | { exists: false }
  | { exists: true; value: PatchJsonValue; index: number; parent_item_id?: string };

export interface MoveSnapshot {
  index: number;
  parent_item_id?: string;
}

export interface AliasCapture {
  /** Auto-alias appended for the vacated slug. */
  minted?: { term: TermPayload; index: number };
  /** Deprecated self-alias holding the new slug, removed to avoid a collision. */
  consumed?: { term: TermPayload; index: number };
  /** Alias re-inserted via `restore_alias` (inverse application). */
  restored?: { term: TermPayload; index: number };
}

export type PatchOpCapture =
  | { kind: 'fields'; before: FieldsTree; after: FieldsTree; alias?: AliasCapture }
  | {
      kind: 'element';
      before: ElementSnapshot;
      after: ElementSnapshot;
      /** The optional container (`children`/`actions`) was created by this op. */
      container_created?: boolean;
      /** The optional container was removed because the op emptied it (`prune_empty`). */
      container_pruned?: boolean;
    }
  | { kind: 'move'; before: MoveSnapshot; after: MoveSnapshot };

export interface AppliedPatchOp {
  op: PatchOp;
  capture: PatchOpCapture;
  body_mutated: boolean;
}

export interface ApplyPatchOptions {
  actor: Principal;
  /** ISO timestamp recorded on history entries and `updated_at`. */
  at: string;
}

export interface ApplyPatchResult {
  record: ObjectRecord<unknown>;
  applied: AppliedPatchOp[];
  body_mutated: boolean;
}

const captureMutatedBody = (capture: PatchOpCapture): boolean => {
  if (capture.kind === 'fields') {
    if (capture.alias && (capture.alias.minted || capture.alias.consumed || capture.alias.restored)) return true;
    return !deepEqualJson(capture.before, capture.after);
  }
  if (capture.kind === 'element')
    return !deepEqualJson(capture.before, capture.after) || capture.container_pruned === true;
  return capture.before.index !== capture.after.index;
};

// ——— guard checking (the C§2.4 blind-revert rule) ———

const checkGuard = (op: PatchOp, actual: unknown): void => {
  if (op.guard === undefined) return;
  if (!deepEqualJson(op.guard.expected, actual)) {
    throw new PatchApplyError(
      'blind_revert_refused',
      `Refusing ${op.op}: the draft no longer matches the state this op expects (C§2.4 blind-revert rule); resolve manually.`,
      { expected: op.guard.expected, actual }
    );
  }
};

/**
 * A guarded op whose target unit is gone is a stale revert, not a lookup
 * mistake — surface it as blind-revert refusal. Without a guard it is an
 * ordinary bad address.
 */
const targetMissing = (op: PatchOp, what: string): PatchApplyError => {
  if (op.guard !== undefined) {
    return new PatchApplyError(
      'blind_revert_refused',
      `Refusing ${op.op}: ${what} no longer exists in the draft (C§2.4 blind-revert rule); resolve manually.`,
      { expected: op.guard.expected, actual: { missing: true } }
    );
  }
  return new PatchApplyError('target_not_found', `${op.op}: ${what} not found.`);
};

// ——— fields merge (shared by every *_meta / update_* / set_*_fields op) ———
//
// Plain-object values merge recursively (only when the current value is also
// a plain object); arrays and scalars replace wholesale; null deletes the
// key. Returns before/after trees mirroring the fields shape.

const snapshotFields = (target: UnknownRecord | undefined, fields: UnknownRecord): FieldsTree => {
  const snapshot: FieldsTree = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const current = target?.[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      snapshot[key] = snapshotFields(current, value);
      continue;
    }
    snapshot[key] = current === undefined ? null : (deepCloneJson(current) as PatchJsonValue);
  }
  return snapshot;
};

const mergeFields = (target: UnknownRecord, fields: UnknownRecord): { before: FieldsTree; after: FieldsTree } => {
  const before: FieldsTree = {};
  const after: FieldsTree = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const current = target[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      const nested = mergeFields(current, value);
      before[key] = nested.before;
      after[key] = nested.after;
      continue;
    }
    before[key] = current === undefined ? null : (deepCloneJson(current) as PatchJsonValue);
    if (value === null) {
      delete target[key];
      after[key] = null;
    } else {
      target[key] = deepCloneJson(value);
      after[key] = deepCloneJson(value) as PatchJsonValue;
    }
  }
  return { before, after };
};

const applyFieldsOp = (op: PatchOp, unit: UnknownRecord, fields: UnknownRecord): PatchOpCapture => {
  checkGuard(op, snapshotFields(unit, fields));
  const { before, after } = mergeFields(unit, fields);
  return { kind: 'fields', before, after };
};

// ——— structural body contracts (mirroring D§3.2–3.8; deep shapes are T0.2/T0.7's) ———

interface SectionLike extends UnknownRecord {
  id: string;
}
interface NavItemLike extends UnknownRecord {
  id: string;
  children?: NavItemLike[];
}
interface NavGroupLike extends UnknownRecord {
  id: string;
  items: NavItemLike[];
}
interface LinkActionLike extends UnknownRecord {
  label: string;
}
interface TermLike extends UnknownRecord {
  term_id: string;
  slug: string;
  label: string;
  status: 'active' | 'deprecated';
  merged_into?: string;
}
interface TemplateSlotLike extends UnknownRecord {
  slotId: string;
}

const expectPlainObject = (value: unknown, what: string): UnknownRecord => {
  if (!isPlainObject(value)) {
    throw new PatchApplyError('invalid_body', `Expected ${what} to be an object.`);
  }
  return value;
};

const expectArray = <T>(value: unknown, what: string): T[] => {
  if (!Array.isArray(value)) {
    throw new PatchApplyError('invalid_body', `Expected ${what} to be an array.`);
  }
  return value as T[];
};

const getSections = (body: UnknownRecord): SectionLike[] => expectArray<SectionLike>(body.sections, 'body.sections');
const getGroups = (body: UnknownRecord): NavGroupLike[] => expectArray<NavGroupLike>(body.groups, 'body.groups');
const getSlots = (body: UnknownRecord): TemplateSlotLike[] => expectArray<TemplateSlotLike>(body.slots, 'body.slots');
const getTerms = (body: UnknownRecord, kind: PatchTaxonomyKind): TermLike[] => {
  const kinds = expectPlainObject(body.kinds, 'body.kinds');
  const registry = expectPlainObject(kinds[kind], `body.kinds.${kind}`);
  return expectArray<TermLike>(registry.terms, `body.kinds.${kind}.terms`);
};

const elementSnapshot = (value: unknown, index: number, parentItemId?: string): ElementSnapshot => ({
  exists: true,
  value: deepCloneJson(value) as PatchJsonValue,
  index,
  ...(parentItemId !== undefined ? { parent_item_id: parentItemId } : {}),
});

const ABSENT: ElementSnapshot = { exists: false };

// ——— nav item tree addressing (depth ≤ 2 in practice, D§3.8) ———

interface ItemLocation {
  list: NavItemLike[];
  owner?: NavItemLike;
  index: number;
}

const findItemLocation = (list: NavItemLike[], itemId: string, owner?: NavItemLike): ItemLocation | undefined => {
  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    if (item.id === itemId) return { list, owner, index };
    if (Array.isArray(item.children)) {
      const found = findItemLocation(item.children, itemId, item);
      if (found) return found;
    }
  }
  return undefined;
};

// ——— section addressing: a 'page' owns a sections array; a shared 'section'
//     object wraps exactly one instance (C§2.3-section) ———

interface SectionLocation {
  kind: 'list' | 'wrapper';
  section: SectionLike;
  index: number;
}

const findSection = (objectType: ObjectType, body: UnknownRecord, sectionId: string): SectionLocation | undefined => {
  if (objectType === 'section') {
    const section = expectPlainObject(body.section, 'body.section') as SectionLike;
    return section.id === sectionId ? { kind: 'wrapper', section, index: 0 } : undefined;
  }
  const sections = getSections(body);
  const index = sections.findIndex((section) => section.id === sectionId);
  return index === -1 ? undefined : { kind: 'list', section: sections[index], index };
};

// ——— taxonomy alias helpers (C§2.3-taxonomy) ———

const mintAliasTermId = (terms: TermLike[], oldSlug: string): string => {
  const base = oldSlug.toLowerCase().replace(/[^a-z0-9]/g, '') || 'alias';
  let candidate = `t_${base}`;
  let suffix = 2;
  while (terms.some((term) => term.term_id === candidate)) {
    candidate = `t_${base}${suffix}`;
    suffix += 1;
  }
  return candidate;
};

// ——— per-op application ———

type ElementCapture = Extract<PatchOpCapture, { kind: 'element' }>;

const applyUpsertIntoList = <T extends UnknownRecord>(
  op: PatchOp,
  list: T[],
  matchIndex: number,
  payload: T,
  position: number | undefined
): ElementCapture => {
  if (matchIndex !== -1) {
    const before = elementSnapshot(list[matchIndex], matchIndex);
    checkGuard(op, before);
    list[matchIndex] = deepCloneJson(payload);
    return { kind: 'element', before, after: elementSnapshot(list[matchIndex], matchIndex) };
  }
  checkGuard(op, ABSENT);
  const index = insertAt(list, position, deepCloneJson(payload));
  return { kind: 'element', before: ABSENT, after: elementSnapshot(list[index], index) };
};

const applyRemoveFromList = <T extends UnknownRecord>(op: PatchOp, list: T[], matchIndex: number): ElementCapture => {
  const before = elementSnapshot(list[matchIndex], matchIndex);
  checkGuard(op, before);
  list.splice(matchIndex, 1);
  return { kind: 'element', before, after: ABSENT };
};

const applyMoveInList = <T extends UnknownRecord>(
  op: PatchOp,
  list: T[],
  matchIndex: number,
  toIndex: number,
  parentItemId?: string
): PatchOpCapture => {
  const before: MoveSnapshot = {
    index: matchIndex,
    ...(parentItemId !== undefined ? { parent_item_id: parentItemId } : {}),
  };
  checkGuard(op, before);
  const finalIndex = moveTo(list, matchIndex, toIndex);
  const after: MoveSnapshot = {
    index: finalIndex,
    ...(parentItemId !== undefined ? { parent_item_id: parentItemId } : {}),
  };
  return { kind: 'move', before, after };
};

const applyUpdateTerm = (op: PatchOpOfName<'update_term'>, body: UnknownRecord): PatchOpCapture => {
  const terms = getTerms(body, op.kind);
  const termIndex = terms.findIndex((term) => term.term_id === op.term_id);
  if (termIndex === -1) throw targetMissing(op, `term '${op.term_id}' in kind '${op.kind}'`);
  const term = terms[termIndex];

  const fields = op.fields as UnknownRecord;
  checkGuard(op, snapshotFields(term, fields));

  const oldSlug = term.slug;
  const oldLabel = term.label;
  const { before, after } = mergeFields(term, fields);
  const newSlug = term.slug;
  const slugChanged = op.fields.slug !== undefined && newSlug !== oldSlug;

  if (!slugChanged) {
    if (op.mint_alias !== undefined || op.alias_term_id !== undefined || op.restore_alias !== undefined) {
      throw new PatchApplyError(
        'invalid_op',
        `update_term: alias controls were provided but the slug did not change (current slug '${oldSlug}').`
      );
    }
    return { kind: 'fields', before, after };
  }

  const alias: AliasCapture = {};

  // A deprecated self-alias already holding the new slug proves this rename
  // reverts an earlier one; consume it so the term and its alias never claim
  // the same slug (C§2.3-taxonomy).
  const consumeIndex = terms.findIndex(
    (candidate) =>
      candidate !== term &&
      candidate.slug === newSlug &&
      candidate.status === 'deprecated' &&
      candidate.merged_into === term.term_id
  );
  if (consumeIndex !== -1) {
    alias.consumed = { term: deepCloneJson(terms[consumeIndex]) as TermPayload, index: consumeIndex };
    terms.splice(consumeIndex, 1);
  }

  if (op.mint_alias === false) {
    const restoresVacatedSlug =
      op.restore_alias !== undefined &&
      op.restore_alias.term.slug === oldSlug &&
      op.restore_alias.term.status === 'deprecated' &&
      op.restore_alias.term.merged_into === op.term_id;
    if (alias.consumed === undefined && !restoresVacatedSlug) {
      throw new PatchApplyError(
        'alias_required',
        `update_term: renaming '${oldSlug}' → '${newSlug}' without the auto-alias is only allowed when the rename reverts a prior rename (C§2.3-taxonomy).`
      );
    }
  } else {
    const aliasTermId = op.alias_term_id ?? mintAliasTermId(terms, oldSlug);
    if (terms.some((candidate) => candidate.term_id === aliasTermId)) {
      throw new PatchApplyError(
        'alias_conflict',
        `update_term: alias term id '${aliasTermId}' already exists in kind '${op.kind}'.`
      );
    }
    const aliasTerm: TermLike = {
      term_id: aliasTermId,
      slug: oldSlug,
      label: oldLabel,
      status: 'deprecated',
      merged_into: term.term_id,
    };
    terms.push(aliasTerm);
    alias.minted = { term: deepCloneJson(aliasTerm) as TermPayload, index: terms.length - 1 };
  }

  if (op.restore_alias !== undefined) {
    if (terms.some((candidate) => candidate.term_id === op.restore_alias!.term.term_id)) {
      throw new PatchApplyError(
        'alias_conflict',
        `update_term: restore_alias term id '${op.restore_alias.term.term_id}' already exists in kind '${op.kind}'.`
      );
    }
    const restored = deepCloneJson(op.restore_alias.term) as TermLike;
    const index = insertAt(terms, op.restore_alias.position, restored);
    alias.restored = { term: deepCloneJson(restored) as TermPayload, index };
  }

  return { kind: 'fields', before, after, alias };
};

const termStatusSnapshot = (term: TermLike): FieldsTree => ({
  status: term.status,
  merged_into: term.merged_into === undefined ? null : (deepCloneJson(term.merged_into) as PatchJsonValue),
});

const applyOp = (objectType: ObjectType, body: UnknownRecord, op: PatchOp): PatchOpCapture => {
  switch (op.op) {
    // ——— page / shared-section family ———
    case 'set_page_meta':
      return applyFieldsOp(op, body, op.fields as UnknownRecord);

    case 'upsert_section': {
      if (objectType === 'section') {
        // The wrapper holds exactly one section; upsert replaces it.
        const current = expectPlainObject(body.section, 'body.section');
        const before = elementSnapshot(current, 0);
        checkGuard(op, before);
        body.section = deepCloneJson(op.section);
        return { kind: 'element', before, after: elementSnapshot(body.section, 0) };
      }
      const sections = getSections(body);
      const index = sections.findIndex((section) => section.id === op.section.id);
      return applyUpsertIntoList(op, sections, index, op.section as SectionLike, op.position);
    }

    case 'update_section_data': {
      const located = findSection(objectType, body, op.section_id);
      if (!located) throw targetMissing(op, `section '${op.section_id}'`);
      const data = expectPlainObject(located.section.data, `section '${op.section_id}' data`);
      return applyFieldsOp(op, data, op.fields as UnknownRecord);
    }

    case 'move_section': {
      const sections = getSections(body);
      const index = sections.findIndex((section) => section.id === op.section_id);
      if (index === -1) throw targetMissing(op, `section '${op.section_id}'`);
      return applyMoveInList(op, sections, index, op.to_index);
    }

    case 'set_section_visibility': {
      const located = findSection(objectType, body, op.section_id);
      if (!located) throw targetMissing(op, `section '${op.section_id}'`);
      const snapshot: FieldsTree = {
        visibility: located.section.visibility === undefined ? null : (located.section.visibility as PatchJsonValue),
      };
      checkGuard(op, snapshot);
      if (op.visibility === null) delete located.section.visibility;
      else located.section.visibility = op.visibility;
      return { kind: 'fields', before: snapshot, after: { visibility: op.visibility } };
    }

    case 'remove_section': {
      const sections = getSections(body);
      const index = sections.findIndex((section) => section.id === op.section_id);
      if (index === -1) throw targetMissing(op, `section '${op.section_id}'`);
      return applyRemoveFromList(op, sections, index);
    }

    // ——— navigation family ———
    case 'set_nav_meta':
      return applyFieldsOp(op, body, op.fields as UnknownRecord);

    case 'upsert_group': {
      const groups = getGroups(body);
      const index = groups.findIndex((group) => group.id === op.group.id);
      return applyUpsertIntoList(op, groups, index, op.group as NavGroupLike, op.position);
    }

    case 'move_group': {
      const groups = getGroups(body);
      const index = groups.findIndex((group) => group.id === op.group_id);
      if (index === -1) throw targetMissing(op, `group '${op.group_id}'`);
      return applyMoveInList(op, groups, index, op.to_index);
    }

    case 'remove_group': {
      const groups = getGroups(body);
      const index = groups.findIndex((group) => group.id === op.group_id);
      if (index === -1) throw targetMissing(op, `group '${op.group_id}'`);
      return applyRemoveFromList(op, groups, index);
    }

    case 'upsert_item': {
      const groups = getGroups(body);
      const group = groups.find((candidate) => candidate.id === op.group_id);
      if (!group) throw targetMissing(op, `group '${op.group_id}'`);
      const items = expectArray<NavItemLike>(group.items, `group '${op.group_id}' items`);
      const existing = findItemLocation(items, op.item.id);
      if (existing) {
        // Replace in place, wherever the item lives; position/parent_item_id
        // apply to inserts only.
        const before = elementSnapshot(existing.list[existing.index], existing.index, existing.owner?.id);
        checkGuard(op, before);
        existing.list[existing.index] = deepCloneJson(op.item) as NavItemLike;
        return {
          kind: 'element',
          before,
          after: elementSnapshot(existing.list[existing.index], existing.index, existing.owner?.id),
        };
      }
      checkGuard(op, ABSENT);
      if (op.parent_item_id !== undefined) {
        const parentLocation = findItemLocation(items, op.parent_item_id);
        if (!parentLocation) throw targetMissing(op, `parent item '${op.parent_item_id}' in group '${op.group_id}'`);
        const parent = parentLocation.list[parentLocation.index];
        const containerCreated = !Array.isArray(parent.children);
        if (containerCreated) parent.children = [];
        const index = insertAt(parent.children as NavItemLike[], op.position, deepCloneJson(op.item) as NavItemLike);
        return {
          kind: 'element',
          before: ABSENT,
          after: elementSnapshot((parent.children as NavItemLike[])[index], index, parent.id),
          ...(containerCreated ? { container_created: true } : {}),
        };
      }
      const index = insertAt(items, op.position, deepCloneJson(op.item) as NavItemLike);
      return { kind: 'element', before: ABSENT, after: elementSnapshot(items[index], index) };
    }

    case 'update_item': {
      const groups = getGroups(body);
      const group = groups.find((candidate) => candidate.id === op.group_id);
      if (!group) throw targetMissing(op, `group '${op.group_id}'`);
      const located = findItemLocation(
        expectArray<NavItemLike>(group.items, `group '${op.group_id}' items`),
        op.item_id
      );
      if (!located) throw targetMissing(op, `item '${op.item_id}' in group '${op.group_id}'`);
      return applyFieldsOp(op, located.list[located.index], op.fields as UnknownRecord);
    }

    case 'move_item': {
      const groups = getGroups(body);
      const group = groups.find((candidate) => candidate.id === op.group_id);
      if (!group) throw targetMissing(op, `group '${op.group_id}'`);
      const located = findItemLocation(
        expectArray<NavItemLike>(group.items, `group '${op.group_id}' items`),
        op.item_id
      );
      if (!located) throw targetMissing(op, `item '${op.item_id}' in group '${op.group_id}'`);
      return applyMoveInList(op, located.list, located.index, op.to_index, located.owner?.id);
    }

    case 'remove_item': {
      const groups = getGroups(body);
      const group = groups.find((candidate) => candidate.id === op.group_id);
      if (!group) throw targetMissing(op, `group '${op.group_id}'`);
      const located = findItemLocation(
        expectArray<NavItemLike>(group.items, `group '${op.group_id}' items`),
        op.item_id
      );
      if (!located) throw targetMissing(op, `item '${op.item_id}' in group '${op.group_id}'`);
      const before = elementSnapshot(located.list[located.index], located.index, located.owner?.id);
      checkGuard(op, before);
      located.list.splice(located.index, 1);
      let containerPruned = false;
      if (op.prune_empty === true && located.owner !== undefined && located.list.length === 0) {
        // `children` is optional (D§3.8); pruning restores its absence.
        // Top-level `items` is required and is never pruned.
        delete located.owner.children;
        containerPruned = true;
      }
      return { kind: 'element', before, after: ABSENT, ...(containerPruned ? { container_pruned: true } : {}) };
    }

    case 'upsert_action': {
      const actions =
        body.actions === undefined ? undefined : expectArray<LinkActionLike>(body.actions, 'body.actions');
      const index = actions === undefined ? -1 : actions.findIndex((action) => action.label === op.action.label);
      if (actions !== undefined && index !== -1) {
        return applyUpsertIntoList(op, actions, index, op.action as LinkActionLike, op.position);
      }
      checkGuard(op, ABSENT);
      const containerCreated = actions === undefined;
      const list = actions ?? [];
      if (containerCreated) body.actions = list;
      const insertedAt = insertAt(list, op.position, deepCloneJson(op.action) as LinkActionLike);
      return {
        kind: 'element',
        before: ABSENT,
        after: elementSnapshot(list[insertedAt], insertedAt),
        ...(containerCreated ? { container_created: true } : {}),
      };
    }

    case 'remove_action': {
      const actions =
        body.actions === undefined ? undefined : expectArray<LinkActionLike>(body.actions, 'body.actions');
      const index = actions === undefined ? -1 : actions.findIndex((action) => action.label === op.label);
      if (actions === undefined || index === -1) throw targetMissing(op, `action '${op.label}'`);
      const capture = applyRemoveFromList(op, actions, index);
      if (op.prune_empty === true && actions.length === 0) {
        // `actions` is optional on the navigation body (D§3.8).
        delete body.actions;
        return { ...capture, container_pruned: true };
      }
      return capture;
    }

    // ——— taxonomy family ———
    case 'add_term': {
      const terms = getTerms(body, op.kind);
      const index = terms.findIndex((term) => term.term_id === op.term.term_id);
      const snapshot = index === -1 ? ABSENT : elementSnapshot(terms[index], index);
      checkGuard(op, snapshot);
      if (index !== -1) {
        throw new PatchApplyError(
          'duplicate_target',
          `add_term: term '${op.term.term_id}' already exists in kind '${op.kind}'.`
        );
      }
      const term: TermLike = { ...(deepCloneJson(op.term) as TermPayload), status: op.term.status ?? 'active' };
      const insertedAt = insertAt(terms, op.position, term);
      return { kind: 'element', before: ABSENT, after: elementSnapshot(terms[insertedAt], insertedAt) };
    }

    case 'update_term':
      return applyUpdateTerm(op, body);

    case 'deprecate_term': {
      const terms = getTerms(body, op.kind);
      const term = terms.find((candidate) => candidate.term_id === op.term_id);
      if (!term) throw targetMissing(op, `term '${op.term_id}' in kind '${op.kind}'`);
      const before = termStatusSnapshot(term);
      checkGuard(op, before);
      term.status = 'deprecated';
      if (op.merged_into === undefined) delete term.merged_into;
      else term.merged_into = op.merged_into;
      return { kind: 'fields', before, after: termStatusSnapshot(term) };
    }

    case 'reactivate_term': {
      const terms = getTerms(body, op.kind);
      const term = terms.find((candidate) => candidate.term_id === op.term_id);
      if (!term) throw targetMissing(op, `term '${op.term_id}' in kind '${op.kind}'`);
      const before = termStatusSnapshot(term);
      checkGuard(op, before);
      term.status = 'active';
      delete term.merged_into;
      return { kind: 'fields', before, after: termStatusSnapshot(term) };
    }

    case 'remove_term': {
      const terms = getTerms(body, op.kind);
      const index = terms.findIndex((term) => term.term_id === op.term_id);
      if (index === -1) throw targetMissing(op, `term '${op.term_id}' in kind '${op.kind}'`);
      return applyRemoveFromList(op, terms, index);
    }

    // ——— site family ———
    case 'set_site_fields':
      return applyFieldsOp(op, body, op.fields as UnknownRecord);

    // ——— template family ———
    case 'set_template_meta':
      return applyFieldsOp(op, body, op.fields as UnknownRecord);

    case 'upsert_slot': {
      const slots = getSlots(body);
      const index = slots.findIndex((slot) => slot.slotId === op.slot.slotId);
      return applyUpsertIntoList(op, slots, index, op.slot as TemplateSlotLike, op.position);
    }

    case 'move_slot': {
      const slots = getSlots(body);
      const index = slots.findIndex((slot) => slot.slotId === op.slot_id);
      if (index === -1) throw targetMissing(op, `slot '${op.slot_id}'`);
      return applyMoveInList(op, slots, index, op.to_index);
    }

    case 'remove_slot': {
      const slots = getSlots(body);
      const index = slots.findIndex((slot) => slot.slotId === op.slot_id);
      if (index === -1) throw targetMissing(op, `slot '${op.slot_id}'`);
      return applyRemoveFromList(op, slots, index);
    }
  }
};

// ——— the public apply entry point ———

export const applyPatchOps = (
  record: ObjectRecord<unknown>,
  ops: readonly unknown[],
  options: ApplyPatchOptions
): ApplyPatchResult => {
  // Parse and family-check everything first so a malformed batch fails
  // before any work happens (the batch is atomic either way — mutations
  // happen on a clone).
  const parsedOps: PatchOp[] = ops.map((rawOp, index) => {
    let parsed: PatchOp;
    try {
      parsed = patchOpSchema.parse(rawOp);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new PatchApplyError(
          'invalid_op',
          `ops[${index}] is not a valid patch op: ${error.issues[0]?.message ?? 'invalid'}`,
          {
            issues: error.issues,
          }
        );
      }
      throw error;
    }
    const allowed = patchOpNamesByObjectType[record.object_type] as readonly string[];
    if (!allowed.includes(parsed.op)) {
      throw new PatchApplyError(
        'op_not_applicable',
        record.object_type === 'content_item'
          ? `ops[${index}]: content_item is served by the existing article tool surface (C§2.0); generic patch ops do not apply.`
          : `ops[${index}]: op '${parsed.op}' does not apply to object_type '${record.object_type}'.`
      );
    }
    return parsed;
  });

  if (parsedOps.length === 0) {
    return { record: { ...record, history: [...record.history] }, applied: [], body_mutated: false };
  }

  const body = expectPlainObject(deepCloneJson(record.body), 'body');
  const applied: AppliedPatchOp[] = [];
  const entries: HistoryEntry[] = [];

  for (const op of parsedOps) {
    const capture = applyOp(record.object_type, body, op);
    const bodyMutated = captureMutatedBody(capture);
    applied.push({ op, capture, body_mutated: bodyMutated });
    entries.push({
      at: options.at,
      action: op.op,
      actor: options.actor,
      details: deepCloneJson({ op, capture }) as Record<string, unknown>,
    });
  }

  const mutatedOps = applied.filter((entry) => entry.body_mutated).length;
  const next: ObjectRecord<unknown> = {
    ...record,
    body,
    updated_at: options.at,
    history: [...record.history, ...entries],
    // Every op application bumps `version`; `content_revision` moves only
    // with actual body mutation (D§3.1 / C§2.0).
    version: record.version + applied.length,
    content_revision: record.content_revision + mutatedOps,
  };
  return { record: next, applied, body_mutated: mutatedOps > 0 };
};

// ——— inverse derivation (C§2.4 Discard) ———

const invalidInverse = (op: PatchOp, reason: string): PatchApplyError =>
  new PatchApplyError('invalid_op', `Cannot derive inverse of ${op.op}: ${reason}`);

const expectCaptureKind = <TKind extends PatchOpCapture['kind']>(
  op: PatchOp,
  capture: PatchOpCapture,
  kind: TKind
): Extract<PatchOpCapture, { kind: TKind }> => {
  if (capture.kind !== kind) throw invalidInverse(op, `capture kind '${capture.kind}' does not match the op.`);
  return capture as Extract<PatchOpCapture, { kind: TKind }>;
};

const guardOf = (expected: unknown): { guard: { expected: unknown } } => ({
  guard: { expected: deepCloneJson(expected) },
});

const inverseOfUpsert = (
  capture: Extract<PatchOpCapture, { kind: 'element' }>,
  restore: (value: PatchJsonValue) => PatchOp,
  remove: (after: Extract<ElementSnapshot, { exists: true }>) => PatchOp
): PatchOp => {
  if (capture.before.exists) {
    // Conditional-upsert inverse (C§2.4): the op replaced an existing
    // element — restore the stored `before`; a blind remove would delete
    // pre-existing content the op merely modified.
    return { ...restore(deepCloneJson(capture.before.value)), ...guardOf(capture.after) } as PatchOp;
  }
  if (!capture.after.exists) throw new PatchApplyError('invalid_op', 'upsert capture has neither before nor after.');
  // True insert — the inverse removes it.
  return { ...remove(capture.after), ...guardOf(capture.after) } as PatchOp;
};

const inverseOfRemove = (
  capture: Extract<PatchOpCapture, { kind: 'element' }>,
  restore: (before: Extract<ElementSnapshot, { exists: true }>) => PatchOp
): PatchOp => {
  if (!capture.before.exists) throw new PatchApplyError('invalid_op', 'remove capture has no before element.');
  return { ...restore(capture.before), ...guardOf(ABSENT) } as PatchOp;
};

/**
 * Derive the compensating op for an applied patch op, from exactly what its
 * history entry stores (`details: {op, capture}`). The returned op carries a
 * `guard` pinning the state it expects (the forward op's captured `after`),
 * so applying it through `applyPatchOps` enforces the C§2.4 blind-revert
 * rule automatically.
 */
export const derivePatchInverse = (op: PatchOp, capture: PatchOpCapture): PatchOp => {
  switch (op.op) {
    case 'set_page_meta':
    case 'set_nav_meta':
    case 'set_site_fields':
    case 'set_template_meta': {
      const fieldsCapture = expectCaptureKind(op, capture, 'fields');
      return patchOpSchema.parse({ op: op.op, fields: fieldsCapture.before, ...guardOf(fieldsCapture.after) });
    }

    case 'update_section_data': {
      const fieldsCapture = expectCaptureKind(op, capture, 'fields');
      return patchOpSchema.parse({
        op: op.op,
        section_id: op.section_id,
        fields: fieldsCapture.before,
        ...guardOf(fieldsCapture.after),
      });
    }

    case 'update_item': {
      const fieldsCapture = expectCaptureKind(op, capture, 'fields');
      return patchOpSchema.parse({
        op: op.op,
        group_id: op.group_id,
        item_id: op.item_id,
        fields: fieldsCapture.before,
        ...guardOf(fieldsCapture.after),
      });
    }

    case 'set_section_visibility': {
      const fieldsCapture = expectCaptureKind(op, capture, 'fields');
      return patchOpSchema.parse({
        op: op.op,
        section_id: op.section_id,
        visibility: fieldsCapture.before.visibility ?? null,
        ...guardOf(fieldsCapture.after),
      });
    }

    case 'upsert_section': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      return patchOpSchema.parse(
        inverseOfUpsert(
          elementCapture,
          (value) => ({ op: 'upsert_section', section: value }) as unknown as PatchOp,
          () => ({ op: 'remove_section', section_id: op.section.id }) as unknown as PatchOp
        )
      );
    }

    case 'remove_section': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      return patchOpSchema.parse(
        inverseOfRemove(
          elementCapture,
          (before) => ({ op: 'upsert_section', section: before.value, position: before.index }) as unknown as PatchOp
        )
      );
    }

    case 'upsert_group': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      return patchOpSchema.parse(
        inverseOfUpsert(
          elementCapture,
          (value) => ({ op: 'upsert_group', group: value }) as unknown as PatchOp,
          () => ({ op: 'remove_group', group_id: op.group.id }) as unknown as PatchOp
        )
      );
    }

    case 'remove_group': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      return patchOpSchema.parse(
        inverseOfRemove(
          elementCapture,
          (before) => ({ op: 'upsert_group', group: before.value, position: before.index }) as unknown as PatchOp
        )
      );
    }

    case 'upsert_item': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      return patchOpSchema.parse(
        inverseOfUpsert(
          elementCapture,
          (value) => ({ op: 'upsert_item', group_id: op.group_id, item: value }) as unknown as PatchOp,
          () =>
            ({
              op: 'remove_item',
              group_id: op.group_id,
              item_id: op.item.id,
              ...(elementCapture.container_created === true ? { prune_empty: true } : {}),
            }) as unknown as PatchOp
        )
      );
    }

    case 'remove_item': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      return patchOpSchema.parse(
        inverseOfRemove(
          elementCapture,
          (before) =>
            ({
              op: 'upsert_item',
              group_id: op.group_id,
              item: before.value,
              position: before.index,
              ...(before.parent_item_id !== undefined ? { parent_item_id: before.parent_item_id } : {}),
            }) as unknown as PatchOp
        )
      );
    }

    case 'upsert_action': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      return patchOpSchema.parse(
        inverseOfUpsert(
          elementCapture,
          (value) => ({ op: 'upsert_action', action: value }) as unknown as PatchOp,
          () =>
            ({
              op: 'remove_action',
              label: op.action.label,
              ...(elementCapture.container_created === true ? { prune_empty: true } : {}),
            }) as unknown as PatchOp
        )
      );
    }

    case 'remove_action': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      return patchOpSchema.parse(
        inverseOfRemove(
          elementCapture,
          (before) => ({ op: 'upsert_action', action: before.value, position: before.index }) as unknown as PatchOp
        )
      );
    }

    case 'upsert_slot': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      return patchOpSchema.parse(
        inverseOfUpsert(
          elementCapture,
          (value) => ({ op: 'upsert_slot', slot: value }) as unknown as PatchOp,
          () => ({ op: 'remove_slot', slot_id: op.slot.slotId }) as unknown as PatchOp
        )
      );
    }

    case 'remove_slot': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      return patchOpSchema.parse(
        inverseOfRemove(
          elementCapture,
          (before) => ({ op: 'upsert_slot', slot: before.value, position: before.index }) as unknown as PatchOp
        )
      );
    }

    case 'move_section':
    case 'move_group':
    case 'move_item':
    case 'move_slot': {
      const moveCapture = expectCaptureKind(op, capture, 'move');
      return patchOpSchema.parse({ ...op, to_index: moveCapture.before.index, ...guardOf(moveCapture.after) });
    }

    case 'add_term': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      if (!elementCapture.after.exists) throw invalidInverse(op, 'capture has no inserted term.');
      // C§2.4: add_term inverts to term removal.
      return patchOpSchema.parse({
        op: 'remove_term',
        kind: op.kind,
        term_id: op.term.term_id,
        ...guardOf(elementCapture.after),
      });
    }

    case 'remove_term': {
      const elementCapture = expectCaptureKind(op, capture, 'element');
      if (!elementCapture.before.exists) throw invalidInverse(op, 'capture has no removed term.');
      return patchOpSchema.parse({
        op: 'add_term',
        kind: op.kind,
        term: elementCapture.before.value,
        position: elementCapture.before.index,
        ...guardOf(ABSENT),
      });
    }

    case 'deprecate_term':
    case 'reactivate_term': {
      const fieldsCapture = expectCaptureKind(op, capture, 'fields');
      const beforeStatus = fieldsCapture.before.status;
      const beforeMerged = fieldsCapture.before.merged_into ?? null;
      if (beforeStatus === 'active' && beforeMerged === null) {
        return patchOpSchema.parse({
          op: 'reactivate_term',
          kind: op.kind,
          term_id: op.term_id,
          ...guardOf(fieldsCapture.after),
        });
      }
      if (beforeStatus === 'deprecated') {
        return patchOpSchema.parse({
          op: 'deprecate_term',
          kind: op.kind,
          term_id: op.term_id,
          ...(beforeMerged !== null ? { merged_into: beforeMerged } : {}),
          ...guardOf(fieldsCapture.after),
        });
      }
      // 'active' + merged_into is unreachable through this grammar; refuse
      // rather than restore it approximately.
      throw invalidInverse(
        op,
        `prior term state {status: ${String(beforeStatus)}, merged_into: ${String(beforeMerged)}} is not expressible.`
      );
    }

    case 'update_term': {
      const fieldsCapture = expectCaptureKind(op, capture, 'fields');
      const slugChanged =
        fieldsCapture.before.slug !== undefined &&
        fieldsCapture.after.slug !== undefined &&
        !deepEqualJson(fieldsCapture.before.slug, fieldsCapture.after.slug);
      if (!slugChanged) {
        return patchOpSchema.parse({
          op: 'update_term',
          kind: op.kind,
          term_id: op.term_id,
          fields: fieldsCapture.before,
          ...guardOf(fieldsCapture.after),
        });
      }
      // Slug rename inverse (C§2.3-taxonomy): restoring the old slug
      // consumes the forward-minted alias (or the forward-restored one)
      // naturally, because that alias holds exactly the slug being restored;
      // mint_alias:false suppresses an alias for the slug being vacated; a
      // forward-consumed alias is re-inserted verbatim via restore_alias.
      const consumed = fieldsCapture.alias?.consumed;
      return patchOpSchema.parse({
        op: 'update_term',
        kind: op.kind,
        term_id: op.term_id,
        fields: fieldsCapture.before,
        mint_alias: false,
        ...(consumed !== undefined ? { restore_alias: { term: consumed.term, position: consumed.index } } : {}),
        ...guardOf(fieldsCapture.after),
      });
    }
  }
};
