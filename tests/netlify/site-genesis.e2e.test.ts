/**
 * W14 T14.4 — GENESIS: a brand-new site can be born through the front door.
 *
 * Drives the MCP endpoint against a COMPLETELY EMPTY object store — the state
 * every new client starts in — and proves the starter pack can be created in
 * dependency order with no out-of-band writes:
 *
 *   navigation (header, footer) → site singleton → taxonomy → theme → page
 *
 * The order is the contract this test pins: the site singleton's
 * defaultNavigation refs are validated with reference integrity at create, so
 * the navs must exist FIRST. (The live T14.4 run initially read this as
 * "genesis is circular" — it is not; nav creation has no site dependency. The
 * actual live failure was the blob fallback, covered by
 * blob-store-prod-fail-closed.test.ts.)
 */
import '../../sites/drlurie/config/policy-bindings.js'; // registers providers (suite convention)
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';
import { setLocalBlobsRootForTesting } from '../../packages/core/server/lib/local-blobs.js';

for (const key of [
  'NETLIFY',
  'NETLIFY_SITE_ID',
  'NETLIFY_BLOBS_TOKEN',
  'NETLIFY_AUTH_TOKEN',
  'SITE_ID',
  'MCP_HTTP_AUTH_TOKEN',
  'GITHUB_CONTENT_TOKEN',
]) {
  delete process.env[key];
}
process.env.PUBLISH_SECRET = 'test-publish-secret';

const LOCAL_BLOBS_ROOT = join(process.cwd(), '.netlify', 'local-blobs-test', 'site-genesis-e2e');
setLocalBlobsRootForTesting(LOCAL_BLOBS_ROOT);

const call = async (name: string, args: Record<string, unknown>) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-publish-key': 'test-publish-secret' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const parsed = JSON.parse((response as { body: string }).body) as {
    result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
  };
  return { isError: Boolean(parsed.result?.isError), data: parsed.result?.structuredContent ?? {} };
};

const create = (object_type: string, requested_id: string, body: Record<string, unknown>) =>
  call('object_create', {
    object_type,
    site: 'site_genesis_test',
    requested_id,
    agent_name: 'object-conversion-roundtrip',
    body,
  });

test('an empty store births the starter pack in dependency order', async () => {
  await rm(LOCAL_BLOBS_ROOT, { recursive: true, force: true });

  // 1. Navigation first — no dependency on anything.
  const header = await create('navigation', 'nav_header', {
    role: 'header',
    groups: [{ id: 'g_primary', items: [{ id: 'i_home', label: 'Home', target: { kind: 'route', href: '/' } }] }],
  });
  assert.equal(header.isError, false, `nav_header: ${JSON.stringify(header.data).slice(0, 300)}`);

  const footer = await create('navigation', 'nav_footer', {
    role: 'footer',
    brand: { text: 'Genesis Test' },
    footNote: '© Genesis Test',
    groups: [
      {
        id: 'g_explore',
        title: 'Explore',
        items: [{ id: 'i_home', label: 'Home', target: { kind: 'route', href: '/' } }],
      },
    ],
  });
  assert.equal(footer.isError, false, `nav_footer: ${JSON.stringify(footer.data).slice(0, 300)}`);

  // 2. The site singleton — its defaultNavigation refs now resolve.
  const site = await create('site', 'site_genesis_test', {
    name: 'Genesis Test',
    logo: { text: 'GENESIS TEST' },
    urls: { base: '/', canonicalHost: 'https://genesis-test.netlify.app' },
    metadataDefaults: {
      description: 'Genesis test site.',
      ogImage: '/Social/og-default.jpg',
      titleTemplate: '%s - Genesis Test',
    },
    brandTokens: {
      colors: {
        primary: 'rgb(51 102 204)',
        secondary: 'rgb(38 77 153)',
        accent: 'rgb(0 150 136)',
        gold: 'rgb(191 155 48)',
        'text-heading': 'rgb(20 24 28)',
        'text-default': 'rgb(38 43 48)',
        'text-muted': 'rgb(60 67 75 / 76%)',
        'bg-page': 'rgb(255 255 255)',
        'bg-surface': 'rgb(245 246 248)',
        'bg-page-dark': 'rgb(10 12 20)',
      },
      fonts: { sans: 'system-ui, sans-serif', serif: 'Georgia, serif', heading: 'Georgia, serif' },
    },
    chrome: { showRssFeed: false, showThemeToggle: true },
    defaultNavigation: { header: 'nav_header', footer: 'nav_footer' },
    blog: { listPath: 'learn/library', postsPerPage: 6, categoryBase: 'category', tagBase: 'tag' },
  });
  assert.equal(site.isError, false, `site: ${JSON.stringify(site.data).slice(0, 400)}`);

  // 3. And a page renders the proof that ordinary objects follow.
  const page = await create('page', 'page_genesis_home', {
    pageType: 'system',
    route: '/',
    title: 'Genesis Test',
    // Required to PUBLISH (structure_home_footer, the 2026-07-10 incident
    // rule) — carried at create so the born page is publishable as-is.
    navigationOverrides: { footer: 'nav_footer' },
    seo: { description: 'Genesis test home.', robots: { index: false, follow: false } },
    sections: [{ id: 's_hello', type: 'prose', data: { body: '<h2>Born.</h2><p>Through the front door.</p>' } }],
  });
  assert.equal(page.isError, false, `page: ${JSON.stringify(page.data).slice(0, 300)}`);

  // The inventory sees all four.
  const inventory = await call('object_inventory', {});
  const objects = (inventory.data.objects ?? []) as Array<{ object_id: string }>;
  const ids = new Set(objects.map((entry) => entry.object_id));
  for (const id of ['nav_header', 'nav_footer', 'site_genesis_test', 'page_genesis_home']) {
    assert.ok(ids.has(id), `${id} missing from inventory`);
  }

  await rm(LOCAL_BLOBS_ROOT, { recursive: true, force: true });
});

test('the site singleton REFUSES to create before its navigation exists (the order is law)', async () => {
  await rm(LOCAL_BLOBS_ROOT, { recursive: true, force: true });
  const site = await create('site', 'site_genesis_test', {
    name: 'Genesis Test',
    logo: { text: 'GENESIS TEST' },
    urls: { base: '/', canonicalHost: 'https://genesis-test.netlify.app' },
    metadataDefaults: { description: 'x', ogImage: '/Social/og-default.jpg', titleTemplate: '%s - X' },
    brandTokens: {
      colors: {
        primary: 'rgb(51 102 204)',
        secondary: 'rgb(38 77 153)',
        accent: 'rgb(0 150 136)',
        gold: 'rgb(191 155 48)',
        'text-heading': 'rgb(20 24 28)',
        'text-default': 'rgb(38 43 48)',
        'text-muted': 'rgb(60 67 75 / 76%)',
        'bg-page': 'rgb(255 255 255)',
        'bg-surface': 'rgb(245 246 248)',
        'bg-page-dark': 'rgb(10 12 20)',
      },
      fonts: { sans: 'system-ui, sans-serif', serif: 'Georgia, serif', heading: 'Georgia, serif' },
    },
    chrome: { showRssFeed: false, showThemeToggle: true },
    defaultNavigation: { header: 'nav_header', footer: 'nav_footer' },
    blog: { listPath: 'learn/library', postsPerPage: 6, categoryBase: 'category', tagBase: 'tag' },
  });
  assert.equal(site.isError, true, 'site creation against an empty store must fail reference integrity');
  await rm(LOCAL_BLOBS_ROOT, { recursive: true, force: true });
});
