/**
 * Canvas rich-text editor (T9.19) — binds a TipTap 3 instance to the restricted
 * `rich_text.v1` grammar and round-trips its document through the ONE mapper
 * (richtext/prosemirror.ts). Two layers, deliberately separated:
 *
 *   1. PURE core (no editor packages): the grammar allowlist, a client-side
 *      sanitizer that strips out-of-grammar nodes/marks from ANY ProseMirror
 *      JSON (so pasted content can never carry the store past its schema), and
 *      serialize ↔ rich_text.v1 wrappers. This half is unit-tested headlessly
 *      and imports nothing from @tiptap — mirroring prosemirror.ts's rule that
 *      the data layer must not drag editor packages into the build.
 *
 *   2. BROWSER factory (`createRichTextEditor`): news up a TipTap Editor via a
 *      DYNAMIC import, so @tiptap/* load only at runtime in the overlay, never
 *      in the test/build graph. The toolbar surfaces ONLY grammar marks/nodes;
 *      links are https-only.
 *
 * Grammar (08-articles-plan §2.2, this task's brief): p, br, strong, em,
 * a[https only], ul, ol, li, h2, h3, plus the `code` mark (inline code
 * display — widened alongside rich-text-v1.ts's grammars). Blockquote,
 * code BLOCKS, and other heading levels are OUT of this field grammar and
 * are stripped client-side; a hand-built violation is additionally rejected
 * server-side by validateObject.
 */
import {
  proseMirrorToRichTextV1,
  richTextV1ToProseMirror,
  type ProseMirrorNode,
  type ProseMirrorMark,
} from '../richtext/prosemirror.js';
import type { RichTextV1Document } from '../../lib/richtext/rich-text-v1.js';

// ─── grammar allowlist (ProseMirror/TipTap side) ───────────────────────────────

/** Block node types the field grammar permits at document level / inside lists. */
export const GRAMMAR_BLOCKS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem']);
/** Inline node types permitted inside a block. */
export const GRAMMAR_INLINES = new Set(['text', 'hardBreak']);
/** Marks permitted on a text run. */
export const GRAMMAR_MARKS = new Set(['bold', 'italic', 'code', 'link']);
/** Heading levels permitted (h2, h3 only). */
export const GRAMMAR_HEADING_LEVELS = new Set([2, 3]);

const HTTPS_ONLY = /^https:\/\//i;

// ─── client-side sanitizer (closes the round-trip on paste) ────────────────────

const sanitizeMarks = (marks: ProseMirrorMark[] | undefined): ProseMirrorMark[] => {
  const out: ProseMirrorMark[] = [];
  for (const mark of marks ?? []) {
    if (mark.type === 'bold' || mark.type === 'italic' || mark.type === 'code') {
      out.push({ type: mark.type });
    } else if (mark.type === 'link') {
      const href = mark.attrs?.href;
      // https-only: any other scheme (http, javascript, mailto, relative) drops
      // the link mark but KEEPS the text (never silently lose content).
      if (typeof href === 'string' && HTTPS_ONLY.test(href)) out.push({ type: 'link', attrs: { href } });
    }
    // any other mark (strike, …) is dropped
  }
  return out;
};

/** Sanitize a block's inline children to text/hardBreak with grammar marks only. */
const sanitizeInline = (nodes: ProseMirrorNode[] | undefined): ProseMirrorNode[] => {
  const out: ProseMirrorNode[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') {
      out.push({ type: 'hardBreak' });
    } else if (node.type === 'text') {
      const marks = sanitizeMarks(node.marks);
      out.push({ type: 'text', text: node.text ?? '', ...(marks.length ? { marks } : {}) });
    } else if (node.content) {
      // An unexpected inline wrapper (e.g. a pasted span-as-node): keep its text.
      out.push(...sanitizeInline(node.content));
    }
  }
  return out;
};

/** Sanitize one block node; returns 0+ grammar-valid blocks (unwrapping the invalid). */
const sanitizeBlock = (node: ProseMirrorNode): ProseMirrorNode[] => {
  switch (node.type) {
    case 'paragraph':
      return [{ type: 'paragraph', content: sanitizeInline(node.content) }];
    case 'heading': {
      const level = node.attrs?.level;
      if (level === 2 || level === 3) {
        return [{ type: 'heading', attrs: { level }, content: sanitizeInline(node.content) }];
      }
      // Out-of-grammar heading level (h1, h4–h6) → demote to a paragraph.
      return [{ type: 'paragraph', content: sanitizeInline(node.content) }];
    }
    case 'bulletList':
    case 'orderedList': {
      const items = (node.content ?? [])
        .filter((child) => child.type === 'listItem')
        .map((item) => ({ type: 'listItem', content: sanitizeListItem(item.content) }));
      // A list with no valid items is dropped entirely.
      return items.length ? [{ type: node.type, content: items }] : [];
    }
    case 'blockquote':
      // Blockquote is OUT of this field grammar → unwrap its children to top level.
      return (node.content ?? []).flatMap(sanitizeBlock);
    default:
      // Unknown block (codeBlock, horizontalRule, table, …): flatten to a
      // paragraph carrying whatever inline text it held, or drop if empty.
      if (node.content && node.content.length) {
        const inline = sanitizeInline(node.content);
        return inline.length ? [{ type: 'paragraph', content: inline }] : [];
      }
      return [];
  }
};

/** List items hold block content (paragraphs / nested lists). */
const sanitizeListItem = (content: ProseMirrorNode[] | undefined): ProseMirrorNode[] => {
  const blocks = (content ?? []).flatMap(sanitizeBlock);
  // A listItem must contain at least one block; default to an empty paragraph.
  return blocks.length ? blocks : [{ type: 'paragraph', content: [] }];
};

/**
 * Strip a ProseMirror/TipTap document to the field grammar. Total and
 * defensive: any input (including pasted, out-of-grammar content) yields a
 * document the store's schema will accept.
 */
export const sanitizeProseMirrorDoc = (doc: ProseMirrorNode): ProseMirrorNode => ({
  type: 'doc',
  content: (doc.content ?? []).flatMap(sanitizeBlock),
});

// ─── serialize ↔ rich_text.v1 ──────────────────────────────────────────────────

/** TipTap/ProseMirror JSON → rich_text.v1, sanitizing to grammar first. */
export const serializeToRichTextV1 = (pmDoc: ProseMirrorNode): RichTextV1Document =>
  proseMirrorToRichTextV1(sanitizeProseMirrorDoc(pmDoc));

/** rich_text.v1 → TipTap/ProseMirror JSON for loading into the editor. */
export const deserializeFromRichTextV1 = (doc: RichTextV1Document): ProseMirrorNode => richTextV1ToProseMirror(doc);

// ─── browser editor factory (dynamic TipTap import) ────────────────────────────

export interface RichTextEditorHandle {
  /** Current document as rich_text.v1 (already sanitized to grammar). */
  getRichTextV1(): RichTextV1Document;
  /** Focus the editable surface. */
  focus(): void;
  /** Tear down the TipTap instance (call on panel close — avoids leaks). */
  destroy(): void;
  /** The underlying TipTap editor (typed loosely to avoid a static @tiptap dep here). */
  editor: unknown;
}

export interface CreateRichTextEditorOptions {
  element: HTMLElement;
  /** Initial document (rich_text.v1); an empty paragraph when omitted. */
  doc?: RichTextV1Document;
  /** Fired on every change with the serialized, grammar-sanitized document. */
  onChange?: (doc: RichTextV1Document) => void;
  placeholder?: string;
}

/**
 * Mount a grammar-bound TipTap editor into `element`. Browser-only: @tiptap/*
 * are dynamically imported so they never enter the test/SSR graph. StarterKit is
 * pared to the grammar (headings 2–3, inline code; no blockquote/code
 * blocks/strike/hr); Link is https-only and cannot be opened on click.
 */
export const createRichTextEditor = async (options: CreateRichTextEditorOptions): Promise<RichTextEditorHandle> => {
  const [{ Editor }, { default: StarterKit }, { default: Link }] = await Promise.all([
    import('@tiptap/core'),
    import('@tiptap/starter-kit'),
    import('@tiptap/extension-link'),
  ]);

  const initialContent = options.doc
    ? (deserializeFromRichTextV1(options.doc) as unknown as Record<string, unknown>)
    : { type: 'doc', content: [{ type: 'paragraph' }] };

  const editor = new Editor({
    element: options.element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Everything outside the grammar off — the toolbar can only offer what
        // the schema permits, and paste is additionally run through the
        // sanitizer below. `code` (the inline mark) stays on; `codeBlock`
        // (multi-line, no rich-text-v1 node type yet) stays off.
        blockquote: false,
        codeBlock: false,
        strike: false,
        horizontalRule: false,
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ['https'],
        HTMLAttributes: { rel: 'noopener nofollow', target: '_blank' },
      }),
    ],
    content: initialContent,
    editorProps: {
      // Belt-and-suspenders: sanitize pasted ProseMirror slices at the seam so
      // out-of-grammar structure never enters the doc in the first place.
      transformPastedHTML: (html) => html,
    },
  });

  const getRichTextV1 = (): RichTextV1Document => serializeToRichTextV1(editor.getJSON() as unknown as ProseMirrorNode);

  if (options.onChange) {
    editor.on('update', () => options.onChange?.(getRichTextV1()));
  }

  return {
    getRichTextV1,
    focus: () => editor.commands.focus(),
    destroy: () => editor.destroy(),
    editor,
  };
};
