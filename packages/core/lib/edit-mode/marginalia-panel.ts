/**
 * Marginalia (W15 S4, MVP) — the canvas "Comments" accordion section's body.
 *
 * Split out of edit-mode/ui.ts (which is already ~3000 lines) to keep that
 * file from growing further, mirroring how the other accordion sections
 * (edit/image/role/meta) keep their DOM-building logic close to their own
 * concerns. ui.ts calls `mountMarginaliaPanel` when the `comments` accordion
 * section opens and does nothing else — all fetch/render/compose logic for
 * this section lives here.
 *
 * `preloaded` (optional): ui.ts warms every visible object's comment threads
 * the moment edit mode activates (the same "pay the wait up front" B4
 * discipline as its object-record cache), so this panel's FIRST paint reuses
 * that promise instead of a cold fetch. Every write (resolve/reply/create)
 * still re-fetches live via `refresh()`, and calls `onWrite` so ui.ts drops
 * its now-stale cache entry — the next preload or reopen gets fresh data.
 * With no `preloaded` promise supplied (e.g. a caller reached this object
 * some other way), the panel falls back to its own cold fetch, unchanged.
 *
 * The routing decision of whether a send REPLIES to an existing open thread
 * at this exact anchor or OPENS a new one is a pure predicate
 * (`resolveComposerAction`) so it is unit-tested without a DOM, the same
 * discipline targets.ts and preview.ts already follow in this directory.
 *
 * Flat list, no reply-threading UI (parentCommentId exists in the data model
 * but stays unused by this client — explicitly out of scope for this MVP
 * pass).
 */
import { principalName } from '../admin/display-name.js';
import {
  createMarginaliaThread,
  listMarginaliaThreads,
  replyToMarginaliaThread,
  setMarginaliaThreadStatus,
} from '../admin/marginalia-client.js';
import type { MarginaliaThreadStatus, MarginaliaThreadWithComments } from '../../schema/marginalia-v1.js';
import type { GetToken } from './verbs-client.js';

export type MarginaliaPanelTarget = {
  objectType: string;
  objectId: string;
  sectionId?: string;
  nodeId?: string;
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A short scope label for a thread's anchor, relative to nothing in particular — just orientation. */
export const describeMarginaliaAnchor = (anchor: { sectionId?: string; nodeId?: string }): string => {
  if (anchor.sectionId) return `Section ${anchor.sectionId}`;
  if (anchor.nodeId) return `Node ${anchor.nodeId}`;
  return 'Whole object';
};

export const marginaliaStatusLabel = (status: MarginaliaThreadStatus): string =>
  status === 'open' ? 'Open' : status === 'resolved' ? 'Resolved' : 'Dismissed';

/** The toggle button's next action: Open → Resolve; Resolved/Dismissed → Reopen. */
export const nextMarginaliaResolveAction = (
  status: MarginaliaThreadStatus
): { label: string; next: MarginaliaThreadStatus } =>
  status === 'open' ? { label: 'Resolve', next: 'resolved' } : { label: 'Reopen', next: 'open' };

const sameAnchor = (a: { sectionId?: string; nodeId?: string }, target: MarginaliaPanelTarget): boolean =>
  (a.sectionId ?? '') === (target.sectionId ?? '') && (a.nodeId ?? '') === (target.nodeId ?? '');

/**
 * What a composer Send should do: REPLY to the most recently-created OPEN
 * thread anchored to this exact target (section/node), or CREATE a fresh one
 * when none exists. Pure — no fetch, no DOM — so the routing rule is
 * unit-tested directly.
 */
export type ComposerAction = { kind: 'reply'; threadId: string } | { kind: 'create' };

export const resolveComposerAction = (
  threads: readonly MarginaliaThreadWithComments[],
  target: MarginaliaPanelTarget
): ComposerAction => {
  const openAtAnchor = threads.filter((thread) => thread.status === 'open' && sameAnchor(thread.anchor, target));
  const latest = openAtAnchor.at(-1);
  return latest ? { kind: 'reply', threadId: latest.id } : { kind: 'create' };
};

/**
 * Mount the whole Comments section body into `container` (the
 * `[data-em-acc-body="comments"]` element ui.ts owns): fetch threads for
 * `target`, render them, and wire the composer + per-thread resolve toggle.
 * Reuses the SAME `dl-em-log` / `dl-em-composer` CSS classes the Ask AI
 * section already uses, so no new panel chrome is introduced.
 */
export const mountMarginaliaPanel = async (
  container: HTMLElement,
  getToken: GetToken,
  target: MarginaliaPanelTarget,
  preloaded?: Promise<{ threads: MarginaliaThreadWithComments[] }>,
  onWrite?: () => void
): Promise<void> => {
  container.innerHTML =
    `<div class="dl-em-log dl-em-marg-log" data-em-marg-log></div>` +
    `<div class="dl-em-composer"><div class="dl-em-row">` +
    `<textarea class="dl-em-marg-input" data-em-marg-input placeholder="Add a comment…"></textarea>` +
    `<button type="button" class="dl-em-btn dl-em-primary dl-em-send dl-em-ico" data-em-marg-send aria-label="Send comment">Send</button>` +
    `</div></div>`;

  const logEl = container.querySelector<HTMLElement>('[data-em-marg-log]');
  const textarea = container.querySelector<HTMLTextAreaElement>('[data-em-marg-input]');
  const sendButton = container.querySelector<HTMLButtonElement>('[data-em-marg-send]');
  if (!logEl || !textarea || !sendButton) return; // container was torn down mid-mount (panel closed)

  let threads: MarginaliaThreadWithComments[] = [];

  const renderThreads = (): void => {
    if (!logEl.isConnected) return;
    if (threads.length === 0) {
      logEl.innerHTML = `<div class="dl-em-msg dl-em-sys">No comments yet.</div>`;
      return;
    }
    logEl.innerHTML = '';
    for (const thread of threads) {
      const threadEl = document.createElement('div');
      threadEl.className = 'dl-em-marg-thread';
      const action = nextMarginaliaResolveAction(thread.status);
      threadEl.innerHTML =
        `<div class="dl-em-marg-thread-head">` +
        `<span class="dl-em-marg-status dl-em-marg-status-${thread.status}">${escapeHtml(marginaliaStatusLabel(thread.status))}</span>` +
        `<span class="dl-em-marg-scope">${escapeHtml(describeMarginaliaAnchor(thread.anchor))}</span>` +
        `<button type="button" class="dl-em-btn dl-em-ghost dl-em-marg-toggle" data-em-marg-toggle="${escapeHtml(thread.id)}" data-em-marg-next="${action.next}">${escapeHtml(action.label)}</button>` +
        `</div>`;
      for (const comment of thread.comments) {
        const commentEl = document.createElement('div');
        commentEl.className = 'dl-em-msg dl-em-user dl-em-marg-comment';
        commentEl.innerHTML =
          `<div class="dl-em-marg-comment-meta"><strong>${escapeHtml(principalName(comment.author))}</strong> ` +
          `<span class="dl-em-marg-time">${escapeHtml(comment.at)}</span></div>` +
          `<p>${escapeHtml(comment.body)}</p>`;
        threadEl.append(commentEl);
      }
      logEl.append(threadEl);
    }
    logEl.querySelectorAll<HTMLButtonElement>('[data-em-marg-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const threadId = button.dataset.emMargToggle;
        const next = button.dataset.emMargNext as MarginaliaThreadStatus | undefined;
        if (threadId && next) void resolve(threadId, next);
      });
    });
    logEl.scrollTop = logEl.scrollHeight;
  };

  const refresh = async (): Promise<void> => {
    const result = await listMarginaliaThreads(getToken, target.objectType, target.objectId);
    threads = result.threads;
    renderThreads();
  };

  const resolve = async (threadId: string, status: MarginaliaThreadStatus): Promise<void> => {
    await setMarginaliaThreadStatus(getToken, target.objectType, target.objectId, threadId, status);
    onWrite?.();
    await refresh();
  };

  const send = async (): Promise<void> => {
    const body = textarea.value.trim();
    if (!body || sendButton.disabled) return;
    sendButton.disabled = true;
    try {
      const routing = resolveComposerAction(threads, target);
      if (routing.kind === 'reply') {
        await replyToMarginaliaThread(getToken, target.objectType, target.objectId, routing.threadId, body);
      } else {
        await createMarginaliaThread(getToken, target.objectType, target.objectId, body, {
          ...(target.sectionId !== undefined ? { sectionId: target.sectionId } : {}),
          ...(target.nodeId !== undefined ? { nodeId: target.nodeId } : {}),
        });
      }
      textarea.value = '';
      onWrite?.();
      await refresh();
    } finally {
      sendButton.disabled = false;
    }
  };

  sendButton.addEventListener('click', () => void send());
  textarea.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void send();
    }
  });

  logEl.innerHTML = `<div class="dl-em-msg dl-em-sys">Loading comments…</div>`;
  if (preloaded) {
    const result = await preloaded;
    threads = result.threads;
    renderThreads();
  } else {
    await refresh();
  }
};
