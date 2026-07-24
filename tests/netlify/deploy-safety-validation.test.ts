/**
 * The two write-time guardrails that close the known "agent blocks the
 * pipeline" dead ends (playbook traps 5 + 14):
 *
 *   - renderability: fields a component splits are checked with the REAL
 *     splitters, so a paragraph-only body carrying <h2>/<ul> is a blocker at
 *     patch/create/publish instead of a build explosion at the next release;
 *   - deploy safety: renderable strings must not contain protected env values
 *     (raw, URL-encoded, double-encoded — the trap-14 incident shape) or
 *     repo-file hotlink URL families (raw.githubusercontent / weserv proxies).
 *
 * Both surface through the full validateObject pipeline (patch and create and
 * publish all run it), so an agent gets the named error at write time.
 */
import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkDeploySafety,
  checkRenderability,
  protectedEnvValues,
  summarizeValidation,
  validateObject,
} from '../../packages/core/server/lib/object-validate.js';

const paragraphSection = (type: string, body: string) => ({
  id: 's_x',
  type,
  data: { heading: 'H', body, ...(type === 'hero' || type === 'lede' ? { actions: [] } : {}) },
});

test('renderability: a paragraph-only body carrying a heading is a blocker naming the section', () => {
  for (const type of ['hero', 'lede', 'bio', 'cta_banner', 'newsletter_signup']) {
    const [criterion] = checkRenderability('section', { section: paragraphSection(type, '<p>ok</p><h2>Nope</h2>') });
    assert.equal(criterion.status, 'missing', `${type} must block`);
    assert.ok(criterion.message.includes(`'s_x'`), criterion.message);
    assert.ok(criterion.message.includes('paragraph-only'), criterion.message);
  }
});

test('renderability: prose accepts headings/lists; paragraph-only types accept plain paragraphs', () => {
  const proseOk = checkRenderability('section', {
    section: { id: 's_p', type: 'prose', data: { body: '<p>a</p><h2>b</h2><ul><li>c</li></ul>' } },
  });
  assert.equal(proseOk[0].status, 'complete', proseOk[0].message);
  const ledeOk = checkRenderability('section', {
    section: paragraphSection('lede', '<p>One.</p><p>Two with <strong>bold</strong>.</p>'),
  });
  assert.equal(ledeOk[0].status, 'complete', ledeOk[0].message);
});

test('renderability: a stray list in prose (outside allowed blocks) still blocks via the real splitter', () => {
  const [criterion] = checkRenderability('section', {
    section: { id: 's_p', type: 'prose', data: { body: '<p>a</p><blockquote>x</blockquote>' } },
  });
  assert.equal(criterion.status, 'missing');
});

test('renderability: FAQ answers are checked per item', () => {
  const [criterion] = checkRenderability('section', {
    section: {
      id: 's_f',
      type: 'faq',
      data: {
        items: [
          { q: 'Fine?', a: '<p>Yes.</p>' },
          { q: 'Broken?', a: '<p>No.</p><ul><li>list</li></ul>' },
        ],
      },
    },
  });
  assert.equal(criterion.status, 'missing');
  assert.ok(criterion.message.includes('items[1]'), criterion.message);
});

test('renderability: page bodies check every inline section', () => {
  const [criterion] = checkRenderability('page', {
    sections: [
      paragraphSection('lede', '<p>fine</p>'),
      { id: 's_bad', type: 'cta_banner', data: { heading: 'H', body: '<h3>heading in a banner</h3>' } },
    ],
  });
  assert.equal(criterion.status, 'missing');
  assert.ok(criterion.message.includes(`'s_bad'`), criterion.message);
});

test('deploy safety: protected env values are blockers in raw, encoded, and double-encoded form', () => {
  const protectedValues = [{ key: 'GITHUB_REPOSITORY', value: 'acme-org/Secret-Repo' }];
  for (const leaf of [
    'see acme-org/Secret-Repo for details',
    'https://proxy.example/?url=acme-org%2FSecret-Repo%2Fmain',
    'https://proxy.example/?url=acme-org%252FSecret-Repo%252Fmain',
    'SEE ACME-ORG/SECRET-REPO', // case-insensitive
  ]) {
    const [criterion] = checkDeploySafety({ section: { data: { body: leaf } } }, protectedValues);
    assert.equal(criterion.status, 'missing', leaf);
    assert.ok(criterion.message.includes('GITHUB_REPOSITORY'), criterion.message);
    assert.ok(!criterion.message.includes('Secret-Repo'), 'the error must name the KEY, never echo the value');
  }
});

test('deploy safety: repo-file hotlink URL families are blockers even without env values', () => {
  for (const url of [
    'https://raw.githubusercontent.com/someone/some-repo/main/photo.jpeg',
    'https://images.weserv.nl/?url=example.com%2Fphoto.jpeg',
  ]) {
    const [criterion] = checkDeploySafety({ data: { portrait: { src: url } } }, []);
    assert.equal(criterion.status, 'missing', url);
  }
});

test('deploy safety: clean content passes; short/absent env values never scan', () => {
  const clean = checkDeploySafety(
    { data: { body: '<p>Normal skincare copy about the main routine.</p>' } },
    protectedEnvValues({ GITHUB_BRANCH: 'main', PUBLISH_SECRET: '' })
  );
  assert.equal(clean[0].status, 'complete');
  // 'main' (4 chars) must never become a needle — it would match innocent copy.
  assert.deepEqual(protectedEnvValues({ GITHUB_REPOSITORY: 'main' }), []);
});

test('the full pipeline blocks the real trap-14 shape at validate/patch/create/publish', () => {
  const body = {
    section: {
      id: 's_intro',
      type: 'bio',
      data: {
        heading: 'About',
        body: '<p>Fine copy.</p>',
        portrait: {
          alt: 'Portrait',
          src: 'https://images.weserv.nl/?url=raw.githubusercontent.com%252Facme%252Frepo%252Fmain%252Fp.jpeg',
        },
        trustNotes: [],
      },
    },
  };
  const summary = summarizeValidation(validateObject({ objectType: 'section', objectId: 'sec_x', body }, {}));
  assert.equal(summary.eligible, false);
  assert.ok(
    summary.blockers.some((blocker) => blocker.id === 'deploy_safety'),
    JSON.stringify(summary.blockers.map((blocker) => blocker.id))
  );
});
