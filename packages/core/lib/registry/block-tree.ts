/**
 * Block-tree bounds (docs/cms-architecture/block-tree.md).
 *
 * Content is a tree of typed blocks: a page holds blocks, a container block
 * (e.g. `content_grid`) holds child blocks, recursively — the same shape the
 * `navigation` object already uses (groups → items → child items, bounded).
 * This module enforces the "bounded" half: at EVERY node, each child's type must
 * be in the parent type's `allowedChildren`, and the child count must sit within
 * `childCount`. A leaf (no `allowedChildren`) may hold no children at all.
 *
 * The rules are **derived from the component registry** (`allowedChildren` /
 * `childCount` on each `SectionComponentDefinition`), never hand-listed here, so
 * the legal-tree grammar cannot drift from what the contract advertises. Client-
 * safe (no `.astro` imports) so the Netlify function bundle and tests can run it.
 *
 * Scope note (first slice): the rules currently come from the one declared
 * container, `content_grid`. As more types declare `allowedChildren`, register
 * their definition in `CONTAINER_DEFINITIONS` below — the walk itself is general.
 */
import type { SectionType } from '../../schema/bodies/section-v1.js';
import { contentGridDefinition } from './components/content-grid.js';
import type { SectionComponentDefinition } from './components/types.js';

/** A node in a content tree: a section instance that may hold child blocks. */
export type BlockNode = {
  id: string;
  type: SectionType;
  data?: unknown;
  visibility?: 'public' | 'hidden';
  children?: BlockNode[];
};

type ChildRule = { allowedChildren: SectionType[]; childCount?: { min?: number; max?: number } };

// The definitions that declare block-tree bounds. Add a container's definition
// here when it gains `allowedChildren`; the derivation + walk need no other edit.
const CONTAINER_DEFINITIONS: SectionComponentDefinition<SectionType, unknown>[] = [
  contentGridDefinition as unknown as SectionComponentDefinition<SectionType, unknown>,
];

const CONTAINER_RULES: Partial<Record<SectionType, ChildRule>> = Object.fromEntries(
  CONTAINER_DEFINITIONS.filter((d) => d.allowedChildren).map((d) => [
    d.type,
    { allowedChildren: d.allowedChildren as SectionType[], childCount: d.childCount },
  ])
);

/** The child rule for a type, or undefined when the type is a leaf. */
export const childRuleFor = (type: SectionType): ChildRule | undefined => CONTAINER_RULES[type];

/** True when the type is a container (may hold children). */
export const isContainerType = (type: SectionType): boolean => Boolean(CONTAINER_RULES[type]);

export type BlockTreeError = {
  /** Block-id path from the root to the offending node. */
  path: string[];
  code: 'leaf_has_children' | 'child_type_not_allowed' | 'too_many_children' | 'too_few_children';
  message: string;
};

/**
 * Walk a block tree and return every bound violation (empty = a legal tree).
 * Pure and recursive; does NOT re-validate each node's `data` — that stays the
 * per-type schema's job (`sectionInstanceSchema`), applied node-by-node elsewhere.
 */
export const validateBlockTree = (node: BlockNode, path: string[] = [node.id]): BlockTreeError[] => {
  const errors: BlockTreeError[] = [];
  const children = node.children ?? [];
  const rule = childRuleFor(node.type);

  if (!rule) {
    if (children.length > 0) {
      errors.push({
        path,
        code: 'leaf_has_children',
        message: `'${node.type}' is a leaf block and may not contain children.`,
      });
    }
  } else {
    const { min, max } = rule.childCount ?? {};
    if (max !== undefined && children.length > max) {
      errors.push({
        path,
        code: 'too_many_children',
        message: `'${node.type}' allows at most ${max} child block(s); got ${children.length}.`,
      });
    }
    if (min !== undefined && children.length < min) {
      errors.push({
        path,
        code: 'too_few_children',
        message: `'${node.type}' requires at least ${min} child block(s); got ${children.length}.`,
      });
    }
    for (const child of children) {
      if (!rule.allowedChildren.includes(child.type)) {
        errors.push({
          path: [...path, child.id],
          code: 'child_type_not_allowed',
          message: `'${node.type}' may not contain '${child.type}' (allowed: ${
            rule.allowedChildren.join(', ') || 'none'
          }).`,
        });
      }
    }
  }

  // Recurse into every child regardless of its own legality above, so a deep
  // violation is reported with its full path.
  for (const child of children) {
    errors.push(...validateBlockTree(child, [...path, child.id]));
  }
  return errors;
};

/** Convenience: a tree is legal when the walk finds no bound violations. */
export const isLegalBlockTree = (node: BlockNode): boolean => validateBlockTree(node).length === 0;
