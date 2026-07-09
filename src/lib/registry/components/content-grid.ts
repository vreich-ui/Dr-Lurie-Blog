/**
 * `content_grid` registry module (T3.2/T3.9, D§3.5) — replaces the audited
 * placeholder article grid (A§2.1). The transitional `static` source renders
 * cards verbatim (deprecated-on-arrival); `manual`/`query` sources render from
 * renderer-resolved content summaries (src/lib/renderer/resolve.ts, M-8
 * fallback semantics from T3.3).
 */
import { sectionVariantDataSchema, type ContentGridResolved, type SectionComponentDefinition } from './types.js';

export const contentGridDefinition: SectionComponentDefinition<'content_grid', ContentGridResolved> = {
  type: 'content_grid',
  schema: sectionVariantDataSchema('content_grid'),
  editor: {
    label: 'Content grid',
    icon: 'tabler:layout-grid',
    fieldHints: {
      kicker: { label: 'Kicker', help: 'Small uppercase lead-in line above the heading.', widget: 'text' },
      heading: { label: 'Heading', widget: 'text' },
      body: { label: 'Intro', help: 'Optional paragraph under the heading.', widget: 'richtext' },
      source: { label: 'Cards', help: 'Where the cards come from (curated list or query).', widget: 'cards' },
      limit: { label: 'Max cards', widget: 'number' },
      anchor: { label: 'Anchor', help: 'Public URL fragment for this section (e.g. "start-here").', widget: 'text' },
    },
    defaultData: {
      source: { kind: 'manual', items: [] },
      limit: 4,
    },
  },
  // Block-tree bounds: a grid is a CONTAINER of `card` leaf blocks an agent
  // composes (docs/cms-architecture/block-tree.md). `card` is the only legal
  // child; at most 8 cells. (The transitional `source.cards` data path is the
  // pre-tree escape hatch this supersedes — slice 6 migrates it.)
  allowedChildren: ['card'],
  childCount: { max: 8 },
};
