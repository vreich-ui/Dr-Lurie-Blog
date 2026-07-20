/**
 * T13.8 — the CSP hosts-drift gate (12-plan §4): the netlify.toml
 * Content-Security-Policy-Report-Only value must equal the documented
 * baseline PLUS exactly the union of the ENABLED providers' cspHosts (from
 * `src/data/site/tracking.json` when that export exists — none is
 * committed today). Drift fails in BOTH directions: an enabled provider
 * whose hosts are missing, and an unexplained host nobody enabled. CSP
 * updates therefore ride the same change that enables a provider.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { GA4_CSP_HOSTS } from '../../src/lib/tracking/adapters/ga4.js';
import { GOOGLE_ADS_CSP_HOSTS } from '../../src/lib/tracking/adapters/google-ads.js';
import { META_PIXEL_CSP_HOSTS } from '../../src/lib/tracking/adapters/meta-pixel.js';
import { MGID_CSP_HOSTS } from '../../src/lib/tracking/adapters/mgid.js';
import { OUTBRAIN_CSP_HOSTS } from '../../src/lib/tracking/adapters/outbrain.js';
import { TABOOLA_CSP_HOSTS } from '../../src/lib/tracking/adapters/taboola.js';
import { trackingConfigBodySchema } from '../../src/schema/bodies/tracking-config-v1.js';

type HostSets = {
  script: readonly string[];
  connect: readonly string[];
  img: readonly string[];
  frame: readonly string[];
};

// Every gtag/native ad adapter's contribution, keyed by provider. plausible
// is handled separately (its host is the config's own api_host value).
const ADAPTER_CSP: Record<string, HostSets> = {
  google_ads: GOOGLE_ADS_CSP_HOSTS,
  ga4: GA4_CSP_HOSTS,
  meta_pixel: META_PIXEL_CSP_HOSTS,
  taboola: TABOOLA_CSP_HOSTS,
  outbrain: OUTBRAIN_CSP_HOSTS,
  mgid: MGID_CSP_HOSTS,
};

// The documented all-disabled baseline — netlify.toml's comment block is the
// prose twin of this constant. img-src is deliberately wide (externally
// hosted content images); the pinning directives are script/connect/frame.
const BASE = {
  script: ["'self'", "'unsafe-inline'"],
  connect: ["'self'"],
  frame: ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
};

const repoRoot = (): string => {
  let root = path.dirname(fileURLToPath(import.meta.url));
  while (root !== path.dirname(root)) {
    if (existsSync(path.join(root, 'netlify.toml')) && existsSync(path.join(root, 'src/lib/tracking'))) break;
    root = path.dirname(root);
  }
  return root;
};

const readPolicy = (): Record<string, string[]> => {
  const toml = readFileSync(path.join(repoRoot(), 'netlify.toml'), 'utf8');
  const match = /Content-Security-Policy-Report-Only\s*=\s*"([^"]+)"/.exec(toml);
  assert.ok(match, 'netlify.toml carries the Content-Security-Policy-Report-Only header');
  const directives: Record<string, string[]> = {};
  for (const clause of match![1]!.split(';')) {
    const parts = clause.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) directives[parts[0]!] = parts.slice(1);
  }
  return directives;
};

/** Enabled ad-provider keys per the committed export (absent = none). */
const enabledProviders = (): { keys: string[]; plausibleHost?: string } => {
  const exportPath = path.join(repoRoot(), 'src/data/site/tracking.json');
  if (!existsSync(exportPath)) return { keys: [] };
  const raw = JSON.parse(readFileSync(exportPath, 'utf8')) as Record<string, unknown>;
  delete raw.__generated;
  const body = trackingConfigBodySchema.parse(raw);
  const keys = Object.keys(ADAPTER_CSP).filter(
    (key) => (body.providers as Record<string, { enabled?: boolean } | undefined>)[key]?.enabled === true
  );
  return { keys, plausibleHost: body.providers.plausible?.enabled ? body.providers.plausible.api_host : undefined };
};

const expectedFor = (directive: 'script' | 'connect' | 'frame'): Set<string> => {
  const { keys, plausibleHost } = enabledProviders();
  const expected = new Set<string>(BASE[directive]);
  for (const key of keys) for (const host of ADAPTER_CSP[key]![directive]) expected.add(host);
  if (plausibleHost && directive !== 'frame') expected.add(plausibleHost);
  return expected;
};

test('CSP-RO script/connect/frame equal the baseline + enabled adapters — drift fails both directions', () => {
  const policy = readPolicy();
  for (const [directive, key] of [
    ['script-src', 'script'],
    ['connect-src', 'connect'],
    ['frame-src', 'frame'],
  ] as const) {
    const actual = new Set(policy[directive] ?? []);
    const expected = expectedFor(key);
    const missing = [...expected].filter((host) => !actual.has(host));
    const extra = [...actual].filter((host) => !expected.has(host));
    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `${directive} drift — enabling a provider must add its adapter cspHosts to netlify.toml in the SAME change ` +
        `(and hosts nobody enabled must be removed). Adapter constants: src/lib/tracking/adapters/*.ts`
    );
  }
});

test('CSP-RO structural posture: default-src self, object-src none, base-uri self, img-src wide-but-present', () => {
  const policy = readPolicy();
  assert.deepEqual(policy['default-src'], ["'self'"]);
  assert.deepEqual(policy['object-src'], ["'none'"]);
  assert.deepEqual(policy['base-uri'], ["'self'"]);
  for (const source of ["'self'", 'data:', 'https:']) {
    assert.ok(policy['img-src']?.includes(source), `img-src carries ${source}`);
  }
  assert.ok(policy['style-src']?.includes('https://fonts.googleapis.com'), 'Google Fonts stylesheet allowed');
  assert.ok(policy['font-src']?.includes('https://fonts.gstatic.com'), 'Google Fonts files allowed');
});

test('every ad adapter publishes https-only hosts for the drift union', () => {
  for (const [provider, hosts] of Object.entries(ADAPTER_CSP)) {
    for (const directive of ['script', 'connect', 'img', 'frame'] as const) {
      for (const host of hosts[directive]) {
        assert.match(host, /^https:\/\/[a-z0-9.-]+$/, `${provider}.${directive}: ${host}`);
      }
    }
    assert.ok(hosts.script.length > 0 || hosts.connect.length > 0, `${provider} contributes at least one host`);
  }
});
