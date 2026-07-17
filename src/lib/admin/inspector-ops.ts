/**
 * Object inspector op-builder (T9.9). The generated inspector edits fields and
 * saves them through the type's contract patch ops. The ONE trap that must be
 * handled everywhere (conversion-playbook trap #2 / #10): the fields ops
 * DEEP-MERGE, so switching a discriminated-union variant leaves the old
 * variant's keys behind unless they are explicitly set to `null` — recursively,
 * at every nesting depth. This mirrors the unit-tested `diffFieldsForMerge`
 * (scripts/lib/roundtrip-reconcile.mjs) in typed form so the inspector can
 * never emit a merge that strands stale keys.
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Produce the value to send in a deep-merge fields payload so that applying it
 * to `current` yields exactly `next`: keys present in `current` but absent in
 * `next` become `null` (delete); nested objects recurse; scalars, arrays, and
 * object-for-scalar swaps replace wholesale.
 */
export function mergeNullingValue(next: unknown, current: unknown): unknown {
  if (isPlainObject(next) && isPlainObject(current)) {
    const out: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(next), ...Object.keys(current)])) {
      if (!(key in next)) {
        out[key] = null; // stray key from the old variant/shape → delete
      } else {
        out[key] = mergeNullingValue(next[key], current[key]);
      }
    }
    return out;
  }
  return next; // scalar / array / type change → wholesale replace
}

export interface FieldsPatchOp {
  op: string;
  fields: Record<string, unknown>;
}

/**
 * A single deep-merge fields patch op that sets `fieldKey` to `next`, nulling
 * any keys the old value had that `next` drops. `op` is the type's fields op
 * (e.g. `update_section_data`, `set_page_meta`, `update_item`).
 */
export function buildFieldsPatchOp(op: string, fieldKey: string, next: unknown, current: unknown): FieldsPatchOp {
  return { op, fields: { [fieldKey]: mergeNullingValue(next, current) } };
}

/** True when writing `next` over `current` would strand at least one old key (needs an explicit null). */
export function strandsKeys(next: unknown, current: unknown): boolean {
  if (!isPlainObject(next) || !isPlainObject(current)) return false;
  for (const key of Object.keys(current)) {
    if (!(key in next)) return true;
    if (strandsKeys(next[key], current[key])) return true;
  }
  return false;
}
