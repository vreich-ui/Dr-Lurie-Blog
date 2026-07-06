/**
 * T2.2 verification (offline half): the seed data that
 * scripts/seed-navigation.mjs transports must
 *   1. parse under the navigation.v1 body schema,
 *   2. pass object_validate with ONLY the expected duplicate-target warning
 *      on nav_header (zero warnings on the footers, zero blockers anywhere),
 *   3. match the C§1.2–1.4 mapping tables field-for-field (amendments M-1,
 *      M-2, M-5, M-7; route-kind targets throughout; S-4's nav_footer_home
 *      as its own permanent instance),
 *   4. materialize deterministically to the derived-export path the loader
 *      plumbing (T1.7) reads.
 *
 * The online half — create + validate against the deployed store — is the
 * script itself under --execute.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { materializeNavigation } from '../../netlify/lib/materializers/navigation.js';
import { summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import { navigationBodySchema } from '../../src/schema/bodies/navigation-v1.js';
import {
  NAVIGATION_SEEDS,
  NAVIGATION_SEED_SITE,
  navFooterBody,
  navFooterHomeBody,
  navHeaderBody,
} from '../../scripts/lib/navigation-seed-data.mjs';

type Seed = { objectId: string; body: unknown; expectedWarningIds: string[] };
const seeds = NAVIGATION_SEEDS as Seed[];

test('seed constants: three records, expected ids, single site', () => {
  assert.deepEqual(
    seeds.map((seed) => seed.objectId),
    ['nav_header', 'nav_footer', 'nav_footer_home']
  );
  assert.equal(NAVIGATION_SEED_SITE, 'site_drlurie');
});

test('every seeded body parses under navigation.v1', () => {
  for (const seed of seeds) {
    const parsed = navigationBodySchema.safeParse(seed.body);
    assert.ok(parsed.success, `${seed.objectId}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
  }
});

test('object_validate: zero blockers everywhere; exactly the expected warning set per record', () => {
  for (const seed of seeds) {
    const summary = summarizeValidation(
      validateObject({ objectType: 'navigation', objectId: seed.objectId, body: seed.body })
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId} must have no hard failures`);
    assert.deepEqual(
      summary.warnings.map((warning) => warning.id).sort(),
      [...seed.expectedWarningIds].sort(),
      `${seed.objectId} warning classes`
    );
  }
  // The one warning in the whole seed set is nav_header's duplicate-target
  // (the audited 'Early Access' / 'Join Early Access' pair, C§1.7-4).
  const header = summarizeValidation(
    validateObject({ objectType: 'navigation', objectId: 'nav_header', body: navHeaderBody })
  );
  assert.equal(header.warnings.length, 1);
  assert.match(header.warnings[0].message, /"Early Access" and "Join Early Access"/);
});

// ── C§1.2 — nav_header field-for-field ───────────────────────────────────────

test('nav_header matches the C§1.2 table: groups, labels, M-1 descriptions, M-5 parent targets, action', () => {
  const body = navigationBodySchema.parse(navHeaderBody);
  assert.equal(body.role, 'header');
  assert.deepEqual(
    body.groups.map((group) => group.title),
    ['Start Here', 'Learn', 'Solutions']
  );
  // M-5: every top-level group carries its own (stored, unrendered) target.
  assert.deepEqual(
    body.groups.map((group) => group.target),
    [
      { kind: 'route', href: '/' },
      { kind: 'listing', list: 'content_index' },
      { kind: 'route', href: '/solutions/shop-preview' },
    ]
  );
  assert.deepEqual(
    body.groups.map((group) => group.items.map((item) => item.label)),
    [
      ['Home', 'About Dr. Lurié', 'Start Here guide'],
      ['Education Library', 'Topics', 'Free Guide'],
      ['Shop Preview', 'Early Access', 'Join Early Access'],
    ]
  );
  // M-1: every dropdown item carries its verbatim description.
  for (const group of body.groups) {
    for (const item of group.items) {
      assert.ok(item.description && item.description.length > 10, `${item.label} carries a description`);
    }
  }
  assert.equal(body.groups[0].items[0].description, 'A science-first overview of what changes in skin after 60.');
  // The triple's third leg: the header action (rendered nowhere today —
  // Header.astro ignores `actions` — but carried faithfully).
  assert.deepEqual(body.actions, [
    { label: 'Join Early Access', target: { kind: 'route', href: '/solutions/early-access' }, style: 'primary' },
  ]);
  // Gap Note 2: page-like destinations are route-kind — NO page-kind targets
  // may exist anywhere in the Phase 2 seeds.
  assert.ok(!JSON.stringify(body).includes('"kind":"page"'));
});

// ── C§1.3 — nav_footer field-for-field ───────────────────────────────────────

test('nav_footer matches the C§1.3 table: M-2 slots, M-7 RSS metadata, verbatim footNote, no brand', () => {
  const body = navigationBodySchema.parse(navFooterBody);
  assert.equal(body.role, 'footer');
  // No brand block: Footer.astro's own defaults (SITE.name + default
  // descriptor) must keep applying, exactly as with today's footerData.
  assert.equal(body.brand, undefined);
  assert.deepEqual(
    body.groups.map((group) => [group.title, group.slot]),
    [
      ['Explore', undefined],
      ['Next steps', undefined],
      [undefined, 'secondary'],
      [undefined, 'social'],
    ]
  );
  assert.deepEqual(
    body.groups[0].items.map((item) => item.label),
    ['Home', 'About', 'Education', 'Topics']
  );
  assert.deepEqual(
    body.groups[1].items.map((item) => item.label),
    ['Free Guide', 'Shop Preview', 'Early Access', 'Contact']
  );
  assert.deepEqual(
    body.groups[2].items.map((item) => item.label),
    ['Terms', 'Privacy Policy']
  );
  // M-7: the icon-only RSS link keeps its icon and accessibility label.
  assert.deepEqual(body.groups[3].items, [
    { id: 'i_rss', label: 'RSS', ariaLabel: 'RSS', icon: 'tabler:rss', target: { kind: 'asset', href: '/rss.xml' } },
  ]);
  // Verbatim source string (template-literal whitespace included — the
  // byte-identity guarantee); the C§ table shows its trimmed rendering.
  assert.equal(body.footNote?.trim(), 'Educational content only — not medical advice. © Dr. Lurié.');
  assert.equal(body.footNote, '\n    Educational content only — not medical advice. © Dr. Lurié.\n  ');
});

// ── C§1.4 — nav_footer_home field-for-field (S-4: permanent instance) ───────

test('nav_footer_home matches the C§1.4 table: brand, groups, home-specific labels', () => {
  const body = navigationBodySchema.parse(navFooterHomeBody);
  assert.equal(body.role, 'footer');
  assert.deepEqual(body.brand, { text: 'Dr. Lurié Skin Care', descriptor: 'Healthy Skin for Skincare Newcomers' });
  assert.deepEqual(
    body.groups.map((group) => [group.title, group.slot]),
    [
      ['Start learning', undefined],
      ['Connect', undefined],
      [undefined, 'secondary'],
      [undefined, 'social'],
    ]
  );
  assert.deepEqual(
    body.groups[0].items.map((item) => item.label),
    ['Start Here', 'Library', 'Topics', 'Free Guide']
  );
  assert.deepEqual(
    body.groups[1].items.map((item) => item.label),
    ['About', 'Newsletter']
  );
  // The audited label differences vs nav_footer, kept verbatim (S-4 seeds the
  // end-state instance, not a copy of the global footer).
  assert.equal(body.groups[2].items[1].label, 'Privacy');
  assert.equal(body.groups[0].items[1].label, 'Library');
});

// ── materializer round-trip ──────────────────────────────────────────────────

test('each seed materializes deterministically to its loader path with the __generated marker', () => {
  const meta = { at: '2026-07-06T00:00:00.000Z', record_version: 1 };
  for (const seed of seeds) {
    const first = materializeNavigation(seed.objectId, seed.body, meta);
    const second = materializeNavigation(seed.objectId, seed.body, meta);
    assert.equal(first.path, `src/data/site/navigation/${seed.objectId}.json`);
    assert.equal(first.content, second.content, 'byte-identical re-materialization');
    const parsed = JSON.parse(first.content) as Record<string, unknown>;
    assert.deepEqual(parsed.__generated, {
      from: `objects/navigation/by-id/${seed.objectId}.json`,
      at: meta.at,
      record_version: meta.record_version,
    });
    // The export carries the body verbatim (plus the marker) — what the
    // T2.4 adapter and the T2.5 loader will consume.
    const { __generated: _marker, ...exportedBody } = parsed;
    assert.deepEqual(exportedBody, JSON.parse(JSON.stringify(seed.body)));
  }
});
