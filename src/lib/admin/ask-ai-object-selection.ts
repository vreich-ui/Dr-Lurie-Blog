/**
 * Generic Ask-AI selection capture (T1.6, client side).
 *
 * Replicates the article editor's selection mechanism (publish.astro
 * onAskAiClick, A§1.4) for the generic objects surface, WITHOUT importing from
 * or altering the article implementation: read the live browser selection, use
 * it only when it is non-collapsed and anchored inside the edited unit's
 * container, and otherwise fall back to a whole-object revision (the article
 * "revise this block" fallback). The decision logic is a pure predicate so it
 * can be unit-tested without a DOM; the thin `captureObjectSelection` wrapper
 * reads `window.getSelection()` and applies it.
 *
 * The captured text becomes the `selected_text` field of the
 * admin-ask-ai-object request; omitting it is the whole-object fallback.
 */

/** Max span length accepted, mirroring the endpoint's `selected_text` bound. */
export const MAX_SELECTION_LENGTH = 4000;

export interface SelectionDecisionInput {
  /** Raw selected text (already scoped to the target container by the caller). */
  text: string;
  /** Whether the selection range is collapsed (caret only, nothing highlighted). */
  isCollapsed: boolean;
  /** Whether the selection is anchored inside the edited unit's container. */
  anchoredInTarget: boolean;
}

/**
 * Decide the `selected_text` to send: the trimmed span when it is a real,
 * in-target highlight within bounds; otherwise `undefined` (whole-object
 * fallback). Pure — no DOM.
 */
export const decideSelectedText = (input: SelectionDecisionInput): string | undefined => {
  if (input.isCollapsed || !input.anchoredInTarget) return undefined;
  const trimmed = input.text.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_SELECTION_LENGTH) return undefined;
  return trimmed;
};

/**
 * Read the live browser selection and return the text to send as
 * `selected_text`, or `undefined` for the whole-object fallback. When
 * `container` is given, the selection must be anchored inside it (the article
 * "anchored in this node's wrapper" rule).
 */
export const captureObjectSelection = (container?: Node | null): string | undefined => {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return undefined;
  const selection = window.getSelection();
  if (!selection) return undefined;

  const anchoredInTarget = container ? Boolean(selection.anchorNode && container.contains(selection.anchorNode)) : true;

  return decideSelectedText({
    text: selection.toString(),
    isCollapsed: selection.isCollapsed,
    anchoredInTarget,
  });
};

export interface ObjectSuggestionRequest {
  object_type: string;
  object_id: string;
  instruction: string;
  selected_text?: string;
  /** Page-only: scope the request to one section instance (edit-mode canvas). */
  section_id?: string;
}

export interface ObjectSuggestionResponse {
  ok: boolean;
  status: number;
  suggestion?: Record<string, unknown>;
  error?: string;
}

/**
 * POST an Ask-AI request for a generic object to the admin endpoint and return
 * the proposed suggestion. Read-only: the caller applies the suggestion through
 * the reviewable object_patch path (T1.5), never a direct write.
 */
export const requestObjectSuggestion = async (
  request: ObjectSuggestionRequest,
  getToken: () => Promise<string>,
  endpoint = '/.netlify/functions/admin-ask-ai-object'
): Promise<ObjectSuggestionResponse> => {
  const token = await getToken();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
  });
  const body = (await response.json().catch(() => ({}))) as {
    suggestion?: Record<string, unknown>;
    error?: string;
  };
  return { ok: response.ok, status: response.status, suggestion: body.suggestion, error: body.error };
};
