/**
 * T3.10 (lib half) — computed affected-surface lists. Pins the brief's
 * verify criterion (`sec_newsletter_signup` impact lists `page_home`) plus
 * the navigation usage rules: page-level override beats the Site default
 * per role; an override pointing elsewhere suppresses the default for that
 * role only; no Site object yet → overrides still computable with an
 * honest note.
 */
import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { computeObjectImpact, type ObjectImpactStore } from '../../packages/core/server/lib/object-impact.js';
import { objectRecordKey } from '../../packages/core/server/lib/object-store-keys.js';
import { pageHomeBody, sectionNewsletterSignupBody } from '../../sites/drlurie/seeds/page-home-seed-data.mjs';
import type { ObjectRecord, ObjectType } from '../../packages/core/schema/object-record-v1.js';

const createMemoryStore = () => {
  const blobs = new Map<string, string>();
  const store: ObjectImpactStore = {
    async get(key) {
      return blobs.get(key) ?? null;
    },
    async list({ prefix }) {
      return { blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
  const seed = (objectType: ObjectType, objectId: string, body: unknown, site = 'site_drlurie') => {
    const record: ObjectRecord = {
      object_id: objectId,
      object_type: objectType,
      schema_version: `${objectType}.v1`,
      site,
      created_at: '2026-07-06T00:00:00.000Z',
      updated_at: '2026-07-06T00:00:00.000Z',
      status: 'active',
      body,
      publication: { published_time: null },
      history: [],
      version: 1,
      content_revision: 1,
    };
    blobs.set(objectRecordKey(objectType, objectId), JSON.stringify(record));
  };
  return { store, seed };
};

const aboutPageBody = () => ({
  route: '/about',
  pageType: 'standard',
  title: 'About',
  seo: {},
  sections: [{ id: 's_hero', type: 'hero', data: { heading: 'About', actions: [] } }],
});

test('sec_newsletter_signup impact lists page_home via shared_ref (the T3.10 verify criterion)', async () => {
  const { store, seed } = createMemoryStore();
  seed('section', 'sec_newsletter_signup', sectionNewsletterSignupBody);
  seed('page', 'page_home', pageHomeBody);
  seed('page', 'page_about', aboutPageBody());

  const impact = await computeObjectImpact(store, { object_type: 'section', object_id: 'sec_newsletter_signup' });
  assert.equal(impact.computed, true);
  assert.deepEqual(impact.pages, [{ object_id: 'page_home', route: '/', via: 'shared_ref' }]);
});

test('navigation impact: override wins per role, default fills the rest, overridden-away pages excluded', async () => {
  const { store, seed } = createMemoryStore();
  seed('page', 'page_home', pageHomeBody); // navigationOverrides.footer = nav_footer_home
  seed('page', 'page_about', aboutPageBody()); // no overrides
  seed('site', 'site_drlurie', {
    defaultNavigation: { header: 'nav_header', footer: 'nav_footer' },
  });

  const footerHome = await computeObjectImpact(store, { object_type: 'navigation', object_id: 'nav_footer_home' });
  assert.deepEqual(footerHome.pages, [{ object_id: 'page_home', route: '/', via: 'navigation_override' }]);

  // page_home overrides footer AWAY from nav_footer, so only page_about uses the default.
  const footer = await computeObjectImpact(store, { object_type: 'navigation', object_id: 'nav_footer' });
  assert.deepEqual(footer.pages, [{ object_id: 'page_about', route: '/about', via: 'site_default' }]);

  // Nobody overrides header: both pages use the default.
  const header = await computeObjectImpact(store, { object_type: 'navigation', object_id: 'nav_header' });
  assert.deepEqual(
    header.pages.map((page) => [page.object_id, page.via]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    [
      ['page_about', 'site_default'],
      ['page_home', 'site_default'],
    ]
  );
});

test('navigation impact without a Site object: overrides computable, honest note attached', async () => {
  const { store, seed } = createMemoryStore();
  seed('page', 'page_home', pageHomeBody);

  const impact = await computeObjectImpact(store, { object_type: 'navigation', object_id: 'nav_footer_home' });
  assert.deepEqual(impact.pages, [{ object_id: 'page_home', route: '/', via: 'navigation_override' }]);
  assert.ok(impact.notes.some((note) => note.includes('No Site object')));
});

test('template impact lists provenance-stamped pages with the no-live-inheritance note', async () => {
  const { store, seed } = createMemoryStore();
  const stamped = {
    ...aboutPageBody(),
    template: { ref: 'tpl_standard', instantiated_at: '2026-07-06T00:00:00.000Z' },
  };
  seed('page', 'page_about', stamped);

  const impact = await computeObjectImpact(store, { object_type: 'template', object_id: 'tpl_standard' });
  assert.deepEqual(impact.pages, [{ object_id: 'page_about', route: '/about', via: 'template_ref' }]);
  assert.ok(impact.notes.some((note) => note.includes('provenance')));
});

test('types without a computed surface say so instead of pretending', async () => {
  const { store } = createMemoryStore();
  const impact = await computeObjectImpact(store, { object_type: 'taxonomy', object_id: 'tax_site_drlurie' });
  assert.equal(impact.computed, false);
  assert.deepEqual(impact.pages, []);
  assert.ok(impact.notes.length > 0);
});
