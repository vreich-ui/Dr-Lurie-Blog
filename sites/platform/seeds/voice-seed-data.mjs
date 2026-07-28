/**
 * Declared editorial voice for 'voice_platform' (D1, 2026-07-28).
 *
 * The platform site documents the object substrate to the people who operate
 * it — so the voice is precise, unhedged, and mechanical, and every claim it
 * makes is checkable against a contract or a commit. Written as FACTS about the
 * publication, never as instructions to a model (the voice_not_a_prompt
 * constraint refuses the latter at write).
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --site sites/platform --seeds sites/platform/seeds/voice-seed-data.mjs
 */

export const SEED_SITE = 'site_platform';

export const voiceBody = {
  name: 'Kugel Platform — operator documentation voice',
  audience:
    'Operators and agent authors working against the object substrate: people who will act on what they read, ' +
    'immediately, against a live system they can break.',
  tone: ['precise', 'unhedged', 'mechanical', 'plain'],
  cadence:
    'Short declarative sentences. One idea per sentence, one claim per paragraph. Present tense, third person about ' +
    'the system; second person only in a procedure step. Paragraphs run two to four sentences; anything longer is a ' +
    'list that has not been written as one yet.',
  lexicon: {
    prefer: ['object', 'contract', 'governed', 'refused', 'gate', 'commit', 'materialize', 'verified'],
    avoid: [
      'simply',
      'just',
      'easy',
      'seamless',
      'powerful',
      'leverage',
      'robust',
      'best-in-class',
      'unlock',
      'delight',
    ],
  },
  claim_policy:
    'Every behavioral claim names the thing that enforces it — a contract field, a constraint id, a verb, or a commit. ' +
    'A claim that cannot be pointed at is cut, not softened. Planned behavior is labelled as planned, in the same ' +
    'sentence, never in a footnote.',
  cta_policy:
    'One action per page, phrased as the next concrete step against the system ("fetch the contract", "run the ' +
    'roundtrip"). No urgency framing, no sign-up pressure, no manufactured scarcity.',
  reader_safety_notes:
    'The audience acts on this text against production systems, so an ambiguous instruction is a real outage. ' +
    'Destructive or irreversible steps carry their blast radius in the same sentence as the step. Nothing on this ' +
    'site is medical, legal, or financial guidance.',
  frameworks: [
    {
      framework_id: 'fw_concept',
      label: 'Concept explainer',
      description:
        'Names one idea in the substrate, states what problem it exists to solve, and shows the smallest example that ' +
        'makes it real.',
      when_to_use:
        'The reader does not yet have the vocabulary. Pick this when the topic is a noun (a type, a gate, a lifecycle) ' +
        'rather than a task.',
      beats: ['What it is', 'Why it exists', 'Smallest real example', 'What it is not', 'Where to go next'],
    },
    {
      framework_id: 'fw_procedure',
      label: 'Procedure',
      description: 'An ordered path from a stated starting state to a stated end state, with a verification step.',
      when_to_use:
        'The reader has a task and a live system. Pick this when success is checkable — if there is nothing to verify ' +
        'at the end, it is a concept explainer wearing numbered steps.',
      beats: ['Starting state', 'Steps in order', 'How to verify it worked', 'What to do when it did not'],
    },
    {
      framework_id: 'fw_decision',
      label: 'Decision record',
      description:
        'States a decision that was made, the alternatives considered, the evidence, and what the decision forecloses.',
      when_to_use:
        'The topic is a choice with live consequences and a reader would otherwise re-litigate it. Pick this over the ' +
        'concept explainer when the interesting content is WHY-not, not what.',
      beats: ['The decision', 'Alternatives considered', 'Evidence', 'What this forecloses', 'How to reopen it'],
    },
  ],
  default_framework: 'fw_concept',
};

export const CONVERSION_SEEDS = [{ objectType: 'editorial_voice', objectId: 'voice_platform', body: voiceBody }];
