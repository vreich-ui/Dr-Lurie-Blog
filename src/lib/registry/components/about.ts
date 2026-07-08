/**
 * `about` registry module — the full /about page section (About.astro). A
 * bespoke, single-use faithful cutover: the prose is fixed furniture, so only
 * the clean fields are editable data. Its `actions` resolve to hrefs the same
 * way hero/thank_you actions do (HeroResolved), computed centrally by the
 * renderer (src/lib/renderer/resolve.ts), so this module declares no resolveRefs.
 */
import { sectionVariantDataSchema, type HeroResolved, type SectionComponentDefinition } from './types.js';

export const aboutDefinition: SectionComponentDefinition<'about', HeroResolved> = {
  type: 'about',
  schema: sectionVariantDataSchema('about'),
  editor: {
    label: 'About page',
    icon: 'tabler:user-circle',
    fieldHints: {
      heading: { label: 'Page heading', help: 'The page’s h1 title.', widget: 'text' },
      portrait: { label: 'Portrait image', help: 'Source URL and alt text for the portrait.', widget: 'cards' },
      sectionHeadings: {
        label: 'Section headings',
        help: 'The six body-section titles, in order. Each pairs with its fixed prose block.',
        widget: 'text_list',
      },
      ctaHeading: {
        label: 'Closing CTA heading',
        help: 'Heading above the closing call-to-action buttons.',
        widget: 'text',
      },
      actions: {
        label: 'Closing CTA buttons',
        help: 'Call-to-action buttons at the foot of the page.',
        widget: 'link_actions',
      },
    },
    defaultData: {
      heading: 'About',
      portrait: { src: 'https://example.com/portrait.jpg', alt: 'Portrait' },
      sectionHeadings: ['Section one', 'Section two', 'Section three', 'Section four', 'Section five', 'Section six'],
      ctaHeading: 'Start here',
      actions: [],
    },
  },
};
