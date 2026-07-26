/**
 * Unit tests for T11.7's `create-site` scaffold — the acceptance criteria's
 * "unit tests over scaffold output (config validates, seeds parse, ids are
 * <client>-scoped); dry-run output committed as a fixture; no secret
 * material in any artifact" line, made concrete.
 *
 * A `.test.ts` co-located with the script (the packages/core precedent —
 * e.g. lib/site-identity.test.ts) rather than a plain tests/scripts/*.mjs
 * test: validating the generated seed bodies needs the real zod schemas,
 * and importing compiled TS from a plain .mjs test would mean reaching into
 * .tmp/ci-test by a fragile relative path. Running as part of the same
 * `tsc -p tsconfig.test.json` + `node --test` pass this file's siblings run
 * in gives a normal relative import instead.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildPlan,
  CORE_BLOB_STORES,
  ENV_CHECKLIST,
  idsFor,
  renderEnvChecklist,
  renderPlan,
  validateClientSlug,
  writeFiles,
} from './create-site.mjs';
import { navigationBodySchema } from '../schema/bodies/navigation-v1.js';
import { sectionTemplateBodySchema } from '../schema/bodies/section-template-v1.js';
import { siteBodySchema } from '../schema/bodies/site-v1.js';
import { taxonomyBodySchema } from '../schema/bodies/taxonomy-v1.js';
import { themeBodySchema } from '../schema/bodies/theme-v1.js';
import { expectedAcmeDryRun } from '../../../tests/fixtures/create-site-dry-run-acme.mjs';

// This test file compiles to .tmp/ci-test/packages/core/cli/create-site.test.js.
// `import.meta.url`-derived paths resolve WITHIN that compiled tree (tsc
// mirrors the repo layout under .tmp/ci-test, including create-site.mjs and
// the fixture .mjs above — both pulled in as plain relative JS imports, the
// same way sites/drlurie's seed .mjs files are pulled into other compiled
// tests even though tsconfig's `include` never names *.mjs). The scratch
// directory this test writes to is therefore a path under the COMPILED
// tree's own sites/, not the real checkout's — harmless either way (it's
// cleaned up in every case, try/finally, and the whole compiled tree is
// discarded at the end of `npm test`), but worth being precise about.
const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('validateClientSlug accepts kebab-case names, rejects everything else', () => {
  assert.equal(validateClientSlug('acme'), 'acme');
  assert.equal(validateClientSlug('acme-clinic'), 'acme-clinic');
  assert.throws(() => validateClientSlug(''), /required/);
  assert.throws(() => validateClientSlug('Acme'), /invalid/);
  assert.throws(() => validateClientSlug('acme_clinic'), /invalid/);
  assert.throws(() => validateClientSlug('1acme'), /invalid/);
  assert.throws(() => validateClientSlug('a'), /invalid/); // too short
});

test('idsFor scopes every generated id to the client — no cross-client collision', () => {
  const acme = idsFor('acme-clinic');
  assert.equal(acme.siteId, 'site_acme_clinic');
  assert.equal(acme.taxonomyId, 'tax_acme_clinic');
  assert.equal(acme.themeId, 'thm_acme_clinic_default');

  const other = idsFor('globex');
  assert.notEqual(acme.siteId, other.siteId);
  assert.notEqual(acme.taxonomyId, other.taxonomyId);
  assert.notEqual(acme.themeId, other.themeId);
});

test('buildPlan scaffolds the full baseline pack: config bundle + empty export tree + five seed modules', () => {
  const plan = buildPlan({ name: 'acme' });
  const relPaths = plan.files.map((f) => f.path);

  for (const expected of [
    'sites/acme/config/site-identity.ts',
    'sites/acme/config/site-binding.ts',
    'sites/acme/site.config.ts',
    'sites/acme/netlify.toml',
    'sites/acme/package.json',
    'sites/acme/seeds/site-seed-data.mjs',
    'sites/acme/seeds/navigation-seed-data.mjs',
    'sites/acme/seeds/taxonomy-seed-data.mjs',
    'sites/acme/seeds/themes-seed-data.mjs',
    'sites/acme/seeds/section-templates-seed-data.mjs',
    // W14 T14.2: the per-site policy bundle. Without policy-bindings.ts the
    // shell cannot resolve site identity and the site does not build at all.
    'sites/acme/config/approval-policy.ts',
    'sites/acme/config/creation-policy.ts',
    'sites/acme/config/media-policy.ts',
    'sites/acme/config/policy-bindings.ts',
    // W14 T14.1/T14.2: the build entry over the shared shell.
    'sites/acme/astro.config.ts',
    'sites/acme/config.yaml',
    'sites/acme/app/content/config.ts',
    'sites/acme/app/pages/index.astro',
    'sites/acme/app/pages/404.astro',
    'sites/acme/app/pages/[...objectPage].astro',
  ]) {
    assert.ok(relPaths.includes(expected), `expected ${expected} in the plan`);
  }
});

test('the committed-export tree ships as BOOTSTRAP only — enough to build, nothing store-backed', () => {
  const plan = buildPlan({ name: 'acme' });
  const relPaths = plan.files.map((f) => f.path);
  const dataSiteFiles = relPaths.filter((p) => p.startsWith('sites/acme/data/site/'));

  // Every per-type directory still ships as an empty placeholder…
  assert.ok(dataSiteFiles.filter((p) => p.endsWith('.gitkeep')).length >= 8);

  // …except for the five exports without which the site cannot render ONE
  // page: PageLayout throws on a missing navigation export by design, and
  // PageObjectRenderer throws on a missing page export.
  for (const expected of [
    'sites/acme/data/site/site.json',
    'sites/acme/data/site/navigation/nav_header.json',
    'sites/acme/data/site/navigation/nav_footer.json',
    'sites/acme/data/site/pages/page_home.json',
    'sites/acme/data/site/pages/page_404.json',
  ]) {
    assert.ok(relPaths.includes(expected), `expected ${expected} in the plan`);
  }

  // They are rendered stubs, NOT converted objects (CLAUDE.md's five-part
  // definition: no store record backs them). The marker has to say so, or the
  // seed drive that replaces them looks optional.
  for (const file of plan.files.filter((f) => f.path.startsWith('sites/acme/data/site/') && f.path.endsWith('.json'))) {
    const parsed = JSON.parse(file.content);
    assert.match(parsed.__generated.from, /^create-site:bootstrap/);
    assert.equal(parsed.__generated.record_version, 0);
  }
});

test('CORE_BLOB_STORES matches the store-name literals in blob-store.ts/governance-store.ts/users-store.ts/chat-store.ts', () => {
  // Not a live import of those modules (their store names are inline string
  // literals passed to getNetlifyBlobStore, not exported constants) — this
  // pins the count/shape so a drift is at least visible in a diff.
  assert.deepEqual(
    [...CORE_BLOB_STORES].sort(),
    [
      'agent-chats',
      'artifact-index',
      'artifacts',
      'commerce',
      'governance',
      'site-objects',
      'users',
      'workflows',
    ].sort()
  );
});

test('the env checklist covers every per-site row from the T11.7 brief (not an illustrative subset)', () => {
  const names = ENV_CHECKLIST.flatMap((g) => g.rows.map((r) => r.name));
  for (const expected of [
    'PUBLISH_SECRET',
    'NETLIFY_SITE_ID',
    'GITHUB_REPOSITORY',
    'GITHUB_CONTENT_TOKEN',
    'MCP_HTTP_AUTH_TOKEN',
    'ADMIN_EMAILS',
    'ARTIFACT_UPLOAD_TOKEN_SECRET',
    'PDF_TOOL_PROJECT_ID',
    'PDF_TOOL_STORAGE_SITE_ID',
    'TRACKING_SALT',
    'ANTHROPIC_API_KEY',
    'STRIPE_SECRET_KEY',
  ]) {
    assert.ok(names.includes(expected), `expected ${expected} in the checklist`);
  }
  // fleet-shared rows are marked as such, never told to generate a fresh value:
  const fleetRows = ENV_CHECKLIST.flatMap((g) => g.rows).filter((r) => r.cls === 'fleet-shared');
  assert.ok(fleetRows.every((r) => !r.generate));
});

test('the dry-run report never contains a generated secret value — checklist entries reference env NAMES only', () => {
  const plan = buildPlan({ name: 'acme' });
  const report = renderPlan(plan, { netlifyToken: false });
  // The report is entirely static/derived from the plan + checklist metadata
  // — nothing in it is a minted secret. Spot-check: no long hex-looking run
  // (what randomSecret() would produce) appears anywhere in the text.
  assert.equal(/\b[0-9a-f]{32,}\b/i.test(report), false);
  // The report is deterministic given a plan: two renders are byte-identical.
  assert.equal(report, renderPlan(plan, { netlifyToken: false }));
});

test('renderEnvChecklist(executed=true) reports generated secrets as set, never prints their value', () => {
  const text = renderEnvChecklist(true);
  assert.match(text, /PUBLISH_SECRET.*generated \+ set on the new site \(value not shown\)/s);
  assert.equal(/\b[0-9a-f]{32,}\b/i.test(text), false);
});

test('dry-run output matches the committed fixture (tests/fixtures/create-site-dry-run-acme.mjs)', () => {
  const plan = buildPlan({ name: 'acme' });
  const actual = renderPlan(plan, { netlifyToken: false });
  // The fixture module wraps the pasted output in a template literal for
  // readability, so it carries one leading and one trailing newline that
  // renderPlan's own return value does not — strip both before comparing.
  const expected = expectedAcmeDryRun.replace(/^\n/, '').replace(/\n$/, '');
  assert.equal(actual, expected);
});

test('scaffolded seed bodies parse against the real object schemas, and ids stay client-scoped end to end', async () => {
  const scratchSlug = 'cli-test-scratch';
  const scratchDir = path.join(treeRoot, 'sites', scratchSlug);
  assert.ok(!fs.existsSync(scratchDir), 'scratch dir must not already exist — refusing to touch a real client');

  const plan = buildPlan({ name: scratchSlug, brandName: 'Scratch Co' });
  try {
    writeFiles(plan);

    const site = await import(path.join(scratchDir, 'seeds', 'site-seed-data.mjs'));
    const nav = await import(path.join(scratchDir, 'seeds', 'navigation-seed-data.mjs'));
    const tax = await import(path.join(scratchDir, 'seeds', 'taxonomy-seed-data.mjs'));
    const theme = await import(path.join(scratchDir, 'seeds', 'themes-seed-data.mjs'));
    const stpl = await import(path.join(scratchDir, 'seeds', 'section-templates-seed-data.mjs'));

    assert.equal(siteBodySchema.safeParse(site.siteBody).success, true);
    assert.equal(navigationBodySchema.safeParse(nav.navHeaderBody).success, true);
    assert.equal(navigationBodySchema.safeParse(nav.navFooterBody).success, true);
    assert.equal(taxonomyBodySchema.safeParse(tax.taxonomyBody).success, true);
    assert.equal(themeBodySchema.safeParse(theme.themeDefaultBody).success, true);
    for (const seed of stpl.CONVERSION_SEEDS) {
      const result = sectionTemplateBodySchema.safeParse(seed.body);
      assert.equal(
        result.success,
        true,
        `${seed.objectId}: ${result.success ? '' : JSON.stringify(result.error?.issues)}`
      );
    }

    // ids-are-client-scoped, proven on the WRITTEN files, not just buildPlan's
    // in-memory ids:
    assert.equal(site.SEED_SITE, 'site_cli_test_scratch');
    assert.equal(tax.CONVERSION_SEEDS[0].objectId, 'tax_cli_test_scratch');
    assert.equal(theme.CONVERSION_SEEDS[0].objectId, 'thm_cli_test_scratch_default');

    // No stray secret material anywhere in what was actually written to disk:
    for (const file of plan.files) {
      const written = fs.readFileSync(path.join(treeRoot, file.path), 'utf8');
      assert.equal(/\b[0-9a-f]{32,}\b/i.test(written), false, `${file.path} must carry no secret-shaped literal`);
    }
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});

test('function shims use the export form the core function generation requires (W14 F2 regression)', () => {
  // A Functions-2.0 core function (declares `export const config`) is reached
  // at config.path with a Request→Response handler and MUST be exported as the
  // DEFAULT export; a v1 function MUST be exported as a named `handler`. The
  // artifact-upload shim shipped as v1 `handler` for a v2 function and 502'd at
  // init on the platform site. This pins the generator to read the core source.
  const plan = buildPlan({ name: 'acme' });
  const coreDir = path.join(fileURLToPath(new URL('.', import.meta.url)), '..', 'server', 'functions');
  const shim = (name: string) => plan.files.find((f) => f.path === `sites/acme/netlify/functions/${name}.ts`);

  // artifact-upload is v2 (export const config) → default export, never `export const handler`.
  const au = shim('artifact-upload');
  assert.ok(au, 'artifact-upload shim should be scaffolded');
  assert.match(au.content, /^export default createHandler\(siteBinding\);$/m, 'v2 fn must use export default');
  assert.doesNotMatch(au.content, /export const handler\s*=/, 'v2 fn must NOT use export const handler');

  // object-store is v1 → named handler export, never a default export.
  const os = shim('object-store');
  assert.ok(os, 'object-store shim should be scaffolded');
  assert.match(
    os.content,
    /^export const handler = createHandler\(siteBinding\);$/m,
    'v1 fn must use export const handler'
  );
  assert.doesNotMatch(os.content, /export default createHandler/, 'v1 fn must NOT default-export the handler');

  // The rule is derived from the core source, not a hand-list: every generated
  // shim (except mcp, whose composite shim re-exports its own handler) matches
  // its core function's generation.
  for (const file of plan.files) {
    const m = /^sites\/acme\/netlify\/functions\/(.+)\.ts$/.exec(file.path);
    if (!m || m[1] === 'mcp') continue;
    const fnName = m[1];
    let src = '';
    for (const ext of ['ts', 'js', 'mjs']) {
      const p = path.join(coreDir, `${fnName}.${ext}`);
      if (fs.existsSync(p)) {
        src = fs.readFileSync(p, 'utf8');
        break;
      }
    }
    const coreIsV2 = /^\s*export\s+const\s+config\s*[:=]/m.test(src);
    if (coreIsV2) {
      assert.match(file.content, /^export default createHandler\(siteBinding\);$/m, `${fnName} is v2 → default export`);
    } else {
      assert.match(
        file.content,
        /^export const handler = createHandler\(siteBinding\);$/m,
        `${fnName} is v1 → named handler`
      );
    }
  }
});

test('re-running against an existing sites/<client>/ is a no-op plan-wise (the caller checks existence before writeFiles)', () => {
  // buildPlan itself is pure/idempotent — same input, same output — the
  // existence check that makes re-runs a no-op lives in main()'s CLI flow
  // (fs.existsSync guard), not in buildPlan; this pins the pure half.
  const first = buildPlan({ name: 'acme' });
  const second = buildPlan({ name: 'acme' });
  assert.deepEqual(first.files, second.files);
});
