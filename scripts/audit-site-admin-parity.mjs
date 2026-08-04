#!/usr/bin/env node
/**
 * `audit-site-admin-parity` — W15 S2: prove, from the repo alone, that a
 * tenant has everything a working `/admin` workspace + edit-mode canvas
 * needs — or print exactly what is missing and who provisions it.
 *
 * The requirement inventory and every check live in
 * packages/core/cli/admin-parity.mjs (single source of truth, shared with
 * `migrate-site --admin-parity`, which can WRITE the automatable fixes).
 * The human-readable requirement doc is
 * docs/cms-architecture/15-fleet-admin-parity.md.
 *
 * Usage:
 *   node scripts/audit-site-admin-parity.mjs --site sites/platform
 *   node scripts/audit-site-admin-parity.mjs --root          # the Dr-Lurie root deploy wiring
 *   node scripts/audit-site-admin-parity.mjs --all           # every sites/<slug> with a netlify.toml + the root
 *
 * Exit code: 0 when no GAP rows (HUMAN rows are expected — they name the
 * console/secret steps no repo check can prove), 1 otherwise. Safe to run
 * anywhere: read-only, no network, no store access.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  computeAdminParity,
  renderParityReport,
  resolveAuditTarget,
  repoRoot,
} from '../packages/core/cli/admin-parity.mjs';

const parseArgs = (argv) => {
  const opts = { targets: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--site') {
      opts.targets.push(argv[i + 1]);
      i += 1;
    } else if (arg === '--root') {
      opts.targets.push('--root');
    } else if (arg === '--all') {
      opts.all = true;
    }
  }
  return opts;
};

/** Every sites/<slug> that is its OWN Netlify project (has a netlify.toml), plus the root deploy. */
export const discoverTargets = (root = repoRoot) => {
  const targets = [];
  const sitesRoot = path.join(root, 'sites');
  if (fs.existsSync(sitesRoot)) {
    for (const entry of fs.readdirSync(sitesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (fs.existsSync(path.join(sitesRoot, entry.name, 'netlify.toml'))) targets.push(`sites/${entry.name}`);
    }
  }
  targets.sort();
  targets.push('--root'); // Dr-Lurie still deploys from the repo root (T14.3 wiring)
  return targets;
};

export const main = async (argv) => {
  const opts = parseArgs(argv);
  const targets = opts.all ? discoverTargets() : opts.targets;
  if (targets.length === 0) {
    console.error('[audit-site-admin-parity] pass --site sites/<slug>, --root, or --all');
    process.exitCode = 2;
    return;
  }

  let gaps = 0;
  for (const targetArg of targets) {
    const target = resolveAuditTarget(targetArg);
    if (!target.isRoot && !fs.existsSync(target.siteDir)) {
      console.error(`[audit-site-admin-parity] no such site directory: ${targetArg}`);
      process.exitCode = 2;
      return;
    }
    const checks = computeAdminParity(target);
    console.log(renderParityReport(target.label, checks));
    console.log('');
    gaps += checks.filter((c) => c.status === 'GAP').length;
  }
  console.log(
    gaps === 0
      ? '[audit-site-admin-parity] RESULT: PASS — no gaps; HUMAN rows list the console/secret steps.'
      : `[audit-site-admin-parity] RESULT: FAIL — ${gaps} gap(s). Automatable ones: node packages/core/cli/migrate-site.mjs --site sites/<slug> --admin-parity --write`
  );
  process.exitCode = gaps === 0 ? 0 : 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[audit-site-admin-parity] FAILED: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
