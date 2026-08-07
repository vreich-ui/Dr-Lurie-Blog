import { describe, it } from 'node:test';
import assert from 'node:assert';

import { candidateAtShortcut, currentCandidateText } from './candidate-choice.js';
import type { ObjectRecord } from '../../schema/object-record-v1.js';

const record = (body: Record<string, unknown>): ObjectRecord =>
  ({
    object_id: 'ci_test',
    object_type: 'content_item',
    schema_version: 'content_item.v1',
    site: 'site_test',
    created_at: '2026-08-07T00:00:00.000Z',
    updated_at: '2026-08-07T00:00:00.000Z',
    status: 'active',
    publication: { published_time: null },
    history: [],
    version: 1,
    content_revision: 1,
    body,
  }) as ObjectRecord;

describe('candidate choice helpers', () => {
  it('builds a readable current baseline without private strategy or agent notes', () => {
    const text = currentCandidateText(
      record({
        title: 'Visible title',
        nodes: [
          {
            id: 'n1',
            public: { body: 'Visible body' },
            private: { strategy: 'hidden strategy', agentNotes: 'hidden notes' },
          },
        ],
      })
    );
    assert.match(text, /Visible title/);
    assert.match(text, /Visible body/);
    assert.doesNotMatch(text, /hidden strategy|hidden notes/);
  });

  it('maps only 1/2/3-style shortcuts to existing candidates', () => {
    const candidates = [
      { candidate_id: 'a', label: 'A', content: 'One', self_description: 'First' },
      { candidate_id: 'b', label: 'B', content: 'Two', self_description: 'Second' },
    ];
    assert.strictEqual(candidateAtShortcut(candidates, '2')?.candidate_id, 'b');
    assert.strictEqual(candidateAtShortcut(candidates, '3'), undefined);
    assert.strictEqual(candidateAtShortcut(candidates, 'x'), undefined);
  });
});
