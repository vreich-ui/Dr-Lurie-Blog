/**
 * Edit-mode canvas — navigation copy editing, pure (no DOM).
 *
 * The header/footer chrome renders from navigation OBJECTS (nav_header,
 * nav_footer…), which are patched with their own grammar (set_nav_meta /
 * update_item / upsert_group / remove_action+upsert_action — never the page
 * ops). The canvas edits nav the way it edits sections: a small form of the
 * object's COPY. This module owns the two pure halves so they are
 * unit-testable:
 *
 *   - `navEditFieldsFor(body)`: flatten a navigation body into the editable
 *     copy fields — brand text/descriptor, footNote, group titles, item
 *     labels (children included), action labels. Targets/hrefs/icons are
 *     deliberately absent: retargeting a link is structural work (the same
 *     boundary the Ask-AI protected-field list draws), not a copy edit.
 *   - `navChangesToOps(body, changes)`: map the changed fields to the
 *     navigation patch grammar, one minimal op per change (meta writes
 *     coalesce into a single set_nav_meta).
 */
import type { NavGroup, NavigationBody, NavItem } from '../../../packages/core/schema/bodies/navigation-v1.js';

export type NavEditField = {
  /** Stable form key, e.g. `brand.text`, `group.g_products.title`, `item.g_products.i_shop.label`, `action.0.label`. */
  key: string;
  /** Editor-facing label for the form row. */
  label: string;
  value: string;
};

const itemFields = (groupId: string, items: NavItem[], depth: number): NavEditField[] =>
  items.flatMap((item) => [
    {
      key: `item.${groupId}.${item.id}.label`,
      label: `${'· '.repeat(depth)}${item.label}`,
      value: item.label,
    },
    ...(item.children ? itemFields(groupId, item.children, depth + 1) : []),
  ]);

export const navEditFieldsFor = (body: NavigationBody): NavEditField[] => [
  ...(body.brand?.text !== undefined ? [{ key: 'brand.text', label: 'brand', value: body.brand.text }] : []),
  ...(body.brand?.descriptor !== undefined
    ? [{ key: 'brand.descriptor', label: 'brand descriptor', value: body.brand.descriptor }]
    : []),
  ...body.groups.flatMap((group) => [
    ...(group.title !== undefined
      ? [{ key: `group.${group.id}.title`, label: 'group title', value: group.title }]
      : []),
    ...itemFields(group.id, group.items, 0),
  ]),
  ...(body.actions ?? []).map((action, index) => ({
    key: `action.${index}.label`,
    label: 'button',
    value: action.label,
  })),
  ...(body.footNote !== undefined ? [{ key: 'footNote', label: 'footer note', value: body.footNote }] : []),
];

const findGroup = (body: NavigationBody, groupId: string): NavGroup | undefined =>
  body.groups.find((group) => group.id === groupId);

/**
 * Map changed form fields to navigation patch ops. `changes` is
 * key → new value for ONLY the fields that differ. Unknown keys throw —
 * a drifted form must fail loudly, not silently drop an edit.
 */
export const navChangesToOps = (
  body: NavigationBody,
  changes: Record<string, string>
): Array<Record<string, unknown>> => {
  const ops: Array<Record<string, unknown>> = [];
  const meta: { brand?: { text?: string; descriptor?: string }; footNote?: string } = {};

  for (const [key, value] of Object.entries(changes)) {
    if (key === 'brand.text' || key === 'brand.descriptor') {
      meta.brand = { ...body.brand, ...meta.brand, [key.split('.')[1] as 'text' | 'descriptor']: value };
      continue;
    }
    if (key === 'footNote') {
      meta.footNote = value;
      continue;
    }
    const [kind, ...rest] = key.split('.');
    if (kind === 'group') {
      const [groupId] = rest;
      const group = findGroup(body, groupId);
      if (!group) throw new Error(`navChangesToOps: unknown group ${groupId}`);
      // The grammar has no update_group; upsert_group replaces by id. Send the
      // CURRENT group with only the title changed — items ride along verbatim.
      ops.push({ op: 'upsert_group', group: { ...group, title: value } });
      continue;
    }
    if (kind === 'item') {
      const [groupId, itemId] = rest;
      if (!findGroup(body, groupId)) throw new Error(`navChangesToOps: unknown group ${groupId}`);
      ops.push({ op: 'update_item', group_id: groupId, item_id: itemId, fields: { label: value } });
      continue;
    }
    if (kind === 'action') {
      const index = Number(rest[0]);
      const action = (body.actions ?? [])[index];
      if (!action) throw new Error(`navChangesToOps: unknown action index ${rest[0]}`);
      // Actions are keyed by label (no id): a rename is remove + re-insert at
      // the same position — the grammar's own documented recipe.
      ops.push({ op: 'remove_action', label: action.label });
      ops.push({ op: 'upsert_action', action: { ...action, label: value }, position: index });
      continue;
    }
    throw new Error(`navChangesToOps: unknown field key ${key}`);
  }

  if (meta.brand !== undefined || meta.footNote !== undefined) {
    ops.push({
      op: 'set_nav_meta',
      fields: {
        ...(meta.brand !== undefined ? { brand: meta.brand } : {}),
        ...(meta.footNote !== undefined ? { footNote: meta.footNote } : {}),
      },
    });
  }

  return ops;
};

const withItemLabel = (items: NavItem[], itemId: string, label: string): NavItem[] =>
  items.map((item) => ({
    ...item,
    ...(item.id === itemId ? { label } : {}),
    ...(item.children ? { children: withItemLabel(item.children, itemId, label) } : {}),
  }));

/**
 * The same changes applied to a LOCAL copy of the body — the canvas keeps its
 * in-panel body in step with the draft record after each save, so a later
 * save's `upsert_group` (which resends the whole group) can never carry a
 * stale label it would silently revert.
 */
export const applyNavChangesToBody = (body: NavigationBody, changes: Record<string, string>): NavigationBody => {
  let next = body;
  for (const [key, value] of Object.entries(changes)) {
    const [kind, ...rest] = key.split('.');
    if (key === 'brand.text' || key === 'brand.descriptor') {
      next = { ...next, brand: { ...next.brand, [key.split('.')[1] as 'text' | 'descriptor']: value } };
    } else if (key === 'footNote') {
      next = { ...next, footNote: value };
    } else if (kind === 'group') {
      next = {
        ...next,
        groups: next.groups.map((group) => (group.id === rest[0] ? { ...group, title: value } : group)),
      };
    } else if (kind === 'item') {
      const [groupId, itemId] = rest;
      next = {
        ...next,
        groups: next.groups.map((group) =>
          group.id === groupId ? { ...group, items: withItemLabel(group.items, itemId, value) } : group
        ),
      };
    } else if (kind === 'action') {
      const index = Number(rest[0]);
      next = {
        ...next,
        actions: (next.actions ?? []).map((action, i) => (i === index ? { ...action, label: value } : action)),
      };
    }
  }
  return next;
};
