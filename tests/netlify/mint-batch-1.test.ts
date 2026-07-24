/**
 * T10.5 — mint batch 1 (`media`, `brand_row`, `stats`; the ratified list,
 * design-vocabulary-gaps.md §7).
 *
 * Pins per type: bounded schema accept/reject (rule 6 — enums/limits, no
 * free URLs for video), standalone placeability, registry surfacing (the
 * total-record component registry + contract already anti-drift by
 * construction; here we pin the grown union renders a mixed page valid),
 * brand_row target resolution through the standard action policy, and the
 * media video safety posture (provider + regex-pinned id only — the embed
 * URL is a code template in Media.astro).
 */
import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkStructuralInvariants } from '../../packages/core/server/lib/object-validate.js';
import { brandRowDefinition } from '../../packages/core/lib/registry/components/brand-row.js';
import { mediaDefinition } from '../../packages/core/lib/registry/components/media.js';
import { statsDefinition } from '../../packages/core/lib/registry/components/stats.js';
import { isStandalonePlaceableSectionType } from '../../packages/core/lib/registry/components/registered-types.js';
import { resolveSections, type ResolvePageDeps } from '../../packages/core/lib/renderer/resolve.js';
import { pageBodySchema } from '../../packages/core/schema/bodies/page-v1.js';
import { MEDIA_VIDEO_ID_RE, sectionInstanceSchema, sectionTypes } from '../../packages/core/schema/bodies/section-v1.js';

const instance = (type: string, data: unknown, index = 1) => ({ id: `s_mint${index}`, type, data });
const parses = (type: string, data: unknown, index = 1): boolean =>
  sectionInstanceSchema.safeParse(instance(type, data, index)).success;

// ═══ media ════════════════════════════════════════════════════════════════════

test('media: images and provider-allowlisted videos parse; URLs and junk ids reject', () => {
  assert.ok(
    parses('media', {
      heading: 'Gallery',
      layout: 'grid',
      items: [
        { kind: 'image', src: '/images/a.jpg', alt: 'A' },
        { kind: 'video', provider: 'youtube', videoId: 'dQw4w9WgXcQ', title: 'Routine walkthrough' },
      ],
    })
  );
  assert.ok(!parses('media', { items: [] }), 'at least one item');
  assert.ok(
    !parses('media', { items: Array.from({ length: 9 }, (_, i) => ({ kind: 'image', src: `/i${i}.jpg`, alt: 'x' })) }),
    'max 8 items'
  );
  assert.ok(
    !parses('media', { layout: 'masonry', items: [{ kind: 'image', src: '/a.jpg', alt: 'a' }] }),
    'layout enum'
  );
  assert.ok(
    !parses('media', { items: [{ kind: 'video', provider: 'tiktok', videoId: 'abc12345', title: 't' }] }),
    'provider allowlist'
  );
  assert.ok(
    !parses('media', {
      items: [{ kind: 'video', provider: 'youtube', videoId: 'https://evil.com/x', title: 't' }],
    }),
    'a URL can never be a video id'
  );
  assert.ok(!MEDIA_VIDEO_ID_RE.test('dQw4"><script>'), 'the render template re-asserts this regex');
});

// ═══ brand_row ════════════════════════════════════════════════════════════════

test('brand_row: 2–8 logos, optional label + per-logo targets; targets resolve like actions', () => {
  assert.ok(
    parses('brand_row', {
      heading: 'As seen in',
      logos: [
        { src: '/logos/a.svg', alt: 'Journal A', target: { kind: 'route', href: '/start-here' } },
        { src: '/logos/b.svg', alt: 'Journal B' },
      ],
    })
  );
  assert.ok(!parses('brand_row', { logos: [{ src: '/l.svg', alt: 'only one' }] }), 'min 2 logos');
  assert.ok(
    !parses('brand_row', {
      logos: [
        { src: '/a.svg', alt: 'a', href: 'https://x.com' },
        { src: '/b.svg', alt: 'b' },
      ],
    }),
    'no raw href field — targets only (.strict())'
  );

  const deps = {
    resolveActionHref: (target: { href?: string }) => `resolved:${target.href}`,
  } as unknown as ResolvePageDeps;
  const sections = resolveSections(
    [
      instance('brand_row', {
        logos: [
          { src: '/a.svg', alt: 'a', target: { kind: 'route', href: '/x' } },
          { src: '/b.svg', alt: 'b' },
        ],
      }),
    ] as never,
    deps
  );
  assert.deepEqual(sections[0]!.resolved, { logoHrefs: ['resolved:/x', undefined] });
});

// ═══ stats ════════════════════════════════════════════════════════════════════

test('stats: 2–6 bounded items; long values and singletons reject', () => {
  assert.ok(
    parses('stats', {
      kicker: 'By the numbers',
      items: [
        { value: '10k+', label: 'Readers', sublabel: 'monthly' },
        { value: '97%', label: 'Satisfaction' },
      ],
    })
  );
  assert.ok(!parses('stats', { items: [{ value: '1', label: 'lonely' }] }), 'min 2 items');
  assert.ok(
    !parses('stats', { items: Array.from({ length: 7 }, (_, i) => ({ value: String(i), label: 'l' })) }),
    'max 6 items'
  );
  assert.ok(
    !parses('stats', {
      items: [
        { value: 'x'.repeat(25), label: 'a' },
        { value: '1', label: 'b' },
      ],
    }),
    'value ≤24'
  );
});

// ═══ registry + placeability + the grown union ════════════════════════════════

test('all three mints are registered, standalone-placeable, and carry editor hints', () => {
  // The component BINDING is a total Record over REGISTERED_SECTION_TYPES in
  // components/index.ts — a missing binding is a compile error caught by
  // `astro check` (the harness deliberately never imports .astro files).
  const definitions = { media: mediaDefinition, brand_row: brandRowDefinition, stats: statsDefinition } as const;
  for (const type of ['media', 'brand_row', 'stats'] as const) {
    assert.ok(isStandalonePlaceableSectionType(type), `${type} is standalone-placeable`);
    assert.ok((definitions[type].editor.useWhen ?? '').length > 20, `${type} carries a real useWhen`);
    assert.ok((sectionTypes as readonly string[]).includes(type), `${type} in the union`);
  }
});

test('the grown union pins: a page carrying one of each mint validates placeable', () => {
  const body = pageBodySchema.parse({
    route: '/mint-fixture',
    pageType: 'standard',
    title: 'Mint fixture',
    seo: {},
    sections: [
      instance('media', { items: [{ kind: 'image', src: '/a.jpg', alt: 'a' }] }, 1),
      instance(
        'brand_row',
        {
          logos: [
            { src: '/a.svg', alt: 'a' },
            { src: '/b.svg', alt: 'b' },
          ],
        },
        2
      ),
      instance(
        'stats',
        {
          items: [
            { value: '1', label: 'one' },
            { value: '2', label: 'two' },
          ],
        },
        3
      ),
    ],
  });
  const criteria = checkStructuralInvariants('page', 'page_mint_fixture', body, {}, false);
  const placeable = criteria.find((criterion) => criterion.id === 'structure_placeable');
  assert.equal(placeable?.status ?? 'complete', 'complete');
  const blockers = criteria.filter((criterion) => criterion.status === 'missing');
  assert.deepEqual(blockers, [], JSON.stringify(blockers));
});
