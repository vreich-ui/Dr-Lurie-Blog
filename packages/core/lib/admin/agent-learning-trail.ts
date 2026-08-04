/**
 * Canvas Ask-AI proposal capture for CMS Agent learning (S4x, 2/2).
 *
 * The gate is the editor's Save: an Ask-AI round the editor never saves
 * leaves no trace anywhere — held in memory only (edit-mode/ui.ts), dropped
 * the moment the editor navigates away without saving. A round that DOES
 * ride into a save is tagged with what actually happened to it —
 * DETERMINISTICALLY, from the accumulated proposal list plus which proposal
 * (if any) the save actually applied. No model call classifies it.
 *
 * The tagged trail travels to the server inside the SAME object_patch call
 * that performs the save: edit-mode/ui.ts appends one marker entry
 * (`AGENT_LEARNING_TRAIL_OP`) to the `ops` array it already sends, rather
 * than firing a separate request. object-verbs.ts strips the marker out of
 * the ops array before the real patch ops reach the engine — it is never
 * itself a patch op and never touches the object body or `history[].details`.
 * If the underlying patch fails, the marker is discarded right along with
 * it: no orphaned learning record for a change that never landed.
 *
 * Pure and DOM-free (like targets.ts) so the tagging logic is unit-tested
 * without a browser; edit-mode/ui.ts is the only caller that touches state.
 */
import type { ObjectType, Principal } from '../../schema/object-record-v1.js';

/** One Ask-AI round: instruction in, model's suggested patch out — held only in memory until a save. */
export type AccumulatedProposal = {
  instruction: string;
  suggestion: Record<string, unknown>;
  at: string;
};

export type ProposalDisposition = 'accepted_verbatim' | 'accepted_with_edits' | 'superseded_by_reask' | 'discarded';

export type TaggedProposal = AccumulatedProposal & { disposition: ProposalDisposition };

/** The scope a proposal trail accumulates against: an object, optionally narrowed to one section or node. */
export type ProposalScopeTarget = {
  objectType: string;
  objectId: string;
  sectionId?: string;
  nodeId?: string;
};

/**
 * One accumulator per object/section/node (mandate #9) — a page's two
 * sections, or two different article nodes, never share a trail.
 */
export const scopeKeyFor = (target: ProposalScopeTarget): string =>
  `${target.objectType}:${target.objectId}:${target.sectionId ?? ''}:${target.nodeId ?? ''}`;

/** The reserved ops-array marker edit-mode/ui.ts appends alongside the real patch ops for a save. */
export const AGENT_LEARNING_TRAIL_OP = '__agent_learning_trail__' as const;

export type AgentLearningTrailOp = {
  op: typeof AGENT_LEARNING_TRAIL_OP;
  proposals: TaggedProposal[];
};

export const isAgentLearningTrailOp = (value: unknown): value is AgentLearningTrailOp => {
  if (!value || typeof value !== 'object') return false;
  const record = value as { op?: unknown; proposals?: unknown };
  return record.op === AGENT_LEARNING_TRAIL_OP && Array.isArray(record.proposals);
};

/** Plain-JSON structural equality — proposal suggestions are always JSON-safe AI tool-call output. */
const deepEqualJson = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqualJson(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqualJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
};

/**
 * Which accumulated proposal (if any) a save actually used, deterministically.
 * Only the LAST accumulated proposal can ever be "used": Accept always
 * applies the most recent ask's suggestion (an earlier one is, by
 * construction, always superseded the moment a later ask exists), and a
 * manual edit-form save is matched against the most recent ask's suggested
 * fields. `verbatim` is true only when every suggested field landed in the
 * save with an unchanged value — a hand-edited or partial application is
 * "with edits".
 */
export const resolveUsedProposal = (
  proposals: readonly AccumulatedProposal[],
  savedFields: Record<string, unknown> | undefined
): { index: number; verbatim: boolean } | undefined => {
  if (!savedFields || proposals.length === 0) return undefined;
  const lastIndex = proposals.length - 1;
  const last = proposals[lastIndex]!;
  const suggestionKeys = Object.keys(last.suggestion);
  if (suggestionKeys.length === 0) return undefined; // a no-op ("nothing to change") proposal is never "used"
  const overlap = suggestionKeys.filter((key) => key in savedFields);
  if (overlap.length === 0) return undefined;
  const verbatim =
    overlap.length === suggestionKeys.length &&
    overlap.every((key) => deepEqualJson(savedFields[key], last.suggestion[key]));
  return { index: lastIndex, verbatim };
};

/**
 * Deterministic disposition tagging (mandate #10). `used` names the
 * accumulated proposal (by index) that actually landed in the save, if any.
 * Every proposal that isn't `used` and has a later proposal after it was
 * superseded by that later ask; the one at the end of the list with nothing
 * after it (and not used) was asked for and then saved without using it.
 */
export const tagProposalTrail = (
  proposals: readonly AccumulatedProposal[],
  used: { index: number; verbatim: boolean } | undefined
): TaggedProposal[] =>
  proposals.map((proposal, index) => {
    if (used && index === used.index) {
      return { ...proposal, disposition: used.verbatim ? 'accepted_verbatim' : 'accepted_with_edits' };
    }
    const hasLaterProposal = index < proposals.length - 1;
    return { ...proposal, disposition: hasLaterProposal ? 'superseded_by_reask' : 'discarded' };
  });

/**
 * One call: resolve which proposal was used against `savedFields`, tag the
 * whole trail, and wrap it as the ops-array marker — or `undefined` when
 * there is nothing accumulated for this scope (the common case; most saves
 * never followed an Ask-AI round).
 */
export const buildLearningTrailOpIfAny = (
  proposals: readonly AccumulatedProposal[] | undefined,
  savedFields: Record<string, unknown> | undefined
): AgentLearningTrailOp | undefined => {
  if (!proposals || proposals.length === 0) return undefined;
  const used = resolveUsedProposal(proposals, savedFields);
  return { op: AGENT_LEARNING_TRAIL_OP, proposals: tagProposalTrail(proposals, used) };
};

/**
 * The record object-verbs.ts writes to the `agent-learning` blob store —
 * one per save that carried a trail. Never read by the object substrate;
 * training data only (mandate #12's shape exactly: object id + type, site,
 * save timestamp, editor identity if available, tagged proposals).
 */
export type AgentLearningRecord = {
  object_id: string;
  object_type: ObjectType;
  site: string;
  saved_at: string;
  editor?: Principal;
  proposals: TaggedProposal[];
};
