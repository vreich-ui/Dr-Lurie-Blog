import type { ObjectRecord } from '../../schema/object-record-v1.js';

export interface CandidateOptionView {
  candidate_id: string;
  label: string;
  content: string;
  self_description: string;
}

export interface CandidateSetView {
  call_id: string;
  run_id: string;
  candidates: CandidateOptionView[];
}

const PRIVATE_KEYS = /private|strategy|agent[_-]?notes|system[_-]?prompt|authorization|password|secret|token/i;
const TEXT_LIMIT = 6000;

const collectPublicText = (value: unknown, into: string[], key?: string): void => {
  if (key && PRIVATE_KEYS.test(key)) return;
  if (typeof value === 'string') {
    const text = value
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) into.push(text);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPublicText(entry, into));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) =>
    collectPublicText(child, into, childKey)
  );
};

/**
 * A deliberately lossy, public-text-only baseline for the stage comparison.
 * It is an orientation aid, not a second renderer and never includes the
 * content_item private strategy envelope or agent/authentication fields.
 */
export const currentCandidateText = (record: ObjectRecord, focusId?: string): string => {
  const body = record.body as Record<string, unknown>;
  let source: unknown = body;
  if (record.object_type === 'content_item') {
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    const focused = focusId ? nodes.find((node) => (node as { id?: unknown }).id === focusId) : undefined;
    source = focused
      ? (focused as { public?: unknown }).public
      : {
          title: body.title,
          description: body.description,
          nodes: nodes.map((node) => (node as { public?: unknown }).public),
        };
  } else if (record.object_type === 'page' && focusId && Array.isArray(body.sections)) {
    source = body.sections.find((section) => (section as { id?: unknown }).id === focusId) ?? body;
  } else if (record.object_type === 'section') {
    source = (body.section as { data?: unknown } | undefined)?.data ?? body;
  }
  const parts: string[] = [];
  collectPublicText(source, parts);
  const text = parts.join('\n\n');
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text;
};

export const candidateAtShortcut = (
  candidates: readonly CandidateOptionView[],
  key: string
): CandidateOptionView | undefined => {
  const index = Number(key) - 1;
  return Number.isInteger(index) && index >= 0 ? candidates[index] : undefined;
};
