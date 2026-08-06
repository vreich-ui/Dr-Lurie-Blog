/**
 * Markdown → rich_text.v1 (the inverse of article-content/to-markdown.ts's
 * `articleBodyToMarkdown`). Markdown is the format agents and writers reach
 * for most naturally; this closes the loop so that content authored as
 * markdown renders through the SAME theme-driven typography as everything
 * else in the store — headings in the theme's heading font, bold/italic as
 * real marks, inline code as a real `code` mark (monospace, unformatted) —
 * instead of landing in a plain-text field where the syntax characters
 * would show up literally (asterisks, backticks, hashes) because
 * plain-string bodies are deliberately rendered as escaped, literal text
 * (content-item-v1.ts, render-nodes.ts's bodyHtml — "plain text as it is").
 *
 * Covers exactly the rich_text.v1 vocabulary (rich-text-v1.ts): paragraphs,
 * heading levels 2–3, bold, italic, inline code, https(s) links, flat
 * (non-nested) bullet/ordered lists, and single-level blockquotes. Anything
 * outside that — fenced code blocks, images, tables, horizontal rules, h1/
 * h4-h6, nested lists — throws naming the construct and the offending line,
 * the same "never silently drop" contract every splitter/mapper in this
 * directory already honors (paragraphs.ts, prosemirror.ts, render-html.ts).
 * The output is schema-validated before returning, so a converter bug is a
 * loud parse error here, never malformed data downstream.
 */
import { BLOCKS, INLINES, MARKS } from '@contentful/rich-text-types';

import {
  parseRichTextV1,
  type RichTextV1Document,
  type RichTextV1Hyperlink,
  type RichTextV1Text,
} from './rich-text-v1.js';

const fail = (why: string, line?: string): never => {
  throw new Error(`markdownToRichTextV1: ${why}${line !== undefined ? ` (line: ${JSON.stringify(line)})` : ''}`);
};

// ─── inline parsing (bold / italic / code / links) ──────────────────────────

type MarkName = typeof MARKS.BOLD | typeof MARKS.ITALIC | typeof MARKS.CODE;

const textNode = (value: string, marks: MarkName[]): RichTextV1Text => ({
  nodeType: 'text',
  value,
  marks: marks.map((type) => ({ type })),
  data: {},
});

const SAFE_URL_RE = /^https?:\/\/\S+$/i;

/** Escapable literal characters (backslash-escaped, common markdown convention). */
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')']);

/**
 * Parse one line/paragraph's worth of inline markdown into text + hyperlink
 * nodes, carrying `activeMarks` down through nested emphasis so e.g.
 * `**bold *and italic***` yields a run carrying both marks (a rich_text.v1
 * text node's marks are a set, exactly like Contentful's own model).
 */
const parseInline = (source: string, activeMarks: MarkName[] = []): Array<RichTextV1Text | RichTextV1Hyperlink> => {
  const out: Array<RichTextV1Text | RichTextV1Hyperlink> = [];
  let buffer = '';
  let i = 0;

  const flush = (): void => {
    if (buffer !== '') out.push(textNode(buffer, activeMarks));
    buffer = '';
  };

  const findClose = (delim: string, from: number): number => source.indexOf(delim, from);

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\\' && i + 1 < source.length && ESCAPABLE.has(source[i + 1])) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    if (ch === '`') {
      const close = findClose('`', i + 1);
      if (close === -1) {
        buffer += ch;
        i += 1;
        continue;
      }
      flush();
      out.push(textNode(source.slice(i + 1, close), [...activeMarks, MARKS.CODE]));
      i = close + 1;
      continue;
    }

    if (source.startsWith('**', i) || source.startsWith('__', i)) {
      const delim = source.slice(i, i + 2);
      const close = source.indexOf(delim, i + 2);
      if (close === -1) {
        buffer += delim;
        i += 2;
        continue;
      }
      flush();
      out.push(...parseInline(source.slice(i + 2, close), [...activeMarks, MARKS.BOLD]));
      i = close + 2;
      continue;
    }

    if (ch === '*' || ch === '_') {
      const close = source.indexOf(ch, i + 1);
      if (close === -1) {
        buffer += ch;
        i += 1;
        continue;
      }
      flush();
      out.push(...parseInline(source.slice(i + 1, close), [...activeMarks, MARKS.ITALIC]));
      i = close + 1;
      continue;
    }

    if (ch === '[') {
      const closeBracket = source.indexOf(']', i + 1);
      if (closeBracket !== -1 && source[closeBracket + 1] === '(') {
        const closeParen = source.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const label = source.slice(i + 1, closeBracket);
          const url = source.slice(closeBracket + 2, closeParen);
          if (!SAFE_URL_RE.test(url)) {
            fail(`link url "${url}" must be http(s) with no whitespace`, source);
          }
          flush();
          const content = parseInline(label, activeMarks).filter(
            (node): node is RichTextV1Text => node.nodeType === 'text'
          );
          out.push({
            nodeType: INLINES.HYPERLINK,
            data: { uri: url },
            content: content.length ? content : [textNode(label, activeMarks)],
          });
          i = closeParen + 1;
          continue;
        }
      }
      buffer += ch;
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }
  flush();
  return out;
};

// ─── block parsing ───────────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UNSUPPORTED_HEADING_RE = /^(#|####|#####|######)\s/;
const UL_ITEM_RE = /^[-*+]\s+(.*)$/;
const OL_ITEM_RE = /^\d+\.\s+(.*)$/;
const QUOTE_LINE_RE = /^>\s?(.*)$/;
const FENCE_RE = /^```/;
const HR_RE = /^([-*_])\1{2,}\s*$/;
const INDENTED_RE = /^\s+\S/;

type Line = string;

/** A loosely-typed block node — the whole document is schema-validated by `parseRichTextV1` before it is returned. */
type MdBlockNode = { nodeType: string; data: Record<string, unknown>; content: unknown[] };

const paragraphNode = (text: string): MdBlockNode => ({
  nodeType: BLOCKS.PARAGRAPH,
  data: {},
  content: parseInline(text),
});

const headingNode = (level: 2 | 3, text: string): MdBlockNode => ({
  nodeType: level === 2 ? BLOCKS.HEADING_2 : BLOCKS.HEADING_3,
  data: {},
  content: parseInline(text),
});

const listNode = (ordered: boolean, items: string[]): MdBlockNode => ({
  nodeType: ordered ? BLOCKS.OL_LIST : BLOCKS.UL_LIST,
  data: {},
  content: items.map((item) => ({ nodeType: BLOCKS.LIST_ITEM, data: {}, content: [paragraphNode(item)] })),
});

/** Split into blank-line-delimited chunks of raw (non-blank) lines. */
const chunkLines = (lines: Line[]): Line[][] => {
  const chunks: Line[][] = [];
  let current: Line[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length) chunks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
};

const blockFromChunk = (chunk: Line[]): MdBlockNode => {
  const first = chunk[0];

  if (FENCE_RE.test(first)) {
    fail('fenced code blocks are not supported yet — use inline `code` spans', first);
  }
  if (HR_RE.test(first) && chunk.length === 1) {
    fail('horizontal rules are not supported', first);
  }
  if (UNSUPPORTED_HEADING_RE.test(first)) {
    fail('only ## and ### headings are supported (h1 and h4–h6 are out of the v1 vocabulary)', first);
  }
  const heading = first.match(HEADING_RE);
  if (heading) {
    if (chunk.length !== 1) fail('a heading must be on its own line', first);
    return headingNode(heading[1].length as 2 | 3, heading[2]);
  }

  if (chunk.some((line) => INDENTED_RE.test(line))) {
    fail('indented (nested) list items are not supported — lists are flat, one level only', chunk.join('\n'));
  }

  if (chunk.every((line) => UL_ITEM_RE.test(line))) {
    return listNode(
      false,
      chunk.map((line) => line.match(UL_ITEM_RE)![1])
    );
  }
  if (chunk.every((line) => OL_ITEM_RE.test(line))) {
    return listNode(
      true,
      chunk.map((line) => line.match(OL_ITEM_RE)![1])
    );
  }

  if (chunk.every((line) => QUOTE_LINE_RE.test(line))) {
    const quoted = chunk.map((line) => line.match(QUOTE_LINE_RE)![1]).join(' ');
    return { nodeType: BLOCKS.QUOTE, data: {}, content: [paragraphNode(quoted)] };
  }

  // A mix of list/quote markers with plain lines, or a plain paragraph: a
  // paragraph, joining lines with '\n' — the same hard-break convention the
  // rest of this substrate already uses (prosemirror.ts, render-html.ts).
  if (chunk.some((line) => UL_ITEM_RE.test(line) || OL_ITEM_RE.test(line) || QUOTE_LINE_RE.test(line))) {
    fail(
      'a list or blockquote block must be made of only that kind of line — mixed markup in one block',
      chunk.join('\n')
    );
  }
  return paragraphNode(chunk.join('\n'));
};

/**
 * Convert a markdown string to a rich_text.v1 document. Throws (naming the
 * offending construct/line) on anything outside the supported subset rather
 * than dropping or mis-rendering it.
 */
export const markdownToRichTextV1 = (markdown: string): RichTextV1Document => {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const content = chunkLines(lines).map(blockFromChunk);
  return parseRichTextV1({ nodeType: BLOCKS.DOCUMENT, data: {}, content });
};
