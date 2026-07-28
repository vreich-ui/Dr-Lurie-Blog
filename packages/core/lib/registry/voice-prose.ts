/**
 * The prompt-text marker registry (D1, 2026-07-28) — the enforced grammar
 * behind the `voice_not_a_prompt` constraint on `editorial_voice` bodies.
 *
 * A governed voice is DATA: third-person facts about how a publication sounds.
 * The moment a field carries prompt-formatted text, the object stops being data
 * and becomes an unreviewable instruction to whichever model reads it next — an
 * approval that covered "the voice" would silently have covered an injection.
 * So prompt formatting is refused at WRITE, not warned about at publish.
 *
 * ONE definition, two consumers — the same law that keeps every other contract
 * field honest: `object-validate.ts` ENFORCES this catalog (checkEditorialVoice)
 * and `object-contract.ts` DESCRIBES it from the same array, so the published
 * constraint text cannot drift from what actually rejects a write.
 *
 * Deliberately NARROW. Style guidance is often imperative — "Use short
 * sentences", "Avoid hedging", "Never promise a cure" are all legitimate voice
 * prose and must pass. Only unambiguous prompt-engineering artifacts are
 * matched: role assignment, model addressing, chat-turn markers, template
 * placeholders, and output-format commands. When in doubt the marker is left
 * out — a false block on real editorial policy is the more expensive error.
 */

export type PromptTextMarker = {
  /** Stable id, surfaced in the rejection message so a fix is unambiguous. */
  id: string;
  /** What the author wrote that reads as a prompt. */
  label: string;
  pattern: RegExp;
};

export const PROMPT_TEXT_MARKERS: readonly PromptTextMarker[] = [
  // ── role assignment: the classic system-prompt opening ──
  {
    id: 'role_assignment',
    label: 'role assignment ("You are a…", "Act as…", "Your task is…")',
    pattern:
      /\byou\s+are\s+(?:a|an|the)\b|\bact\s+as\s+(?:a|an|the)\b|\bpretend\s+to\s+be\b|\bassume\s+the\s+role\s+of\b|\byour\s+(?:role|task|job|goal|objective)\s+is\b/i,
  },
  // ── addressing a model rather than describing a publication ──
  {
    id: 'model_addressing',
    label: 'addressing an AI model ("as an AI", "language model", a model name)',
    pattern: /\bas\s+an?\s+AI\b|\blanguage\s+model\b|\bchatgpt\b|\bgpt-?[0-9]\b|\bclaude\b|\bllm\b/i,
  },
  // ── chat-turn / instruction-block markers ──
  {
    id: 'chat_turn_marker',
    label: 'chat-turn or instruction-block marker (System:, ### Instruction, <|…|>, [INST])',
    pattern: /(?:^|\n)\s*(?:system|assistant|user|human)\s*:|<\|[^|]*\|>|\[\/?INST\]|#{2,}\s*instruction/i,
  },
  // ── template placeholders: a slot to be filled is not a stated fact ──
  {
    id: 'template_placeholder',
    label: 'template placeholder ({{slot}}, ${slot}, <SLOT>)',
    pattern: /\{\{[^}]*\}\}|\$\{[^}]*\}|<[A-Z][A-Z0-9_]{2,}>/,
  },
  // ── output-format commands: instructions to a generator, not house style ──
  {
    id: 'output_command',
    label: 'output-format command ("respond with…", "output only…", "do not output…", "follow these instructions")',
    pattern:
      /\b(?:respond|reply|answer)\s+(?:only\s+)?(?:with|in)\b|\b(?:output|return|print)\s+(?:only|nothing|the\s+following)\b|\bdo\s+not\s+(?:output|respond|include\s+any)\b|\bfollow\s+(?:these|the\s+following)\s+instructions\b/i,
  },
  // ── a fenced block is prompt scaffolding, never editorial policy prose ──
  {
    id: 'fenced_block',
    label: 'fenced code block (```)',
    pattern: /```/,
  },
];

export type PromptTextFinding = {
  /** Dotted path to the offending string, e.g. `frameworks.0.description`. */
  path: string;
  markerId: string;
  markerLabel: string;
  /** The matched text, trimmed — enough to locate it, never the whole field. */
  excerpt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Every prompt-formatted string in a value tree, deepest-first by walk order.
 * Pure and total: any shape in, findings out (a non-object returns []). Callers
 * decide severity — this module only reports what it sees.
 */
export const findPromptFormattedText = (value: unknown, basePath = ''): PromptTextFinding[] => {
  const findings: PromptTextFinding[] = [];

  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      for (const marker of PROMPT_TEXT_MARKERS) {
        const match = marker.pattern.exec(node);
        if (match) {
          findings.push({
            path: path || '(root)',
            markerId: marker.id,
            markerLabel: marker.label,
            excerpt: match[0].trim().slice(0, 60),
          });
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, path ? `${path}.${index}` : String(index)));
      return;
    }
    if (isRecord(node)) {
      for (const [key, child] of Object.entries(node)) walk(child, path ? `${path}.${key}` : key);
    }
  };

  walk(value, basePath);
  return findings;
};

/** The constraint's human description, derived from the same catalog it enforces. */
export const promptMarkerSummary = (): string => PROMPT_TEXT_MARKERS.map((marker) => marker.label).join('; ');
