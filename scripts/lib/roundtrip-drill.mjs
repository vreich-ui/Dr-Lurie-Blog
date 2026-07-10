/**
 * Drill-op construction for the round-trip driver
 * (scripts/home-conversion-roundtrip.mjs). Extracted so the op sequences — each
 * of which must exercise EVERY permitted op for its object type while ending
 * byte-identical to the record's current body — are unit-testable AND
 * type-generic: they must survive strict per-type schemas (e.g. `prose`'s
 * body-only shape, `content_grid`'s no-`kicker` shape), not just the home
 * family's hero/grid/bio. The original home-only drill hard-coded a
 * `{ kicker: 'probe' }` field probe and a `hero`-typed page probe, both of
 * which fail the moment a family without those shapes converts.
 */

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

// Plain-text (non-rich-text, non-array) fields safe to append a probe marker to
// and then restore. Ordered by how universally section types carry them. The
// rich-text `body` field is deliberately EXCLUDED — appending raw text after a
// closing </p> breaks the RichText allowlist and the paragraph splitter.
const PLAIN_TEXT_PROBE_FIELDS = [
  'heading',
  'title',
  'kicker',
  'label',
  'eyebrow',
  'ctaHeading',
  'disclaimer',
  'consentText',
  'anchor',
  'placeholder',
  'message',
  'indexRoute',
];

/**
 * Build update_section_data op(s) that exercise the op on a section of UNKNOWN
 * type, guaranteed valid under the type's strict schema and byte-identical once
 * applied:
 *   - preferred: a plain-text field present in the data → append a probe marker
 *     then restore the original value (two ops; genuinely mutates + reverts);
 *   - fallback (e.g. `prose`, whose only field is rich-text `body`): set the
 *     first data field to its own cloned value (one op) — a body-level no-op
 *     that still dispatches → applies → captures → re-validates the op.
 * Returns { ops } (1 or 2 ops). Never sends a key the type's schema lacks.
 */
export const updateDataProbeOps = (sectionId, data) => {
  const plainField = PLAIN_TEXT_PROBE_FIELDS.find((field) => isNonEmptyString(data?.[field]));
  if (plainField) {
    const original = data[plainField];
    return {
      ops: [
        { op: 'update_section_data', section_id: sectionId, fields: { [plainField]: `${original} [probe]` } },
        { op: 'update_section_data', section_id: sectionId, fields: { [plainField]: original } },
      ],
    };
  }
  const firstKey = isRecord(data) ? Object.keys(data)[0] : undefined;
  if (firstKey === undefined) {
    // Unreachable for a schema-valid instance (every variant's data has ≥1 key);
    // an empty fields payload is still a valid no-op if we ever get here.
    return { ops: [{ op: 'update_section_data', section_id: sectionId, fields: {} }] };
  }
  return {
    ops: [{ op: 'update_section_data', section_id: sectionId, fields: { [firstKey]: clone(data[firstKey]) } }],
  };
};

/** A probe section id not already used by any section in `existingIds`. */
export const deriveProbeId = (existingIds, base = 's_rtprobe') => {
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('deriveProbeId: could not find a free probe id.');
};

/**
 * Drill a shared `section` object: upsert the instance wholesale, round-trip a
 * data field, and toggle visibility — restoring visibility to its ORIGINAL
 * value (not a hard-coded null, which would drift a section that legitimately
 * carried `visibility: 'public'`).
 */
export const sectionDrillOps = (instance) => {
  const originalVisibility = instance.visibility ?? null;
  const { ops: updateOps } = updateDataProbeOps(instance.id, instance.data);
  return {
    expected: ['upsert_section', 'update_section_data', 'set_section_visibility'],
    ops: [
      { op: 'upsert_section', section: instance },
      ...updateOps,
      { op: 'set_section_visibility', section_id: instance.id, visibility: 'hidden' },
      { op: 'set_section_visibility', section_id: instance.id, visibility: originalVisibility },
    ],
  };
};

/**
 * Drill a `page` object: exercise all six page ops via a probe section that is
 * a CLONE of the page's first inline (non-shared_ref) section — guaranteed to
 * be a PageType-allowed, component-bound type (it is already on the published
 * page), instead of assuming `hero` is allowed. The probe is added, poked,
 * moved, hidden, and removed, so the final body is byte-identical to the seed.
 * Throws if the page carries only shared_ref sections (no inline type to clone)
 * — an honest "extend the driver" signal rather than a wrong guess.
 */
export const pageDrillOps = (page, probeId) => {
  const sections = Array.isArray(page.sections) ? page.sections : [];
  const inline = sections.find(
    (section) => isRecord(section) && section.type !== 'shared_ref' && isRecord(section.data)
  );
  if (!inline) {
    throw new Error(
      'pageDrillOps: page has only shared_ref sections — no inline section to clone as a probe. ' +
        'Extend the driver to source a PageType-allowed type from object_contract before drilling such a page.'
    );
  }
  const probe = { id: probeId, type: inline.type, data: clone(inline.data) };
  const count = sections.length;
  const title = page.title;
  const { ops: updateOps } = updateDataProbeOps(probeId, probe.data);
  return {
    expected: [
      'set_page_meta',
      'upsert_section',
      'update_section_data',
      'move_section',
      'set_section_visibility',
      'remove_section',
    ],
    ops: [
      { op: 'set_page_meta', fields: { title: `${title} [probe]` } },
      { op: 'set_page_meta', fields: { title } },
      { op: 'upsert_section', section: probe, position: count },
      ...updateOps,
      { op: 'set_section_visibility', section_id: probeId, visibility: 'hidden' },
      { op: 'move_section', section_id: probeId, to_index: 0 },
      { op: 'move_section', section_id: probeId, to_index: count },
      { op: 'remove_section', section_id: probeId },
    ],
  };
};

/** Dispatch: build the drill for one seed (page or section). */
export const drillOpsForSeed = (seed) => {
  if (seed.objectType === 'page') {
    const existingIds = (Array.isArray(seed.body.sections) ? seed.body.sections : [])
      .map((section) => section?.id)
      .filter((id) => typeof id === 'string');
    return pageDrillOps(seed.body, deriveProbeId(existingIds));
  }
  return sectionDrillOps(seed.body.section);
};
