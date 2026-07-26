#!/usr/bin/env node
/**
 * Fleet schema-migration gate (W11 T11.9, extends T11.8's fleet discovery).
 *
 * "A core schema change cannot merge unless every client provably survives
 * it" (T11.9-schema-migration-harness.md's Deliver) — this script is the CI
 * mechanism: for every site the fleet discovery already knows about
 * (scripts/ci/discover-fleet-matrix.mjs's `discoverSites`, so a second
 * client (T11.11) is covered with zero edits here), it runs
 * `migrate-site.mjs`'s dry-run classifier against that site's COMMITTED
 * exports and fails the whole gate if any site comes back `blocked` —
 * "every site's committed exports must parse under the head schemas OR the
 * PR must carry the migration module + a green dry-run report per site; a
 * failing site blocks merge" (the brief, verbatim).
 *
 * `migrate-site.mjs` imports real zod schema modules (packages/core/schema/
 * bodies/*.ts) via `.js` NodeNext specifiers, so it can only run compiled —
 * this script drives its own `tsc -p tsconfig.test.json` pass into a
 * throwaway `.tmp/ci-schema-gate/` (a DIFFERENT outDir than `npm test`'s own
 * `.tmp/ci-test`, deliberately: this script is meant to run as its own CI
 * step — e.g. in the `check` job, which does not itself run the test-tsc
 * compile — without racing or colliding with a concurrent `npm test`), then
 * dynamically imports the compiled `migrate-site.js` and calls its
 * `buildDryRunReport`/`renderReport` directly (no need to shell out to the
 * CLI's own argv parsing). Cleans up its own compiled tree afterwards
 * (best-effort; a leftover `.tmp/ci-schema-gate/` is harmless clutter, not a
 * correctness problem, so a cleanup failure is logged, not fatal).
 *
 * Today (no real schema bump exists — T11.9's own non-goal) this trivially
 * passes for every discovered site: proof the harness doesn't break
 * anything live, not a weak test — the adversarial "blocks without a
 * migration, passes with it" case has its own dedicated proof in
 * packages/core/server/migrations/classify.test.ts against a wholly
 * synthetic schema pair.
 *
 * Usage:
 *   node scripts/ci/schema-migration-gate.mjs
 * Exit code 0 = every discovered site's exports parse clean; 1 = at least
 * one site is blocked (the report names it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { discoverSites } from './discover-fleet-matrix.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE_OUT_DIR = path.join(repoRoot, '.tmp', 'ci-schema-gate');

/**
 * Pure aggregation over already-built per-site dry-run reports — separated
 * from the compile/import machinery above so the "one blocked site fails
 * the whole gate" decision is unit-testable without a real tsc pass.
 * @param {Array<{site: string, report: {gatePasses: boolean, recordCount: number}}>} perSite
 */
export const aggregateFleetGate = (perSite) => ({
  allPass: perSite.every((s) => s.report.gatePasses),
  totalRecords: perSite.reduce((sum, s) => sum + s.report.recordCount, 0),
  failingSites: perSite.filter((s) => !s.report.gatePasses).map((s) => s.site),
});

const compileForGate = () => {
  fs.rmSync(GATE_OUT_DIR, { recursive: true, force: true });
  execFileSync('npx', ['tsc', '-p', 'tsconfig.test.json', '--outDir', GATE_OUT_DIR], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
};

export const main = async () => {
  const sites = discoverSites();
  if (sites.length === 0) {
    console.log('[schema-migration-gate] no sites discovered — nothing to check.');
    return 0;
  }

  console.log(
    `[schema-migration-gate] compiling (tsc -p tsconfig.test.json -> ${path.relative(repoRoot, GATE_OUT_DIR)})…`
  );
  compileForGate();

  // object-verbs.js's import chain reaches site-identity resolution at
  // module scope, which needs the site policy bindings registered first —
  // the same side-effect import every test that touches handleObjectVerb
  // needs (see packages/core/cli/migrate-site.test.ts's own first import).
  //
  // W14 T14.1 moved the bindings out of `src/config/` and into each site's
  // own `config/`, so the path is derived from the discovered fleet rather
  // than hardcoded. The providers are process-global and the gate only needs
  // SOME site registered to resolve identity, so the first one wins — the
  // per-site export parsing below is what actually iterates the fleet.
  const [firstSite] = discoverSites();
  if (!firstSite) throw new Error('[schema-migration-gate] no sites discovered — nothing to gate.');
  await import(pathToFileURL(path.join(GATE_OUT_DIR, 'sites', firstSite, 'config', 'policy-bindings.js')).href);

  // tsc copies a .mjs source through as .mjs (it can't rename an ESM-mode
  // file's extension the way it emits .ts -> .js), unlike the co-located
  // .test.ts files, which DO emit as .test.js — see the sibling .cli dir's
  // compiled output for both shapes side by side.
  const migrateSiteModulePath = path.join(GATE_OUT_DIR, 'packages', 'core', 'cli', 'migrate-site.mjs');
  const { buildDryRunReport, renderReport } = await import(pathToFileURL(migrateSiteModulePath).href);

  const perSite = sites.map((site) => ({
    site,
    report: buildDryRunReport(path.join(repoRoot, 'sites', site)),
  }));

  for (const { site, report } of perSite) {
    console.log(`\n--- ${site} ---`);
    console.log(renderReport(report));
  }

  const aggregate = aggregateFleetGate(perSite);
  console.log(
    `\n[schema-migration-gate] ${sites.length} site(s), ${aggregate.totalRecords} record(s) total — ${
      aggregate.allPass ? 'PASS' : `FAIL (blocked: ${aggregate.failingSites.join(', ')})`
    }`
  );

  try {
    fs.rmSync(GATE_OUT_DIR, { recursive: true, force: true });
  } catch (error) {
    console.error(
      `[schema-migration-gate] warning: could not clean up ${GATE_OUT_DIR} (${error instanceof Error ? error.message : error}) — harmless clutter, not a gate failure.`
    );
  }

  return aggregate.allPass ? 0 : 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[schema-migration-gate] FAILED: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
}
