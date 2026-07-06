/**
 * T2.7 acceptance drill — data for both legs of the "update the footer CTA"
 * exercise (runbook §6): the ops for `nav_footer`, and a state classifier the
 * drill script's pre-flight uses to refuse to run a leg against a record that
 * isn't in that leg's expected starting shape.
 *
 * The drill is deliberately trivial in content (one label word) because its
 * subject is the WORKFLOW: checkout → patch → validate → submit_review →
 * human approve → human publish, then the exact same cycle in reverse. The
 * two records' history entries are the acceptance evidence.
 */

export const NAV_FOOTER_OBJECT_ID = 'nav_footer';

export const DRILL_GROUP_ID = 'g_next_steps';
export const DRILL_ITEM_ID = 'i_early_access';
export const DRILL_LABEL_BASELINE = 'Early Access';
export const DRILL_LABEL_DRILLED = 'Get Early Access';

/** Leg 1: baseline → drilled. */
export const NAV_FOOTER_T27_FORWARD_OPS = [
  {
    op: 'update_item',
    group_id: DRILL_GROUP_ID,
    item_id: DRILL_ITEM_ID,
    fields: { label: DRILL_LABEL_DRILLED },
  },
];

/** Leg 2: drilled → baseline (the same op with the original label). */
export const NAV_FOOTER_T27_REVERT_OPS = [
  {
    op: 'update_item',
    group_id: DRILL_GROUP_ID,
    item_id: DRILL_ITEM_ID,
    fields: { label: DRILL_LABEL_BASELINE },
  },
];

/** The current label of the drill item, or undefined if the item is missing. */
export const getDrillItemLabel = (body) => {
  const groups = Array.isArray(body?.groups) ? body.groups : [];
  const group = groups.find((candidate) => candidate?.id === DRILL_GROUP_ID);
  const items = Array.isArray(group?.items) ? group.items : [];
  return items.find((candidate) => candidate?.id === DRILL_ITEM_ID)?.label;
};

/**
 * 'baseline'  — label is 'Early Access' (forward leg may run)
 * 'drilled'   — label is 'Get Early Access' (revert leg may run)
 * 'other'     — item missing or carrying an unexpected label; no leg may run.
 */
export const classifyNavFooterDrillState = (body) => {
  const label = getDrillItemLabel(body);
  if (label === DRILL_LABEL_BASELINE) return 'baseline';
  if (label === DRILL_LABEL_DRILLED) return 'drilled';
  return 'other';
};
