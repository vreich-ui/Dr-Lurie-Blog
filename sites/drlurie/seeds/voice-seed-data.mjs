/**
 * Declared editorial voice for 'voice_drlurie' (D1, 2026-07-28).
 *
 * Dr. Lurie publishes consumer-facing skin-health content, which makes the
 * claim policy and the reader-safety boundaries the load-bearing fields here —
 * not the tone adjectives. This voice is DATA describing the publication; the
 * voice_not_a_prompt constraint refuses any field that reads as an instruction
 * to a model.
 *
 * ⚠️ The values below are a STARTING POSTURE derived from the client's existing
 * published corpus and its standing reader-safety rules, not a sign-off from
 * the client. dr-lurie voice changes are approval-gated (see
 * sites/drlurie/config/approval-policy.ts) precisely so this seed is a proposal
 * a human confirms, never a fait accompli.
 *
 * Driver contract for scripts/home-conversion-roundtrip.mjs:
 *   --site sites/drlurie --seeds sites/drlurie/seeds/voice-seed-data.mjs
 */

export const SEED_SITE = 'site_drlurie';

export const voiceBody = {
  name: 'Dr. Lurie — evidence-led skin health',
  audience:
    'Adults making decisions about their own skin, most arriving from a search with a specific worry and no clinical ' +
    'training. They are capable of nuance and are tired of being sold to.',
  tone: ['warm', 'calm', 'evidence-led', 'non-alarmist'],
  cadence:
    'Conversational but disciplined. Short sentences carry the medical content; longer ones carry the reassurance. ' +
    'Second person for the reader, third person for the science. Paragraphs stay under four sentences so a worried ' +
    'reader can scan without losing the thread.',
  lexicon: {
    prefer: ['evidence', 'studies suggest', 'in most people', 'your dermatologist', 'ingredient', 'routine', 'barrier'],
    avoid: [
      'miracle',
      'cure',
      'detox',
      'toxin',
      'chemical-free',
      'anti-aging',
      'flawless',
      'clinically proven',
      'guaranteed',
      'reverse',
    ],
  },
  claim_policy:
    'Efficacy statements are hedged to the strength of the evidence behind them and attributed in-line. No claim to ' +
    'treat, cure, prevent, or diagnose any condition. Individual variation is stated wherever an outcome is described. ' +
    'A claim without a citable source is cut rather than softened into vagueness.',
  cta_policy:
    'At most one ask per article, and it is always the low-commitment one — read the next piece, or raise it with a ' +
    'clinician. Never urgency, never scarcity, never a purchase framed as a health necessity.',
  reader_safety_notes:
    'Consumer health audience with no clinical training: an over-confident sentence here can delay real care. Anything ' +
    'that could read as a diagnosis, a dosage, or a substitute for seeing a clinician is out. Content touching ' +
    'pregnancy, minors, prescription actives, or procedures carries the see-a-professional boundary in the body, not ' +
    'only in a footer disclaimer. Before/after framing that implies a guaranteed outcome is refused.',
  frameworks: [
    {
      framework_id: 'fw_concern',
      label: 'Concern explainer',
      description:
        'Takes one thing a reader is worried about, explains what is actually happening in the skin, and states what ' +
        'the evidence supports doing about it.',
      when_to_use:
        'The reader arrived with a symptom or a fear. Pick this when the search intent is "what is this / is this bad".',
      beats: [
        'What you are seeing',
        'What is happening underneath',
        'What the evidence supports',
        'What is not worth your money',
        'When to see someone',
      ],
    },
    {
      framework_id: 'fw_ingredient',
      label: 'Ingredient review',
      description:
        'One active or ingredient class: what it does, the strength of the evidence, who it suits, and how it fails.',
      when_to_use:
        'The subject is a named ingredient rather than a symptom. Pick this over the concern explainer when the reader ' +
        'already has a product in hand.',
      beats: ['What it is', 'What the evidence shows', 'Who it suits', 'How people get it wrong', 'Interactions'],
    },
    {
      framework_id: 'fw_routine',
      label: 'Routine guide',
      description: 'An ordered routine for a stated skin situation, with the reasoning behind each step.',
      when_to_use:
        'The reader wants a sequence, not an explanation. Pick this only when the situation is common enough that a ' +
        'general routine is responsible advice.',
      beats: ['Who this is for', 'The steps in order', 'Why this order', 'What to drop first if it irritates'],
    },
    {
      framework_id: 'fw_myth',
      label: 'Myth check',
      description: 'States a widely-repeated claim, what is actually known, and where the belief came from.',
      when_to_use:
        'The topic is a persistent false belief. Pick this when correcting the record IS the article — never as a ' +
        'pretext to sell the alternative.',
      beats: ['The claim', 'What is actually known', 'Where the belief came from', 'What to do instead'],
    },
  ],
  default_framework: 'fw_concern',
};

export const CONVERSION_SEEDS = [{ objectType: 'editorial_voice', objectId: 'voice_drlurie', body: voiceBody }];
