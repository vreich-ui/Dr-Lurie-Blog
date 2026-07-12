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
import { SECTION_PALETTE, insertPositionFor } from './sections-palette.js';
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

/** What the panel is doing: AI chat, manual text form, or the image tool. */
type PanelMode = 'ai' | 'edit' | 'image';

type PanelState = {
  target: EditTarget;
  region: HTMLElement;
  mode: PanelMode;
  /** The section's data in the DRAFT record (source of truth for diffs). */
  currentData: Record<string, unknown>;
  /** The instance id the PATCH scopes to (inner id for shared objects). */
  patchSectionId: string;
  selectedText?: string;
  suggestion?: Record<string, unknown>;
  changes?: FieldChange[];
  snapshot?: RegionSnapshot;
};

/** Section types whose data carries an image the image tool should offer. */
const IMAGE_SECTION_TYPES = new Set(['bio']);

/**
 * Manual-edit field selection (client-side heuristic): copy fields only.
 * Media/asset/link/binding keys are excluded here for the same reason the AI
 * schema strips them — except the image tool, which edits image fields
 * DELIBERATELY through its own dedicated form.
 */
const NON_COPY_KEY_RE = /asset|image|portrait|logo|icon|src|url|href|route|anchor|formname|ogimage/i;

const isImageValue = (value: unknown): value is { src: string; alt?: string } =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof (value as { src?: unknown }).src === 'string';

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
  /* The sparkle stars: deliberately brighter than the rest of the toolbar so
     the AI action reads first (Wolf, 2026-07-12). Gold, lifted toward white. */
  --dlem-spark:color-mix(in srgb,var(--aw-color-gold,#e8be70) 78%,#fff);
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
.dl-em-chip{position:fixed;z-index:99991;display:none;align-items:center;gap:7px;padding:4px 6px 4px 10px;
  border-radius:7px;background:var(--dlem-accent);color:var(--dlem-accent-ink);font:600 11.5px var(--dlem-font);
  box-shadow:var(--dlem-shadow)}
.dl-em-chip .dl-em-id{font:400 10.5px ui-monospace,monospace;color:color-mix(in srgb,var(--dlem-accent-ink) 78%,transparent)}
.dl-em-chip .dl-em-shared{background:color-mix(in srgb,var(--dlem-accent-ink) 22%,transparent);border-radius:4px;padding:1px 6px;font-size:10px}
.dl-em-chip .dl-em-draftflag{background:var(--dlem-draft);border-radius:4px;padding:1px 6px;font-size:10px;color:#fff}
.dl-em-chip .dl-em-tools{display:flex;gap:2px;margin-left:2px;padding-left:7px;
  border-left:1px solid color-mix(in srgb,var(--dlem-accent-ink) 25%,transparent)}
.dl-em-chip .dl-em-tool{display:inline-flex;align-items:center;justify-content:center;width:26px;height:24px;
  border:none;border-radius:5px;background:transparent;color:var(--dlem-accent-ink);cursor:pointer;padding:0}
.dl-em-chip .dl-em-tool:hover{background:color-mix(in srgb,var(--dlem-accent-ink) 18%,transparent)}
.dl-em-chip .dl-em-tool svg{display:block}
.dl-em-chip .dl-em-ask.dl-em-sel{background:color-mix(in srgb,var(--dlem-spark) 30%,transparent);
  box-shadow:0 0 0 1.5px var(--dlem-spark)}
.dl-em-gaplayer{position:absolute;top:0;left:0;width:100%;height:0;z-index:99989;display:none;pointer-events:none}
body.dl-em-on .dl-em-gaplayer{display:block}
.dl-em-gap{position:absolute;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:50%;
  display:inline-flex;align-items:center;justify-content:center;pointer-events:auto;cursor:pointer;
  border:1px solid color-mix(in srgb,var(--dlem-accent) 45%,transparent);background:var(--dlem-surface);
  color:var(--dlem-accent);opacity:.45;transition:opacity .12s,transform .12s;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.dl-em-gap:hover{opacity:1;transform:translate(-50%,-50%) scale(1.15);border-color:var(--dlem-accent)}
.dl-em-pal{position:fixed;z-index:99993;min-width:230px;padding:5px;background:var(--dlem-surface);
  color:var(--dlem-text);border:1px solid var(--dlem-border);border-radius:10px;box-shadow:var(--dlem-shadow);
  font:12.5px/1.45 var(--dlem-font)}
.dl-em-pal .dl-em-palhead{padding:5px 9px 7px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--dlem-muted)}
.dl-em-pal button{display:block;width:100%;text-align:left;border:none;background:transparent;color:inherit;
  padding:7px 9px;border-radius:7px;cursor:pointer;font:inherit}
.dl-em-pal button:hover{background:var(--dlem-surface-2)}
.dl-em-pal .dl-em-pallabel{font-weight:600}
.dl-em-pal .dl-em-palhint{font-size:11px;color:var(--dlem-muted)}
.dl-em-newsec-inner{border-radius:10px;margin:18px auto;max-width:720px;
  padding:18px 22px;font:12.5px/1.5 var(--dlem-font);color:var(--dlem-muted);background:var(--dlem-surface-2)}
.dl-em-newsec-inner strong{color:var(--dlem-heading);font-size:13px}
.dl-em-form{padding:12px 14px;overflow-y:auto;display:none;flex-direction:column;gap:10px}
.dl-em-panel.dl-em-mode-edit .dl-em-form,.dl-em-panel.dl-em-mode-image .dl-em-form{display:flex}
.dl-em-panel.dl-em-mode-edit .dl-em-composer,.dl-em-panel.dl-em-mode-image .dl-em-composer{display:none}
.dl-em-formrow{display:flex;flex-direction:column;gap:4px}
.dl-em-formrow label{font:700 10.5px ui-monospace,monospace;color:var(--dlem-muted)}
.dl-em-formrow input,.dl-em-formrow textarea{border:1px solid var(--dlem-border);border-radius:8px;
  padding:7px 9px;font:12.5px/1.5 var(--dlem-font);background:var(--dlem-surface);color:var(--dlem-text)}
.dl-em-formrow textarea{min-height:84px;resize:vertical}
.dl-em-formrow input:focus,.dl-em-formrow textarea:focus{outline:2px solid var(--dlem-accent);outline-offset:1px;border-color:transparent}
.dl-em-formrow .dl-em-fieldnote{font-size:10.5px;color:var(--dlem-muted)}
.dl-em-imgthumb{max-width:100%;max-height:140px;border-radius:8px;border:1px solid var(--dlem-border);object-fit:cover}
.dl-em-formfoot{display:flex;gap:8px;padding-top:2px}
.dl-em-formfoot .dl-em-save{background:var(--dlem-ok);border-color:var(--dlem-ok);color:#fff}
.dl-em-panel{position:fixed;top:46px;right:12px;bottom:12px;width:380px;max-width:calc(100vw - 24px);
  z-index:99992;display:none;flex-direction:column;background:var(--dlem-surface);color:var(--dlem-text);
  border:1px solid var(--dlem-border);border-radius:12px;box-shadow:var(--dlem-shadow);font:13px/1.5 var(--dlem-font)}
.dl-em-panel.dl-em-open{display:flex}
.dl-em-panel header{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-bottom:1px solid var(--dlem-border)}
.dl-em-panel header .dl-em-t{flex:1;min-width:0}
.dl-em-panel header .dl-em-title{font:700 14px var(--dlem-font-head);color:var(--dlem-heading)}
.dl-em-panel header .dl-em-title svg{display:inline-block;vertical-align:-2px;margin-right:3px}
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
.dl-em-actions[hidden]{display:none}
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

// ── inline icons ─────────────────────────────────────────────────────────────
// The sparkles' stars use --dlem-spark (a brightened site gold) so the AI
// action reads a notch brighter than the neighboring tools, which stay in the
// chip's ink color (currentColor).
const ICON_SPARKLES =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path fill="var(--dlem-spark)" d="M12 2.8l2.1 5.6 5.6 2.1-5.6 2.1L12 18.2l-2.1-5.6-5.6-2.1 5.6-2.1z"/>' +
  '<path fill="var(--dlem-spark)" opacity=".78" d="M19.4 14.6l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/>' +
  '<path fill="var(--dlem-spark)" opacity=".6" d="M5.2 16.8l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>';
const ICON_PENCIL =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const ICON_IMAGE =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
const ICON_PLUS =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
  'stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

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
  panel.setAttribute('aria-label', 'Edit section');
  panel.innerHTML =
    `<header><div class="dl-em-t"><div class="dl-em-title" data-em-title>${ICON_SPARKLES} Ask AI</div>` +
    `<div class="dl-em-scope" data-em-scope></div></div>` +
    `<button class="dl-em-close" data-em-panel-close aria-label="Close">✕</button></header>` +
    `<div class="dl-em-form" data-em-form></div>` +
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

  // Gap layer: the small "+" affordances between/around sections (edit mode
  // only — CSS hides the layer otherwise). Document-absolute so scrolling
  // never needs a reposition; rebuilt when content heights change.
  const gapLayer = document.createElement('div');
  gapLayer.className = 'dl-em-gaplayer';
  document.body.append(gapLayer);

  // The add-section palette popover (opened by a gap "+").
  const palette = document.createElement('div');
  palette.className = 'dl-em-pal';
  palette.style.display = 'none';
  document.body.append(palette);

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
  const titleEl = q<HTMLElement>(panel, '[data-em-title]');
  const formEl = q<HTMLElement>(panel, '[data-em-form]');
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
      scheduleGapRebuild();
    } else {
      chip.style.display = 'none';
      panel.classList.remove('dl-em-open');
      tray.classList.remove('dl-em-open');
      palette.style.display = 'none';
      for (const objectSession of sessions.values()) void objectSession.checkin();
    }
  };
  fab.addEventListener('click', () => setEditMode(true));
  q<HTMLButtonElement>(bar, '[data-em-exit]').addEventListener('click', () => setEditMode(false));

  // ── gap "+" affordances: add a section between/around existing ones ───────
  type Gap = { host: string; anchorId: string; where: 'before' | 'after'; x: number; y: number };

  const gapsFromRegions = (): Gap[] => {
    const regions = Array.from(document.querySelectorAll<HTMLElement>(REGION_SELECTOR))
      .map((region) => ({
        region,
        target: deriveEditTarget(region.dataset as Record<string, string>),
        rect: regionRect(region),
      }))
      .filter((entry): entry is { region: HTMLElement; target: EditTarget; rect: DOMRect } =>
        Boolean(entry.target && entry.rect)
      );
    const gaps: Gap[] = [];
    const scrollY = window.scrollY;
    for (let i = 0; i < regions.length; i += 1) {
      const { target, rect } = regions[i];
      // Inserts always land on the HOST page object, anchored by the page
      // instance id — a shared_ref region anchors by its reference on the page.
      const host = target.hostObjectId;
      const anchorId = target.shared
        ? (regions[i].region.dataset.cmsSectionId as string)
        : (target.sectionId as string);
      const previous = regions[i - 1];
      const next = regions[i + 1];
      const x = rect.left + rect.width / 2;
      if (!previous || previous.target.hostObjectId !== host) {
        gaps.push({ host, anchorId, where: 'before', x, y: rect.top + scrollY - 12 });
      }
      if (next && next.target.hostObjectId === host) {
        gaps.push({ host, anchorId, where: 'after', x, y: (rect.bottom + next.rect.top) / 2 + scrollY });
      } else {
        gaps.push({ host, anchorId, where: 'after', x, y: rect.bottom + scrollY + 12 });
      }
    }
    return gaps;
  };

  const buildGaps = (): void => {
    gapLayer.innerHTML = '';
    if (!document.body.classList.contains('dl-em-on')) return;
    for (const gap of gapsFromRegions()) {
      const button = document.createElement('button');
      button.className = 'dl-em-gap';
      button.title = `Add a section to ${gap.host}`;
      button.setAttribute('aria-label', 'Add a section here');
      button.innerHTML = ICON_PLUS;
      button.style.left = `${gap.x}px`;
      button.style.top = `${gap.y}px`;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        openPalette(gap, button);
      });
      gapLayer.append(button);
    }
  };

  let gapRebuildTimer: number | undefined;
  const scheduleGapRebuild = (): void => {
    window.clearTimeout(gapRebuildTimer);
    gapRebuildTimer = window.setTimeout(buildGaps, 250);
  };
  window.addEventListener('resize', scheduleGapRebuild, { signal });
  window.addEventListener('load', scheduleGapRebuild, { signal });

  const openPalette = (gap: Gap, anchor: HTMLElement): void => {
    palette.innerHTML =
      `<div class="dl-em-palhead">Add to ${escapeHtml(gap.host)}</div>` +
      SECTION_PALETTE.map(
        (entry, index) =>
          `<button data-em-pal="${index}"><span class="dl-em-pallabel">${escapeHtml(entry.label)}</span>` +
          `<div class="dl-em-palhint">${escapeHtml(entry.hint)}</div></button>`
      ).join('');
    const rect = anchor.getBoundingClientRect();
    palette.style.display = 'block';
    palette.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
    palette.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 300)}px`;
    palette.querySelectorAll<HTMLButtonElement>('[data-em-pal]').forEach((button) => {
      button.addEventListener('click', () => {
        palette.style.display = 'none';
        void insertSection(gap, SECTION_PALETTE[Number(button.dataset.emPal)]);
      });
    });
  };
  document.addEventListener(
    'click',
    (event) => {
      if (palette.style.display !== 'none' && !palette.contains(event.target as Node)) {
        const onGap = (event.target as HTMLElement).closest?.('.dl-em-gap');
        if (!onGap) palette.style.display = 'none';
      }
    },
    { signal }
  );

  const insertSection = async (gap: Gap, entry: (typeof SECTION_PALETTE)[number]): Promise<void> => {
    setStatus(`Adding ${entry.label.toLowerCase()} to ${gap.host}…`);
    const objectSession = session('page', gap.host);
    const checkout = await objectSession.ensureCheckout();
    if (!checkout.ok) {
      setStatus(`Locked by ${checkout.heldBy ?? 'another editor'} — try again later.`);
      return;
    }
    // Position from the CURRENT record (hidden sections still occupy indices).
    const { record } = await getObjectRecord(getToken, 'page', gap.host);
    const sections = ((record?.body as Record<string, unknown> | undefined)?.sections ?? []) as Array<{ id: string }>;
    const position = insertPositionFor(sections, gap.anchorId, gap.where);
    const outcome = await objectSession.patch([
      { op: 'upsert_section', section: { type: entry.type, data: entry.starter }, position },
    ]);
    if (!outcome.ok) {
      setStatus(`Could not add: ${outcome.error}`);
      return;
    }
    const mintedId = outcome.minted.find((mint) => mint.field === 'section.id')?.id;
    // A draft placeholder in place: the static page can't render the new
    // section until publish+release, so show an honest, immediately-editable
    // stand-in (it carries the annotation, so the chip tools work on it).
    const anchorRegion = document.querySelector<HTMLElement>(`[data-cms-section-id="${CSS.escape(gap.anchorId)}"]`);
    if (anchorRegion && mintedId) {
      const placeholder = document.createElement('div');
      placeholder.dataset.cmsObjectId = gap.host;
      placeholder.dataset.cmsSectionId = mintedId;
      placeholder.dataset.cmsSectionType = entry.type;
      placeholder.className = 'dl-em-draft';
      placeholder.innerHTML =
        `<div class="dl-em-newsec-inner"><strong>${escapeHtml(entry.label)}</strong> — draft section ` +
        `<span class="dl-em-id">${escapeHtml(mintedId)}</span><br>` +
        `${escapeHtml(shortValue(Object.values(entry.starter).find((value) => typeof value === 'string') ?? entry.hint))}<br>` +
        `Hover to edit or ask the AI. Renders on the live page after publish + release.</div>`;
      if (gap.where === 'before') anchorRegion.before(placeholder);
      else anchorRegion.after(placeholder);
    }
    setStatus(`${entry.label} added to ${gap.host} as a draft.`);
    await refreshPending();
    scheduleGapRebuild();
  };

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
    const hasImage = IMAGE_SECTION_TYPES.has(target.sectionType);
    chip.innerHTML =
      `<span>${escapeHtml(target.sectionType)}</span>` +
      `<span class="dl-em-id">${escapeHtml(target.objectId)}</span>` +
      (target.shared ? `<span class="dl-em-shared">shared</span>` : '') +
      (isDraft ? `<span class="dl-em-draftflag">draft</span>` : '') +
      `<span class="dl-em-tools">` +
      `<button class="dl-em-tool dl-em-edit" title="Edit text" aria-label="Edit text">${ICON_PENCIL}</button>` +
      (hasImage
        ? `<button class="dl-em-tool dl-em-img" title="Image" aria-label="Edit image">${ICON_IMAGE}</button>`
        : '') +
      `<button class="dl-em-tool dl-em-ask${hasSelection ? ' dl-em-sel' : ''}" ` +
      `title="Ask AI${hasSelection ? ' about selection' : ''}" aria-label="Ask AI">${ICON_SPARKLES}</button>` +
      `</span>`;
    chip.querySelector('.dl-em-edit')?.addEventListener('click', () => void openPanel(target, region, 'edit'));
    chip.querySelector('.dl-em-img')?.addEventListener('click', () => void openPanel(target, region, 'image'));
    chip.querySelector('.dl-em-ask')?.addEventListener('click', () => void openPanel(target, region, 'ai'));
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
    panel.classList.remove('dl-em-open', 'dl-em-mode-edit', 'dl-em-mode-image');
    panelState?.region.classList.remove('dl-em-focus');
    panelState = undefined;
    formEl.innerHTML = '';
  };
  q<HTMLButtonElement>(panel, '[data-em-panel-close]').addEventListener('click', closePanel);

  const PANEL_TITLES: Record<PanelMode, string> = {
    ai: `${ICON_SPARKLES} Ask AI`,
    edit: `${ICON_PENCIL} Edit text`,
    image: `${ICON_IMAGE} Image`,
  };

  const openPanel = async (target: EditTarget, region: HTMLElement, mode: PanelMode): Promise<void> => {
    if (panelState?.snapshot) restoreRegion(panelState.snapshot);
    closePanel();
    tray.classList.remove('dl-em-open');
    region.classList.add('dl-em-focus');
    logEl.innerHTML = '';
    suggestionActions.hidden = true;
    titleEl.innerHTML = PANEL_TITLES[mode];
    panel.classList.toggle('dl-em-mode-edit', mode === 'edit');
    panel.classList.toggle('dl-em-mode-image', mode === 'image');

    const selected = mode === 'ai' && selectionRegion === region ? currentSelectionText : undefined;
    scopeEl.textContent =
      `${target.sectionType} · ${target.objectId}` +
      (target.shared ? ' (shared — edits affect every page using it)' : '') +
      (mode === 'ai'
        ? selected
          ? ` · selection: “${selected.slice(0, 60)}${selected.length > 60 ? '…' : ''}”`
          : ' · whole section'
        : '');
    panel.classList.add('dl-em-open');
    if (mode === 'ai') {
      inputEl.value = '';
      inputEl.focus();
    }

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
    panelState = { target, region, mode, currentData, patchSectionId, selectedText: selected };
    logEl.innerHTML = '';
    if (mode === 'ai') {
      log(
        'sys',
        `Editing ${escapeHtml(target.sectionType)} on ${escapeHtml(target.objectId)}. ` +
          'Suggestions preview in place as a draft; nothing publishes from here.'
      );
    } else {
      renderForm(panelState);
    }
  };

  // ── manual edit / image forms ─────────────────────────────────────────────
  // What people are used to: click the pencil, type in fields, save. Save is
  // the same reviewable draft path the AI uses (checkout → patch) — publishing
  // stays a separate act. The image tool is the DELIBERATE way to change an
  // image; the AI is schema-blocked from ever doing it.
  type FormFieldKind = 'text' | 'richtext' | 'lines' | 'image-src' | 'image-alt' | 'asset';
  type FormField = { key: string; kind: FormFieldKind; imageField?: string };

  const formFieldsFor = (data: Record<string, unknown>, mode: PanelMode): FormField[] => {
    const fields: FormField[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (mode === 'image') {
        if (isImageValue(value)) {
          fields.push({ key: `${key}.src`, kind: 'image-src', imageField: key });
          fields.push({ key: `${key}.alt`, kind: 'image-alt', imageField: key });
        } else if (/assetref$|^ogimage$/i.test(key) && typeof value === 'string') {
          fields.push({ key, kind: 'asset' });
        }
        continue;
      }
      if (NON_COPY_KEY_RE.test(key)) continue;
      if (typeof value === 'string') {
        fields.push({ key, kind: /<[a-z][\s\S]*>/i.test(value) || key === 'body' ? 'richtext' : 'text' });
      } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        fields.push({ key, kind: 'lines' });
      }
      // Structured values (actions, quotes, faq items…) stay AI/admin work.
    }
    return fields;
  };

  const formValueFor = (data: Record<string, unknown>, field: FormField): string => {
    if (field.kind === 'image-src') return (data[field.imageField as string] as { src: string }).src;
    if (field.kind === 'image-alt') return ((data[field.imageField as string] as { alt?: string }).alt ?? '') as string;
    const value = data[field.key];
    if (field.kind === 'lines') return (value as string[]).join('\n');
    return (value as string) ?? '';
  };

  const renderForm = (state: PanelState): void => {
    const fields = formFieldsFor(state.currentData, state.mode);
    formEl.innerHTML = '';
    if (fields.length === 0) {
      formEl.innerHTML = `<div class="dl-em-fieldnote">No ${
        state.mode === 'image' ? 'image' : 'text'
      } fields on this section type.</div>`;
      return;
    }
    for (const field of fields) {
      const row = document.createElement('div');
      row.className = 'dl-em-formrow';
      const value = formValueFor(state.currentData, field);
      const label = `<label>${escapeHtml(field.key)}</label>`;
      if (field.kind === 'richtext' || field.kind === 'lines') {
        row.innerHTML =
          label +
          `<textarea data-em-field="${escapeHtml(field.key)}">${escapeHtml(value)}</textarea>` +
          (field.kind === 'lines'
            ? '<span class="dl-em-fieldnote">One item per line.</span>'
            : '<span class="dl-em-fieldnote">Allowed tags: p, br, strong, em, a, ul, ol, li, h2, h3.</span>');
      } else {
        row.innerHTML =
          label + `<input type="text" data-em-field="${escapeHtml(field.key)}" value="${escapeHtml(value)}">`;
      }
      formEl.append(row);
      if (field.kind === 'image-src') {
        const thumb = document.createElement('img');
        thumb.className = 'dl-em-imgthumb';
        thumb.alt = 'Preview';
        thumb.src = value;
        row.append(thumb);
        row.querySelector('input')?.addEventListener('input', (event) => {
          thumb.src = (event.target as HTMLInputElement).value;
        });
      }
    }
    const foot = document.createElement('div');
    foot.className = 'dl-em-formfoot';
    foot.innerHTML =
      `<button class="dl-em-btn dl-em-save" data-em-form-save>Save draft</button>` +
      `<button class="dl-em-btn dl-em-ghost" data-em-form-cancel>Cancel</button>`;
    foot.querySelector('[data-em-form-save]')?.addEventListener('click', () => void saveForm(state, fields));
    foot.querySelector('[data-em-form-cancel]')?.addEventListener('click', closePanel);
    formEl.append(foot);
  };

  const saveForm = async (state: PanelState, fields: FormField[]): Promise<void> => {
    const changed: Record<string, unknown> = {};
    const previews: Array<{ kind: 'string' | 'html' | 'image'; before: unknown; after: unknown }> = [];
    for (const field of fields) {
      const input = formEl.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[data-em-field="${CSS.escape(field.key)}"]`
      );
      if (!input) continue;
      const before = formValueFor(state.currentData, field);
      const raw = input.value;
      if (raw === before) continue;
      if (field.kind === 'image-src' || field.kind === 'image-alt') {
        const imageKey = field.imageField as string;
        const current = { ...(state.currentData[imageKey] as Record<string, unknown>) };
        const merged = (changed[imageKey] as Record<string, unknown>) ?? current;
        merged[field.kind === 'image-src' ? 'src' : 'alt'] = raw;
        changed[imageKey] = merged;
        if (field.kind === 'image-src') previews.push({ kind: 'image', before, after: raw });
      } else if (field.kind === 'lines') {
        changed[field.key] = raw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
      } else {
        changed[field.key] = raw;
        previews.push({ kind: field.kind === 'richtext' ? 'html' : 'string', before, after: raw });
      }
    }
    if (Object.keys(changed).length === 0) {
      log('sys', 'No changes to save.');
      return;
    }
    const working = log('sys', 'Saving draft (checkout → patch)…');
    const objectSession = session(state.target.objectType, state.target.objectId);
    const checkout = await objectSession.ensureCheckout();
    if (!checkout.ok) {
      working.remove();
      log('sys', `Locked by ${escapeHtml(checkout.heldBy ?? 'another editor')} — try again when the lock frees.`);
      return;
    }
    const outcome = await objectSession.patch(suggestionToOps(state.target, changed, state.patchSectionId));
    working.remove();
    if (!outcome.ok) {
      const blockers = outcome.blockers?.length ? `<br>${outcome.blockers.map(escapeHtml).join('<br>')}` : '';
      log('sys', `Not saved: ${escapeHtml(outcome.error)}${blockers}`);
      return;
    }
    // Show the saved draft in place where we can do so unambiguously.
    for (const preview of previews) {
      if (preview.kind === 'image') {
        state.region.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
          if (img.getAttribute('src') === preview.before) img.src = preview.after as string;
        });
      } else {
        previewFieldChange(state.region, preview.kind, preview.before, preview.after);
      }
    }
    Object.assign(state.currentData, changed);
    state.region.classList.add('dl-em-draft');
    log('sys', 'Draft saved — <strong>not published</strong>. Publish from the Pending tray when ready.');
    setStatus(`${state.target.objectId}: draft saved.`);
    await refreshPending();
    scheduleGapRebuild();
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
    scheduleGapRebuild(); // previewed content can change section heights
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
