import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reviewerAvailableActions, tierForDisplay } from './object-review-ui.js';

describe('tierForDisplay', () => {
  it('maps page/section/template to Tier 2 and navigation/taxonomy/site to Tier 3', () => {
    assert.equal(tierForDisplay('page'), 2);
    assert.equal(tierForDisplay('section'), 2);
    assert.equal(tierForDisplay('template'), 2);
    assert.equal(tierForDisplay('navigation'), 3);
    assert.equal(tierForDisplay('taxonomy'), 3);
    assert.equal(tierForDisplay('site'), 3);
  });
});

const approvedReview = (contentRevision: number) => ({
  state: 'approved' as const,
  decisions: [{ content_revision: contentRevision }],
});

describe('reviewerAvailableActions — the Tier 3 / agent acceptance criterion', () => {
  it('a Tier 3 object with a current approval offers Publish to a human but never to an agent', () => {
    const base = {
      objectType: 'navigation' as const,
      hasActiveLock: false,
      review: approvedReview(4),
      contentRevision: 4,
    };

    const forHuman = reviewerAvailableActions({ ...base, principalKind: 'human', roles: ['admin'] });
    assert.equal(forHuman.canPublish, true, 'a role-holding human with a current approval must see Publish');

    const forAgent = reviewerAvailableActions({ ...base, principalKind: 'agent', roles: [] });
    assert.equal(forAgent.canPublish, false, 'an agent must never be offered Publish for a Tier 3 object');
  });

  it('an agent is denied Publish for every Tier 3 type even with a current approval and (hypothetically) admin roles', () => {
    for (const objectType of ['navigation', 'taxonomy', 'site'] as const) {
      const result = reviewerAvailableActions({
        objectType,
        principalKind: 'agent',
        roles: ['admin', 'publisher'], // agents never actually carry roles (roles.ts) — proves this isn't a role gap
        hasActiveLock: true,
        review: approvedReview(1),
        contentRevision: 1,
      });
      assert.equal(result.canPublish, false, `${objectType}: agent must be denied regardless of roles`);
    }
  });

  it('Tier 2 also requires a current approval + role for a human, and is likewise absent for an agent', () => {
    for (const objectType of ['page', 'section', 'template'] as const) {
      const humanApproved = reviewerAvailableActions({
        objectType,
        principalKind: 'human',
        roles: ['publisher'],
        hasActiveLock: false,
        review: approvedReview(2),
        contentRevision: 2,
      });
      assert.equal(humanApproved.canPublish, true);

      const agentApproved = reviewerAvailableActions({
        objectType,
        principalKind: 'agent',
        roles: [],
        hasActiveLock: false,
        review: approvedReview(2),
        contentRevision: 2,
      });
      assert.equal(agentApproved.canPublish, false);
    }
  });
});

describe('reviewerAvailableActions — approval currency and role gates', () => {
  it('canPublish is false without an approval at all', () => {
    const result = reviewerAvailableActions({
      objectType: 'page',
      principalKind: 'human',
      roles: ['admin'],
      hasActiveLock: false,
      review: undefined,
      contentRevision: 3,
    });
    assert.equal(result.canPublish, false);
  });

  it('canPublish is false once content_revision has moved past the pinned approval (stale)', () => {
    const result = reviewerAvailableActions({
      objectType: 'page',
      principalKind: 'human',
      roles: ['admin'],
      hasActiveLock: false,
      review: approvedReview(2),
      contentRevision: 3, // a body write happened after approval
    });
    assert.equal(result.canPublish, false);
  });

  it('canPublish is false for an editor (no publish role) even with a current approval', () => {
    const result = reviewerAvailableActions({
      objectType: 'site',
      principalKind: 'human',
      roles: ['editor'],
      hasActiveLock: false,
      review: approvedReview(1),
      contentRevision: 1,
    });
    assert.equal(result.canPublish, false);
  });

  it('canApprove/canRequestChanges require an open review and at least one human role', () => {
    const noRole = reviewerAvailableActions({
      objectType: 'page',
      principalKind: 'human',
      roles: [],
      hasActiveLock: false,
      review: { state: 'open', decisions: [] },
      contentRevision: 1,
    });
    assert.equal(noRole.canApprove, false);
    assert.equal(noRole.canRequestChanges, false);

    const withRole = reviewerAvailableActions({
      objectType: 'page',
      principalKind: 'human',
      roles: ['editor'],
      hasActiveLock: false,
      review: { state: 'open', decisions: [] },
      contentRevision: 1,
    });
    assert.equal(withRole.canApprove, true);
    assert.equal(withRole.canRequestChanges, true);

    const notOpen = reviewerAvailableActions({
      objectType: 'page',
      principalKind: 'human',
      roles: ['editor'],
      hasActiveLock: false,
      review: approvedReview(1),
      contentRevision: 1,
    });
    assert.equal(notOpen.canApprove, false);
    assert.equal(notOpen.canRequestChanges, false);
  });

  it('canSubmitForReview only reflects lock possession', () => {
    assert.equal(
      reviewerAvailableActions({
        objectType: 'page',
        principalKind: 'human',
        roles: [],
        hasActiveLock: true,
        contentRevision: 1,
      }).canSubmitForReview,
      true
    );
    assert.equal(
      reviewerAvailableActions({
        objectType: 'page',
        principalKind: 'human',
        roles: [],
        hasActiveLock: false,
        contentRevision: 1,
      }).canSubmitForReview,
      false
    );
  });
});
