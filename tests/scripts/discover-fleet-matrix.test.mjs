import assert from 'node:assert/strict';
import test from 'node:test';

import { computeFleetMatrix, discoverSites, writeGithubOutput } from '../../scripts/ci/discover-fleet-matrix.mjs';

test('discoverSites finds every sites/<name>/ with its own site.config.ts (drlurie, at minimum)', () => {
  const sites = discoverSites();
  assert.ok(Array.isArray(sites));
  assert.ok(sites.includes('drlurie'));
});

test('discoverSites ignores a sites/<name>/ directory with no site.config.ts (a half-scaffolded dir)', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-matrix-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'complete'));
    fs.writeFileSync(path.join(tmpRoot, 'complete', 'site.config.ts'), '// stub\n');
    fs.mkdirSync(path.join(tmpRoot, 'incomplete')); // no site.config.ts
    assert.deepEqual(discoverSites(tmpRoot), ['complete']);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('discoverSites returns an empty fleet when the sites root does not exist', async () => {
  assert.deepEqual(discoverSites('/nonexistent/definitely/not/a/real/path'), []);
});

const ALL = ['drlurie', 'acme'];

test('an empty diff (no base/head resolvable) fans out to the whole fleet — fail toward completeness', () => {
  assert.deepEqual(computeFleetMatrix({ allSites: ALL, changedPaths: [] }), { sites: ALL, fanOut: true });
});

test('a change under packages/core fans out to the whole fleet', () => {
  assert.deepEqual(
    computeFleetMatrix({ allSites: ALL, changedPaths: ['packages/core/lib/registry/theme-tokens.ts'] }),
    {
      sites: ALL,
      fanOut: true,
    }
  );
});

test('a change to root config (netlify.toml, astro.config.ts, package.json…) fans out to the whole fleet', () => {
  for (const changedPath of ['netlify.toml', 'astro.config.ts', 'package.json', '.github/workflows/actions.yaml']) {
    assert.deepEqual(computeFleetMatrix({ allSites: ALL, changedPaths: [changedPath] }), { sites: ALL, fanOut: true });
  }
});

test('a change confined to one site under sites/** scopes the matrix to just that site', () => {
  assert.deepEqual(
    computeFleetMatrix({ allSites: ALL, changedPaths: ['sites/drlurie/data/site/pages/page_home.json'] }),
    { sites: ['drlurie'], fanOut: false }
  );
  assert.deepEqual(computeFleetMatrix({ allSites: ALL, changedPaths: ['sites/acme/seeds/site-seed-data.mjs'] }), {
    sites: ['acme'],
    fanOut: false,
  });
});

test('changes confined to sites/** across MULTIPLE sites scope to exactly those sites, no fan-out', () => {
  assert.deepEqual(
    computeFleetMatrix({
      allSites: ALL,
      changedPaths: ['sites/drlurie/data/site/site.json', 'sites/acme/seeds/site-seed-data.mjs'],
    }),
    { sites: ALL, fanOut: false }
  );
});

test('a sites/** path under an UNKNOWN/undiscovered site name is treated as core-impacting (conservative)', () => {
  // e.g. a half-scaffolded or since-deleted site dir the discovery step no
  // longer lists — do not silently drop coverage.
  assert.deepEqual(computeFleetMatrix({ allSites: ALL, changedPaths: ['sites/ghost/seeds/site-seed-data.mjs'] }), {
    sites: ALL,
    fanOut: true,
  });
});

test('mixing a core change with a site-content change still fans out (core wins)', () => {
  assert.deepEqual(
    computeFleetMatrix({
      allSites: ALL,
      changedPaths: ['sites/drlurie/data/site/site.json', 'packages/core/server/lib/object-publish.ts'],
    }),
    { sites: ALL, fanOut: true }
  );
});

test('writeGithubOutput emits sites= and fan_out= lines the workflow reads directly, no bash JSON parsing needed', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'github-output-')), 'output.txt');
  fs.writeFileSync(tmpFile, ''); // GITHUB_OUTPUT always pre-exists; appended to, never overwritten
  try {
    writeGithubOutput(tmpFile, { sites: ['drlurie', 'acme'], fanOut: true });
    const contents = fs.readFileSync(tmpFile, 'utf8');
    assert.equal(contents, 'sites=["drlurie","acme"]\nfan_out=true\n');
  } finally {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  }
});

test('an empty fleet (no sites discovered) stays empty regardless of the diff', () => {
  assert.deepEqual(computeFleetMatrix({ allSites: [], changedPaths: ['packages/core/lib/foo.ts'] }), {
    sites: [],
    fanOut: true,
  });
  assert.deepEqual(computeFleetMatrix({ allSites: [], changedPaths: [] }), { sites: [], fanOut: true });
});
