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
 * Article bodies: OBJECT-BACKED articles (content_item, W7.3) render each
 * node with data-cms-node-* identity, so article prose grows chips too —
 * node edits ride the SAME EditSession → update_node → publish path (the
 * OQ-8 stop line lifted at W7.8). Legacy .md posts carry no annotations and
 * stay read-only on the canvas.
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
  deriveNavTarget,
  deriveNodeTarget,
  suggestionToOps,
  summarizeFieldChanges,
  type EditTarget,
  type FieldChange,
} from './targets.js';
import { applyNavChangesToBody, navChangesToOps, navEditFieldsFor, type NavEditField } from './nav-editor.js';
import type { NavigationBody } from '../../schema/bodies/navigation-v1.js';
import { previewFieldChange, restoreRegion, snapshotRegion, type RegionSnapshot } from './preview.js';
import {
  askAiSuggestion,
  canExecutePublish,
  EditSession,
  ensureBlobBackedImage,
  fetchPendingObjects,
  getObjectRecord,
  releaseToProduction,
  uploadImageArtifact,
  type GetToken,
  type PendingObjectRow,
} from './verbs-client.js';

const REGION_SELECTOR = '[data-cms-section-id]';
const NAV_SELECTOR = '[data-cms-nav-object]';
const NODE_SELECTOR = '[data-cms-node-id]';
const EMPTY_OBJECT_SELECTOR = '[data-cms-empty-object]';
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
  /** Armed "Re: <image>" reference (AI chat image chips) — sent with every ask. */
  imageRef?: { field: string; name: string; url: string };
  /** Navigation targets: the object body the copy form edits (nav grammar ops). */
  navBody?: NavigationBody;
  suggestion?: Record<string, unknown>;
  changes?: FieldChange[];
  snapshot?: RegionSnapshot;
};

/** Section types whose data carries an image the image tool should offer. */
const IMAGE_SECTION_TYPES = new Set(['bio', 'content_split']);

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

const imageBasename = (src: string): string => src.split('/').pop()?.split('?')[0] || src;

/** Every image a section's data carries, flattened (arrays → field.<index>). */
const imageEntriesFor = (data: Record<string, unknown>): Array<{ field: string; src: string; name: string }> => {
  const entries: Array<{ field: string; src: string; name: string }> = [];
  for (const [key, value] of Object.entries(data)) {
    if (isImageValue(value)) {
      entries.push({ field: key, src: value.src, name: imageBasename(value.src) });
    } else if (Array.isArray(value) && value.length > 0 && value.every(isImageValue)) {
      value.forEach((item, index) =>
        entries.push({ field: `${key}.${index}`, src: item.src, name: imageBasename(item.src) })
      );
    }
  }
  return entries;
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
body.dl-em-on [data-cms-section-id].dl-em-hot>*,body.dl-em-on [data-cms-nav-object].dl-em-hot>*{outline:2px solid color-mix(in srgb,var(--dlem-accent) 60%,transparent);outline-offset:6px;border-radius:2px}
body.dl-em-on [data-cms-section-id].dl-em-focus>*,body.dl-em-on [data-cms-nav-object].dl-em-focus>*{outline:2px solid var(--dlem-accent);outline-offset:6px}
body.dl-em-on [data-cms-section-id].dl-em-draft>*,body.dl-em-on [data-cms-nav-object].dl-em-draft>*{outline:2px dashed var(--dlem-draft);outline-offset:6px}
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
/* Selection-algorithm dropdown (related grids) — a chip-native compact select. */
.dl-em-alg{appearance:none;-webkit-appearance:none;height:24px;padding:2px 18px 2px 8px;cursor:pointer;
  border:1px solid color-mix(in srgb,var(--dlem-accent-ink) 35%,transparent);border-radius:5px;
  background:color-mix(in srgb,var(--dlem-accent-ink) 12%,transparent) url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='white' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 6px center;
  color:var(--dlem-accent-ink);font:600 10.5px var(--dlem-font)}
.dl-em-alg:hover{border-color:var(--dlem-accent-ink)}
.dl-em-alg option{color:var(--dlem-text);background:var(--dlem-surface)}
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
.dl-em-form{padding:12px 14px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;flex:1;min-height:0}
.dl-em-formrow{display:flex;flex-direction:column;gap:4px}
.dl-em-formrow label{font:700 10.5px ui-monospace,monospace;color:var(--dlem-muted)}
.dl-em-formrow input,.dl-em-formrow textarea{border:1px solid var(--dlem-border);border-radius:8px;
  padding:7px 9px;font:12.5px/1.5 var(--dlem-font);background:var(--dlem-surface);color:var(--dlem-text)}
.dl-em-formrow textarea{min-height:84px;resize:vertical}
.dl-em-formrow input:focus,.dl-em-formrow textarea:focus{outline:2px solid var(--dlem-accent);outline-offset:1px;border-color:transparent}
.dl-em-formrow .dl-em-fieldnote{font-size:10.5px;color:var(--dlem-muted)}
.dl-em-imgthumb{max-width:100%;max-height:140px;border-radius:8px;border:1px solid var(--dlem-border);object-fit:cover}
.dl-em-srcrow{display:flex;gap:6px;align-items:center}
.dl-em-srcrow input{flex:1;min-width:0}
.dl-em-upload{width:36px;height:36px;padding:0;flex:none}
.dl-em-upload.dl-em-loading{opacity:.5;pointer-events:none}
.dl-em-upload.dl-em-loading svg{animation:dl-em-spin .8s linear infinite}
@keyframes dl-em-spin{to{transform:rotate(360deg)}}
.dl-em-imgrefs{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.dl-em-imgref{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dlem-border);border-radius:8px;
  background:transparent;color:var(--dlem-text);padding:3px 8px 3px 3px;font:600 11.5px var(--dlem-font);cursor:pointer}
.dl-em-imgref img{width:26px;height:26px;object-fit:cover;border-radius:5px}
.dl-em-imgref:hover{border-color:var(--dlem-accent);color:var(--dlem-accent)}
.dl-em-imgref.dl-em-armed{border-color:var(--dlem-accent);outline:1.5px solid var(--dlem-accent)}
.dl-em-repill{display:inline-block;background:color-mix(in srgb,var(--dlem-accent) 14%,transparent);
  border:1px solid var(--dlem-accent);color:var(--dlem-accent);border-radius:999px;padding:0 8px;
  font:700 10.5px ui-monospace,monospace}
.dl-em-formfoot{display:flex;gap:8px;padding:10px 0 2px;position:sticky;bottom:0;background:var(--dlem-surface)}
.dl-em-formfoot .dl-em-save{flex:1;background:var(--dlem-ok);border-color:var(--dlem-ok);color:#fff}
.dl-em-formfoot .dl-em-ghost{width:38px;padding:0;flex:none}
.dl-em-panel{position:fixed;top:46px;right:12px;bottom:12px;width:372px;max-width:calc(100vw - 24px);
  z-index:99992;display:none;flex-direction:column;background:var(--dlem-surface);color:var(--dlem-text);
  border:1px solid var(--dlem-border);border-radius:14px;box-shadow:var(--dlem-shadow);font:13px/1.5 var(--dlem-font);
  overflow:hidden}
.dl-em-panel.dl-em-open{display:flex}
.dl-em-panel header{display:flex;gap:8px;align-items:center;padding:9px 8px 9px 13px;border-bottom:1px solid var(--dlem-border);
  background:var(--dlem-surface-2)}
.dl-em-ident{flex:1;min-width:0;display:flex;align-items:center;gap:7px;font:600 12px var(--dlem-font)}
.dl-em-ident .dl-em-itype{color:var(--dlem-heading);white-space:nowrap}
.dl-em-ident .dl-em-iid{font:400 10.5px ui-monospace,monospace;color:var(--dlem-muted);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dl-em-ident .dl-em-idot{width:6px;height:6px;border-radius:50%;flex:none}
.dl-em-ident .dl-em-idot.dl-em-shd{background:var(--dlem-accent)}
.dl-em-ident .dl-em-idot.dl-em-drf{background:var(--dlem-draft)}
.dl-em-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;
  border:none;background:transparent;color:var(--dlem-muted);border-radius:7px;cursor:pointer}
.dl-em-close:hover{background:color-mix(in srgb,var(--dlem-text) 10%,transparent);color:var(--dlem-text)}
/* accordion: icon-led sections, one open at a time; the open one grows */
.dl-em-accstack{flex:1;min-height:0;display:flex;flex-direction:column}
.dl-em-acc{display:flex;flex-direction:column;min-height:0;border-bottom:1px solid var(--dlem-border)}
.dl-em-acc:last-child{border-bottom:none}
.dl-em-acc.dl-em-open{flex:1;min-height:0}
.dl-em-acc-head{display:flex;align-items:center;gap:10px;width:100%;padding:11px 13px;border:none;
  background:transparent;color:var(--dlem-text);font:600 12.5px var(--dlem-font);cursor:pointer;text-align:left}
.dl-em-acc-head:hover{background:var(--dlem-surface-2)}
.dl-em-acc-head .dl-em-ic{display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;
  color:var(--dlem-accent)}
.dl-em-acc-head .dl-em-lbl{flex:1;color:var(--dlem-heading)}
.dl-em-acc-head .dl-em-chev{color:var(--dlem-muted);transition:transform .16s ease}
.dl-em-acc.dl-em-open>.dl-em-acc-head{border-bottom:1px solid var(--dlem-border);background:var(--dlem-surface-2)}
.dl-em-acc.dl-em-open>.dl-em-acc-head .dl-em-chev{transform:rotate(180deg);color:var(--dlem-accent)}
.dl-em-acc-body{display:none;flex-direction:column;min-height:0;flex:1}
.dl-em-acc.dl-em-open>.dl-em-acc-body{display:flex}
.dl-em-panel:not(.dl-em-has-image) .dl-em-acc[data-em-acc="image"]{display:none}
/* Chrome (navigation objects): copy form only — AI/Image sections don't apply. */
.dl-em-panel.dl-em-nav .dl-em-acc[data-em-acc="ai"],.dl-em-panel.dl-em-nav .dl-em-acc[data-em-acc="image"]{display:none}
.dl-em-log{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.dl-em-msg{max-width:92%;padding:8px 11px;border-radius:10px;font-size:12.5px}
.dl-em-msg.dl-em-user{align-self:flex-end;background:var(--dlem-accent);color:var(--dlem-accent-ink);border-bottom-right-radius:3px}
.dl-em-msg.dl-em-ai{align-self:flex-start;background:var(--dlem-surface-2);border:1px solid var(--dlem-border);border-bottom-left-radius:3px}
.dl-em-msg.dl-em-sys{align-self:stretch;background:none;color:var(--dlem-muted);font-size:11px;text-align:center}
.dl-em-msg.dl-em-sys svg{vertical-align:-2px;margin-right:3px;opacity:.8}
.dl-em-diff{border:1px solid var(--dlem-border);border-radius:8px;padding:8px 10px;font-size:12px;margin-top:6px}
.dl-em-diff .dl-em-field{font:700 10.5px ui-monospace,monospace;margin-bottom:2px;color:var(--dlem-muted)}
.dl-em-diff del{background:color-mix(in srgb,var(--dlem-danger) 14%,transparent);color:var(--dlem-danger);text-decoration:line-through;border-radius:2px}
.dl-em-diff ins{background:color-mix(in srgb,var(--dlem-ok) 16%,transparent);color:var(--dlem-ok);text-decoration:none;border-radius:2px}
.dl-em-diff .dl-em-noprev{color:var(--dlem-draft);font-size:10.5px}
.dl-em-btn svg{display:block}
.dl-em-btn.dl-em-ico{display:inline-flex;align-items:center;justify-content:center;gap:6px}
.dl-em-actions{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--dlem-border)}
.dl-em-actions[hidden]{display:none}
.dl-em-actions .dl-em-btn{border-color:var(--dlem-accent);background:var(--dlem-accent);color:var(--dlem-accent-ink)}
.dl-em-actions .dl-em-accept{flex:1;background:var(--dlem-ok);border-color:var(--dlem-ok)}
.dl-em-actions .dl-em-btn.dl-em-ghost{background:transparent;color:var(--dlem-text);border-color:var(--dlem-border)}
.dl-em-composer{padding:9px 12px 11px;border-top:1px solid var(--dlem-border)}
.dl-em-composer .dl-em-row{display:flex;gap:8px;align-items:flex-end}
.dl-em-composer textarea{flex:1;height:52px;resize:none;border:1px solid var(--dlem-border);border-radius:9px;
  padding:8px 10px;font:12.5px/1.45 var(--dlem-font);background:var(--dlem-surface);color:var(--dlem-text)}
.dl-em-composer textarea:focus{outline:2px solid var(--dlem-accent);outline-offset:1px;border-color:transparent}
.dl-em-composer .dl-em-send{width:40px;height:40px;flex:none;padding:0;border-radius:9px}
.dl-em-hint{display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--dlem-muted);margin-top:7px}
.dl-em-hint kbd{font:600 10px ui-monospace,monospace;border:1px solid var(--dlem-border);border-radius:4px;
  padding:0 4px;color:var(--dlem-text)}
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
const ICON_CHEVRON =
  '<svg class="dl-em-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_CHECK =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_CLOSE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ICON_UPLOAD =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M6 10l6-6 6 6"/>' +
  '<path d="M4 20h16"/></svg>';
const ICON_UNDO =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/>' +
  '<path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg>';
const ICON_SEND =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/>' +
  '<path d="M22 2 15 22l-4-9-9-4Z"/></svg>';

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
  // The panel is one accordion: icon-led sections (Ask AI / Edit / Image),
  // one expanded at a time (the expanded one grows; the rest are just a head).
  // A chip tool opens its section; the heads switch between them; clicking the
  // open head collapses the body to a compact rail. Identity lives in the
  // header as a type + monospace id with tiny shared/draft dots — no prose.
  const accHead = (mode: string, icon: string, label: string): string =>
    `<button class="dl-em-acc-head" data-em-acc-head="${mode}" aria-label="${label}">` +
    `<span class="dl-em-ic">${icon}</span><span class="dl-em-lbl">${label}</span>${ICON_CHEVRON}</button>`;
  panel.innerHTML =
    `<header><div class="dl-em-ident" data-em-ident></div>` +
    `<button class="dl-em-close" data-em-panel-close aria-label="Close">${ICON_CLOSE}</button></header>` +
    `<div class="dl-em-accstack">` +
    `<section class="dl-em-acc" data-em-acc="ai">${accHead('ai', ICON_SPARKLES, 'Ask AI')}` +
    `<div class="dl-em-acc-body">` +
    `<div class="dl-em-log" data-em-log></div>` +
    `<div class="dl-em-actions" data-em-suggestion-actions hidden>` +
    `<button class="dl-em-btn dl-em-accept dl-em-ico" data-em-accept>${ICON_CHECK} Save draft</button>` +
    `<button class="dl-em-btn dl-em-ghost dl-em-ico" data-em-discard title="Discard" aria-label="Discard">${ICON_UNDO}</button></div>` +
    `<div class="dl-em-composer"><div class="dl-em-row">` +
    `<textarea data-em-input placeholder="Describe the change…"></textarea>` +
    `<button class="dl-em-btn dl-em-primary dl-em-send dl-em-ico" data-em-send aria-label="Send">${ICON_SEND}</button></div>` +
    `<div class="dl-em-hint">${ICON_SPARKLES}<span>Select text to scope · <kbd>⌘↵</kbd> send</span></div></div>` +
    `</div></section>` +
    `<section class="dl-em-acc" data-em-acc="edit">${accHead('edit', ICON_PENCIL, 'Edit text')}` +
    `<div class="dl-em-acc-body" data-em-acc-body="edit"></div></section>` +
    `<section class="dl-em-acc" data-em-acc="image">${accHead('image', ICON_IMAGE, 'Image')}` +
    `<div class="dl-em-acc-body" data-em-acc-body="image"></div></section>` +
    `</div>`;
  document.body.append(panel);
  // Single reusable form node, moved into whichever section (edit/image) is open.
  const formEl = document.createElement('div');
  formEl.className = 'dl-em-form';
  formEl.setAttribute('data-em-form', '');

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
    `<header>Pending changes</header>` +
    `<div class="dl-em-rows" data-em-rows></div>` +
    `<footer><span class="dl-em-deploy" data-em-deploy>Publish commits; Release deploys everything once.</span>` +
    `<button class="dl-em-btn dl-em-primary" data-em-tray-release ${allowPublish ? '' : 'disabled'}>Release</button></footer>`;
  document.body.append(tray);

  const q = <T extends HTMLElement>(root: ParentNode, selector: string): T => root.querySelector(selector) as T;
  const statusEl = q<HTMLElement>(bar, '[data-em-status]');
  const countEl = q<HTMLElement>(bar, '[data-em-count]');
  const identEl = q<HTMLElement>(panel, '[data-em-ident]');
  const logEl = q<HTMLElement>(panel, '[data-em-log]');
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
    (region.dataset.cmsNodeId !== undefined
      ? deriveNodeTarget(region.dataset as Record<string, string>)
      : deriveEditTarget(region.dataset as Record<string, string>)
    )?.objectId;

  const markDraftRegions = (): void => {
    const draftIds = new Set(pendingRows.filter((row) => row.unpublished_changes).map((row) => row.object_id));
    document.querySelectorAll<HTMLElement>(`${REGION_SELECTOR}, ${NODE_SELECTOR}`).forEach((region) => {
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
    // Object-EMPTY pages (e.g. page_article before its first section): the
    // zero-height marker ObjectSections leaves behind gets one "+" so the
    // FIRST section can be added from the canvas. anchorId '' → append (the
    // insert-position rule: unknown anchor appends; an empty list appends at 0).
    for (const marker of Array.from(document.querySelectorAll<HTMLElement>(EMPTY_OBJECT_SELECTOR))) {
      const host = marker.dataset.cmsEmptyObject as string;
      if (regions.some((entry) => entry.target.hostObjectId === host)) continue; // no longer empty (draft added)
      const rect = marker.getBoundingClientRect();
      gaps.push({
        host,
        anchorId: '',
        where: 'after',
        x: rect.width > 0 ? rect.left + rect.width / 2 : window.innerWidth / 2,
        y: rect.top + scrollY,
      });
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
    // Anchor: the anchor section's region, or — first section on an
    // object-empty page — the page object's empty marker.
    const anchorRegion =
      document.querySelector<HTMLElement>(`[data-cms-section-id="${CSS.escape(gap.anchorId)}"]`) ??
      document.querySelector<HTMLElement>(`[data-cms-empty-object="${CSS.escape(gap.host)}"]`);
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

  /** Labels for the related-grid selection algorithms (chip dropdown). */
  const ALGORITHM_LABELS: Record<string, string> = {
    tag_similarity: 'Similar',
    same_category: 'Same category',
    latest: 'Latest',
  };

  const renderChip = (region: HTMLElement): void => {
    const isNav = region.dataset.cmsNavObject !== undefined;
    const isNode = region.dataset.cmsNodeId !== undefined;
    const target = isNav
      ? deriveNavTarget(region.dataset as Record<string, string>)
      : isNode
        ? deriveNodeTarget(region.dataset as Record<string, string>)
        : deriveEditTarget(region.dataset as Record<string, string>);
    if (!target) return;
    const hasSelection = !isNav && Boolean(currentSelectionText && selectionRegion === region);
    const isDraft = region.classList.contains('dl-em-draft');
    // Article content nodes carry an optional media image (public.media).
    const hasImage = isNode
      ? region.dataset.cmsNodeKind === 'content'
      : !isNav && IMAGE_SECTION_TYPES.has(target.sectionType);
    // A `related` content_grid announces its algorithm — the chip offers the
    // selection dropdown inline with the AI tool (small footprint, no panel).
    const algorithm = region.dataset.cmsRelatedAlgorithm;
    chip.innerHTML =
      `<span>${escapeHtml(target.sectionType)}</span>` +
      `<span class="dl-em-id">${escapeHtml(target.objectId)}</span>` +
      (target.shared ? `<span class="dl-em-shared">${isNav ? 'site-wide' : 'shared'}</span>` : '') +
      (isDraft ? `<span class="dl-em-draftflag">draft</span>` : '') +
      `<span class="dl-em-tools">` +
      (algorithm
        ? `<select class="dl-em-alg" data-em-alg title="Selection algorithm" aria-label="Selection algorithm">` +
          Object.entries(ALGORITHM_LABELS)
            .map(
              ([value, label]) => `<option value="${value}"${value === algorithm ? ' selected' : ''}>${label}</option>`
            )
            .join('') +
          `</select>`
        : '') +
      `<button class="dl-em-tool dl-em-edit" title="Edit text" aria-label="Edit text">${ICON_PENCIL}</button>` +
      (hasImage
        ? `<button class="dl-em-tool dl-em-img" title="Image" aria-label="Edit image">${ICON_IMAGE}</button>`
        : '') +
      (isNav
        ? ''
        : `<button class="dl-em-tool dl-em-ask${hasSelection ? ' dl-em-sel' : ''}" ` +
          `title="Ask AI${hasSelection ? ' about selection' : ''}" aria-label="Ask AI">${ICON_SPARKLES}</button>`) +
      `</span>`;
    chip.querySelector('.dl-em-edit')?.addEventListener('click', () => void openPanel(target, region, 'edit'));
    chip.querySelector('.dl-em-img')?.addEventListener('click', () => void openPanel(target, region, 'image'));
    chip.querySelector('.dl-em-ask')?.addEventListener('click', () => void openPanel(target, region, 'ai'));
    chip.querySelector<HTMLSelectElement>('[data-em-alg]')?.addEventListener('change', (event) => {
      void applyAlgorithm(target, region, (event.target as HTMLSelectElement).value);
    });
    positionChip(region);
  };

  /**
   * Chip dropdown → draft: patch the related grid's selection algorithm
   * through the normal reviewable path (checkout → update_section_data).
   * Only `source.algorithm` changes — the source keeps kind 'related', so the
   * deep-merge is key-stable. Shared grids route to their sec_* object.
   */
  const applyAlgorithm = async (target: EditTarget, region: HTMLElement, algorithm: string): Promise<void> => {
    setStatus(`Switching selection to “${ALGORITHM_LABELS[algorithm] ?? algorithm}”…`);
    const objectSession = session(target.objectType, target.objectId);
    const checkout = await objectSession.ensureCheckout();
    if (!checkout.ok) {
      setStatus(`Locked by ${checkout.heldBy ?? 'another editor'} — try again when the lock frees.`);
      return;
    }
    let sectionId = target.sectionId;
    if (!sectionId) {
      // Shared grid: the patch scopes to the inner instance id on the sec_* object.
      const { record } = await getObjectRecord(getToken, target.objectType, target.objectId);
      sectionId = ((record?.body as { section?: { id?: string } })?.section?.id ?? '') || undefined;
    }
    if (!sectionId) {
      setStatus('Could not resolve the section instance to patch.');
      return;
    }
    const outcome = await objectSession.patch([
      { op: 'update_section_data', section_id: sectionId, fields: { source: { kind: 'related', algorithm } } },
    ]);
    if (!outcome.ok) {
      setStatus(`Not saved: ${outcome.error}`);
      return;
    }
    region.dataset.cmsRelatedAlgorithm = algorithm;
    region.classList.add('dl-em-draft');
    setStatus(`Selection set to “${ALGORITHM_LABELS[algorithm] ?? algorithm}” — draft saved, not published.`);
    await refreshPending();
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
      // Article nodes first (innermost, inside the post body), then sections
      // (inside <main>), then chrome (header/footer wrap a nav object) — a
      // hover matches exactly one editable region.
      const region =
        element.closest<HTMLElement>(NODE_SELECTOR) ??
        element.closest<HTMLElement>(REGION_SELECTOR) ??
        element.closest<HTMLElement>(NAV_SELECTOR);
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
      const region =
        anchorElement?.closest<HTMLElement>(NODE_SELECTOR) ??
        anchorElement?.closest<HTMLElement>(REGION_SELECTOR) ??
        undefined;
      currentSelectionText = region ? captureObjectSelection(region) : undefined;
      selectionRegion = currentSelectionText ? region : undefined;
      if (hotRegion) renderChip(hotRegion);
    },
    { signal }
  );

  // ── panel ─────────────────────────────────────────────────────────────────
  let panelState: PanelState | undefined;
  let panelTarget: EditTarget | undefined;
  let panelRegion: HTMLElement | undefined;

  const closePanel = (): void => {
    panel.classList.remove('dl-em-open', 'dl-em-mode-edit', 'dl-em-mode-image', 'dl-em-has-image', 'dl-em-nav');
    panel.querySelectorAll('.dl-em-acc').forEach((section) => section.classList.remove('dl-em-open'));
    panelState?.region.classList.remove('dl-em-focus');
    panelState = undefined;
    panelTarget = undefined;
    panelRegion = undefined;
    formEl.remove();
    formEl.innerHTML = '';
  };
  q<HTMLButtonElement>(panel, '[data-em-panel-close]').addEventListener('click', closePanel);

  /** Expand one accordion section (collapse the rest); null collapses all. */
  const setActiveSection = (mode: PanelMode | null): void => {
    panel.querySelectorAll<HTMLElement>('.dl-em-acc').forEach((section) => {
      section.classList.toggle('dl-em-open', section.dataset.emAcc === mode);
    });
    panel.classList.toggle('dl-em-mode-edit', mode === 'edit');
    panel.classList.toggle('dl-em-mode-image', mode === 'image');
  };

  // Accordion heads switch tools on the SAME section; clicking the open head
  // collapses the panel body to the compact icon rail.
  panel.querySelectorAll<HTMLButtonElement>('[data-em-acc-head]').forEach((head) => {
    head.addEventListener('click', () => {
      const mode = head.dataset.emAccHead as PanelMode;
      const section = panel.querySelector(`.dl-em-acc[data-em-acc="${mode}"]`);
      if (section?.classList.contains('dl-em-open')) {
        setActiveSection(null);
      } else if (panelTarget && panelRegion) {
        void openPanel(panelTarget, panelRegion, mode);
      }
    });
  });

  const openPanel = async (target: EditTarget, region: HTMLElement, mode: PanelMode): Promise<void> => {
    if (panelState?.snapshot) restoreRegion(panelState.snapshot);
    closePanel();
    tray.classList.remove('dl-em-open');
    region.classList.add('dl-em-focus');
    panelTarget = target;
    panelRegion = region;
    logEl.innerHTML = '';
    suggestionActions.hidden = true;

    // Header identity: type + monospace id, with tiny shared/draft dots (no prose).
    const isDraft = region.classList.contains('dl-em-draft');
    identEl.innerHTML =
      `<span class="dl-em-itype">${escapeHtml(target.sectionType)}</span>` +
      `<span class="dl-em-iid">${escapeHtml(target.objectId)}</span>` +
      (target.shared ? `<span class="dl-em-idot dl-em-shd" title="Shared — affects every page using it"></span>` : '') +
      (isDraft ? `<span class="dl-em-idot dl-em-drf" title="Unpublished draft"></span>` : '');
    panel.classList.toggle(
      'dl-em-has-image',
      target.objectType === 'content_item'
        ? region.dataset.cmsNodeKind === 'content'
        : IMAGE_SECTION_TYPES.has(target.sectionType)
    );
    // Chrome (navigation objects) is a copy form only: no section grammar for
    // AI scoping, no images — the accordion shows just the Edit section.
    const isNav = target.objectType === 'navigation';
    panel.classList.toggle('dl-em-nav', isNav);
    if (isNav) mode = 'edit';
    setActiveSection(mode);
    if (mode !== 'ai') panel.querySelector(`[data-em-acc-body="${mode}"]`)?.append(formEl);

    const selected = mode === 'ai' && selectionRegion === region ? currentSelectionText : undefined;
    panel.classList.add('dl-em-open');
    if (mode === 'ai') {
      inputEl.value = '';
      inputEl.focus();
    }

    const loading = log('sys', 'Loading…');
    const { status, record } = await getObjectRecord(getToken, target.objectType, target.objectId);
    loading.remove();
    if (status !== 200 || !record) {
      log('sys', `Could not load ${escapeHtml(target.objectId)} (HTTP ${status}).`);
      return;
    }
    const body = record.body as Record<string, unknown>;
    if (isNav) {
      panelState = {
        target,
        region,
        mode: 'edit',
        currentData: {},
        patchSectionId: '',
        navBody: body as unknown as NavigationBody,
      };
      renderNavForm(panelState);
      return;
    }
    let currentData: Record<string, unknown> | undefined;
    let patchSectionId: string | undefined;
    if (target.objectType === 'page') {
      const sectionList = (body.sections as Array<{ id: string; data: Record<string, unknown> }> | undefined) ?? [];
      const instance = sectionList.find((entry) => entry.id === target.sectionId);
      currentData = instance?.data;
      patchSectionId = instance?.id;
    } else if (target.objectType === 'content_item') {
      // Article node (W7.8): the editable unit is the node's PUBLIC fields —
      // update_node scopes by target.nodeId (patchSectionId is unused there
      // but kept non-empty for the shared panel state shape).
      const nodes = (body.nodes as Array<{ id: string; public?: Record<string, unknown> }> | undefined) ?? [];
      const node = nodes.find((entry) => entry.id === target.nodeId);
      currentData = node?.public;
      patchSectionId = node?.id;
    } else {
      const inner = body.section as { id: string; data: Record<string, unknown> } | undefined;
      currentData = inner?.data;
      patchSectionId = inner?.id;
    }
    if (!currentData || !patchSectionId) {
      log('sys', 'Not in the draft record yet — edit via /admin/objects.');
      return;
    }
    panelState = { target, region, mode, currentData, patchSectionId, selectedText: selected };
    logEl.innerHTML = '';
    if (mode === 'ai') {
      inputEl.placeholder = selected ? 'Refine the selection…' : 'Describe the change…';
      log(
        'sys',
        `${ICON_SPARKLES} Editing ${escapeHtml(target.sectionType)}${selected ? ' · selection' : ''} — previews as a draft.`
      );
      renderImageRefChips(panelState);
    } else {
      renderForm(panelState);
    }
  };

  // ── AI image references ("Re: portrait.png") ─────────────────────────────
  // A section that carries images gets clickable chips in the chat. Arming a
  // chip guarantees the image has a blob-store copy with a public /img/* URL
  // (existing repo images are mirrored through the same upload pipeline —
  // storage only, the section's src is untouched) and every ask then carries
  // `image_ref` so the model — and any external image tooling, which needs a
  // public URL — knows exactly which bytes "the image" means. The copy-only
  // guard is unchanged: the AI still cannot write image fields.
  const renderImageRefChips = (state: PanelState): void => {
    const entries = imageEntriesFor(state.currentData);
    if (entries.length === 0) return;
    const container = log(
      'sys',
      `${ICON_IMAGE} Reference ${entries.length === 1 ? 'this image' : 'an image'} in the chat:`
    );
    const row = document.createElement('div');
    row.className = 'dl-em-imgrefs';
    for (const entry of entries) {
      const chipButton = document.createElement('button');
      chipButton.type = 'button';
      chipButton.className = 'dl-em-imgref';
      chipButton.innerHTML = `<img src="${escapeHtml(entry.src)}" alt=""> ${escapeHtml(entry.name)}`;
      chipButton.addEventListener('click', () => void armImageRef(state, entry, chipButton, row));
      row.append(chipButton);
    }
    container.append(row);
  };

  const armImageRef = async (
    state: PanelState,
    entry: { field: string; src: string; name: string },
    chipButton: HTMLButtonElement,
    row: HTMLElement
  ): Promise<void> => {
    chipButton.disabled = true;
    const note = /^\/img\//.test(entry.src) ? undefined : log('sys', 'Mirroring image into blobs…');
    const result = await ensureBlobBackedImage(getToken, state.target.objectId, entry.src);
    note?.remove();
    chipButton.disabled = false;
    if (!result.ok) {
      log('sys', `Could not reference image: ${escapeHtml(result.error)}`);
      return;
    }
    state.imageRef = {
      field: entry.field,
      name: entry.name,
      url: new URL(result.publicPath, window.location.origin).href,
    };
    row.querySelectorAll('.dl-em-imgref').forEach((el) => el.classList.remove('dl-em-armed'));
    chipButton.classList.add('dl-em-armed');
    inputEl.placeholder = `Re: ${entry.name} — describe the change…`;
    log(
      'sys',
      `<span class="dl-em-repill">Re: ${escapeHtml(entry.name)}</span> armed` +
        `${result.mirrored ? ' — mirrored into blobs' : ''}: <code>${escapeHtml(result.publicPath)}</code>. ` +
        'Requests now carry this image’s public URL.'
    );
    inputEl.focus();
  };

  // ── manual edit / image forms ─────────────────────────────────────────────
  // What people are used to: click the pencil, type in fields, save. Save is
  // the same reviewable draft path the AI uses (checkout → patch) — publishing
  // stays a separate act. The image tool is the DELIBERATE way to change an
  // image; the AI is schema-blocked from ever doing it.
  type FormFieldKind = 'text' | 'richtext' | 'lines' | 'image-src' | 'image-alt' | 'asset';
  type FormField = {
    key: string;
    kind: FormFieldKind;
    imageField?: string;
    /** For image ARRAYS (content_split `images: [{src,alt}]`): the item index. */
    imageIndex?: number;
  };

  const formFieldsFor = (data: Record<string, unknown>, mode: PanelMode): FormField[] => {
    const fields: FormField[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (mode === 'image') {
        if (isImageValue(value)) {
          fields.push({ key: `${key}.src`, kind: 'image-src', imageField: key });
          fields.push({ key: `${key}.alt`, kind: 'image-alt', imageField: key });
        } else if (Array.isArray(value) && value.length > 0 && value.every(isImageValue)) {
          // Image arrays (content_split): one src/alt pair per item, in order.
          value.forEach((_, index) => {
            fields.push({ key: `${key}.${index}.src`, kind: 'image-src', imageField: key, imageIndex: index });
            fields.push({ key: `${key}.${index}.alt`, kind: 'image-alt', imageField: key, imageIndex: index });
          });
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

  const imageEntryFor = (data: Record<string, unknown>, field: FormField): { src: string; alt?: string } => {
    const holder = data[field.imageField as string];
    if (field.imageIndex !== undefined) {
      return (holder as Array<{ src: string; alt?: string }>)[field.imageIndex];
    }
    return holder as { src: string; alt?: string };
  };

  const formValueFor = (data: Record<string, unknown>, field: FormField): string => {
    if (field.kind === 'image-src') return imageEntryFor(data, field).src;
    if (field.kind === 'image-alt') return imageEntryFor(data, field).alt ?? '';
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
        // Article node bodies are PLAIN TEXT (escaped at render; blank line =
        // new paragraph) — the HTML-tag hint belongs to section fields only.
        const richNote =
          state.target.objectType === 'content_item'
            ? '<span class="dl-em-fieldnote">Plain text — blank line starts a new paragraph</span>'
            : '<span class="dl-em-fieldnote">p · b · i · link · lists · h2–h3</span>';
        row.innerHTML =
          label +
          `<textarea data-em-field="${escapeHtml(field.key)}">${escapeHtml(value)}</textarea>` +
          (field.kind === 'lines' ? '<span class="dl-em-fieldnote">One per line</span>' : richNote);
      } else if (field.kind === 'image-src') {
        // src + Upload side by side: paste a path, or push a file into the
        // blobs artifacts store (pdf-tool pattern) and get its /img/* path.
        row.innerHTML =
          label +
          `<div class="dl-em-srcrow">` +
          `<input type="text" data-em-field="${escapeHtml(field.key)}" value="${escapeHtml(value)}">` +
          `<button type="button" class="dl-em-btn dl-em-upload dl-em-ico" data-em-upload ` +
          `title="Upload image" aria-label="Upload image">${ICON_UPLOAD}</button>` +
          `<input type="file" accept="image/png,image/jpeg,image/webp" hidden data-em-upload-file>` +
          `</div>`;
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
        const srcInput = row.querySelector<HTMLInputElement>('[data-em-field]');
        srcInput?.addEventListener('input', () => {
          thumb.src = srcInput.value;
        });
        const uploadButton = row.querySelector<HTMLButtonElement>('[data-em-upload]');
        const fileInput = row.querySelector<HTMLInputElement>('[data-em-upload-file]');
        uploadButton?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', () => {
          const file = fileInput.files?.[0];
          if (file && uploadButton && srcInput) void uploadImage(state, file, srcInput, uploadButton);
          fileInput.value = '';
        });
      }
    }
    const foot = document.createElement('div');
    foot.className = 'dl-em-formfoot';
    foot.innerHTML =
      `<button class="dl-em-btn dl-em-save dl-em-ico" data-em-form-save>${ICON_CHECK} Save draft</button>` +
      `<button class="dl-em-btn dl-em-ghost dl-em-ico" data-em-form-cancel title="Cancel" aria-label="Cancel">${ICON_CLOSE}</button>`;
    foot.querySelector('[data-em-form-save]')?.addEventListener('click', () => void saveForm(state, fields));
    foot.querySelector('[data-em-form-cancel]')?.addEventListener('click', closePanel);
    formEl.append(foot);
  };

  // ── navigation copy form ──────────────────────────────────────────────────
  // Chrome edits ride the NAV grammar (set_nav_meta / update_item /
  // upsert_group / remove+upsert_action — nav-editor.ts), never page ops.
  // Copy only: item labels, group titles, brand text, footer note. Targets/
  // hrefs/icons stay admin/agent work — the same boundary the Ask-AI
  // protected-field list draws.
  const renderNavForm = (state: PanelState): void => {
    const fields = navEditFieldsFor(state.navBody as NavigationBody);
    formEl.innerHTML = '';
    if (fields.length === 0) {
      formEl.innerHTML = '<div class="dl-em-fieldnote">No editable copy on this navigation object.</div>';
      return;
    }
    for (const field of fields) {
      const row = document.createElement('div');
      row.className = 'dl-em-formrow';
      row.innerHTML =
        `<label>${escapeHtml(field.label)}</label>` +
        `<input type="text" data-em-nav-field="${escapeHtml(field.key)}" value="${escapeHtml(field.value)}">`;
      formEl.append(row);
    }
    const foot = document.createElement('div');
    foot.className = 'dl-em-formfoot';
    foot.innerHTML =
      `<button class="dl-em-btn dl-em-save dl-em-ico" data-em-form-save>${ICON_CHECK} Save draft</button>` +
      `<button class="dl-em-btn dl-em-ghost dl-em-ico" data-em-form-cancel title="Cancel" aria-label="Cancel">${ICON_CLOSE}</button>`;
    foot.querySelector('[data-em-form-save]')?.addEventListener('click', () => void saveNavForm(state, fields));
    foot.querySelector('[data-em-form-cancel]')?.addEventListener('click', closePanel);
    formEl.append(foot);
  };

  const saveNavForm = async (state: PanelState, fields: NavEditField[]): Promise<void> => {
    const body = state.navBody as NavigationBody;
    const changes: Record<string, string> = {};
    const previews: Array<{ before: string; after: string }> = [];
    for (const field of fields) {
      const input = formEl.querySelector<HTMLInputElement>(`[data-em-nav-field="${CSS.escape(field.key)}"]`);
      if (!input) continue;
      const raw = input.value;
      // Labels are schema-min(1): an emptied input is ignored, not saved.
      if (raw === field.value || !raw.trim()) continue;
      changes[field.key] = raw;
      previews.push({ before: field.value, after: raw });
    }
    if (Object.keys(changes).length === 0) {
      log('sys', 'No changes to save.');
      return;
    }
    let ops: Array<Record<string, unknown>>;
    try {
      ops = navChangesToOps(body, changes);
    } catch (error) {
      log('sys', escapeHtml(error instanceof Error ? error.message : String(error)));
      return;
    }
    const working = log('sys', 'Saving…');
    const objectSession = session('navigation', state.target.objectId);
    const checkout = await objectSession.ensureCheckout();
    if (!checkout.ok) {
      working.remove();
      log('sys', `Locked by ${escapeHtml(checkout.heldBy ?? 'another editor')} — try again when the lock frees.`);
      return;
    }
    const outcome = await objectSession.patch(ops);
    working.remove();
    if (!outcome.ok) {
      const blockers = outcome.blockers?.length ? `<br>${outcome.blockers.map(escapeHtml).join('<br>')}` : '';
      log('sys', `Not saved: ${escapeHtml(outcome.error)}${blockers}`);
      return;
    }
    for (const preview of previews) previewFieldChange(state.region, 'string', preview.before, preview.after);
    // Keep the panel body in step with the draft record, then re-snapshot the
    // form (a later upsert_group resends whole groups — staleness reverts edits).
    state.navBody = applyNavChangesToBody(body, changes);
    renderNavForm(state);
    state.region.classList.add('dl-em-draft');
    log('sys', `${ICON_CHECK} Draft saved — <strong>not published</strong>. Changes apply site-wide on release.`);
    setStatus(`${state.target.objectId}: draft saved.`);
    await refreshPending();
  };

  /**
   * Upload → blobs artifacts store → fill the src input with the public
   * /img/* path. Storage only: nothing changes on the object until the human
   * hits Save draft, and nothing shows publicly until publish + release.
   */
  const uploadImage = async (
    state: PanelState,
    file: File,
    srcInput: HTMLInputElement,
    button: HTMLButtonElement
  ): Promise<void> => {
    button.disabled = true;
    button.classList.add('dl-em-loading');
    try {
      const result = await uploadImageArtifact(getToken, state.target.objectId, file);
      if (!result.ok) {
        log('sys', `Upload failed: ${escapeHtml(result.error)}`);
        return;
      }
      srcInput.value = result.publicPath;
      srcInput.dispatchEvent(new Event('input', { bubbles: true }));
      log(
        'sys',
        `${ICON_CHECK} Image stored in blobs — <code>${escapeHtml(result.publicPath)}</code>. Save draft to use it.`
      );
    } catch (error) {
      log('sys', `Upload failed: ${escapeHtml(error instanceof Error ? error.message : String(error))}`);
    } finally {
      button.disabled = false;
      button.classList.remove('dl-em-loading');
    }
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
        const property = field.kind === 'image-src' ? 'src' : 'alt';
        if (field.imageIndex !== undefined) {
          // Image ARRAY (content_split): patch the whole array (deep-merge
          // replaces arrays wholesale), editing only the touched item.
          const merged =
            (changed[imageKey] as Array<Record<string, unknown>>) ??
            (state.currentData[imageKey] as Array<Record<string, unknown>>).map((item) => ({ ...item }));
          merged[field.imageIndex][property] = raw;
          changed[imageKey] = merged;
        } else {
          const merged =
            (changed[imageKey] as Record<string, unknown>) ??
            ({ ...(state.currentData[imageKey] as Record<string, unknown>) } as Record<string, unknown>);
          merged[property] = raw;
          changed[imageKey] = merged;
        }
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
    const working = log('sys', 'Saving…');
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
    log('sys', `${ICON_CHECK} Draft saved — <strong>not published</strong>.`);
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
    log(
      'user',
      (state.imageRef ? `<span class="dl-em-repill">Re: ${escapeHtml(state.imageRef.name)}</span> ` : '') +
        escapeHtml(instruction)
    );
    inputEl.value = '';
    const working = log('sys', 'Thinking…');

    const response = await askAiSuggestion(getToken, {
      object_type: state.target.objectType,
      object_id: state.target.objectId,
      ...(state.target.objectType === 'page' ? { section_id: state.target.sectionId } : {}),
      ...(state.target.objectType === 'content_item' ? { node_id: state.target.nodeId } : {}),
      ...(state.selectedText ? { selected_text: state.selectedText } : {}),
      ...(state.imageRef ? { image_ref: state.imageRef } : {}),
      instruction,
    });
    working.remove();
    if (!response.ok || !response.suggestion) {
      log('sys', escapeHtml(response.error ?? `Ask-AI failed (HTTP ${response.status})`));
      return;
    }
    const changes = summarizeFieldChanges(state.currentData, response.suggestion);
    if (changes.length === 0) {
      log('ai', 'No changes — the content already satisfies that.');
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
    log('ai', `Previewing ${changes.length} change${changes.length > 1 ? 's' : ''} in place.`);
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
    const working = log('sys', 'Saving…');
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
    log('sys', `${ICON_CHECK} Draft saved — <strong>not published</strong>.`);
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
    log('sys', 'Discarded — nothing saved.');
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
