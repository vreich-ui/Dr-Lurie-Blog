/**
 * Source-level guard (pre-W11 dehardcode, census group 3): the two admin
 * taxonomy registry lookups — the workspace article settings and the canvas
 * edit-mode panel — must resolve the registry id through the site-identity
 * seam, never a hardcoded 'tax_drlurie'. Failures in those lookups are
 * swallowed by try/catch at runtime (a wrong id silently downgrades the
 * pickers), so this pins the wiring at the source level, the same stance as
 * the T9.22 legacy-path pin and the T13.12 no-own-endpoint guard.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The compiled test runs from a temp dir; ascend to the repo root.
const repoRoot = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'sites', 'drlurie', 'config', 'site-identity.ts'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('could not locate the repo root');
};

const LOOKUP_SOURCES = ['packages/core/admin/ObjectWorkspace.tsx', 'packages/core/lib/edit-mode/ui.ts'];

for (const source of LOOKUP_SOURCES) {
  test(`${source} resolves the taxonomy registry id through the site-identity seam`, () => {
    const text = readFileSync(join(repoRoot(), source), 'utf8');
    assert.ok(!text.includes('tax_drlurie'), `${source} must not hardcode the tax_drlurie registry id`);
    assert.match(
      text,
      /getSiteIdentity\(\)\.taxonomyId|\.taxonomyId\b/,
      `${source} must read the registry id from the site-identity resolver`
    );
    assert.ok(text.includes('site-identity'), `${source} must import the site-identity module`);
  });
}
