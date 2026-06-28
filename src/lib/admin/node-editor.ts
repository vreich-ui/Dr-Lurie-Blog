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

// ─── link popover ─────────────────────────────────────────────────────────────

/**
 * In-app link popover: URL input + Apply / Remove / Cancel.
 * Anchors below the toolbar; closes on outside click or Escape.
 */
function buildLinkPopover(editor: Editor, anchor: HTMLElement): HTMLElement {
  const existing = anchor.parentElement?.querySelector<HTMLElement>('.dl-link-popover');
  if (existing) {
    existing.remove();
    return existing;
  }

  const currentHref = editor.getAttributes('link').href as string | undefined;

  const pop = document.createElement('div');
  pop.className =
    'dl-link-popover absolute left-0 top-full mt-1 z-50 flex flex-col gap-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl p-3';
  pop.style.minWidth = '16rem';

  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.value = currentHref ?? '';
  urlInput.placeholder = 'https://…';
  urlInput.className =
    'border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-slate-800 w-full focus:outline-none focus:ring-2 focus:ring-accent';

  const row = document.createElement('div');
  row.className = 'flex gap-1.5';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.textContent = 'Apply';
  applyBtn.className =
    'flex-1 rounded-full bg-accent text-white text-xs font-bold py-1.5 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  removeBtn.className =
    'rounded-full border border-gray-300 dark:border-slate-600 text-xs font-bold py-1.5 px-2.5 hover:bg-gray-100 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  removeBtn.disabled = !currentHref;

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className =
    'rounded-full border border-gray-300 dark:border-slate-600 text-xs font-bold py-1.5 px-2.5 hover:bg-gray-100 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  const apply = () => {
    const url = urlInput.value.trim();
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    pop.remove();
  };

  applyBtn.addEventListener('click', apply);
  removeBtn.addEventListener('click', () => {
    editor.chain().focus().unsetLink().run();
    pop.remove();
  });
  cancelBtn.addEventListener('click', () => pop.remove());

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    }
    if (e.key === 'Escape') {
      pop.remove();
    }
  });

  row.append(applyBtn, removeBtn, cancelBtn);
  pop.append(urlInput, row);

  // Close on outside mousedown
  const onOutside = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) {
      pop.remove();
      document.removeEventListener('mousedown', onOutside, true);
    }
  };
  // Delay to avoid the triggering click registering as "outside"
  requestAnimationFrame(() => document.addEventListener('mousedown', onOutside, true));

  // Escape from anywhere closes it
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      pop.remove();
      document.removeEventListener('keydown', onKey, true);
    }
  };
  document.addEventListener('keydown', onKey, true);

  return pop;
}

// ─── toolbar ─────────────────────────────────────────────────────────────────

function buildToolbar(editor: Editor, node: ArticleBodyNode): HTMLElement {
  const bar = document.createElement('div');
  bar.className =
    'dl-editor-toolbar relative flex flex-wrap items-center gap-1 p-2 rounded-t-xl border border-b-0 border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-xs font-semibold';

  const btn = (label: string, title: string, action: () => void, isActive?: () => boolean) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.className =
      'px-2 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      action();
      refreshActive();
    });
    const refreshActive = () => {
      b.setAttribute('aria-pressed', String(isActive?.() ?? false));
    };
    refreshActive();
    return b;
  };

  const presentation = node.rendering?.presentation;
  const isRichText = !['inline', 'offerInline', 'offerCard', 'faq', 'summary'].includes(presentation ?? '');

  if (isRichText) {
    bar.append(
      btn(
        'B',
        'Bold',
        () => editor.chain().focus().toggleBold().run(),
        () => editor.isActive('bold')
      ),
      btn(
        'I',
        'Italic',
        () => editor.chain().focus().toggleItalic().run(),
        () => editor.isActive('italic')
      ),
      btn(
        'H2',
        'Heading 2',
        () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        () => editor.isActive('heading', { level: 2 })
      ),
      btn(
        'H3',
        'Heading 3',
        () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        () => editor.isActive('heading', { level: 3 })
      )
    );

    // Link button — opens in-app popover
    const linkBtn = btn(
      '🔗',
      'Link',
      () => {
        const pop = buildLinkPopover(editor, bar);
        bar.style.position = 'relative';
        bar.append(pop);
        requestAnimationFrame(() => pop.querySelector('input')?.focus());
      },
      () => editor.isActive('link')
    );
    bar.append(linkBtn);
  } else {
    // Minimal label when no rich-text controls apply
    const hint = document.createElement('span');
    hint.className = 'text-muted opacity-60 pl-1';
    hint.textContent = 'Plain text';
    bar.append(hint);
  }

  return bar;
}

function buildEditorFooter(onSave: () => void, onCancel: () => void): HTMLElement {
  const footer = document.createElement('div');
  footer.className =
    'dl-editor-footer flex items-center justify-end gap-2 px-3 py-2 border border-t-0 rounded-b-xl border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className =
    'px-3 py-1 rounded-full border border-gray-300 dark:border-slate-600 text-xs font-bold hover:bg-gray-100 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  cancelBtn.addEventListener('click', onCancel);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save block';
  saveBtn.className =
    'px-3 py-1 rounded-full bg-accent text-white text-xs font-bold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  saveBtn.addEventListener('click', onSave);

  footer.append(cancelBtn, saveBtn);
  return footer;
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

    const extensions = isAction ? plainTextExtensions() : isList ? listOnlyExtensions() : richTextExtensions();

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

    const toolbar = buildToolbar(this.editor, node);
    const footer = buildEditorFooter(doSave, config.onCancel);
    this.container.append(toolbar, this.editorEl);

    if (isAction) {
      this.ctaFields = buildCtaFields(node);
      this.container.append(this.ctaFields.el);
    }

    this.container.append(footer);

    // Hide the rendered preview and show the editor
    const renderedPreview = wrapper.querySelector(
      '.dl-node-body, section, aside, div:not(.dl-node-wrapper)'
    ) as HTMLElement | null;
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
