/**
 * bio `portrait` field (the reusable "person intro" got a rendered photo when
 * /about was decomposed, 2026-07-10). The design point pinned here: `portrait`
 * is a plain URL ({src, alt}), NOT the `*AssetRef` artifact convention, so it
 * renders a site-asset URL directly and does NOT trip artifact-trust validation
 * (which requires a Major Key reference and rejects arbitrary remote URLs). A
 * bio without a portrait is unchanged (the homepage bio has none).
 */
import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../packages/core/server/lib/object-validate.js';
import { sectionInstanceSchema } from '../../packages/core/schema/bodies/section-v1.js';

const bioWith = (extra: Record<string, unknown>) => ({
  id: 's_bio',
  type: 'bio' as const,
  data: {
    kicker: 'About',
    heading: 'About Dr. Leonid Lurie',
    body: '<p>Intro paragraph.</p>',
    trustNotes: [],
    ...extra,
  },
});

test('bio parses with an optional portrait {src, alt}', () => {
  const parsed = sectionInstanceSchema.safeParse(
    bioWith({ portrait: { src: 'https://kugelmedia.netlify.app/drlurieblog/dr-lurie-portrait.jpg', alt: 'Portrait' } })
  );
  assert.ok(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues));
});

test('bio still parses with no portrait (homepage bio is unaffected)', () => {
  assert.ok(sectionInstanceSchema.safeParse(bioWith({})).success);
});

test('a portrait URL is NOT validated as an artifact ref — no artifact-trust blocker', () => {
  const summary = summarizeValidation(
    validateObject(
      {
        objectType: 'section',
        objectId: 'sec_about_intro',
        body: { section: bioWith({ portrait: { src: 'https://kugelmedia.netlify.app/x.jpg', alt: 'P' } }) },
      },
      {}
    )
  );
  assert.deepEqual(summary.blockers, [], JSON.stringify(summary.blockers));
});

test('by contrast, a raw URL in portraitAssetRef IS rejected (why portrait exists)', () => {
  const summary = summarizeValidation(
    validateObject(
      {
        objectType: 'section',
        objectId: 'sec_bad',
        body: { section: bioWith({ portraitAssetRef: 'https://example.com/x.jpg' }) },
      },
      {}
    )
  );
  assert.ok(
    summary.blockers.some((criterion) => criterion.id === 'artifact_trust'),
    'a URL in the *AssetRef field must fail artifact trust — the reason portrait is a separate URL field'
  );
});
