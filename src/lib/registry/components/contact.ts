/**
 * `contact` registry module — the full /contact page section (ContactPage.astro).
 * A widget-composition faithful cutover: the audited HeroText/Contact/Features2
 * widgets stay the furniture; their props are promoted to editable object data.
 * The page has no link actions, so this section resolves to the empty resolved
 * shape and declares no resolveRefs.
 */
import { sectionVariantDataSchema, type EmptyResolved, type SectionComponentDefinition } from './types.js';

export const contactDefinition: SectionComponentDefinition<'contact', EmptyResolved> = {
  type: 'contact',
  schema: sectionVariantDataSchema('contact'),
  editor: {
    label: 'Contact page',
    icon: 'tabler:mail',
    fieldHints: {
      hero: { label: 'Hero', help: 'Tagline + title for the page hero.', widget: 'cards' },
      form: { label: 'Contact form', help: 'Form id, name, copy, inputs, and disclaimer.', widget: 'cards' },
      features: { label: 'How we can help', help: 'Section title and the list of help items.', widget: 'cards' },
    },
    defaultData: {
      hero: { tagline: 'Contact', title: 'Get in touch' },
      form: {
        id: 'form',
        formName: 'contact',
        title: 'Send us a note',
        subtitle: 'We read every message.',
        inputs: [
          { type: 'text', name: 'name', label: 'Name' },
          { type: 'email', name: 'email', label: 'Email' },
        ],
        textarea: { label: 'Message' },
        disclaimer: { label: 'By submitting this form you agree to the Privacy Policy.' },
        description: 'We respond when appropriate.',
      },
      features: {
        title: 'How we can help',
        items: [{ title: 'Questions', description: 'Ask about our content.', icon: 'tabler:help' }],
      },
    },
  },
};
