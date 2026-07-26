/**
 * T2.1 — navigation validators (C§2.3-Navigation), one fixture per rule:
 * empty groups reject, depth ≤ 2, duplicate-target-within-a-group WARNS (never
 * rejects — the audited nav ships the 'Early Access' duplication, C§1.7-4),
 * page-kind targets must be published at publish time (warn while drafting),
 * and `route`-kind targets pass through untouched (Gap Note 2).
 *
 * The headline fixture is the verbatim seeded `nav_header` (the C§1.2 mapping
 * table with route-kind targets per T2.2): it must validate with ZERO hard
 * failures and EXACTLY ONE warning — the Solutions duplicate-target warning.
 */
import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkNavigationStructure,
  checkReferenceIntegrity,
  summarizeValidation,
  validateObject,
  type ObjectValidationContext,
  type ReadinessCriterion,
} from '../../packages/core/server/lib/object-validate.js';

const statusOf = (criteria: ReadinessCriterion[], id: string): string | undefined =>
  criteria.find((criterion) => criterion.id === id)?.status;

// ── the verbatim seeded nav_header (C§1.2, route-kind per Gap Note 2) ────────

const navHeaderBody = () => ({
  role: 'header' as const,
  groups: [
    {
      id: 'g_start_here',
      title: 'Start Here',
      target: { kind: 'route' as const, href: '/' },
      items: [
        {
          id: 'i_home',
          label: 'Home',
          description: 'A science-first overview of what changes in skin after 60.',
          target: { kind: 'route' as const, href: '/' },
        },
        {
          id: 'i_about',
          label: 'About Dr. Lurié',
          description: 'Meet the biophysicist behind the age-aware approach.',
          target: { kind: 'route' as const, href: '/about' },
        },
        {
          id: 'i_start_here_guide',
          label: 'Start Here guide',
          description: 'Begin with the simplest path through Dr. Lurié skin health education.',
          target: { kind: 'route' as const, href: '/start-here' },
        },
      ],
    },
    {
      id: 'g_learn',
      title: 'Learn',
      target: { kind: 'listing' as const, list: 'content_index' as const },
      items: [
        {
          id: 'i_library',
          label: 'Education Library',
          description: 'Browse all skin science articles and practical explainers.',
          target: { kind: 'listing' as const, list: 'content_index' as const },
        },
        {
          id: 'i_topics',
          label: 'Topics',
          description: 'Explore articles grouped by their category frontmatter topics.',
          target: { kind: 'route' as const, href: '/learn/topics' },
        },
        {
          id: 'i_free_guide',
          label: 'Free Guide',
          description: 'Get the structured guide to aging skin and body odor changes.',
          target: { kind: 'route' as const, href: '/guides/free-guide' },
        },
      ],
    },
    {
      id: 'g_solutions',
      title: 'Solutions',
      target: { kind: 'route' as const, href: '/solutions/shop-preview' },
      items: [
        {
          id: 'i_shop_preview',
          label: 'Shop Preview',
          description: 'See the upcoming age-aware skincare product direction.',
          target: { kind: 'route' as const, href: '/solutions/shop-preview' },
        },
        {
          id: 'i_early_access',
          label: 'Early Access',
          description: 'Join updates as research-led solutions become available.',
          target: { kind: 'route' as const, href: '/solutions/early-access' },
        },
        {
          id: 'i_join_early_access',
          label: 'Join Early Access',
          description: 'Request launch notes, previews, and member-only product updates.',
          target: { kind: 'route' as const, href: '/solutions/early-access' },
        },
      ],
    },
  ],
  actions: [
    {
      label: 'Join Early Access',
      target: { kind: 'route' as const, href: '/solutions/early-access' },
      style: 'primary' as const,
    },
  ],
});

// ── the headline acceptance fixture ──────────────────────────────────────────

test('verbatim seeded nav_header validates with zero blockers and exactly one warning (the duplicate-target class)', () => {
  const groups = validateObject({ objectType: 'navigation', objectId: 'nav_header', body: navHeaderBody() });
  const summary = summarizeValidation(groups);
  assert.equal(summary.eligible, true);
  assert.deepEqual(summary.blockers, []);
  assert.equal(summary.warnings.length, 1);
  assert.equal(summary.warnings[0].id, 'nav_duplicates');
  assert.match(summary.warnings[0].message, /Solutions/);
  assert.match(summary.warnings[0].message, /"Early Access" and "Join Early Access"/);
});

// ── per-rule fixtures ─────────────────────────────────────────────────────────

test('empty groups are rejected', () => {
  const body = navHeaderBody();
  body.groups[1].items = [];
  const criteria = checkNavigationStructure(body, {}, false);
  assert.equal(statusOf(criteria, 'nav_groups'), 'missing');
});

test('depth beyond 2 is rejected; one dropdown level is allowed', () => {
  const body = navHeaderBody() as unknown as Record<string, unknown>;
  const groups = body.groups as Array<{ items: Array<Record<string, unknown>> }>;
  // depth 2 (item with children) is fine …
  groups[0].items[0].children = [{ id: 'i_child', label: 'Child', target: { kind: 'route', href: '/x' } }];
  let criteria = checkNavigationStructure(body, {}, false);
  assert.equal(statusOf(criteria, 'nav_depth'), 'complete');
  // … a child of a child is not.
  groups[0].items[0].children = [
    {
      id: 'i_child',
      label: 'Child',
      target: { kind: 'route', href: '/x' },
      children: [{ id: 'i_grandchild', label: 'Grandchild', target: { kind: 'route', href: '/y' } }],
    },
  ];
  criteria = checkNavigationStructure(body, {}, false);
  assert.equal(statusOf(criteria, 'nav_depth'), 'missing');
});

test('duplicate targets within a group WARN and never reject — at draft and at publish alike', () => {
  for (const atPublish of [false, true]) {
    const criteria = checkNavigationStructure(navHeaderBody(), {}, atPublish);
    assert.equal(statusOf(criteria, 'nav_duplicates'), 'warning', `atPublish=${atPublish}`);
  }
});

test('the same target in two DIFFERENT groups is not the within-group duplication', () => {
  const body = navHeaderBody();
  // '/learn/topics' also appears in Solutions: cross-group, no warning added.
  body.groups[2].items[0].target = { kind: 'route', href: '/learn/topics' };
  const criteria = checkNavigationStructure(body, {}, false);
  const message = criteria.find((criterion) => criterion.id === 'nav_duplicates')?.message ?? '';
  assert.ok(!message.includes('Topics'), message);
});

test('M-5 group target mirroring its own item does not trip the duplicate warning', () => {
  // navHeaderBody: group 'Start Here' target '/' AND item 'Home' target '/'.
  const body = navHeaderBody();
  body.groups[2].items.pop(); // drop 'Join Early Access' so no item-level duplicates remain
  const criteria = checkNavigationStructure(body, {}, false);
  assert.equal(statusOf(criteria, 'nav_duplicates'), 'complete');
});

test('page-kind targets: unpublished page warns at draft, rejects at publish, passes when published', () => {
  const body = navHeaderBody();
  body.groups[0].items[0].target = { kind: 'page', page: 'page_home' } as never;

  const unpublished: ObjectValidationContext = {
    resolveObject: () => ({ exists: true, published: false }),
  };
  assert.equal(statusOf(checkNavigationStructure(body, unpublished, false), 'nav_published_targets'), 'warning');
  assert.equal(statusOf(checkNavigationStructure(body, unpublished, true), 'nav_published_targets'), 'missing');

  const published: ObjectValidationContext = {
    resolveObject: () => ({ exists: true, published: true }),
  };
  assert.equal(statusOf(checkNavigationStructure(body, published, true), 'nav_published_targets'), 'complete');
});

test('page-kind existence stays check 3 (reference integrity); route-kind passes through', () => {
  const body = navHeaderBody();
  body.groups[0].items[0].target = { kind: 'page', page: 'page_missing' } as never;
  const context: ObjectValidationContext = { resolveObject: () => ({ exists: false }) };

  const referenceCriteria = checkReferenceIntegrity('navigation', body, context);
  assert.equal(statusOf(referenceCriteria, 'references'), 'missing');

  // The all-route-kind seed consults no resolver at all: integrity is clean
  // even with a resolver that would fail anything it was asked about.
  const failEverything: ObjectValidationContext = { resolveObject: () => ({ exists: false }) };
  const routeOnly = checkReferenceIntegrity('navigation', navHeaderBody(), failEverything);
  assert.equal(statusOf(routeOnly, 'references'), 'optional');
});

test('without a resolver, published-page verification reports optional (not verified here)', () => {
  const criteria = checkNavigationStructure(navHeaderBody(), {}, true);
  assert.equal(statusOf(criteria, 'nav_published_targets'), 'optional');
});

// ── structural-capacity guardrail (header actions) ───────────────────────────
// Content stays flexible (add/remove freely); the registry only advises when a
// role's action slot exceeds the fixed budget its component renders comfortably.

test('a header within the action budget reports capacity complete and adds no warning', () => {
  // The seed fixture carries one action — well under the header max of 3.
  const criteria = checkNavigationStructure(navHeaderBody(), {}, false);
  assert.equal(statusOf(criteria, 'nav_actions_capacity'), 'complete');
  const summary = summarizeValidation(
    validateObject({ objectType: 'navigation', objectId: 'nav_header', body: navHeaderBody() })
  );
  assert.equal(summary.warnings.length, 1, 'capacity within budget must not add a second warning class');
});

test('exceeding the header action budget WARNS (never blocks) — at draft and at publish alike', () => {
  const body = navHeaderBody() as unknown as { actions: Array<Record<string, unknown>> };
  // Four header CTAs — one past the budget.
  body.actions = [
    { label: 'A', target: { kind: 'route', href: '/a' }, style: 'primary' },
    { label: 'B', target: { kind: 'route', href: '/b' }, style: 'primary' },
    { label: 'C', target: { kind: 'route', href: '/c' }, style: 'primary' },
    { label: 'D', target: { kind: 'route', href: '/d' }, style: 'primary' },
  ];
  for (const atPublish of [false, true]) {
    const criteria = checkNavigationStructure(body, {}, atPublish);
    assert.equal(statusOf(criteria, 'nav_actions_capacity'), 'warning', `atPublish=${atPublish}`);
  }
  // Warn-only: an over-budget header must still be publish-eligible (no blocker).
  const summary = summarizeValidation(validateObject({ objectType: 'navigation', objectId: 'nav_header', body }));
  assert.equal(summary.eligible, true);
  assert.ok(
    summary.blockers.every((blocker) => blocker.id !== 'nav_actions_capacity'),
    'capacity is advisory, never a blocker'
  );
});

test('emptying the header action slot is legal (no capacity criterion trips)', () => {
  const body = navHeaderBody() as unknown as { actions: unknown[] };
  body.actions = [];
  const criteria = checkNavigationStructure(body, {}, true);
  assert.equal(statusOf(criteria, 'nav_actions_capacity'), 'complete');
});

test('roles without a configured capacity rule (footer) report capacity complete', () => {
  const body = navHeaderBody() as unknown as { role: string; actions: Array<Record<string, unknown>> };
  body.role = 'footer';
  body.actions = [
    { label: 'A', target: { kind: 'route', href: '/a' } },
    { label: 'B', target: { kind: 'route', href: '/b' } },
    { label: 'C', target: { kind: 'route', href: '/c' } },
    { label: 'D', target: { kind: 'route', href: '/d' } },
    { label: 'E', target: { kind: 'route', href: '/e' } },
  ];
  const criteria = checkNavigationStructure(body, {}, false);
  assert.equal(statusOf(criteria, 'nav_actions_capacity'), 'complete');
});
