import assert from 'node:assert/strict';
import test from 'node:test';

import { getWorkSummary } from './work-summary.js';
import type { ChatSummaryView } from './chat-client.js';
import type { LibraryRow } from './library-logic.js';

const row = (id: string, review_state: LibraryRow['review_state']): LibraryRow => ({
  object_id: id,
  object_type: 'page',
  display_name: id,
  updated_at: '2026-08-07T10:00:00.000Z',
  status: 'active',
  review_state,
  published_time: null,
  unpublished_changes: true,
});

const chat = (id: string, status: ChatSummaryView['status'], object_id?: string): ChatSummaryView => ({
  chat_id: id,
  kind: object_id ? 'object' : 'free',
  ...(object_id ? { object_id, object_type: 'page' } : {}),
  title: id,
  status,
  updated_at: '2026-08-07T10:00:00.000Z',
  last_outcome: null,
});

test('work summary derives compact counts without double-counting an object chat and its open review', () => {
  const summary = getWorkSummary(
    [row('page_a', 'open'), row('page_b', 'open')],
    [chat('work', 'running', 'page_c'), chat('ask', 'awaiting_approval', 'page_a')]
  );
  assert.equal(summary.workingCount, 1);
  assert.equal(summary.needsYouCount, 2);
  assert.deepEqual(
    summary.pendingReviews.map((item) => item.object_id),
    ['page_b']
  );
});
