/**
 * Per-node TipTap editor.
 * One instance per block; mounts over the rendered preview, unmounts on save/cancel.
 * Extension set is deliberately minimal per the brief: no full Notion-style canvas.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import type { ArticleBodyNode } from '../../schema/article-content-v1.ts';

type EditorConfig = {
  /** Resolved after save; receives fields that actually changed (subset of public). */
  onSave: (updatedFields: Partial<ArticleBodyNode['public']>) => Promise<void>;
  onCancel: () => void;
};

// ─── extension sets by node kind ─────────────────────────────────────────────

// Prose / callout / summary → rich text with headings, bold, italic, link
const richTextExtensions = () => [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
  }),
  Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener' } }),
];

// CTA / offer action blocks → plain text only (the URL lives in a separate input)
const plainTextExtensions = () => [
  StarterKit.configure({
    heading: false,
    bold: false,
    italic: false,
    strike: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
    bulletList: false,
    orderedList: false,
  }),
];

// FAQ / summary → list-only (no rich text, no headings)
const listOnlyExtensions = () => [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
    bold: false,
    italic: false,
    strike: false,
  }),
];

// ─── toolbar ─────────────────────────────────────────────────────────────────

function buildToolbar(editor: Editor, node: ArticleBodyNode, onSave: () => void, onCancel: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'dl-editor-toolbar flex flex-wrap items-center gap-1 p-2 rounded-t-xl border border-b-0 border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-xs font-semibold';

  const btn = (label: string, title: string, action: () => void, isActive?: () => boolean) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.className = 'px-2 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-slate-700';
    b.addEventListener('click', (e) => { e.preventDefault(); action(); refreshActive(); });
    const refreshActive = () => { b.setAttribute('aria-pressed', String(isActive?.() ?? false)); };
    refreshActive();
    return b;
  };

  const presentation = node.rendering?.presentation;
  const isRichText = !['inline', 'offerInline', 'offerCard', 'faq', 'summary'].includes(presentation ?? '');

  if (isRichText) {
    bar.append(
      btn('B', 'Bold', () => editor.chain().focus().toggleBold().run(), () => editor.isActive('bold')),
      btn('I', 'Italic', () => editor.chain().focus().toggleItalic().run(), () => editor.isActive('italic')),
      btn('H2', 'Heading 2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), () => editor.isActive('heading', { level: 2 })),
      btn('H3', 'Heading 3', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), () => editor.isActive('heading', { level: 3 })),
      btn('🔗', 'Link', () => {
        const url = window.prompt('URL', editor.getAttributes('link').href ?? '');
        if (url === null) return;
        if (url === '') { editor.chain().focus().unsetLink().run(); return; }
        editor.chain().focus().setLink({ href: url }).run();
      }, () => editor.isActive('link'))
    );
  }

  // Spacer
  const spacer = document.createElement('span');
  spacer.className = 'flex-1';
  bar.append(spacer);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.className = 'px-3 py-0.5 rounded-full bg-accent text-white font-bold hover:opacity-90';
  saveBtn.addEventListener('click', onSave);
  bar.append(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'px-3 py-0.5 rounded-full border border-gray-300 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-700';
  cancelBtn.addEventListener('click', onCancel);
  bar.append(cancelBtn);

  // Sync active state on editor transactions
  editor.on('transaction', () => {
    // Individual buttons update themselves via their own refreshActive closure
  });

  return bar;
}

// ─── extra inputs for action/CTA nodes ───────────────────────────────────────

function buildCtaFields(node: ArticleBodyNode): { el: HTMLElement; getText: () => string; getUrl: () => string } {
  const wrap = document.createElement('div');
  wrap.className = 'dl-editor-cta-fields flex flex-col gap-2 p-3 border-t border-gray-200 dark:border-slate-700';

  const textLabel = document.createElement('label');
  textLabel.className = 'flex flex-col gap-1 text-xs font-semibold';
  textLabel.textContent = 'Button label';
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.value = node.public.ctaText ?? '';
  textInput.className = 'border rounded px-2 py-1 text-sm bg-white dark:bg-slate-900';
  textLabel.append(textInput);

  const urlLabel = document.createElement('label');
  urlLabel.className = 'flex flex-col gap-1 text-xs font-semibold';
  urlLabel.textContent = 'URL';
  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.value = node.public.ctaLink ?? '';
  urlInput.className = 'border rounded px-2 py-1 text-sm bg-white dark:bg-slate-900';
  urlLabel.append(urlInput);

  wrap.append(textLabel, urlLabel);
  return { el: wrap, getText: () => textInput.value, getUrl: () => urlInput.value };
}

// ─── NodeEditor class ─────────────────────────────────────────────────────────

export class NodeEditor {
  private editor: Editor | null = null;
  private container: HTMLElement | null = null;
  private editorEl: HTMLElement | null = null;
  private ctaFields: ReturnType<typeof buildCtaFields> | null = null;

  mount(node: ArticleBodyNode, wrapper: HTMLElement, config: EditorConfig): void {
    if (this.editor) this.unmount();

    const presentation = node.rendering?.presentation ?? 'section';
    const kind = node.kind;
    const isAction = kind === 'action' || ['inline', 'offerInline', 'offerCard'].includes(presentation);
    const isList = ['faq', 'summary'].includes(presentation);

    // Build the editor DOM
    this.container = document.createElement('div');
    this.container.className = 'dl-node-editor border border-accent rounded-xl overflow-hidden';

    this.editorEl = document.createElement('div');
    this.editorEl.className = 'dl-editor-content p-4 min-h-[6rem] bg-white dark:bg-slate-900 outline-none';

    // Initial content: prefer body text; fall back to title
    const initialContent = node.public.body || node.public.title || '';

    const extensions = isAction
      ? plainTextExtensions()
      : isList
        ? listOnlyExtensions()
        : richTextExtensions();

    this.editor = new Editor({
      element: this.editorEl,
      extensions,
      content: initialContent,
    });

    const doSave = async () => {
      if (!this.editor) return;
      const text = this.editor.getText();
      const html = this.editor.getHTML();

      const fields: Partial<ArticleBodyNode['public']> = {};

      if (node.public.body !== undefined || node.public.title !== undefined) {
        // Prefer updating body; if node only had title, update title
        if (node.public.body !== undefined) {
          fields.body = html;
        } else {
          fields.title = text;
        }
      }

      if (isAction && this.ctaFields) {
        const ctaText = this.ctaFields.getText();
        const ctaLink = this.ctaFields.getUrl();
        if (ctaText) fields.ctaText = ctaText;
        if (ctaLink) fields.ctaLink = ctaLink;
        fields.body = html;
      }

      await config.onSave(fields);
    };

    const toolbar = buildToolbar(this.editor, node, doSave, config.onCancel);
    this.container.append(toolbar, this.editorEl);

    if (isAction) {
      this.ctaFields = buildCtaFields(node);
      this.container.append(this.ctaFields.el);
    }

    // Hide the rendered preview and show the editor
    const renderedPreview = wrapper.querySelector('.dl-node-body, section, aside, div:not(.dl-node-wrapper)') as HTMLElement | null;
    if (renderedPreview) renderedPreview.style.display = 'none';
    wrapper.prepend(this.container);

    this.editor.commands.focus('end');
  }

  unmount(): void {
    this.editor?.destroy();
    this.editor = null;
    this.container?.remove();
    this.container = null;
    this.editorEl = null;
    this.ctaFields = null;
  }

  getSelectionText(): string {
    if (!this.editor) return '';
    const { from, to } = this.editor.state.selection;
    return this.editor.state.doc.textBetween(from, to);
  }
}
