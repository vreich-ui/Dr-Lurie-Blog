/**
 * `bio` registry module (T3.2, D§3.5) — the "Meet Dr. Lurié" section
 * (A§2.1). `portraitAssetRef` is schema-legal but the audited markup renders
 * no portrait; the component ignores it until a design uses it. No
 * references resolved in v1 (the asset ref would resolve here when used).
 */
import { sectionVariantDataSchema, type EmptyResolved, type SectionComponentDefinition } from './types.js';

export const bioDefinition: SectionComponentDefinition<'bio', EmptyResolved> = {
  type: 'bio',
  schema: sectionVariantDataSchema('bio'),
  editor: {
    label: 'Bio',
    icon: 'tabler:user',
    fieldHints: {
      kicker: { label: 'Kicker', help: 'Small uppercase lead-in line above the heading.', widget: 'text' },
      heading: { label: 'Heading', widget: 'text' },
      body: { label: 'Introduction', widget: 'richtext' },
      trustNotes: { label: 'Trust notes', help: 'Credential lines shown with an accent border.', widget: 'text_list' },
      disclaimer: { label: 'Disclaimer', help: 'Small print under the trust notes.', widget: 'text' },
      anchor: { label: 'Anchor', help: 'Public URL fragment for this section (e.g. "about").', widget: 'text' },
    },
    defaultData: {
      heading: 'About',
      body: '<p>Introduce the author here.</p>',
      trustNotes: [],
    },
  },
};
