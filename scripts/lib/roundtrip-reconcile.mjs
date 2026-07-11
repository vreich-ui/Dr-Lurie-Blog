/**
 * Pure reconcile helpers for the home-conversion round-trip driver
 * (scripts/home-conversion-roundtrip.mjs) — extracted so the drift-healing
 * logic is unit-testable offline (tests/scripts/roundtrip-reconcile.test.mjs).
 *
 * The hard-won rule encoded here is playbook trap 2: `set_page_meta` (like
 * every fields op) DEEP-MERGES object values onto the existing record, so a
 * key the target omits but the current record carries survives the merge
 * unless it is explicitly set to `null` (null = delete). The first production
 * heal of page_home (2026-07-10) missed this: three stray `seo` subkeys
 * survived and the reconciled body failed the byte-identical check.
 */

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Build the `fields` payload that transforms `current` into `target` under
 * deep-merge semantics: target values win, and any key present in `current`
 * but absent from `target` — at ANY depth where both sides are plain objects —
 * is explicitly nulled so the merge deletes it. Arrays and scalars replace
 * wholesale (the merge does not recurse into them).
 */
export const diffFieldsForMerge = (target, current) => {
  const fields = {};
  const targetObj = isPlainObject(target) ? target : {};
  const currentObj = isPlainObject(current) ? current : {};
  for (const key of new Set([...Object.keys(targetObj), ...Object.keys(currentObj)])) {
    const targetValue = targetObj[key];
    const currentValue = currentObj[key];
    if (targetValue === undefined) {
      fields[key] = null; // stray key: delete
    } else if (isPlainObject(targetValue) && isPlainObject(currentValue)) {
      fields[key] = diffFieldsForMerge(targetValue, currentValue); // recurse: null nested strays
    } else {
      fields[key] = targetValue; // scalar/array/new object: replace wholesale
    }
  }
  return fields;
};

const PAGE_META_KEYS = ['route', 'pageType', 'title', 'seo', 'navigationOverrides', 'template'];
// set_template_meta forbids 'slots' (the slot ops own them) — mirror that split.
const TEMPLATE_META_KEYS = ['name', 'appliesTo'];

/**
 * The patch ops that heal a drifted record back to its seed body.
 *
 * - section objects: the wrapper holds exactly one instance; `upsert_section`
 *   replaces it wholesale — one op, no merge pitfalls.
 * - page objects: meta first (so structure_home_footer sees the footer
 *   override immediately), via diffFieldsForMerge against the CURRENT record's
 *   meta (nulling strays at every depth); then per-section upserts (wholesale
 *   replace by id), removal of stray sections, and explicit final ordering.
 * - template objects (W2.5): the same shape as pages with slots in place of
 *   sections — meta diff (name/appliesTo; set_template_meta forbids `slots`),
 *   positioned per-slot upserts, stray-slot removal, explicit final ordering.
 */
export const reconcileOps = (seed, currentBody) => {
  if (seed.objectType === 'section') {
    return [{ op: 'upsert_section', section: seed.body.section }];
  }
  if (seed.objectType === 'template') {
    const target = seed.body;
    const current = isPlainObject(currentBody) ? currentBody : {};
    const targetSlotIds = new Set(target.slots.map((slot) => slot.slotId));
    const ops = [];

    const pickMeta = (source) =>
      Object.fromEntries(TEMPLATE_META_KEYS.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])));
    ops.push({ op: 'set_template_meta', fields: diffFieldsForMerge(pickMeta(target), pickMeta(current)) });

    target.slots.forEach((slot, index) => {
      ops.push({ op: 'upsert_slot', slot, position: index });
    });
    const currentSlots = Array.isArray(current.slots) ? current.slots : [];
    for (const slot of currentSlots) {
      if (slot && typeof slot.slotId === 'string' && !targetSlotIds.has(slot.slotId)) {
        ops.push({ op: 'remove_slot', slot_id: slot.slotId });
      }
    }
    // upsert leaves pre-existing slots in place — pin the final order explicitly.
    target.slots.forEach((slot, index) => {
      ops.push({ op: 'move_slot', slot_id: slot.slotId, to_index: index });
    });
    return ops;
  }
  const target = seed.body;
  const current = isPlainObject(currentBody) ? currentBody : {};
  const targetIds = new Set(target.sections.map((section) => section.id));
  const ops = [];

  const pick = (source) =>
    Object.fromEntries(PAGE_META_KEYS.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])));
  ops.push({ op: 'set_page_meta', fields: diffFieldsForMerge(pick(target), pick(current)) });

  target.sections.forEach((section, index) => {
    ops.push({ op: 'upsert_section', section, position: index });
  });
  const currentSections = Array.isArray(current.sections) ? current.sections : [];
  for (const section of currentSections) {
    if (section && typeof section.id === 'string' && !targetIds.has(section.id)) {
      ops.push({ op: 'remove_section', section_id: section.id });
    }
  }
  // upsert leaves pre-existing sections in place — pin the final order explicitly.
  target.sections.forEach((section, index) => {
    ops.push({ op: 'move_section', section_id: section.id, to_index: index });
  });
  return ops;
};
