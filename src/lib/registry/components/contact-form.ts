/**
 * `contact_form` registry module — a Netlify Forms contact form
 * (ContactForm.astro). No references to resolve (EmptyResolved). The field set
 * (name/email/message) is a fixed affordance; the schema carries only the
 * posting identity, heading, and disclaimer.
 */
import { sectionVariantDataSchema, type EmptyResolved, type SectionComponentDefinition } from './types.js';

export const contactFormDefinition: SectionComponentDefinition<'contact_form', EmptyResolved> = {
  type: 'contact_form',
  schema: sectionVariantDataSchema('contact_form'),
  editor: {
    label: 'Contact form',
    icon: 'tabler:mail',
    fieldHints: {
      heading: { label: 'Heading', widget: 'text' },
      formName: {
        label: 'Form name',
        help: 'The Netlify form identity submissions are grouped under.',
        widget: 'text',
      },
      disclaimer: { label: 'Disclaimer', help: 'Optional fine print shown under the form.', widget: 'text' },
    },
    defaultData: {
      formName: 'contact',
      heading: 'Get in touch',
    },
  },
};
