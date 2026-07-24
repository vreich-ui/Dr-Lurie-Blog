/**
 * ProseMirror JSON ↔ rich_text.v1 (W7.1, 08-articles-plan §2.2/§3.2).
 *
 * TipTap (the admin editor and the canvas Ask-AI preview) is ProseMirror
 * underneath; this mapper is the ONE place its document JSON and the store's
 * rich_text.v1 convert into each other. Written once here so W7.2 (section
 * editors) and W7.7 (article editor) share it verbatim.
 *
 * Coverage is exactly the v1 universe: paragraphs, heading levels 2–3,
 * bullet/ordered lists, blockquote, bold/italic, links, hard breaks. The
 * impedance mismatches are the two link models and the two break models:
 * ProseMirror marks a text run as a link; Contentful wraps runs in a
 * hyperlink INLINE node — so consecutive text runs sharing one href merge
 * into one hyperlink node (and split back out on the way home). ProseMirror
 * has a hardBreak NODE; Contentful encodes breaks as '\n' INSIDE text values
 * — the renderer emits them as `<br/>` (the sanitizer allowlist's br).
 *
 * Anything outside the universe throws naming the offending type — an editor
 * emitting nodes the store cannot hold must fail at the seam, not lose
 * content silently (the standing contract of this directory).
 */
import { BLOCKS, INLINES, MARKS } from '@contentful/rich-text-types';

import type {
  RichTextV1Document,
  RichTextV1Hyperlink,
  RichTextV1Text,
} from '../../lib/richtext/rich-text-v1.js';

// ---------- ProseMirror JSON shapes (structural, not @tiptap types: the
// mapper is data-level and must not drag editor packages into the build) ----

export type ProseMirrorMark = { type: string; attrs?: Record<string, unknown> };
export type ProseMirrorNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  marks?: ProseMirrorMark[];
  text?: string;
};

type CtNode = {
  nodeType: string;
  data: Record<string, unknown>;
  content?: CtNode[];
  marks?: Array<{ type: string }>;
  value?: string;
};

const fail = (direction: string, what: string): never => {
  throw new Error(`richtext prosemirror mapper (${direction}): ${what}`);
};

// ---------- ProseMirror → rich_text.v1 ----------

type InlineRun = { text: string; bold: boolean; italic: boolean; href: string | null };

const inlineRuns = (nodes: ProseMirrorNode[]): InlineRun[] => {
  const runs: InlineRun[] = [];
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      // Break rides inside the adjacent text value ('\n'), Contentful-style.
      runs.push({ text: '\n', bold: false, italic: false, href: null });
      continue;
    }
    if (node.type !== 'text') fail('pm→ct', `unsupported inline node type '${node.type}'`);
    let bold = false;
    let italic = false;
    let href: string | null = null;
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') bold = true;
      else if (mark.type === 'italic') italic = true;
      else if (mark.type === 'link') {
        const uri = mark.attrs?.href;
        if (typeof uri !== 'string' || uri === '') fail('pm→ct', 'link mark without an href');
        href = uri as string;
      } else fail('pm→ct', `unsupported mark '${mark.type}'`);
    }
    runs.push({ text: node.text ?? '', bold, italic, href });
  }
  return runs;
};

const runToText = (run: InlineRun): RichTextV1Text => ({
  nodeType: 'text',
  value: run.text,
  marks: [...(run.bold ? [{ type: MARKS.BOLD }] : []), ...(run.italic ? [{ type: MARKS.ITALIC }] : [])] as Array<{
    type: typeof MARKS.BOLD | typeof MARKS.ITALIC;
  }>,
  data: {},
});

const inlineContent = (nodes: ProseMirrorNode[]): Array<RichTextV1Text | RichTextV1Hyperlink> => {
  const out: Array<RichTextV1Text | RichTextV1Hyperlink> = [];
  for (const run of inlineRuns(nodes)) {
    if (run.href === null) {
      out.push(runToText(run));
      continue;
    }
    // Consecutive runs sharing one href collapse into one hyperlink node.
    const prev = out[out.length - 1];
    if (prev && prev.nodeType === INLINES.HYPERLINK && (prev.data as { uri: string }).uri === run.href) {
      prev.content.push(runToText(run));
    } else {
      out.push({
        nodeType: INLINES.HYPERLINK,
        data: { uri: run.href },
        content: [runToText(run)],
      });
    }
  }
  return out;
};

const pmBlockToCt = (node: ProseMirrorNode): CtNode => {
  switch (node.type) {
    case 'paragraph':
      return { nodeType: BLOCKS.PARAGRAPH, data: {}, content: inlineContent(node.content ?? []) };
    case 'heading': {
      const level = node.attrs?.level;
      if (level !== 2 && level !== 3) fail('pm→ct', `unsupported heading level '${String(level)}' (only 2 and 3)`);
      return {
        nodeType: level === 2 ? BLOCKS.HEADING_2 : BLOCKS.HEADING_3,
        data: {},
        content: inlineContent(node.content ?? []),
      };
    }
    case 'bulletList':
    case 'orderedList':
      return {
        nodeType: node.type === 'bulletList' ? BLOCKS.UL_LIST : BLOCKS.OL_LIST,
        data: {},
        content: (node.content ?? []).map((item) => {
          if (item.type !== 'listItem') fail('pm→ct', `list child '${item.type}' is not a listItem`);
          return { nodeType: BLOCKS.LIST_ITEM, data: {}, content: (item.content ?? []).map(pmBlockToCt) };
        }),
      };
    case 'blockquote':
      return {
        nodeType: BLOCKS.QUOTE,
        data: {},
        content: (node.content ?? []).map((child) => {
          if (child.type !== 'paragraph') fail('pm→ct', `blockquote child '${child.type}' is not a paragraph`);
          return pmBlockToCt(child);
        }),
      };
    default:
      return fail('pm→ct', `unsupported block node type '${node.type}'`);
  }
};

/** Convert a ProseMirror/TipTap document to a rich_text.v1 document. */
export const proseMirrorToRichTextV1 = (pmDoc: ProseMirrorNode): RichTextV1Document => {
  if (pmDoc.type !== 'doc') fail('pm→ct', `root node is '${pmDoc.type}', expected 'doc'`);
  return {
    nodeType: BLOCKS.DOCUMENT,
    data: {},
    content: (pmDoc.content ?? []).map(pmBlockToCt),
  } as RichTextV1Document;
};

// ---------- rich_text.v1 → ProseMirror ----------

const textToPm = (node: RichTextV1Text, href: string | null): ProseMirrorNode[] => {
  const marks: ProseMirrorMark[] = [];
  for (const mark of node.marks) {
    if (mark.type === MARKS.BOLD) marks.push({ type: 'bold' });
    else if (mark.type === MARKS.ITALIC) marks.push({ type: 'italic' });
    else fail('ct→pm', `unsupported mark '${mark.type}'`);
  }
  if (href !== null) marks.push({ type: 'link', attrs: { href } });
  // '\n' inside a value splits back into text + hardBreak nodes.
  const segments = node.value.split('\n');
  const out: ProseMirrorNode[] = [];
  segments.forEach((segment, i) => {
    if (i > 0) out.push({ type: 'hardBreak' });
    if (segment !== '') out.push({ type: 'text', text: segment, ...(marks.length ? { marks } : {}) });
  });
  return out;
};

const inlinesToPm = (nodes: Array<RichTextV1Text | RichTextV1Hyperlink>): ProseMirrorNode[] =>
  nodes.flatMap((node) =>
    node.nodeType === 'text' ? textToPm(node, null) : node.content.flatMap((t) => textToPm(t, node.data.uri))
  );

const ctBlockToPm = (node: CtNode): ProseMirrorNode => {
  switch (node.nodeType) {
    case BLOCKS.PARAGRAPH:
      return {
        type: 'paragraph',
        content: inlinesToPm((node.content ?? []) as Array<RichTextV1Text | RichTextV1Hyperlink>),
      };
    case BLOCKS.HEADING_2:
    case BLOCKS.HEADING_3:
      return {
        type: 'heading',
        attrs: { level: node.nodeType === BLOCKS.HEADING_2 ? 2 : 3 },
        content: inlinesToPm((node.content ?? []) as Array<RichTextV1Text | RichTextV1Hyperlink>),
      };
    case BLOCKS.UL_LIST:
    case BLOCKS.OL_LIST:
      return {
        type: node.nodeType === BLOCKS.UL_LIST ? 'bulletList' : 'orderedList',
        content: (node.content ?? []).map((item) => ({
          type: 'listItem',
          content: (item.content ?? []).map(ctBlockToPm),
        })),
      };
    case BLOCKS.QUOTE:
      return { type: 'blockquote', content: (node.content ?? []).map(ctBlockToPm) };
    case BLOCKS.EMBEDDED_ENTRY:
    case BLOCKS.EMBEDDED_ASSET:
      // Editors have no representation for embeds yet — W7.7's problem, and a
      // loud one until then.
      return fail('ct→pm', `'${node.nodeType}' has no ProseMirror representation yet (W7.7)`);
    default:
      return fail('ct→pm', `unsupported node type '${node.nodeType}'`);
  }
};

/** Convert a rich_text.v1 document to ProseMirror/TipTap document JSON. */
export const richTextV1ToProseMirror = (doc: RichTextV1Document): ProseMirrorNode => ({
  type: 'doc',
  content: (doc.content as unknown as CtNode[]).map(ctBlockToPm),
});
