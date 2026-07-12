/**
 * Edit-mode canvas — the on-page overlay (admin-only, loaded on demand).
 *
 * The site itself is the editing surface: every annotated section gets a
 * hover chip with "Ask AI"; a request opens a docked panel; the suggestion
 * previews IN PLACE as an amber draft; Accept persists it through the
 * reviewable object_patch path (checkout → patch, EditSession); Publish and
 * Release stay separate, deliberate acts in the pending tray — the same
 * draft → publish → release lifecycle every agent follows, driven by a human
 * on the live page.
 *
 * Article bodies are NOT edited here (OQ-8: the article pipeline is its own
 * system); only object-backed sections carry annotations, so article prose
 * simply never grows a chip.
 *
 * Remount-safe for Astro view transitions: a body swap removes the injected
 * chrome, so boot calls mountEditMode again — the previous mount's
 * document-level listeners die with its AbortController, and object sessions
 * (locks!) live at module scope so a swap never orphans a held lease.
 *
 * DOM-heavy by nature — the routing/merge logic it drives lives in the pure,
 * unit-tested modules (targets.ts, preview.ts, verbs-client.ts).
 */
import { captureObjectSelection } from '../admin/ask-ai-object-selection.js';
import {
  changedFieldsOnly,
  deriveEditTarget,
  suggestionToOps,
  summarizeFieldChanges,
  type EditTarget,
  type FieldChange,
} from './targets.js';
import { previewFieldChange, restoreRegion, snapshotRegion, type RegionSnapshot } from './preview.js';
import {
  askAiSuggestion,
  canExecutePublish,
  EditSession,
  fetchPendingObjects,
  getObjectRecord,
  releaseToProduction,
  type GetToken,
  type PendingObjectRow,
} from './verbs-client.js';

const REGION_SELECTOR = '[data-cms-section-id]';
const MODE_KEY = 'dl-edit-mode';

export type MountOptions = { email: string; roles: string[]; getToken: GetToken };

type PanelState = {
  target: EditTarget;
  region: HTMLElement;
  /** The section's data in the DRAFT record (source of truth for diffs). */
  currentData: Record<string, unknown>;
  /** The instance id the PATCH scopes to (inner id for shared objects). */
  patchSectionId: string;
  selectedText?: string;
  suggestion?: Record<string, unknown>;
  changes?: FieldChange[];
  snapshot?: RegionSnapshot;
};

// Locks survive view-transition remounts: sessions are module state, not mount state.
const sessions = new Map<string, EditSession>();
let activeController: AbortController | undefined;

// The canvas chrome themes itself from the PROJECT it is editing: every color
// and font is the site's own --aw-* design token (rendered by CustomStyles from
// the site object's brandTokens), so the overlay matches whatever site it runs
// on and flips light/dark automatically (the --aw-* vars are redefined under
// .dark). The --dlem-* layer maps each need to a token with a hardcoded
// fallback, so it still renders on a project that lacks the tokens. Semantic
// states reuse palette members that read as those states: gold=draft/pending,
// accent(green)=save/ok, secondary(rust)=delete/danger, primary=action.
const STYLES = `
:root{
  --dlem-accent:var(--aw-color-primary,rgb(20 122 140));
  --dlem-accent-ink:#fff;
  --dlem-surface:var(--aw-color-bg-page,#fff);
  --dlem-surface-2:var(--aw-color-bg-surface,#f1f5f4);
  --dlem-text:var(--aw-color-text-default,rgb(36 41 46));
  --dlem-heading:var(--aw-color-text-heading,rgb(18 33 38));
  --dlem-muted:var(--aw-color-text-muted,rgb(58 65 73 / 76%));
  --dlem-border:color-mix(in srgb,var(--aw-color-text-muted,rgb(58 65 73)) 24%,transparent);
  --dlem-draft:var(--aw-color-gold,#b45309);
  --dlem-ok:var(--aw-color-accent,#15803d);
  --dlem-danger:var(--aw-color-secondary,#b91c1c);
  --dlem-font:var(--aw-font-sans,ui-sans-serif,system-ui,sans-serif);
  --dlem-font-head:var(--aw-font-heading,var(--dlem-font));
  --dlem-shadow:0 14px 40px rgba(0,0,0,.24);
}
.dl-em-bar{position:fixed;top:0;left:0;right:0;z-index:99990;display:none;align-items:center;gap:10px;
  padding:6px 14px;background:var(--dlem-surface-2);color:var(--dlem-text);font:600 12.5px/1.4 var(--dlem-font);
  border-bottom:1px solid var(--dlem-border);box-shadow:0 2px 12px rgba(0,0,0,.12)}
body.dl-em-on .dl-em-bar{display:flex}
body.dl-em-on{padding-top:38px}
.dl-em-bar .dl-em-dot{width:8px;height:8px;border-radius:50%;background:var(--dlem-accent);flex:none}
.dl-em-bar .dl-em-who{color:var(--dlem-muted);font-weight:400}
.dl-em-bar .dl-em-status{flex:1;text-align:center;color:var(--dlem-muted);font-weight:400;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.dl-em-btn{border:1px solid var(--dlem-border);border-radius:6px;background:transparent;color:var(--dlem-text);
  padding:4px 10px;font:600 12px var(--dlem-font);cursor:pointer}
.dl-em-btn:hover{border-color:var(--dlem-accent);color:var(--dlem-accent)}
.dl-em-btn.dl-em-primary{background:var(--dlem-accent);border-color:var(--dlem-accent);color:var(--dlem-accent-ink)}
.dl-em-btn.dl-em-primary:hover{filter:brightness(1.08);color:var(--dlem-accent-ink)}
.dl-em-btn:disabled{opacity:.5;cursor:not-allowed}
.dl-em-count{display:inline-flex;min-width:17px;height:17px;align-items:center;justify-content:center;
  margin-left:6px;padding:0 5px;border-radius:9px;background:color-mix(in srgb,var(--dlem-text) 40%,transparent);
  color:var(--dlem-surface);font-size:10.5px}
.dl-em-count.dl-em-hot{background:var(--dlem-draft);color:#fff}
.dl-em-fab{position:fixed;right:18px;bottom:18px;z-index:99990;width:44px;height:44px;border-radius:50%;
  border:none;background:var(--dlem-accent);color:var(--dlem-accent-ink);font:18px var(--dlem-font);cursor:pointer;
  box-shadow:var(--dlem-shadow)}
body.dl-em-on .dl-em-fab{display:none}
body.dl-em-on [data-cms-section-id].dl-em-hot>*{outline:2px solid color-mix(in srgb,var(--dlem-accent) 60%,transparent);outline-offset:6px;border-radius:2px}
body.dl-em-on [data-cms-section-id].dl-em-focus>*{outline:2px solid var(--dlem-accent);outline-offset:6px}
body.dl-em-on [data-cms-section-id].dl-em-draft>*{outline:2px dashed var(--dlem-draft);outline-offset:6px}
.dl-em-chip{position:fixed;z-index:99991;display:none;align-items:center;gap:8px;padding:4px 6px 4px 10px;
  border-radius:7px;background:var(--dlem-accent);color:var(--dlem-accent-ink);font:600 11.5px var(--dlem-font);
  box-shadow:var(--dlem-shadow)}
.dl-em-chip .dl-em-id{font:400 10.5px ui-monospace,monospace;color:color-mix(in srgb,var(--dlem-accent-ink) 78%,transparent)}
.dl-em-chip .dl-em-shared{background:color-mix(in srgb,var(--dlem-accent-ink) 22%,transparent);border-radius:4px;padding:1px 6px;font-size:10px}
.dl-em-chip .dl-em-draftflag{background:var(--dlem-draft);border-radius:4px;padding:1px 6px;font-size:10px;color:#fff}
.dl-em-chip .dl-em-ask{border:none;border-radius:5px;background:var(--dlem-surface);color:var(--dlem-accent);padding:3px 9px;
  font:700 11.5px var(--dlem-font);cursor:pointer}
.dl-em-chip .dl-em-ask.dl-em-sel{background:var(--dlem-draft);color:#3a2b00}
.dl-em-panel{position:fixed;top:46px;right:12px;bottom:12px;width:380px;max-width:calc(100vw - 24px);
  z-index:99992;display:none;flex-direction:column;background:var(--dlem-surface);color:var(--dlem-text);
  border:1px solid var(--dlem-border);border-radius:12px;box-shadow:var(--dlem-shadow);font:13px/1.5 var(--dlem-font)}
.dl-em-panel.dl-em-open{display:flex}
.dl-em-panel header{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-bottom:1px solid var(--dlem-border)}
.dl-em-panel header .dl-em-t{flex:1;min-width:0}
.dl-em-panel header .dl-em-title{font:700 14px var(--dlem-font-head);color:var(--dlem-heading)}
.dl-em-panel header .dl-em-scope{font-size:11.5px;color:var(--dlem-muted);margin-top:2px;overflow-wrap:anywhere}
.dl-em-close{border:none;background:none;color:inherit;font-size:15px;cursor:pointer;padding:2px 6px}
.dl-em-log{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.dl-em-msg{max-width:92%;padding:8px 11px;border-radius:9px;font-size:12.5px}
.dl-em-msg.dl-em-user{align-self:flex-end;background:var(--dlem-accent);color:var(--dlem-accent-ink);border-bottom-right-radius:3px}
.dl-em-msg.dl-em-ai{align-self:flex-start;background:var(--dlem-surface-2);border:1px solid var(--dlem-border);border-bottom-left-radius:3px}
.dl-em-msg.dl-em-sys{align-self:center;background:none;color:var(--dlem-muted);font-size:11px;text-align:center}
.dl-em-diff{border:1px solid var(--dlem-border);border-radius:8px;padding:8px 10px;font-size:12px;margin-top:6px}
.dl-em-diff .dl-em-field{font:700 10.5px ui-monospace,monospace;margin-bottom:2px;color:var(--dlem-muted)}
.dl-em-diff del{background:color-mix(in srgb,var(--dlem-danger) 14%,transparent);color:var(--dlem-danger);text-decoration:line-through;border-radius:2px}
.dl-em-diff ins{background:color-mix(in srgb,var(--dlem-ok) 16%,transparent);color:var(--dlem-ok);text-decoration:none;border-radius:2px}
.dl-em-diff .dl-em-noprev{color:var(--dlem-draft);font-size:10.5px}
.dl-em-actions{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--dlem-border)}
.dl-em-actions .dl-em-btn{border-color:var(--dlem-accent);background:var(--dlem-accent);color:var(--dlem-accent-ink)}
.dl-em-actions .dl-em-accept{background:var(--dlem-ok);border-color:var(--dlem-ok)}
.dl-em-actions .dl-em-btn.dl-em-ghost{background:transparent;color:var(--dlem-text);border-color:var(--dlem-border)}
.dl-em-composer{padding:10px 14px 12px;border-top:1px solid var(--dlem-border)}
.dl-em-composer .dl-em-row{display:flex;gap:8px}
.dl-em-composer textarea{flex:1;height:58px;resize:none;border:1px solid var(--dlem-border);border-radius:8px;
  padding:7px 9px;font:12.5px/1.45 var(--dlem-font);background:var(--dlem-surface);color:var(--dlem-text)}
.dl-em-composer textarea:focus{outline:2px solid var(--dlem-accent);outline-offset:1px;border-color:transparent}
.dl-em-hint{font-size:10.5px;color:var(--dlem-muted);margin-top:6px}
.dl-em-tray{position:fixed;top:44px;right:12px;width:420px;max-width:calc(100vw - 24px);z-index:99992;display:none;
  flex-direction:column;background:var(--dlem-surface);color:var(--dlem-text);border:1px solid var(--dlem-border);
  border-radius:12px;box-shadow:var(--dlem-shadow);font:12.5px/1.5 var(--dlem-font)}
.dl-em-tray.dl-em-open{display:flex}
.dl-em-tray header{padding:11px 14px;font:700 13px var(--dlem-font-head);color:var(--dlem-heading);border-bottom:1px solid var(--dlem-border)}
.dl-em-tray .dl-em-rows{max-height:50vh;overflow-y:auto}
.dl-em-tray .dl-em-row2{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--dlem-border)}
.dl-em-tray .dl-em-meta{flex:1;min-width:0}
.dl-em-tray .dl-em-oid{font:600 11px ui-monospace,monospace;color:var(--dlem-accent)}
.dl-em-tray .dl-em-note{font-size:11px;color:var(--dlem-muted)}
.dl-em-tray footer{display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--dlem-border)}
.dl-em-tray footer .dl-em-deploy{flex:1;font-size:11px;color:var(--dlem-muted)}
.dl-em-tray .dl-em-btn.dl-em-primary{background:var(--dlem-accent);border-color:var(--dlem-accent);color:var(--dlem-accent-ink)}
@media (max-width:720px){.dl-em-panel{top:auto;left:10px;right:10px;bottom:10px;width:auto;max-height:62vh}}
`;

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const shortValue = (value: unknown): string => {
  const text = typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ') : JSON.stringify(value);
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > 220 ? `${normalized.slice(0, 220)}…` : normalized;
};

/** Union of the child boxes — display:contents regions generate no box themselves. */
const regionRect = (region: HTMLElement): DOMRect | undefined => {
  let rect: DOMRect | undefined;
  for (const child of Array.from(region.children)) {
    const box = (child as HTMLElement).getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    if (!rect) {
      rect = DOMRect.fromRect(box);
      continue;
    }
    const left = Math.min(rect.left, box.left);
    const top = Math.min(rect.top, box.top);
    const right = Math.max(rect.right, box.right);
    const bottom = Math.max(rect.bottom, box.bottom);
    rect = new DOMRect(left, top, right - left, bottom - top);
  }
  return rect;
};

export const mountEditMode = (options: MountOptions): void => {
  if (document.querySelector('.dl-em-bar')) return; // singleton per document
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const signal = controller.signal;

  const { email, roles, getToken } = options;
  const allowPublish = canExecutePublish(roles);

  if (!document.getElementById('dl-em-styles')) {
    const style = document.createElement('style');
    style.id = 'dl-em-styles';
    style.textContent = STYLES;
    document.head.append(style);
  }

  // ── chrome ────────────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'dl-em-bar';
  bar.innerHTML =
    `<span class="dl-em-dot"></span><span>Edit mode</span>` +
    `<span class="dl-em-who">${escapeHtml(email)}</span>` +
    `<span class="dl-em-status" data-em-status></span>` +
    `<button class="dl-em-btn" data-em-tray-toggle>Pending<span class="dl-em-count" data-em-count>0</span></button>` +
    `<button class="dl-em-btn dl-em-primary" data-em-release ${allowPublish ? '' : 'disabled title="Requires publisher role"'}>Release to production</button>` +
    `<button class="dl-em-btn" data-em-exit>Exit</button>`;
  document.body.append(bar);

  const fab = document.createElement('button');
  fab.className = 'dl-em-fab';
  fab.title = 'Edit this page (admin)';
  fab.setAttribute('aria-label', 'Enter edit mode');
  fab.textContent = '✎';
  document.body.append(fab);

  const chip = document.createElement('div');
  chip.className = 'dl-em-chip';
  document.body.append(chip);

  const panel = document.createElement('div');
  panel.className = 'dl-em-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Ask AI');
  panel.innerHTML =
    `<header><div class="dl-em-t"><div class="dl-em-title">✨ Ask AI</div>` +
    `<div class="dl-em-scope" data-em-scope></div></div>` +
    `<button class="dl-em-close" data-em-panel-close aria-label="Close">✕</button></header>` +
    `<div class="dl-em-log" data-em-log></div>` +
    `<div class="dl-em-actions" data-em-suggestion-actions hidden>` +
    `<button class="dl-em-btn dl-em-accept" data-em-accept>Accept → save draft</button>` +
    `<button class="dl-em-btn dl-em-ghost" data-em-discard>Discard</button></div>` +
    `<div class="dl-em-composer"><div class="dl-em-row">` +
    `<textarea data-em-input placeholder="Describe the change you want…"></textarea>` +
    `<button class="dl-em-btn dl-em-primary" data-em-send>Send</button></div>` +
    `<div class="dl-em-hint">Select text on the page first to scope the request to that passage. ` +
    `Accept saves a draft — publishing stays a separate step.</div></div>`;
  document.body.append(panel);

  const tray = document.createElement('div');
  tray.className = 'dl-em-tray';
  tray.innerHTML =
    `<header>Pending changes — drafts and unreleased publishes</header>` +
    `<div class="dl-em-rows" data-em-rows></div>` +
    `<footer><span class="dl-em-deploy" data-em-deploy>Publish commits to the repo without deploying; Release runs one deploy for everything.</span>` +
    `<button class="dl-em-btn dl-em-primary" data-em-tray-release ${allowPublish ? '' : 'disabled'}>Release</button></footer>`;
  document.body.append(tray);

  const q = <T extends HTMLElement>(root: ParentNode, selector: string): T => root.querySelector(selector) as T;
  const statusEl = q<HTMLElement>(bar, '[data-em-status]');
  const countEl = q<HTMLElement>(bar, '[data-em-count]');
  const logEl = q<HTMLElement>(panel, '[data-em-log]');
  const scopeEl = q<HTMLElement>(panel, '[data-em-scope]');
  const inputEl = q<HTMLTextAreaElement>(panel, '[data-em-input]');
  const suggestionActions = q<HTMLElement>(panel, '[data-em-suggestion-actions]');
  const rowsEl = q<HTMLElement>(tray, '[data-em-rows]');
  const deployEl = q<HTMLElement>(tray, '[data-em-deploy]');

  const setStatus = (text: string): void => {
    statusEl.textContent = text;
  };

  const log = (kind: 'user' | 'ai' | 'sys', html: string): HTMLElement => {
    const message = document.createElement('div');
    message.className = `dl-em-msg dl-em-${kind}`;
    message.innerHTML = html;
    logEl.append(message);
    logEl.scrollTop = logEl.scrollHeight;
    return message;
  };

  const session = (objectType: string, objectId: string): EditSession => {
    const key = `${objectType}:${objectId}`;
    let existing = sessions.get(key);
    if (!existing) {
      existing = new EditSession(objectType, objectId, getToken);
      sessions.set(key, existing);
    }
    return existing;
  };

  let pendingRows: PendingObjectRow[] = [];
  const refreshPending = async (): Promise<void> => {
    pendingRows = await fetchPendingObjects(getToken);
    countEl.textContent = String(pendingRows.length);
    countEl.classList.toggle('dl-em-hot', pendingRows.length > 0);
    renderTray();
    markDraftRegions();
  };

  const targetObjectIdOf = (region: HTMLElement): string | undefined =>
    deriveEditTarget(region.dataset as Record<string, string>)?.objectId;

  const markDraftRegions = (): void => {
    const draftIds = new Set(pendingRows.filter((row) => row.unpublished_changes).map((row) => row.object_id));
    document.querySelectorAll<HTMLElement>(REGION_SELECTOR).forEach((region) => {
      const objectId = targetObjectIdOf(region);
      region.classList.toggle('dl-em-draft', Boolean(objectId && draftIds.has(objectId)));
    });
  };

  // ── tray ──────────────────────────────────────────────────────────────────
  const renderTray = (): void => {
    rowsEl.innerHTML = '';
    if (pendingRows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dl-em-row2';
      empty.innerHTML =
        '<span class="dl-em-note">Nothing waiting. Accepted edits appear here as unpublished drafts.</span>';
      rowsEl.append(empty);
      return;
    }
    for (const row of pendingRows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'dl-em-row2';
      const gateNote = row.requires_approval && row.review_state !== 'approved' ? ' · needs review approval' : '';
      const lockNote = row.lock.held ? ` · locked by ${row.lock.owner_label ?? 'someone'}` : '';
      rowEl.innerHTML =
        `<div class="dl-em-meta"><div class="dl-em-oid">${escapeHtml(row.object_id)}</div>` +
        `<div class="dl-em-note">${row.published_time ? 'changed since last publish' : 'never published'}${gateNote}${escapeHtml(lockNote)}</div></div>`;
      const publishBtn = document.createElement('button');
      publishBtn.className = 'dl-em-btn';
      publishBtn.textContent = 'Publish';
      publishBtn.disabled = !allowPublish;
      publishBtn.addEventListener('click', async () => {
        publishBtn.disabled = true;
        publishBtn.textContent = 'Publishing…';
        const objectSession = session(row.object_type, row.object_id);
        const checkout = await objectSession.ensureCheckout();
        if (!checkout.ok) {
          publishBtn.textContent = 'Publish';
          publishBtn.disabled = false;
          setStatus(`Locked by ${checkout.heldBy ?? 'another editor'} — try again later.`);
          return;
        }
        const result = await objectSession.publish();
        await objectSession.checkin();
        if (result.status === 200) {
          setStatus(`${row.object_id} published — committed, not yet deployed. Release when ready.`);
          await refreshPending();
        } else {
          setStatus(`${row.object_id}: ${(result.body.error as string) ?? `publish failed (${result.status})`}`);
          publishBtn.textContent = 'Publish';
          publishBtn.disabled = false;
        }
      });
      rowEl.append(publishBtn);
      rowsEl.append(rowEl);
    }
  };

  const doRelease = async (button: HTMLButtonElement): Promise<void> => {
    button.disabled = true;
    deployEl.textContent = 'Build hook fired — deploy running…';
    setStatus('Releasing to production…');
    const release = await releaseToProduction(getToken);
    const status = release.result?.status ?? `HTTP ${release.status}`;
    deployEl.textContent =
      status === 'released'
        ? '✓ Live — the deploy is ready.'
        : `Release status: ${status}${release.result?.detail ? ` — ${release.result.detail}` : ''}`;
    setStatus(status === 'released' ? 'Released — the site is current.' : `Release: ${status}`);
    button.disabled = !allowPublish;
  };
  q<HTMLButtonElement>(tray, '[data-em-tray-release]').addEventListener('click', (event) =>
    doRelease(event.currentTarget as HTMLButtonElement)
  );
  q<HTMLButtonElement>(bar, '[data-em-release]').addEventListener('click', (event) => {
    tray.classList.add('dl-em-open');
    void doRelease(event.currentTarget as HTMLButtonElement);
  });
  q<HTMLButtonElement>(bar, '[data-em-tray-toggle]').addEventListener('click', () => {
    tray.classList.toggle('dl-em-open');
    panel.classList.remove('dl-em-open');
  });

  // ── edit-mode toggling ────────────────────────────────────────────────────
  const setEditMode = (on: boolean): void => {
    document.body.classList.toggle('dl-em-on', on);
    try {
      sessionStorage.setItem(MODE_KEY, on ? '1' : '0');
    } catch {
      /* ignored */
    }
    if (on) {
      void refreshPending();
    } else {
      chip.style.display = 'none';
      panel.classList.remove('dl-em-open');
      tray.classList.remove('dl-em-open');
      for (const objectSession of sessions.values()) void objectSession.checkin();
    }
  };
  fab.addEventListener('click', () => setEditMode(true));
  q<HTMLButtonElement>(bar, '[data-em-exit]').addEventListener('click', () => setEditMode(false));

  // ── hover chip ────────────────────────────────────────────────────────────
  let hotRegion: HTMLElement | undefined;
  let chipHideTimer: number | undefined;

  const positionChip = (region: HTMLElement): void => {
    const rect = regionRect(region);
    if (!rect) return;
    chip.style.display = 'flex';
    chip.style.left = `${Math.max(8, rect.left + 6)}px`;
    chip.style.top = `${Math.max(42, rect.top - 14)}px`;
  };

  const renderChip = (region: HTMLElement): void => {
    const target = deriveEditTarget(region.dataset as Record<string, string>);
    if (!target) return;
    const hasSelection = Boolean(currentSelectionText && selectionRegion === region);
    const isDraft = region.classList.contains('dl-em-draft');
    chip.innerHTML =
      `<span>${escapeHtml(target.sectionType)}</span>` +
      `<span class="dl-em-id">${escapeHtml(target.objectId)}</span>` +
      (target.shared ? `<span class="dl-em-shared">shared</span>` : '') +
      (isDraft ? `<span class="dl-em-draftflag">draft</span>` : '') +
      `<button class="dl-em-ask${hasSelection ? ' dl-em-sel' : ''}">✨ Ask AI${hasSelection ? ' about selection' : ''}</button>`;
    chip.querySelector('button')?.addEventListener('click', () => {
      void openPanel(target, region);
    });
    positionChip(region);
  };

  const clearChipSoon = (): void => {
    window.clearTimeout(chipHideTimer);
    chipHideTimer = window.setTimeout(() => {
      chip.style.display = 'none';
      hotRegion?.classList.remove('dl-em-hot');
      hotRegion = undefined;
    }, 250);
  };

  document.addEventListener(
    'mouseover',
    (event) => {
      if (!document.body.classList.contains('dl-em-on')) return;
      const element = event.target as HTMLElement;
      if (chip.contains(element)) {
        window.clearTimeout(chipHideTimer);
        return;
      }
      const region = element.closest<HTMLElement>(REGION_SELECTOR);
      if (!region) {
        clearChipSoon();
        return;
      }
      window.clearTimeout(chipHideTimer);
      if (region !== hotRegion) {
        hotRegion?.classList.remove('dl-em-hot');
        hotRegion = region;
        region.classList.add('dl-em-hot');
        renderChip(region);
      }
    },
    { signal }
  );
  document.addEventListener(
    'scroll',
    () => {
      if (hotRegion && chip.style.display !== 'none') positionChip(hotRegion);
    },
    { passive: true, signal }
  );

  // ── selection tracking ────────────────────────────────────────────────────
  let currentSelectionText: string | undefined;
  let selectionRegion: HTMLElement | undefined;
  document.addEventListener(
    'mouseup',
    (event) => {
      if (!document.body.classList.contains('dl-em-on')) return;
      // A mouseup on the chip itself must not re-render it: the click event
      // dispatches AFTER mouseup, and re-rendering would replace the Ask-AI
      // button before its click listener ever fires.
      if (chip.contains(event.target as Node)) return;
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const anchorElement =
        anchor && anchor.nodeType === Node.ELEMENT_NODE ? (anchor as HTMLElement) : (anchor?.parentElement ?? null);
      const region = anchorElement?.closest<HTMLElement>(REGION_SELECTOR) ?? undefined;
      currentSelectionText = region ? captureObjectSelection(region) : undefined;
      selectionRegion = currentSelectionText ? region : undefined;
      if (hotRegion) renderChip(hotRegion);
    },
    { signal }
  );

  // ── panel ─────────────────────────────────────────────────────────────────
  let panelState: PanelState | undefined;

  const closePanel = (): void => {
    panel.classList.remove('dl-em-open');
    panelState?.region.classList.remove('dl-em-focus');
    panelState = undefined;
  };
  q<HTMLButtonElement>(panel, '[data-em-panel-close]').addEventListener('click', closePanel);

  const openPanel = async (target: EditTarget, region: HTMLElement): Promise<void> => {
    if (panelState?.snapshot) restoreRegion(panelState.snapshot);
    closePanel();
    tray.classList.remove('dl-em-open');
    region.classList.add('dl-em-focus');
    logEl.innerHTML = '';
    suggestionActions.hidden = true;

    const selected = selectionRegion === region ? currentSelectionText : undefined;
    scopeEl.textContent =
      `${target.sectionType} · ${target.objectId}` +
      (target.shared ? ' (shared — edits affect every page using it)' : '') +
      (selected ? ` · selection: “${selected.slice(0, 60)}${selected.length > 60 ? '…' : ''}”` : ' · whole section');
    panel.classList.add('dl-em-open');
    inputEl.value = '';
    inputEl.focus();

    log('sys', 'Reading the object record…');
    const { status, record } = await getObjectRecord(getToken, target.objectType, target.objectId);
    if (status !== 200 || !record) {
      log('sys', `Could not load ${escapeHtml(target.objectId)} (HTTP ${status}). Is it store-backed?`);
      return;
    }
    const body = record.body as Record<string, unknown>;
    let currentData: Record<string, unknown> | undefined;
    let patchSectionId: string | undefined;
    if (target.objectType === 'page') {
      const sectionList = (body.sections as Array<{ id: string; data: Record<string, unknown> }> | undefined) ?? [];
      const instance = sectionList.find((entry) => entry.id === target.sectionId);
      currentData = instance?.data;
      patchSectionId = instance?.id;
    } else {
      const inner = body.section as { id: string; data: Record<string, unknown> } | undefined;
      currentData = inner?.data;
      patchSectionId = inner?.id;
    }
    if (!currentData || !patchSectionId) {
      log('sys', 'This section is not in the draft record — it may be newer than the store. Edit via /admin/objects.');
      return;
    }
    panelState = { target, region, currentData, patchSectionId, selectedText: selected };
    logEl.innerHTML = '';
    log(
      'sys',
      `Editing ${escapeHtml(target.sectionType)} on ${escapeHtml(target.objectId)}. ` +
        'Suggestions preview in place as a draft; nothing publishes from here.'
    );
  };

  const renderDiff = (changes: FieldChange[], previewed: Map<string, boolean>): void => {
    const container = document.createElement('div');
    container.className = 'dl-em-msg dl-em-ai';
    for (const change of changes) {
      const entry = document.createElement('div');
      entry.className = 'dl-em-diff';
      entry.innerHTML =
        `<div class="dl-em-field">${escapeHtml(change.field)}</div>` +
        `<del>${escapeHtml(shortValue(change.before))}</del><br>` +
        `<ins>${escapeHtml(shortValue(change.after))}</ins>` +
        (previewed.get(change.field) === false
          ? '<div class="dl-em-noprev">Not previewable in place — shown here only; Accept still applies it.</div>'
          : '');
      container.append(entry);
    }
    logEl.append(container);
    logEl.scrollTop = logEl.scrollHeight;
  };

  const send = async (): Promise<void> => {
    const state = panelState;
    const instruction = inputEl.value.trim();
    if (!state || !instruction) return;
    if (state.snapshot) {
      restoreRegion(state.snapshot);
      state.snapshot = undefined;
      state.suggestion = undefined;
      state.changes = undefined;
      suggestionActions.hidden = true;
    }
    log('user', escapeHtml(instruction));
    inputEl.value = '';
    const working = log('sys', 'Thinking…');

    const response = await askAiSuggestion(getToken, {
      object_type: state.target.objectType,
      object_id: state.target.objectId,
      ...(state.target.objectType === 'page' ? { section_id: state.target.sectionId } : {}),
      ...(state.selectedText ? { selected_text: state.selectedText } : {}),
      instruction,
    });
    working.remove();
    if (!response.ok || !response.suggestion) {
      log('sys', escapeHtml(response.error ?? `Ask-AI failed (HTTP ${response.status})`));
      return;
    }
    const changes = summarizeFieldChanges(state.currentData, response.suggestion);
    if (changes.length === 0) {
      log('ai', 'No changes proposed — the current content already satisfies that instruction.');
      return;
    }
    state.suggestion = changedFieldsOnly(changes);
    state.changes = changes;
    state.snapshot = snapshotRegion(state.region);
    const previewed = new Map<string, boolean>();
    for (const change of changes) {
      previewed.set(change.field, previewFieldChange(state.region, change.kind, change.before, change.after));
    }
    state.region.classList.add('dl-em-draft');
    log(
      'ai',
      `Proposed ${changes.length} field change${changes.length > 1 ? 's' : ''} — previewing in place as a draft.`
    );
    renderDiff(changes, previewed);
    suggestionActions.hidden = false;
  };
  q<HTMLButtonElement>(panel, '[data-em-send]').addEventListener('click', () => void send());
  inputEl.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void send();
  });

  q<HTMLButtonElement>(panel, '[data-em-accept]').addEventListener('click', async () => {
    const state = panelState;
    if (!state?.suggestion) return;
    suggestionActions.hidden = true;
    const working = log('sys', 'Saving draft (checkout → patch)…');
    const objectSession = session(state.target.objectType, state.target.objectId);
    const checkout = await objectSession.ensureCheckout();
    if (!checkout.ok) {
      working.remove();
      log('sys', `Locked by ${escapeHtml(checkout.heldBy ?? 'another editor')} — try again when the lock frees.`);
      suggestionActions.hidden = false;
      return;
    }
    const ops = suggestionToOps(state.target, state.suggestion, state.patchSectionId);
    const outcome = await objectSession.patch(ops);
    working.remove();
    if (!outcome.ok) {
      const blockers = outcome.blockers?.length ? `<br>${outcome.blockers.map(escapeHtml).join('<br>')}` : '';
      log('sys', `Not saved: ${escapeHtml(outcome.error)}${blockers}`);
      suggestionActions.hidden = false;
      return;
    }
    Object.assign(state.currentData, state.suggestion);
    state.suggestion = undefined;
    state.changes = undefined;
    state.snapshot = undefined; // the preview is now the draft — keep it on screen
    log('sys', 'Draft saved — <strong>not published</strong>. Publish from the Pending tray when ready.');
    setStatus(`${state.target.objectId}: draft saved.`);
    await refreshPending();
  });

  q<HTMLButtonElement>(panel, '[data-em-discard]').addEventListener('click', () => {
    const state = panelState;
    if (!state) return;
    if (state.snapshot) restoreRegion(state.snapshot);
    state.snapshot = undefined;
    state.suggestion = undefined;
    state.changes = undefined;
    markDraftRegions(); // restore the true draft flags after the preview styling
    suggestionActions.hidden = true;
    log('sys', 'Suggestion discarded — nothing was saved.');
  });

  // ── activation ────────────────────────────────────────────────────────────
  let savedMode = '0';
  try {
    savedMode = sessionStorage.getItem(MODE_KEY) ?? '0';
  } catch {
    /* ignored */
  }
  if (savedMode === '1') setEditMode(true);
};
