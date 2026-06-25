/**
 * "Ask AI" flow: text selection → instruction → suggestion overlay → Accept/Discard.
 *
 * Diff strategy:
 *   - Short fields (title, ctaText, ctaLink, label, eyebrow): whole-field old-vs-new,
 *     side by side — realistic change is whole-field replacement.
 *   - Prose body: word-level diff so only changed spans are highlighted,
 *     not the entire paragraph.
 *   - items[]: each item diffed independently at word level.
 */

import { diffWords, type Change } from 'diff';
import type { ArticleBodyNode } from '../../schema/article-content-v1.ts';

const AI_ENDPOINT = '/.netlify/functions/admin-ask-ai-node';

// Fields where prose word-diff is meaningful (multi-sentence content)
const PROSE_FIELDS: (keyof ArticleBodyNode['public'])[] = ['body'];

// ─── diff rendering ───────────────────────────────────────────────────────────

function renderWordDiff(oldText: string, newText: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'dl-diff-word';

  const changes: Change[] = diffWords(oldText, newText);
  for (const change of changes) {
    if (change.added) {
      const ins = document.createElement('ins');
      ins.className = 'dl-diff-ins bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 rounded px-0.5 no-underline';
      ins.textContent = change.value;
      container.append(ins);
    } else if (change.removed) {
      const del = document.createElement('del');
      del.className = 'dl-diff-del bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 rounded px-0.5 line-through';
      del.textContent = change.value;
      container.append(del);
    } else {
      container.append(document.createTextNode(change.value));
    }
  }
  return container;
}

function renderFieldDiff(
  fieldName: string,
  oldValue: string | undefined,
  newValue: string | undefined
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dl-diff-field flex flex-col gap-1 py-2 border-b border-gray-100 dark:border-slate-700 last:border-0';

  const label = document.createElement('span');
  label.className = 'text-xs font-bold uppercase tracking-wide text-muted';
  label.textContent = fieldName;
  row.append(label);

  const isProse = PROSE_FIELDS.includes(fieldName as keyof ArticleBodyNode['public']) &&
    ((oldValue ?? '').length > 80 || (newValue ?? '').length > 80);

  if (isProse) {
    // Word-level diff for prose
    row.append(renderWordDiff(oldValue ?? '', newValue ?? ''));
  } else {
    // Side-by-side for short fields
    const pair = document.createElement('div');
    pair.className = 'flex gap-3 text-sm';

    if (oldValue !== undefined && oldValue !== '') {
      const oldEl = document.createElement('div');
      oldEl.className = 'flex-1 rounded p-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 line-through';
      oldEl.textContent = oldValue;
      pair.append(oldEl);
    }

    const newEl = document.createElement('div');
    newEl.className = 'flex-1 rounded p-2 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300';
    newEl.textContent = newValue ?? '';
    pair.append(newEl);

    row.append(pair);
  }

  return row;
}

// ─── suggestion overlay ───────────────────────────────────────────────────────

export function renderSuggestionOverlay(
  nodeWrapper: HTMLElement,
  originalPublic: ArticleBodyNode['public'],
  suggestion: Partial<ArticleBodyNode['public']>,
  onAccept: (fields: Partial<ArticleBodyNode['public']>) => Promise<void>,
  onDiscard: () => void
): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className =
    'dl-suggestion-overlay absolute inset-0 z-20 flex flex-col rounded-xl border-2 border-accent bg-white dark:bg-slate-900 shadow-xl overflow-hidden';

  // Header
  const header = document.createElement('div');
  header.className = 'flex items-center justify-between px-4 py-2 bg-accent/10 border-b border-accent/20';
  const headerText = document.createElement('span');
  headerText.className = 'text-sm font-bold';
  headerText.textContent = 'AI suggestion — review changes';
  header.append(headerText);
  overlay.append(header);

  // Diff body
  const body = document.createElement('div');
  body.className = 'flex-1 overflow-y-auto px-4 py-3 space-y-1';

  const changedFields = Object.keys(suggestion) as (keyof ArticleBodyNode['public'])[];
  if (changedFields.length === 0) {
    body.append(Object.assign(document.createElement('p'), {
      className: 'text-sm text-muted',
      textContent: 'No changes suggested.',
    }));
  }

  for (const field of changedFields) {
    const oldValue = String(originalPublic[field] ?? '');
    const newValue = String((suggestion as Record<string, unknown>)[field] ?? '');
    if (oldValue === newValue) continue;
    body.append(renderFieldDiff(String(field), oldValue, newValue));
  }

  overlay.append(body);

  // Action bar
  const actions = document.createElement('div');
  actions.className = 'flex gap-2 px-4 py-3 border-t border-gray-200 dark:border-slate-700';

  const acceptBtn = document.createElement('button');
  acceptBtn.type = 'button';
  acceptBtn.textContent = 'Accept';
  acceptBtn.className =
    'flex-1 rounded-full bg-accent text-white font-bold py-2 text-sm hover:opacity-90 disabled:opacity-50';

  const discardBtn = document.createElement('button');
  discardBtn.type = 'button';
  discardBtn.textContent = 'Discard';
  discardBtn.className =
    'flex-1 rounded-full border border-gray-300 dark:border-slate-600 font-bold py-2 text-sm hover:bg-gray-100 dark:hover:bg-slate-700';

  acceptBtn.addEventListener('click', async () => {
    acceptBtn.disabled = true;
    acceptBtn.textContent = 'Applying…';
    await onAccept(suggestion);
    overlay.remove();
  });

  discardBtn.addEventListener('click', () => {
    overlay.remove();
    onDiscard();
  });

  actions.append(acceptBtn, discardBtn);
  overlay.append(actions);

  // Mount; the wrapper must be position:relative
  nodeWrapper.style.position = 'relative';
  nodeWrapper.append(overlay);

  return overlay;
}

// ─── ask AI ───────────────────────────────────────────────────────────────────

export type AskAiOptions = {
  requestId: string;
  nodeId: string;
  selectedText?: string;
  instruction: string;
  clerkToken: string;
};

export type AskAiResult =
  | { ok: true; suggestion: Partial<ArticleBodyNode['public']> }
  | { ok: false; error: string };

export async function askAiForNode(options: AskAiOptions): Promise<AskAiResult> {
  const { requestId, nodeId, selectedText, instruction, clerkToken } = options;
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clerkToken}`,
      },
      body: JSON.stringify({ requestId, nodeId, selectedText, instruction }),
    });
    const json = (await res.json()) as { ok?: boolean; suggestion?: Partial<ArticleBodyNode['public']>; error?: string };
    if (!res.ok || !json.ok) return { ok: false, error: json.error ?? `HTTP ${res.status}` };
    if (!json.suggestion) return { ok: false, error: 'No suggestion returned' };
    return { ok: true, suggestion: json.suggestion };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ─── instruction popover ──────────────────────────────────────────────────────

/**
 * Small popover that collects the user's instruction before calling the AI.
 * Anchors to the nodeWrapper and dismisses on Escape or outside click.
 */
export function showInstructionPopover(
  nodeWrapper: HTMLElement,
  selectedText: string | undefined,
  onSubmit: (instruction: string) => void,
  onDismiss: () => void
): HTMLElement {
  const popover = document.createElement('div');
  popover.className =
    'dl-instruction-popover absolute z-30 left-0 right-0 top-0 bg-white dark:bg-slate-900 border border-accent rounded-xl shadow-xl p-4 flex flex-col gap-3';

  const titleEl = document.createElement('p');
  titleEl.className = 'text-sm font-bold';
  titleEl.textContent = selectedText ? `Ask AI about: "${selectedText.slice(0, 60)}${selectedText.length > 60 ? '…' : ''}"` : 'Ask AI to revise this block';
  popover.append(titleEl);

  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.placeholder = 'e.g. "Make this more conversational" or "Shorten to one sentence"';
  textarea.className =
    'w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm resize-none';
  popover.append(textarea);

  const row = document.createElement('div');
  row.className = 'flex gap-2 justify-end';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.textContent = 'Ask AI';
  submitBtn.className =
    'rounded-full bg-accent text-white font-bold px-4 py-1.5 text-sm hover:opacity-90 disabled:opacity-50';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className =
    'rounded-full border border-gray-300 dark:border-slate-600 font-bold px-4 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-slate-700';

  const submit = () => {
    const instruction = textarea.value.trim();
    if (!instruction) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Asking…';
    popover.remove();
    onSubmit(instruction);
  };

  submitBtn.addEventListener('click', submit);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
    if (e.key === 'Escape') { popover.remove(); onDismiss(); }
  });
  cancelBtn.addEventListener('click', () => { popover.remove(); onDismiss(); });

  row.append(cancelBtn, submitBtn);
  popover.append(row);

  nodeWrapper.style.position = 'relative';
  nodeWrapper.prepend(popover);
  setTimeout(() => textarea.focus(), 50);

  // Dismiss on outside click
  const outside = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node)) { popover.remove(); onDismiss(); document.removeEventListener('click', outside, true); }
  };
  document.addEventListener('click', outside, true);

  return popover;
}
