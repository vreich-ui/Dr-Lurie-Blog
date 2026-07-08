import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStoreValidationContext } from '../../netlify/lib/object-validation-context.js';

// A minimal in-memory store matching the subset the context builder reads
// (list by prefix + get by key), seeded with a few object records.
const makeStore = (records: Array<{ type: string; id: string; body: unknown; published?: boolean }>) => {
  const blobs = new Map<string, string>();
  for (const r of records) {
    blobs.set(
      `objects/${r.type}/by-id/${r.id}.json`,
      JSON.stringify({
        object_id: r.id,
        object_type: r.type,
        body: r.body,
        publication: { published_time: r.published ? '2026-01-01T00:00:00.000Z' : null },
      })
    );
  }
  return {
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async list({ prefix }: { prefix: string }) {
      return { blobs: [...blobs.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), directories: [] };
    },
    // unused by the builder but part of the store type
    async setJSON() {},
  } as never;
};

test('resolveObject: hit reports exists+published; miss reports not-exists', async () => {
  const store = makeStore([
    { type: 'page', id: 'page_home', body: { route: '/' }, published: true },
    { type: 'section', id: 'sec_x', body: { section: { id: 's_a', type: 'newsletter_signup', data: {} } } },
  ]);
  const ctx = await buildStoreValidationContext(store);
  assert.deepEqual(ctx.resolveObject!('page', 'page_home'), { exists: true, published: true });
  assert.deepEqual(ctx.resolveObject!('section', 'sec_x'), { exists: true, published: false });
  assert.deepEqual(ctx.resolveObject!('page', 'page_ghost'), { exists: false });
});

test('resolveSharedSectionType returns the wrapped variant type', async () => {
  const store = makeStore([
    { type: 'section', id: 'sec_x', body: { section: { id: 's_a', type: 'newsletter_signup', data: {} } } },
  ]);
  const ctx = await buildStoreValidationContext(store);
  assert.equal(ctx.resolveSharedSectionType!('sec_x'), 'newsletter_signup');
  assert.equal(ctx.resolveSharedSectionType!('sec_ghost'), undefined);
});

test('isRouteTaken flags a different page on the same route, excludes self', async () => {
  const store = makeStore([
    { type: 'page', id: 'page_home', body: { route: '/' } },
    { type: 'page', id: 'page_about', body: { route: '/about' } },
  ]);
  const ctxOther = await buildStoreValidationContext(store, { selfObjectId: 'page_new' });
  assert.equal(ctxOther.isRouteTaken!('/'), true);
  assert.equal(ctxOther.isRouteTaken!('/nope'), false);
  // a page re-saving its OWN route is not a conflict
  const ctxSelf = await buildStoreValidationContext(store, { selfObjectId: 'page_home' });
  assert.equal(ctxSelf.isRouteTaken!('/'), false);
});

test('resolvePageType returns the code-registry constraint; unknown → undefined', async () => {
  const ctx = await buildStoreValidationContext(makeStore([]));
  const home = ctx.resolvePageType!('home');
  assert.equal(home?.id, 'home');
  assert.ok(Array.isArray(home?.allowedSections));
  assert.deepEqual(home?.requiredSections, ['hero']);
  assert.equal(ctx.resolvePageType!('not_a_type'), undefined);
});

test('componentTypeExists is true only for bound section types', async () => {
  const ctx = await buildStoreValidationContext(makeStore([]));
  assert.equal(ctx.componentTypeExists!('hero'), true);
  assert.equal(ctx.componentTypeExists!('lede'), true);
  assert.equal(ctx.componentTypeExists!('prose'), true); // now bound (Prose.astro)
  // shared_ref is schema-legal but never a component — the renderer dereferences
  // it to the target's variant before dispatch, so it is intentionally unbound.
  assert.equal(ctx.componentTypeExists!('shared_ref'), false);
});

test('resolveTaxonomyTerm: omitted when no taxonomy object exists; follows merged_into when present', async () => {
  const noTax = await buildStoreValidationContext(makeStore([{ type: 'page', id: 'p', body: { route: '/' } }]));
  assert.equal(noTax.resolveTaxonomyTerm, undefined, 'no taxonomy → no resolver (avoids false positives)');

  const withTax = await buildStoreValidationContext(
    makeStore([
      {
        type: 'taxonomy',
        id: 'tax_main',
        body: {
          kinds: {
            category: {
              terms: [
                { term_id: 't_old', status: 'deprecated', merged_into: 't_new' },
                { term_id: 't_new', status: 'active' },
              ],
            },
            tag: { terms: [] },
          },
        },
      },
    ])
  );
  // t_old is deprecated but merges into an active term → resolves active
  assert.deepEqual(withTax.resolveTaxonomyTerm!('category', 't_old'), { active: true });
  assert.deepEqual(withTax.resolveTaxonomyTerm!('category', 't_new'), { active: true });
  assert.equal(withTax.resolveTaxonomyTerm!('category', 't_missing'), undefined);
});
