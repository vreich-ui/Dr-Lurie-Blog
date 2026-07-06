/**
 * Paragraph access to RichText for section components (T3.2).
 *
 * RichText is TipTap-produced HTML constrained to the sanitizer allowlist
 * (D§3.5): at the top level it is a sequence of block elements, `<p>…</p>`
 * in every audited section. Components own layout — including per-paragraph
 * classes (the audited hero styles its first paragraph differently from the
 * rest) — while copy stays data (D§4.2). To apply a class to a paragraph,
 * the component needs the paragraphs separately; this splitter provides
 * exactly that and nothing more.
 *
 * Deliberately narrow: only top-level `<p>` blocks are recognized (nested
 * `<p>` cannot occur — invalid HTML the sanitizer never produces). Content
 * outside `<p>` blocks (e.g. a stray `<ul>` between paragraphs) is refused
 * loudly rather than silently dropped, so a body this splitter cannot
 * faithfully represent fails the build instead of losing content.
 */

const PARAGRAPH_RE = /<p>([\s\S]*?)<\/p>/g;

/** Inner HTML of each top-level paragraph, in order. Empty input → []. */
export const splitRichTextParagraphs = (richText: string): string[] => {
  const trimmed = richText.trim();
  if (trimmed === '') return [];
  const paragraphs: string[] = [];
  let consumed = '';
  for (const match of trimmed.matchAll(PARAGRAPH_RE)) {
    paragraphs.push(match[1]);
    consumed += match[0];
  }
  const residue = trimmed.replaceAll(/\s+/g, '');
  const covered = consumed.replaceAll(/\s+/g, '');
  if (residue !== covered) {
    throw new Error(
      'splitRichTextParagraphs: rich text contains content outside top-level <p> blocks; ' +
        'refusing to drop it silently. Received: ' +
        JSON.stringify(richText)
    );
  }
  return paragraphs;
};
