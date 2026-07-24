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
  /** Called instead of onSave when no content changed — editor closes silently. */
  onNoChange?: () => void;
};

// ─── icon helper ─────────────────────────────────────────────────────────────

const cloneIcon = (name: string, fallback = ''): Node => {
  const tmpl = document.querySelector<HTMLElement>(`[data-icon="${name}"]`);
  if (tmpl) return tmpl.cloneNode(true);
  return document.createTextNode(fallback);
};

// ─── extension sets by node kind ─────────────────────────────────────────────

// Prose / callout → rich text with headings, bold, italic, link, lists
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

  const onOutside = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) {
      pop.remove();
      document.removeEventListener('mousedown', onOutside, true);
    }
  };
  requestAnimationFrame(() => document.addEventListener('mousedown', onOutside, true));

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

function buildToolbar(editor: Editor, isAction: boolean, isList: boolean): HTMLElement {
  const bar = document.createElement('div');
  bar.className =
    'dl-editor-toolbar relative flex flex-wrap items-center gap-0.5 p-1.5 rounded-t-xl border border-b-0 border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800';

  const btn = (iconName: string, title: string, action: () => void, isActive?: () => boolean) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.className =
      'w-7 h-7 flex items-center justify-center rounded text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors';
    b.append(cloneIcon(iconName, title.slice(0, 2)));
    const refreshActive = () => {
      const active = isActive?.() ?? false;
      b.setAttribute('aria-pressed', String(active));
      b.classList.toggle('is-active', active);
    };
    refreshActive();
    editor.on('selectionUpdate', refreshActive);
    editor.on('transaction', refreshActive);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      action();
    });
    return b;
  };

  const sep = () => {
    const s = document.createElement('span');
    s.className = 'w-px h-4 bg-gray-200 dark:bg-slate-600 mx-0.5 self-center';
    s.setAttribute('aria-hidden', 'true');
    return s;
  };

  if (isAction) {
    const hint = document.createElement('span');
    hint.className = 'text-gray-500 dark:text-gray-400 opacity-70 pl-1 text-xs font-semibold';
    hint.textContent = 'Plain text';
    bar.append(hint);
  } else if (isList) {
    bar.append(
      btn(
        'list',
        'Bullet list',
        () => editor.chain().focus().toggleBulletList().run(),
        () => editor.isActive('bulletList')
      ),
      btn(
        'list-numbers',
        'Ordered list',
        () => editor.chain().focus().toggleOrderedList().run(),
        () => editor.isActive('orderedList')
      ),
      sep(),
      btn('arrow-back-up', 'Undo', () => editor.chain().focus().undo().run()),
      btn('arrow-forward-up', 'Redo', () => editor.chain().focus().redo().run())
    );
  } else {
    // Full rich text
    const linkBtn = btn(
      'link',
      'Link',
      () => {
        const pop = buildLinkPopover(editor, bar);
        bar.append(pop);
        requestAnimationFrame(() => pop.querySelector('input')?.focus());
      },
      () => editor.isActive('link')
    );

    // Disable link when nothing is selected and no link is active (Rule 2)
    const refreshLinkDisabled = () => {
      const off = editor.state.selection.empty && !editor.isActive('link');
      linkBtn.disabled = off;
      linkBtn.title = off ? 'Select text to add a link' : 'Link';
      linkBtn.setAttribute('aria-label', off ? 'Select text to add a link' : 'Link');
    };
    refreshLinkDisabled();
    editor.on('selectionUpdate', refreshLinkDisabled);
    editor.on('transaction', refreshLinkDisabled);

    bar.append(
      btn(
        'bold',
        'Bold',
        () => editor.chain().focus().toggleBold().run(),
        () => editor.isActive('bold')
      ),
      btn(
        'italic',
        'Italic',
        () => editor.chain().focus().toggleItalic().run(),
        () => editor.isActive('italic')
      ),
      sep(),
      btn(
        'h-2',
        'Heading 2',
        () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        () => editor.isActive('heading', { level: 2 })
      ),
      btn(
        'h-3',
        'Heading 3',
        () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        () => editor.isActive('heading', { level: 3 })
      ),
      sep(),
      btn(
        'list',
        'Bullet list',
        () => editor.chain().focus().toggleBulletList().run(),
        () => editor.isActive('bulletList')
      ),
      btn(
        'list-numbers',
        'Ordered list',
        () => editor.chain().focus().toggleOrderedList().run(),
        () => editor.isActive('orderedList')
      ),
      sep(),
      linkBtn,
      sep(),
      btn('arrow-back-up', 'Undo', () => editor.chain().focus().undo().run()),
      btn('arrow-forward-up', 'Redo', () => editor.chain().focus().redo().run())
    );
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
  private hiddenPreview: HTMLElement | null = null;
  private hiddenPreviewDisplay = '';
  private titleInput: HTMLInputElement | null = null;
  private _dirty = false;
  private _initialHtml = '';
  private _doSave: (() => Promise<void>) | null = null;

  isDirty(): boolean {
    return this._dirty;
  }

  triggerSave(): void {
    void this._doSave?.();
  }

  mount(node: ArticleBodyNode, wrapper: HTMLElement, config: EditorConfig): void {
    if (this.editor) this.unmount();

    const presentation = node.rendering?.presentation ?? 'section';
    const kind = node.kind;
    const isAction = kind === 'action' || ['inline', 'offerInline', 'offerCard'].includes(presentation);
    const isList = ['faq', 'summary'].includes(presentation);

    // Build the editor DOM
    this.container = document.createElement('div');
    this.container.className = 'dl-node-editor border border-accent rounded-xl overflow-hidden';

    // Title input: shown when node has both title and body (so neither is lost)
    const hasSeparateTitle = node.public.title !== undefined && node.public.body !== undefined && !isAction;
    if (hasSeparateTitle) {
      const titleWrap = document.createElement('div');
      titleWrap.className =
        'dl-editor-title-field px-3 pt-3 pb-2 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900';
      const titleLabel = document.createElement('label');
      titleLabel.className = 'block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1';
      titleLabel.textContent = 'Section title';
      this.titleInput = document.createElement('input');
      this.titleInput.type = 'text';
      this.titleInput.value = node.public.title ?? '';
      this.titleInput.placeholder = 'Section title…';
      this.titleInput.className =
        'w-full border border-gray-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-accent';
      this.titleInput.addEventListener('input', () => {
        this._dirty = true;
      });
      titleLabel.append(this.titleInput);
      titleWrap.append(titleLabel);
      this.container.append(titleWrap);
    }

    this.editorEl = document.createElement('div');
    this.editorEl.className = 'dl-editor-content p-4 min-h-[6rem] bg-white dark:bg-slate-900 outline-none';

    // Initial content: body if available, else title
    const initialContent = node.public.body || node.public.title || '';

    const extensions = isAction ? plainTextExtensions() : isList ? listOnlyExtensions() : richTextExtensions();

    this.editor = new Editor({
      element: this.editorEl,
      extensions,
      content: initialContent,
    });

    this._initialHtml = this.editor.getHTML();
    this._dirty = false;
    this.editor.on('update', () => {
      this._dirty = true;
    });

    const doSave = async () => {
      if (!this.editor) return;
      const html = this.editor.getHTML();

      // Detect no-change before doing any network work
      const bodyChanged = html !== this._initialHtml;
      const titleChanged = this.titleInput ? this.titleInput.value.trim() !== (node.public.title ?? '') : false;
      const ctaTextChanged = this.ctaFields ? this.ctaFields.getText() !== (node.public.ctaText ?? '') : false;
      const ctaLinkChanged = this.ctaFields ? this.ctaFields.getUrl() !== (node.public.ctaLink ?? '') : false;

      if (!bodyChanged && !titleChanged && !ctaTextChanged && !ctaLinkChanged) {
        config.onNoChange?.();
        return;
      }

      const fields: Partial<ArticleBodyNode['public']> = {};

      if (hasSeparateTitle && this.titleInput) {
        fields.title = this.titleInput.value.trim();
      }

      if (isAction && this.ctaFields) {
        const ctaText = this.ctaFields.getText();
        const ctaLink = this.ctaFields.getUrl();
        if (ctaText) fields.ctaText = ctaText;
        if (ctaLink) fields.ctaLink = ctaLink;
        fields.body = html;
      } else if (node.public.body !== undefined || node.public.title !== undefined) {
        if (node.public.body !== undefined) {
          fields.body = html;
        } else {
          // Node had only title
          fields.title = this.editor.getText();
        }
      }

      await config.onSave(fields);
    };

    this._doSave = doSave;

    const toolbar = buildToolbar(this.editor, isAction, isList);
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
    if (renderedPreview) {
      this.hiddenPreview = renderedPreview;
      this.hiddenPreviewDisplay = renderedPreview.style.display;
      renderedPreview.style.display = 'none';
    }
    wrapper.prepend(this.container);

    this.editor.commands.focus('end');
  }

  unmount(): void {
    // Restore preview only when it's still in the DOM (cancel path).
    // On the save path, saveNodeUpdate replaces wrapper.innerHTML first,
    // which detaches the preview — isConnected is false and we skip.
    if (this.hiddenPreview?.isConnected) {
      this.hiddenPreview.style.display = this.hiddenPreviewDisplay;
    }
    this.hiddenPreview = null;
    this.hiddenPreviewDisplay = '';

    this.editor?.destroy();
    this.editor = null;
    this.container?.remove();
    this.container = null;
    this.editorEl = null;
    this.ctaFields = null;
    this.titleInput = null;
    this._doSave = null;
    this._dirty = false;
    this._initialHtml = '';
  }

  getSelectionText(): string {
    if (!this.editor) return '';
    const { from, to } = this.editor.state.selection;
    return this.editor.state.doc.textBetween(from, to);
  }
}
