/**
 * `faq` registry module — an optional heading over a question/answer list
 * (Faq.astro). No references to resolve (EmptyResolved). Answers are richtext.
 */
import { sectionVariantDataSchema, type EmptyResolved, type SectionComponentDefinition } from './types.js';

export const faqDefinition: SectionComponentDefinition<'faq', EmptyResolved> = {
  type: 'faq',
  schema: sectionVariantDataSchema('faq'),
  editor: {
    label: 'FAQ',
    icon: 'tabler:help-circle',
    fieldHints: {
      heading: { label: 'Heading', widget: 'text' },
      items: { label: 'Questions', help: 'Each item is a question and its richtext answer.', widget: 'cards' },
    },
    defaultData: {
      items: [],
    },
  },
};
