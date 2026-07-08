# The Block Tree — recursive, bounded, agent-manipulable composition

> Companion to [`design-principles.md`](design-principles.md). Records Wolf's
> 2026-07-08 direction: content is a **tree of blocks** — a page holds blocks, a
> block (e.g. a grid) holds child blocks, all the way down — exactly like a
> conventional block CMS (Gutenberg `InnerBlocks`, Sanity portable-text, Contentful
> rich blocks). **We are not inventing the tree.** The whole point of this project
> is a different one: making **agentic manipulation of every node predictable and
> bounded.**

## We already have a bounded tree — navigation

Nothing below is new machinery. The `navigation` object is already a bounded tree:

```
nav_header
 └─ group            (allowed at the root)
     └─ item         (a link)
         └─ item     (a dropdown child — depth is BOUNDED at ≤ 2)
```

- Nodes nest and are addressed by `id` + `parent_item_id` (`upsert_item`).
- The shape is bounded: menu depth ≤ 2, no empty groups, targets must resolve
  (`object-validate`, C§2.3-Navigation).
- Agents manipulate any node with a small, predictable op set: `upsert_group`,
  `move_group`, `remove_group`, `upsert_item`, `move_item`, `remove_item`.

**The block tree is this same pattern, generalized to all content** — and the
bound is per-type instead of a hardcoded depth.

## The model

### 1. Everything is a Block

A **Block** is one typed component instance that may contain child blocks:

```ts
Block = {
  id: string;          // stable, opaque (s_… today)
  type: BlockType;     // 'hero' | 'content_grid' | 'card' | …  (the registry)
  data: {…};           // the type's own fields (its schema)
  children?: Block[];  // present only on container types
  visibility?: 'public' | 'hidden';
}
```

Today's flat `section` IS a block with no `children`. A `page.sections` array is
just the tree's **root level**. The recursion is additive — every existing record
is already a valid (childless) tree.

### 2. Containers declare what they may contain — the "bounded" part

Each block type declares in its **registry** entry:

```ts
allowedChildren: BlockType[] | null;   // null = leaf (may hold no children)
childCount?: { min?: number; max?: number };
```

- `hero`, `prose`, `card` → `allowedChildren: null` (leaves).
- `content_grid` → `allowedChildren: ['card'], childCount: { max: 8 }`.
- The page **root** already has this: `PageType.allowedSections` is the root's
  `allowedChildren`. `Template.slots[].allowed` is the same idea for named buckets.

Validation walks the tree and enforces, at **every** node: each child's `type` is
in the parent's `allowedChildren`, and the child count is within `childCount`. A
leaf with `children`, a `hero` dropped into a grid, or a 9th card are all rejected
**at patch time** (C§2.0), not just publish. That is the whole "bounded" guarantee:
an agent can never build a tree the schema doesn't sanction.

### 3. Agents manipulate any node — predictably

The page patch ops generalize the nav ops to any depth. Every op addresses a node
by a **path** (the chain of block ids from the root) or by `id` + `parent_id`
(exactly as `upsert_item` already does):

| Op                                            | Effect                                        |
| --------------------------------------------- | --------------------------------------------- |
| `upsert_block(parent_path, block, position?)` | insert/replace a child at a point in the tree |
| `move_block(path, to_parent_path, to_index)`  | reparent / reorder                            |
| `remove_block(path)`                          | delete a node and its subtree                 |
| `update_block_data(path, data)`               | edit one node's fields                        |
| `set_block_visibility(path, visibility)`      | show/hide a subtree                           |

(These are the existing `upsert_section` / `move_section` / … renamed and given a
`path` instead of a flat index. Nav's `upsert_item`/`move_item`/`remove_item` are
the working precedent.)

### 4. The contract makes it predictable

`object_contract` already returns, per type: the `data` JSON-schema, editor hints,
and the patch ops. It gains one field per type — **`allowedChildren` + `childCount`**
— so an agent reading the contract knows the _entire_ grammar of legal trees before
it acts: what a node's data looks like, and exactly what may go inside it. No
guessing, no code-diving.

## Worked example — the homepage grid as a tree

Today (flat, placeholder, invalid):

```jsonc
{ "type": "content_grid",
  "data": { "source": { "kind": "static", "cards": [ {"title":"…"}, … ] } } }
```

As a bounded tree (grid is a container of `card` blocks an agent composes):

```jsonc
{ "id": "s_startgrid", "type": "content_grid",
  "data": { "kicker": "Start here", "heading": "Five simple places to begin." },
  "children": [
    { "id": "s_card1", "type": "card",
      "data": { "title": "…", "description": "…", "link": { "kind":"listing", "list":"content_index" } } },
    { "id": "s_card2", "type": "card", "data": { … } }
  ] }
```

- Agent adds a cell → `upsert_block(path:[s_startgrid], block:{type:'card', …})`; rejected if the grid is full or the type isn't `card`.
- Empty grid → the M-8 **query fallback** fills it (latest posts) — flexibility principle #3.
- The same `card` block type is reusable in any future container (a product row, a related-links strip).

## What this changes (staged — each slice ships and is proven on its own)

1. **Schema** — add optional `children` to the block wrapper (recursive); add the leaf `card` type. _(additive; existing records unaffected)_
2. **Registry** — add `allowedChildren` + `childCount` to component definitions; declare them for `content_grid` (→`card`) and every leaf. Surface in `object_contract`.
3. **Validation** — recursive allowlist + cardinality walk (the "bounded" enforcement).
4. **Renderer** — recursive dispatch: a container renders its own frame, then its children.
5. **Patch grammar** — path-addressed `*_block` ops (generalize `*_section`; nav's `*_item` is the precedent).
6. **Migrate** — `content_grid` static/manual cards → `card` child blocks; retire the `static` escape hatch.

Slices 1–3 are the foundation (they make trees legal and bounded). 4–6 make them
render and be edited live. This doc is the shape to agree on **before** slice 4+
build on it.
