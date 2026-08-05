#!/usr/bin/env node
/**
 * `audit-storage-grant-parity` — live proof that every named tenant site has
 * its OWN dedicated pdf-tool storage target (`PDF_TOOL_STORAGE_SITE_ID`), not
 * a value shared with another tenant (the pre-2026-08-04 fleet default this
 * repo is moving off of — docs/agents/pdf-tool-storage-grant.md).
 *
 * Companion to scripts/audit-site-admin-parity.mjs, but this one CANNOT run
 * repo-only: PDF_TOOL_STORAGE_SITE_ID/TOKEN are per-site Netlify env values,
 * never committed, so proving parity means reading them live.
 * `checkStorageGrantParity` (packages/core/cli/create-site.mjs) is the single
 * source of truth — this script's CLI wrapper and create-site's own
 * `--known-tenant-site` provisioning-time check both call it.
 *
 * Usage:
 *   node scripts/audit-storage-grant-parity.mjs \
 *     --site kugel-platform --site kugel-fernwell --site dr-lurie-root
 *   NETLIFY_API_TOKEN=... node scripts/audit-storage-grant-parity.mjs --site ...
 *
 * Requires a Netlify API token with account-level env read access on every
 * named site (`--netlify-token`, or `NETLIFY_API_TOKEN` in the environment —
 * the same fleet-shared token `create-site --netlify-token` uses).
 *
 * Exit code: 0 when every named site has a distinct (or not-yet-provisioned)
 * storage target; 1 on any collision or site-not-found; 2 on bad usage.
 * An 'unset' row is reported but does NOT fail the run by itself — a site
 * that hasn't been through pdf-tool-storage-grant.md's provisioning steps
 * yet is a not-yet-provisioned site, not a parity violation; the bridge
 * already fails closed for it (`pdf_tool_storage_grant_not_configured`).
 */
import { pathToFileURL } from 'node:url';

import { checkStorageGrantParity } from '../packages/core/cli/create-site.mjs';

const parseArgs = (argv) => {
  const opts = { sites: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--site') {
      opts.sites.push(argv[i + 1]);
      i += 1;
    } else if (arg === '--netlify-token') {
      opts.netlifyToken = argv[i + 1];
      i += 1;
    }
  }
  return opts;
};

export const main = async (argv) => {
  const opts = parseArgs(argv);
  const token = opts.netlifyToken || process.env.NETLIFY_API_TOKEN;
  if (!token) {
    console.error('[audit-storage-grant-parity] set NETLIFY_API_TOKEN or pass --netlify-token');
    process.exitCode = 2;
    return;
  }
  if (opts.sites.length < 2) {
    console.error('[audit-storage-grant-parity] pass at least two --site <netlify-site-name> to check for parity');
    process.exitCode = 2;
    return;
  }

  const { rows, collisions } = await checkStorageGrantParity(fetch, token, opts.sites);

  console.log('pdf-tool storage-grant parity audit');
  console.log('');
  for (const row of rows) {
    console.log(
      `  [${row.status.toUpperCase().padEnd(9)}] ${row.siteName}${row.storageSiteId ? ` -> ${row.storageSiteId}` : ''}`
    );
  }
  console.log('');

  if (collisions.length) {
    console.log(`RESULT: FAIL — ${collisions.length} storage collision(s):`);
    for (const collision of collisions) {
      console.log(`  '${collision.storageSiteId}' is shared by: ${collision.siteNames.join(', ')}`);
    }
    console.log('');
    console.log('Fix: provision a dedicated PDF_TOOL_STORAGE_TOKEN/PDF_TOOL_STORAGE_SITE_ID per site');
    console.log('     (docs/agents/pdf-tool-storage-grant.md "Credential provisioning").');
    process.exitCode = 1;
    return;
  }

  const notFound = rows.filter((row) => row.status === 'not-found');
  if (notFound.length) {
    console.log(`RESULT: FAIL — site(s) not found: ${notFound.map((row) => row.siteName).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log('RESULT: PASS — every checked site has a distinct (or not-yet-provisioned) storage target.');
  process.exitCode = 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[audit-storage-grant-parity] FAILED: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
