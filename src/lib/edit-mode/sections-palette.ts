/**
 * Edit-mode canvas — the "add a section" palette (pure, unit-tested).
 *
 * What the gap "+" offers. A deliberately small, curated subset of the
 * registered section types — the shapes an editor reaches for between two
 * blocks of a page — each with a minimal STARTER body that passes the
 * section.v1 schema and the write-time validators (rich-text fields use
 * paragraph-only allowlist HTML), so the insert patches cleanly and the new
 * section is immediately editable with the text tools. Structural/bound types
 * (content_grid, product_preview, contact_form, search, shared_ref…) are
 * intentionally absent: they need references or bindings a quick-add cannot
 * responsibly invent — they remain agent/admin work.
 *
 * Position math is record-based, not DOM-based: hidden sections still occupy
 * indices in `body.sections`, so the insert position is derived from the
 * anchor section's id in the CURRENT record (`insertPositionFor`), never from
 * what happens to be rendered.
 */

export type PaletteEntry = {
  type: string;
  /** Editor-facing label — what the block is, not how it's implemented. */
  label: string;
  /** One-line hint shown in the picker. */
  hint: string;
  /** Minimal schema-valid starter data. */
  starter: Record<string, unknown>;
};

export const SECTION_PALETTE: PaletteEntry[] = [
  {
    type: 'prose',
    label: 'Text',
    hint: 'A block of paragraphs.',
    starter: { body: '<p>New text. Click the pencil to edit, or ask the AI to draft it.</p>' },
  },
  {
    type: 'lede',
    label: 'Intro header',
    hint: 'Kicker, heading, and lead-in copy.',
    starter: { heading: 'New heading', body: '<p>Lead-in copy for this part of the page.</p>', actions: [] },
  },
  {
    type: 'cta_banner',
    label: 'Call to action',
    hint: 'A short pitch with buttons.',
    starter: { heading: 'Ready for the next step?', body: '<p>One sentence on why.</p>', actions: [] },
  },
  {
    type: 'checklist',
    label: 'Checklist',
    hint: '“This is for you if…” bullet list.',
    starter: { heading: 'This is for you if…', items: ['First point'] },
  },
  {
    type: 'faq',
    label: 'FAQ',
    hint: 'Questions and answers.',
    starter: { heading: 'Frequently asked questions', items: [{ q: 'First question?', a: '<p>The answer.</p>' }] },
  },
  {
    type: 'testimonial',
    label: 'Quotes',
    hint: 'Reader or expert quotes.',
    starter: { quotes: [{ quote: 'A kind word from a reader.' }] },
  },
  {
    type: 'newsletter_signup',
    label: 'Newsletter signup',
    hint: 'Email capture with consent copy.',
    starter: { heading: 'Get one useful letter a month', formName: 'newsletter' },
  },
  // The one content_grid shape a quick-add CAN responsibly create: a
  // `related` source needs no references — the algorithm selects posts at
  // build time (anchored to the current article; newest-first elsewhere).
  // The chip's inline dropdown switches the algorithm afterwards.
  {
    type: 'content_grid',
    label: 'Related articles',
    hint: 'Auto-selected posts; algorithm switchable.',
    starter: {
      heading: 'Related Posts',
      source: { kind: 'related', algorithm: 'tag_similarity' },
      limit: 4,
    },
  },
];

export const paletteEntry = (type: string): PaletteEntry | undefined =>
  SECTION_PALETTE.find((entry) => entry.type === type);

/**
 * Where `upsert_section` should insert relative to an anchor section id in
 * the CURRENT record's sections array. `before` = at the anchor's index,
 * `after` = just past it. Unknown anchor → append (never throw mid-edit; the
 * record may have moved under us and appending is the safe reading).
 */
export const insertPositionFor = (
  sections: Array<{ id: string }>,
  anchorId: string,
  where: 'before' | 'after'
): number => {
  const index = sections.findIndex((section) => section.id === anchorId);
  if (index < 0) return sections.length;
  return where === 'before' ? index : index + 1;
};
