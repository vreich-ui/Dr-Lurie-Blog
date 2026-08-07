import { z } from 'zod';

import type { CandidateOptionView, CandidateSetView } from '../../../lib/admin/candidate-choice.js';
import type { ChatToolCall, PendingCandidateSet } from './chat-store.js';
import type { WireTool } from './provider.js';
import { chatToolByName } from './tools.js';

export const PRESENT_CANDIDATES_TOOL_NAME = 'present_candidates';

const candidateInputSchema = z.object({
  content: z.string().min(1).max(30_000),
  self_description: z.string().min(1).max(240),
  tool_name: z.string().min(1),
  tool_args: z.record(z.string(), z.unknown()),
});

export const presentCandidatesInputSchema = z.object({
  candidates: z.array(candidateInputSchema).min(2).max(3),
});

export interface CandidateOption extends CandidateOptionView {
  target: ChatToolCall;
}

export const PRESENT_CANDIDATES_WIRE_TOOL: WireTool = {
  name: PRESENT_CANDIDATES_TOOL_NAME,
  description:
    'Present 2 or 3 genuinely distinct editorial versions for a substantive drafting or rewriting decision. ' +
    'Each version must include the editor-visible content, a one-line explanation of how it differs, and the exact ' +
    'governed write tool call that would apply that version. Use ordinary tools directly for lookups, validation, ' +
    'mechanical changes, or small deterministic fixes.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        minItems: 2,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['content', 'self_description', 'tool_name', 'tool_args'],
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 30000 },
            self_description: { type: 'string', minLength: 1, maxLength: 240 },
            tool_name: { type: 'string', minLength: 1 },
            tool_args: { type: 'object' },
          },
        },
      },
    },
  },
};

export const isPresentCandidatesCall = (call: ChatToolCall): boolean => call.name === PRESENT_CANDIDATES_TOOL_NAME;

export const parseCandidateSet = (
  call: ChatToolCall,
  runId: string,
  parseContext: import('./tools.js').ToolContext
): { ok: true; value: PendingCandidateSet } | { ok: false; error: string } => {
  const parsed = presentCandidatesInputSchema.safeParse(call.args);
  if (!parsed.success) return { ok: false, error: 'Candidates must contain 2–3 complete versions.' };

  const candidates: CandidateOption[] = [];
  for (const [index, candidate] of parsed.data.candidates.entries()) {
    const targetTool = chatToolByName(candidate.tool_name);
    if (!targetTool || targetTool.toolClass === 'read') {
      return { ok: false, error: `Candidate ${index + 1} must resolve to an available governed write tool.` };
    }
    const targetParsed = targetTool.parse(candidate.tool_args, parseContext);
    if (!targetParsed.ok) {
      return { ok: false, error: `Candidate ${index + 1} has invalid write arguments: ${targetParsed.error}` };
    }
    const candidateId = String.fromCharCode(97 + index);
    candidates.push({
      candidate_id: candidateId,
      label: candidateId.toUpperCase(),
      content: candidate.content,
      self_description: candidate.self_description,
      target: { id: `${call.id}_${candidateId}`, name: candidate.tool_name, args: candidate.tool_args },
    });
  }
  return { ok: true, value: { call_id: call.id, run_id: runId, candidates } };
};

export const candidateSetView = (set: PendingCandidateSet): CandidateSetView => ({
  call_id: set.call_id,
  run_id: set.run_id,
  candidates: set.candidates.map(({ target: _target, ...candidate }) => candidate),
});
