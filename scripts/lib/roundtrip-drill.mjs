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
 * a CLONE of one of the page's OWN sections — guaranteed to be a PageType-legal
 * placement (it is already on the published page), instead of assuming `hero`
 * is allowed. For a fully-decomposed page (all `shared_ref`s — the normal shape
 * once every section is its own object) the probe is a shared_ref duplicating
 * one of the page's references: it resolves (the target exists) and its
 * effective type is already sanctioned. A SECTION-LESS page (legal since W6:
 * `content_detail` publishes with zero sections) has nothing to clone, so its
 * seed must declare `drillProbe: { type, data }` — a PageType-legal section the
 * drill uses instead. The probe is added, poked, moved, hidden, and removed,
 * so the final body is byte-identical to the seed. Throws only if the page
 * carries no clonable section AND no declared probe.
 */
export const pageDrillOps = (page, probeId, fallbackProbe) => {
  const sections = Array.isArray(page.sections) ? page.sections : [];
  const source =
    sections.find((section) => isRecord(section) && isRecord(section.data)) ??
    (isRecord(fallbackProbe) && isRecord(fallbackProbe.data) ? fallbackProbe : undefined);
  if (!source) {
    throw new Error(
      'pageDrillOps: page has no section with data to clone as a probe and the seed declares no drillProbe.'
    );
  }
  const probe = { id: probeId, type: source.type, data: clone(source.data) };
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

/**
 * Drill a `template` object (W2.5): exercise all four template ops via a probe
 * SLOT that is always legal — optional, non-repeatable, allowing a type cloned
 * from the template's own first slot (already registry-sanctioned; `prose` as
 * the fallback for a slotless template). The probe is added, moved to the
 * front, moved back to the end, and removed; the name round-trips through
 * set_template_meta — so the final body is byte-identical to the seed.
 * (Instantiation is a separate verb, not a patch op — the driver proves it
 * with an object_instantiate_template dry_run after the drill.)
 */
export const templateDrillOps = (body, probeSlotId) => {
  const name = body.name;
  const slots = Array.isArray(body.slots) ? body.slots : [];
  const count = slots.length;
  const firstAllowed = slots.find((slot) => Array.isArray(slot?.allowed) && slot.allowed.length > 0)?.allowed[0];
  const probe = { slotId: probeSlotId, allowed: [firstAllowed ?? 'prose'], required: false, repeatable: false };
  return {
    expected: ['set_template_meta', 'upsert_slot', 'move_slot', 'remove_slot'],
    ops: [
      { op: 'set_template_meta', fields: { name: `${name} [probe]` } },
      { op: 'set_template_meta', fields: { name } },
      { op: 'upsert_slot', slot: probe, position: count },
      { op: 'move_slot', slot_id: probeSlotId, to_index: 0 },
      { op: 'move_slot', slot_id: probeSlotId, to_index: count },
      { op: 'remove_slot', slot_id: probeSlotId },
    ],
  };
};

/**
 * Drill a `section_template` object (W8.1): exercise all three ops —
 * set_section_template_meta round-trips the name; update_blueprint_data pokes
 * a plain-text blueprint field and restores it (reusing the section probe's
 * field-picking logic); replace_blueprint swaps the blueprint for a clone of
 * itself (a genuine whole-instance replace that re-dispatches and re-validates
 * the union member). Final body byte-identical to the seed.
 */
export const sectionTemplateDrillOps = (body) => {
  const name = body.name;
  const blueprint = clone(body.blueprint);
  // updateDataProbeOps builds update_section_data ops; a section-template
  // blueprint has no section_id addressing (the body wraps exactly one), so
  // only the probed `fields` payloads carry over.
  const { ops: sectionOps } = updateDataProbeOps('s_probe', body.blueprint?.data ?? {});
  const dataOps = sectionOps.map(({ fields }) => ({ op: 'update_blueprint_data', fields }));
  return {
    expected: ['set_section_template_meta', 'replace_blueprint', 'update_blueprint_data'],
    ops: [
      { op: 'set_section_template_meta', fields: { name: `${name} [probe]` } },
      { op: 'set_section_template_meta', fields: { name } },
      ...dataOps,
      { op: 'replace_blueprint', blueprint },
    ],
  };
};

/**
 * Drill a `theme` object (W8.3): set_theme_fields is the whole op surface —
 * poke the name and restore it (the siteDrillOps idiom). site_apply_theme is
 * a verb, not a patch op; the driver proves it with a dry_run separately.
 */
export const themeDrillOps = (body) => {
  const name = body.name;
  return {
    expected: ['set_theme_fields'],
    ops: [
      { op: 'set_theme_fields', fields: { name: `${name} [probe]` } },
      { op: 'set_theme_fields', fields: { name } },
    ],
  };
};

/**
 * Drill a `taxonomy` object (W3): exercise all five term ops via a probe TERM
 * in the `tag` kind that is added, relabeled, deprecated, reactivated, and
 * removed — ending byte-identical to the seed. The probe slug is collision-free
 * against every seeded slug ('rt-probe' is not a plausible editorial term); the
 * probe id derives collision-free against existing term ids. `reactivate_term`
 * is inverse-machinery in the contract (agents don't hand-author it) but it IS
 * an advertised op, and the driver's criterion-4 gate is advertised ≡
 * exercised — deprecate→reactivate exercises it while restoring state exactly.
 */
export const taxonomyDrillOps = (body, probeTermId) => {
  const probe = { term_id: probeTermId, slug: 'rt-probe', label: 'RT Probe', status: 'active' };
  return {
    expected: ['add_term', 'update_term', 'deprecate_term', 'reactivate_term', 'remove_term'],
    ops: [
      { op: 'add_term', kind: 'tag', term: probe },
      { op: 'update_term', kind: 'tag', term_id: probeTermId, fields: { label: 'RT Probe [poked]' } },
      { op: 'update_term', kind: 'tag', term_id: probeTermId, fields: { label: 'RT Probe' } },
      { op: 'deprecate_term', kind: 'tag', term_id: probeTermId },
      { op: 'reactivate_term', kind: 'tag', term_id: probeTermId },
      { op: 'remove_term', kind: 'tag', term_id: probeTermId },
    ],
  };
};

/**
 * Drill a `site` object (W4): `set_site_fields` is the type's ONLY permitted
 * op (C§2.0 — the singleton is one fields bag; there is no list structure to
 * add/move/remove). Poke the display name and restore it — two real
 * deep-merge patches ending byte-identical to the seed. Scalar replacement
 * carries no stray-key risk (playbook trap 2 applies to OBJECT values; the
 * reconcile path handles those via diffFieldsForMerge).
 */
export const siteDrillOps = (body) => {
  const name = body.name;
  return {
    expected: ['set_site_fields'],
    ops: [
      { op: 'set_site_fields', fields: { name: `${name} [probe]` } },
      { op: 'set_site_fields', fields: { name } },
    ],
  };
};

/**
 * Drill a `product` object (S2): `set_product_fields` is the type's ONLY
 * permitted op — poke the presentation title and restore it, the siteDrillOps
 * shape. NEVER touches commerce.price/stripe/stripe_test (the §3 canonicality
 * funnel refuses those keys at the grammar).
 */
export const productDrillOps = (body) => {
  const title = body.presentation.title;
  const expected = ['set_product_fields'];
  const ops = [
    { op: 'set_product_fields', fields: { presentation: { title: `${title} [probe]` } } },
    { op: 'set_product_fields', fields: { presentation: { title } } },
  ];
  // set_product_price (the §3 funnel's writer, S3) is only coherent on a
  // fixed-mode product that already carries a price + linkage: poke the cache
  // one cent up and restore it exactly, re-writing the SAME linkage — two
  // more real ops ending byte-identical. pwyw/free products cannot legally
  // carry a price, so they drill set_product_fields only (the per-type
  // contract check unions exercised ops across the family's seeds).
  const commerce = body.commerce;
  const linkageKey = commerce.stripe ? 'stripe' : commerce.stripe_test ? 'stripe_test' : undefined;
  const linkage = commerce.stripe ?? commerce.stripe_test;
  if (commerce.mode === 'fixed' && commerce.price && linkageKey && linkage) {
    expected.push('set_product_price');
    ops.push(
      {
        op: 'set_product_price',
        fields: {
          commerce: {
            price: { amount_cents: commerce.price.amount_cents + 1, currency: commerce.price.currency },
            [linkageKey]: linkage,
          },
        },
      },
      { op: 'set_product_price', fields: { commerce: { price: commerce.price, [linkageKey]: linkage } } }
    );
  }
  return { expected, ops };
};

/**
 * Drill a `content_item` object (W7.3): exercise all six article ops via a
 * probe NODE cloned from the article's own first node (already schema-legal),
 * mirroring pageDrillOps exactly — added, poked (copy AND annotation, the
 * strategy re-labeling that IS the semantic layer's own op path), hidden,
 * moved, and removed, so the final body is byte-identical to the seed.
 * (create_variant is a VERB, not a patch op — the driver proves it with an
 * object_create_variant dry_run after the drill, the instantiate pattern.)
 */
export const articleDrillOps = (body, probeNodeId) => {
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const source = nodes.find((node) => isRecord(node) && isRecord(node.public));
  if (!source) {
    throw new Error('articleDrillOps: article has no node to clone as a probe.');
  }
  const probe = { ...clone(source), id: probeNodeId };
  const count = nodes.length;
  const title = body.title;
  return {
    expected: ['set_article_meta', 'upsert_node', 'update_node', 'move_node', 'set_node_visibility', 'remove_node'],
    ops: [
      { op: 'set_article_meta', fields: { title: `${title} [probe]` } },
      { op: 'set_article_meta', fields: { title } },
      { op: 'upsert_node', node: probe, position: count },
      { op: 'update_node', node_id: probeNodeId, fields: { public: { title: 'RT probe [poked]' } } },
      { op: 'update_node', node_id: probeNodeId, fields: { private: { strategy: 'summary' } } },
      { op: 'set_node_visibility', node_id: probeNodeId, visibility: 'internal' },
      { op: 'move_node', node_id: probeNodeId, to_index: 0 },
      { op: 'move_node', node_id: probeNodeId, to_index: count },
      { op: 'remove_node', node_id: probeNodeId },
    ],
  };
};

/**
 * `set_tracking` probe ops (W13) — the uniform one-writer op every governed
 * type advertises (12-plan §2), so every family's drill must exercise it to
 * satisfy the driver's advertised ≡ exercised contract gate. The T13.10
 * shape is the full set → mutate → unset drill on a body with NO tracking
 * block (every current seed): first-set, a real deep-merge mutation, then
 * top-level `fields: null` removing `body.tracking` entirely — three ops,
 * each with an exact inverse, ending byte-identical. A body that ALREADY
 * carries tracking gets the conservative poke/restore instead (unset would
 * destroy real data): label poked, then the original written back (a `null`
 * unset if the label key was absent — deep-merge would otherwise leave the
 * probe behind).
 */
export const trackingProbeOps = (body) => {
  const tracking = isRecord(body?.tracking) ? body.tracking : undefined;
  const poke = { op: 'set_tracking', fields: { label: 'RT probe' } };
  if (!tracking) {
    return [
      poke, // set (first-set inverse = removal)
      { op: 'set_tracking', fields: { label: 'RT probe [poked]', tags: ['rt-probe'] } }, // mutate (merge inverse)
      { op: 'set_tracking', fields: null }, // unset-to-null (removal inverse = full restore)
    ];
  }
  return [poke, { op: 'set_tracking', fields: { label: tracking.label ?? null } }];
};

const withTrackingProbe = (drill, body) => ({
  expected: [...drill.expected, 'set_tracking'],
  ops: [...drill.ops, ...trackingProbeOps(body)],
});

/**
 * Drill the `tracking_config` singleton (T13.10): `set_tracking_config_fields`
 * is the type's ONLY op (the set_site_fields idiom — open deep-merge). Flip
 * `consent.honor_gpc` and flip it back — two real merges, byte-identical,
 * valid on ANY schema-legal body (honor_gpc is required boolean).
 */
export const trackingConfigDrillOps = (body) => {
  const honorGpc = body.consent.honor_gpc;
  return {
    expected: ['set_tracking_config_fields'],
    ops: [
      { op: 'set_tracking_config_fields', fields: { consent: { honor_gpc: !honorGpc } } },
      { op: 'set_tracking_config_fields', fields: { consent: { honor_gpc: honorGpc } } },
    ],
  };
};

/**
 * Dispatch: build the drill for one seed (page, section, template,
 * section_template, taxonomy, site, product, theme, content_item, or
 * tracking_config). Every branch gets the W13 `set_tracking` probe appended —
 * the attribute lives at body top level on ALL these types — EXCEPT
 * `tracking_config`, which bypasses the wrapper: the registry singleton
 * neither carries the attribute nor advertises the op.
 */
export const drillOpsForSeed = (seed) => {
  if (seed.objectType === 'tracking_config') return trackingConfigDrillOps(seed.body);
  return withTrackingProbe(baseDrillOpsForSeed(seed), seed.body);
};

const baseDrillOpsForSeed = (seed) => {
  if (seed.objectType === 'page') {
    const existingIds = (Array.isArray(seed.body.sections) ? seed.body.sections : [])
      .map((section) => section?.id)
      .filter((id) => typeof id === 'string');
    return pageDrillOps(seed.body, deriveProbeId(existingIds), seed.drillProbe);
  }
  if (seed.objectType === 'template') {
    const existingSlotIds = (Array.isArray(seed.body.slots) ? seed.body.slots : [])
      .map((slot) => slot?.slotId)
      .filter((id) => typeof id === 'string');
    return templateDrillOps(seed.body, deriveProbeId(existingSlotIds, 'slot_rtprobe'));
  }
  if (seed.objectType === 'taxonomy') {
    const kinds = seed.body.kinds ?? {};
    const existingTermIds = ['category', 'tag']
      .flatMap((kind) => (Array.isArray(kinds[kind]?.terms) ? kinds[kind].terms : []))
      .map((entry) => entry?.term_id)
      .filter((id) => typeof id === 'string');
    return taxonomyDrillOps(seed.body, deriveProbeId(existingTermIds, 't_rtprobe'));
  }
  if (seed.objectType === 'section_template') {
    return sectionTemplateDrillOps(seed.body);
  }
  if (seed.objectType === 'theme') {
    return themeDrillOps(seed.body);
  }
  if (seed.objectType === 'site') {
    return siteDrillOps(seed.body);
  }
  if (seed.objectType === 'product') {
    return productDrillOps(seed.body);
  }
  if (seed.objectType === 'content_item') {
    const existingNodeIds = (Array.isArray(seed.body.nodes) ? seed.body.nodes : [])
      .map((node) => node?.id)
      .filter((id) => typeof id === 'string');
    return articleDrillOps(seed.body, deriveProbeId(existingNodeIds, 'n_rtprobe'));
  }
  return sectionDrillOps(seed.body.section);
};
