/**
 * W11 T11.5 — site.config drift guards. W15 S3 widened them fleet-wide.
 *
 * Each tenant's `site.config.ts` is its per-site routing/identity bundle
 * (Wolf B2: routing stays a committed FILE). v1 verifies rather than
 * generates: these tests make it impossible to land a change to a tenant's
 * `netlify.toml` redirect table or `config.yaml` site URL without updating
 * that tenant's site config (and vice versa), which is the single-truth
 * invariant generation would have bought, without touching deploy wiring.
 *
 * The root `netlify.toml` is the Dr-Lurie deployment's wiring (the live
 * Netlify project builds from the repo root — T14.1's note); `sites/platform`
 * and `sites/fernwell` each carry their own. Before W15 S3 only Dr-Lurie was
 * guarded, which is exactly how a tenant's rewrite table could go stale
 * without failing anything (the S1 /admin/content fix had to touch six files
 * by hand).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { siteConfig as drlurieSiteConfig } from '../../sites/drlurie/site.config.js';
import { siteConfig as fernwellSiteConfig } from '../../sites/fernwell/site.config.js';
import { siteConfig as platformSiteConfig } from '../../sites/platform/site.config.js';

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

/** One row per tenant: which netlify.toml + config.yaml mirror its site.config. */
const TENANTS = [
  {
    name: 'drlurie',
    siteConfig: drlurieSiteConfig,
    siteId: 'site_drlurie',
    netlifyToml: 'netlify.toml',
    configYaml: 'sites/drlurie/config.yaml',
  },
  {
    name: 'platform',
    siteConfig: platformSiteConfig,
    siteId: 'site_platform',
    netlifyToml: 'sites/platform/netlify.toml',
    configYaml: 'sites/platform/config.yaml',
  },
  {
    name: 'fernwell',
    siteConfig: fernwellSiteConfig,
    siteId: 'site_fernwell',
    netlifyToml: 'sites/fernwell/netlify.toml',
    configYaml: 'sites/fernwell/config.yaml',
  },
] as const;

const parseRedirects = (tomlPath: string) => {
  const toml = readFileSync(join(ROOT, tomlPath), 'utf8');
  const blocks = toml.split('[[redirects]]').slice(1);
  return blocks.map((block) => {
    const from = block.match(/from = "([^"]+)"/)?.[1];
    const to = block.match(/to = "([^"]+)"/)?.[1];
    const status = Number(block.match(/status = (\d+)/)?.[1]);
    return { from, to, status };
  });
};

for (const tenant of TENANTS) {
  test(`${tenant.name}: netlify.toml [[redirects]] table equals site.config redirects, in order`, () => {
    assert.deepEqual(
      parseRedirects(tenant.netlifyToml),
      tenant.siteConfig.redirects,
      `${tenant.netlifyToml} redirects drifted from sites/${tenant.name}/site.config.ts`
    );
  });

  test(`${tenant.name}: config.yaml site URL equals site.config canonicalHost`, () => {
    const yaml = readFileSync(join(ROOT, tenant.configYaml), 'utf8');
    const url = yaml.match(/^\s{2}site: '([^']+)'/m)?.[1];
    assert.equal(url, tenant.siteConfig.canonicalHost, `${tenant.configYaml} site URL drifted from site.config`);
  });

  test(`${tenant.name}: site.config identity agrees with the committed identity config`, () => {
    assert.equal(tenant.siteConfig.siteId, tenant.siteId);
    assert.match(tenant.siteConfig.canonicalHost, /^https:\/\//);
  });
}
