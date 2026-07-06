/**
 * `checklist` registry module (T3.2, D§3.5) — the "This is for you if…"
 * qualifier card grid (A§2.1). No references: resolved is empty.
 */
import { sectionVariantDataSchema, type EmptyResolved, type SectionComponentDefinition } from './types.js';

export const checklistDefinition: SectionComponentDefinition<'checklist', EmptyResolved> = {
  type: 'checklist',
  schema: sectionVariantDataSchema('checklist'),
  editor: {
    label: 'Checklist',
    icon: 'tabler:checklist',
    fieldHints: {
      kicker: { label: 'Kicker', help: 'Small uppercase lead-in line above the heading.', widget: 'text' },
      heading: { label: 'Heading', widget: 'text' },
      items: { label: 'Items', help: 'One card per entry.', widget: 'text_list' },
      anchor: { label: 'Anchor', help: 'Public URL fragment for this section (e.g. "audience").', widget: 'text' },
    },
    defaultData: {
      items: ['First point'],
    },
  },
};
