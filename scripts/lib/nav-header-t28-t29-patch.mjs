/**
 * Shared constants + pure helpers for the T2.8+T2.9 nav_header patch
 * (scripts/patch-nav-header-t28-t29.mjs). Extracted so the ops and the
 * pre/post-state classification can be exercised offline against the real
 * T0.6 patch-apply engine and T0.7 validation pipeline
 * (tests/netlify/nav-header-t28-t29-patch.test.ts) — the same discipline as
 * scripts/lib/navigation-seed-data.mjs / object-store-client.mjs.
 */

export const NAV_HEADER_OBJECT_ID = 'nav_header';
export const NAV_HEADER_SOLUTIONS_GROUP_ID = 'g_solutions';
export const NAV_HEADER_REMOVED_ITEM_ID = 'i_early_access';

// S-2 settled decision (05 §1): plain, identical, all-device action.
export const NAV_HEADER_NEWSLETTER_ACTION = {
  label: 'Join Newsletter',
  target: { kind: 'route', href: '/newsletter' },
  style: 'primary',
};

/** T2.9 (remove the duplicate item) + T2.8 (add the newsletter action), one patch. */
export const NAV_HEADER_T28_T29_OPS = [
  { op: 'remove_item', group_id: NAV_HEADER_SOLUTIONS_GROUP_ID, item_id: NAV_HEADER_REMOVED_ITEM_ID },
  { op: 'upsert_action', action: NAV_HEADER_NEWSLETTER_ACTION },
];

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const findGroup = (body, groupId) =>
  isRecord(body) && Array.isArray(body.groups) ? body.groups.find((group) => group.id === groupId) : undefined;

export const hasNavItem = (body, groupId, itemId) => {
  const group = findGroup(body, groupId);
  return Boolean(group && Array.isArray(group.items) && group.items.some((item) => item.id === itemId));
};

export const hasNewsletterAction = (body) =>
  isRecord(body) &&
  Array.isArray(body.actions) &&
  body.actions.some((action) => isRecord(action.target) && action.target.href === '/newsletter');

/**
 * Classify a nav_header body against the pre/post shapes this patch moves
 * between. Used both as the --execute pre-flight guard (only PRE-PATCH may
 * proceed) and as the --verify report.
 */
export const classifyNavHeaderPatchState = (body) => {
  const early = hasNavItem(body, NAV_HEADER_SOLUTIONS_GROUP_ID, NAV_HEADER_REMOVED_ITEM_ID);
  const newsletter = hasNewsletterAction(body);
  if (early && !newsletter) return 'pre-patch';
  if (!early && newsletter) return 'post-patch';
  return 'partial'; // either op applied without the other — unexpected, needs manual inspection
};
