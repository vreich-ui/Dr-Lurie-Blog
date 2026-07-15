#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

/**
 * Provision / verify the six Netlify Blob stores that pdf-tool writes into
 * through Dr-Lurie storage grants (see docs/agents/pdf-tool-storage-grant.md
 * and netlify/lib/pdf-tool-storage-grant.ts, the canonical store list).
 *
 * Netlify Blob stores are created implicitly on first write, so "provision"
 * means proving each store is writable with the SAME credentials the grant
 * serves: for every store this script writes a probe key, reads it back, and
 * deletes it. A store that passes exists and is writable for pdf-tool.
 *
 * Required env (the same pair get_pdf_tool_storage_grant serves):
 *   PDF_TOOL_STORAGE_TOKEN    — PAT of the dedicated Netlify machine account
 *   PDF_TOOL_STORAGE_SITE_ID  — the Dr-Lurie site API id
 *
 * Usage: node scripts/provision-pdf-tool-stores.mjs
 * Never prints either credential.
 */

// Keyed by grant field name; values are the store names pdf-tool opens.
// Must match pdfToolStorageStores in netlify/lib/pdf-tool-storage-grant.ts
// (tests pin both to the grant contract).
export const PDF_TOOL_STORES = {
  artifacts: 'artifacts',
  artifactIndex: 'artifact-index',
  templates: 'pdf-templates',
  imageSearch: 'image-search',
  renderData: 'pdf-render-data',
  jobs: 'pdf-tool-jobs',
};

const PROBE_KEY_PREFIX = '__pdf-tool-provision-probe__/';

const probeStore = async (getStore, { siteID, token }, storeName) => {
  const store = getStore({ name: storeName, siteID, token, consistency: 'strong' });
  const probeKey = `${PROBE_KEY_PREFIX}${Date.now()}.json`;
  const payload = { probedAt: new Date().toISOString(), purpose: 'pdf-tool storage-grant provisioning probe' };

  await store.setJSON(probeKey, payload);
  const readBack = await store.get(probeKey, { type: 'json' });
  if (!readBack || readBack.probedAt !== payload.probedAt) {
    throw new Error('probe read-back did not match the written value');
  }
  await store.delete(probeKey);
};

const main = async () => {
  const token = process.env.PDF_TOOL_STORAGE_TOKEN?.trim();
  const siteID = process.env.PDF_TOOL_STORAGE_SITE_ID?.trim();

  if (!token || !siteID) {
    console.error(
      'Missing credentials: set PDF_TOOL_STORAGE_TOKEN and PDF_TOOL_STORAGE_SITE_ID ' +
        '(see docs/agents/pdf-tool-storage-grant.md for the provisioning runbook).'
    );
    process.exit(2);
  }

  let getStore;
  try {
    ({ getStore } = await import('@netlify/blobs'));
  } catch {
    console.error('@netlify/blobs is not installed; run npm install with Netlify registry access first.');
    process.exit(2);
  }

  let failures = 0;
  for (const [grantField, storeName] of Object.entries(PDF_TOOL_STORES)) {
    try {
      await probeStore(getStore, { siteID, token }, storeName);
      console.log(`ok       ${storeName} (grant field: ${grantField})`);
    } catch (error) {
      failures += 1;
      console.error(
        `FAILED   ${storeName} (grant field: ${grantField}): ${error instanceof Error ? error.message : error}`
      );
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} of ${Object.keys(PDF_TOOL_STORES).length} stores failed the write/read/delete probe.`);
    process.exit(1);
  }

  console.log(
    `\nAll ${Object.keys(PDF_TOOL_STORES).length} pdf-tool stores exist and are writable with the grant credentials.`
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
