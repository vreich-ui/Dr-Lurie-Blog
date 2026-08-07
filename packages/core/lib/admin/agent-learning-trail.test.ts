import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  AGENT_LEARNING_TRAIL_OP,
  buildLearningTrailOpIfAny,
  buildLearningEvidenceOp,
  buildManualRichTextEdits,
  isAgentLearningTrailOp,
  resolveUsedProposal,
  scopeKeyFor,
  tagProposalTrail,
  type AccumulatedProposal,
} from './agent-learning-trail.js';

const proposal = (
  instruction: string,
  suggestion: Record<string, unknown>,
  at = '2026-08-04T00:00:00.000Z'
): AccumulatedProposal => ({
  instruction,
  suggestion,
  at,
});

describe('scopeKeyFor', () => {
  it('distinguishes object/section/node scopes, including two different sections on the same page', () => {
    const page = { objectType: 'page', objectId: 'page_home' };
    assert.notStrictEqual(scopeKeyFor({ ...page, sectionId: 's_a' }), scopeKeyFor({ ...page, sectionId: 's_b' }));
    assert.notStrictEqual(
      scopeKeyFor({ objectType: 'content_item', objectId: 'req_1', nodeId: 'n_a' }),
      scopeKeyFor({ objectType: 'content_item', objectId: 'req_1', nodeId: 'n_b' })
    );
    assert.strictEqual(
      scopeKeyFor({ ...page, sectionId: 's_a' }),
      scopeKeyFor({ ...page, sectionId: 's_a' }),
      'the same target must key identically across separate openPanel calls'
    );
  });
});

describe('resolveUsedProposal / tagProposalTrail — disposition tagging', () => {
  it('accepted_verbatim: a single ask, applied unmodified', () => {
    const proposals = [proposal('Tighten this', { title: 'A punchier hook' })];
    const used = resolveUsedProposal(proposals, { title: 'A punchier hook' });
    assert.deepStrictEqual(used, { index: 0, verbatim: true });
    assert.deepStrictEqual(
      tagProposalTrail(proposals, used).map((p) => p.disposition),
      ['accepted_verbatim']
    );
  });

  it('accepted_with_edits: asked once, edited before save', () => {
    const proposals = [proposal('Tighten this', { title: 'A punchier hook', deck: 'New deck' })];
    // The editor kept the AI's title but hand-rewrote the deck before saving.
    const used = resolveUsedProposal(proposals, { title: 'A punchier hook', deck: 'A hand-edited deck' });
    assert.deepStrictEqual(used, { index: 0, verbatim: false });
    assert.deepStrictEqual(
      tagProposalTrail(proposals, used).map((p) => p.disposition),
      ['accepted_with_edits']
    );
  });

  it('accepted_with_edits: only a subset of the suggested fields landed in the save', () => {
    const proposals = [proposal('Tighten this', { title: 'New title', deck: 'New deck' })];
    const used = resolveUsedProposal(proposals, { title: 'New title' });
    assert.deepStrictEqual(used, { index: 0, verbatim: false });
  });

  it('discarded: asked once, saved without using it at all (no field overlap)', () => {
    const proposals = [proposal('Tighten this', { title: 'A punchier hook' })];
    const used = resolveUsedProposal(proposals, { author: 'Wolf' }); // an unrelated field saved
    assert.strictEqual(used, undefined);
    assert.deepStrictEqual(
      tagProposalTrail(proposals, used).map((p) => p.disposition),
      ['discarded']
    );
  });

  it('discarded: a proposal with no suggested changes ("nothing to change") is never used', () => {
    const proposals = [proposal('Tighten this', {})];
    const used = resolveUsedProposal(proposals, { title: 'Something else entirely' });
    assert.strictEqual(used, undefined);
  });

  it('superseded_by_reask + discarded: asked twice, used neither', () => {
    const proposals = [
      proposal('First try', { title: 'Draft one' }),
      proposal('Better version', { title: 'Draft two' }),
    ];
    // The save touches a field neither proposal's suggestion covers.
    const used = resolveUsedProposal(proposals, { author: 'Wolf' });
    assert.strictEqual(used, undefined);
    assert.deepStrictEqual(
      tagProposalTrail(proposals, used).map((p) => p.disposition),
      ['superseded_by_reask', 'discarded']
    );
  });

  it('superseded_by_reask + accepted_verbatim: re-asked, then accepted the later suggestion', () => {
    const proposals = [
      proposal('First try', { title: 'Draft one' }),
      proposal('Better version', { title: 'Draft two' }),
    ];
    const used = resolveUsedProposal(proposals, { title: 'Draft two' });
    assert.deepStrictEqual(used, { index: 1, verbatim: true });
    assert.deepStrictEqual(
      tagProposalTrail(proposals, used).map((p) => p.disposition),
      ['superseded_by_reask', 'accepted_verbatim']
    );
  });

  it('three rounds, none used: every earlier ask is superseded, only the last is (merely) discarded', () => {
    const proposals = [
      proposal('v1', { title: 'One' }),
      proposal('v2', { title: 'Two' }),
      proposal('v3', { title: 'Three' }),
    ];
    // The save touches a field none of the three suggestions cover at all —
    // only the LAST proposal is ever checked as a candidate for "used", and
    // it has no overlap either.
    const used = resolveUsedProposal(proposals, { author: 'Wolf' });
    assert.strictEqual(used, undefined);
    assert.deepStrictEqual(
      tagProposalTrail(proposals, used).map((p) => p.disposition),
      ['superseded_by_reask', 'superseded_by_reask', 'discarded']
    );
  });

  it('no accumulated proposals resolves to no used proposal', () => {
    assert.strictEqual(resolveUsedProposal([], { title: 'x' }), undefined);
  });

  it('no saved fields (e.g. a save with nothing that overlaps) resolves to no used proposal', () => {
    const proposals = [proposal('ask', { title: 'x' })];
    assert.strictEqual(resolveUsedProposal(proposals, undefined), undefined);
  });
});

describe('buildLearningTrailOpIfAny', () => {
  it('returns undefined when nothing has been accumulated for this scope — the common, no-Ask-AI save', () => {
    assert.strictEqual(buildLearningTrailOpIfAny(undefined, { title: 'x' }), undefined);
    assert.strictEqual(buildLearningTrailOpIfAny([], { title: 'x' }), undefined);
  });

  it('builds the marker op with the fully tagged trail when proposals are pending', () => {
    const proposals = [proposal('Tighten this', { title: 'A punchier hook' })];
    const op = buildLearningTrailOpIfAny(proposals, { title: 'A punchier hook' });
    assert.ok(op);
    assert.strictEqual(op.op, AGENT_LEARNING_TRAIL_OP);
    assert.deepStrictEqual(op.proposals, [{ ...proposals[0], disposition: 'accepted_verbatim' }]);
  });
});

describe('manual rich-text learning evidence', () => {
  it('captures exact before/after only for explicitly allowlisted public text fields', () => {
    const edits = buildManualRichTextEdits(
      { objectType: 'content_item', objectId: 'ci_1', nodeId: 'node_1' },
      { body: 'Before', private: 'hidden' },
      { body: 'After', private: 'changed hidden' },
      ['body'],
      '2026-08-07T12:00:00.000Z'
    );
    assert.strictEqual(edits.length, 1);
    assert.strictEqual(edits[0]?.original_text, 'Before');
    assert.strictEqual(edits[0]?.replacement_text, 'After');
    assert.strictEqual(edits[0]?.focus, 'node:node_1/field:body');
    assert.doesNotMatch(JSON.stringify(edits), /hidden/);
  });

  it('keeps repeated corrections as separate additive events and never mutates a profile', () => {
    const first = buildManualRichTextEdits(
      { objectType: 'page', objectId: 'page_1', sectionId: 's_1' },
      { heading: 'One' },
      { heading: 'Two' },
      ['heading'],
      '2026-08-07T12:00:00.000Z'
    );
    const second = buildManualRichTextEdits(
      { objectType: 'page', objectId: 'page_1', sectionId: 's_1' },
      { heading: 'Two' },
      { heading: 'Three' },
      ['heading'],
      '2026-08-07T12:01:00.000Z'
    );
    const op = buildLearningEvidenceOp(undefined, { heading: 'Three' }, [...first, ...second]);
    assert.strictEqual(op?.manual_edits?.length, 2);
    assert.deepStrictEqual(op?.proposals, []);
    assert.ok(!('profile' in (op ?? {})));
  });
});

describe('isAgentLearningTrailOp', () => {
  it('recognizes a well-formed marker op and rejects everything else', () => {
    assert.strictEqual(isAgentLearningTrailOp({ op: AGENT_LEARNING_TRAIL_OP, proposals: [] }), true);
    assert.strictEqual(isAgentLearningTrailOp({ op: 'update_section_data', fields: {} }), false);
    assert.strictEqual(isAgentLearningTrailOp({ op: AGENT_LEARNING_TRAIL_OP }), false, 'missing proposals array');
    assert.strictEqual(isAgentLearningTrailOp(null), false);
    assert.strictEqual(isAgentLearningTrailOp('not an object'), false);
    assert.strictEqual(isAgentLearningTrailOp(42), false);
  });
});
