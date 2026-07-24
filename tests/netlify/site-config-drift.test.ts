/**
 * W11 T11.5 — site.config drift guards.
 *
 * `sites/drlurie/site.config.ts` is the per-site routing/identity bundle
 * (Wolf B2: routing stays a committed FILE). v1 verifies rather than
 * generates: these tests make it impossible to land a change to
 * `netlify.toml`'s redirect table or `src/config.yaml`'s site URL without
 * updating the site config (and vice versa), which is the single-truth
 * invariant generation would have bought, without touching deploy wiring.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { siteConfig } from '../../sites/drlurie/site.config.js';

const findRepoRoot = (startDir: string): string => {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, 'astro.config.ts'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('repo root not found');
    dir = parent;
  }
};
const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

test('netlify.toml [[redirects]] table equals site.config redirects, in order', () => {
  const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
  const blocks = toml.split('[[redirects]]').slice(1);
  const parsed = blocks.map((block) => {
    const from = block.match(/from = "([^"]+)"/)?.[1];
    const to = block.match(/to = "([^"]+)"/)?.[1];
    const status = Number(block.match(/status = (\d+)/)?.[1]);
    return { from, to, status };
  });
  assert.deepEqual(parsed, siteConfig.redirects, 'netlify.toml redirects drifted from sites/drlurie/site.config.ts');
});

test('config.yaml site URL equals site.config canonicalHost', () => {
  const yaml = readFileSync(join(ROOT, 'src/config.yaml'), 'utf8');
  const url = yaml.match(/^\s{2}site: '([^']+)'/m)?.[1];
  assert.equal(url, siteConfig.canonicalHost, 'src/config.yaml site URL drifted from site.config');
});

test('site.config identity agrees with the committed identity config', () => {
  assert.equal(siteConfig.siteId, 'site_drlurie');
  assert.match(siteConfig.canonicalHost, /^https:\/\//);
});
