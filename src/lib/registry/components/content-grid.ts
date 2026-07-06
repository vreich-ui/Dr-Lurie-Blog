/**
 * `content_grid` registry module (T3.2, D§3.5) — replaces the audited
 * placeholder article grid (A§2.1). The transitional `static` source renders
 * cards verbatim (deprecated-on-arrival, retired by T3.9); `manual`/`query`
 * sources render from resolved content summaries once the T3.6 renderer
 * executes them (M-8 fallback semantics arrive with T3.3).
 */
import { sectionVariantDataSchema, type EmptyResolved, type SectionComponentDefinition } from './types.js';

export const contentGridDefinition: SectionComponentDefinition<'content_grid', EmptyResolved> = {
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
};
