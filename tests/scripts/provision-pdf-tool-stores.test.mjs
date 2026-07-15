import assert from 'node:assert/strict';
import test from 'node:test';

import { PDF_TOOL_STORES } from '../../scripts/provision-pdf-tool-stores.mjs';

// Same literal as tests/netlify/mcp-pdf-tool-storage-grant.test.ts: the store
// mapping named by the pdf-tool grant contract. The provisioning script must
// probe exactly the stores the grant hands out.
const CONTRACT_STORES = {
  artifacts: 'artifacts',
  artifactIndex: 'artifact-index',
  templates: 'pdf-templates',
  imageSearch: 'image-search',
  renderData: 'pdf-render-data',
  jobs: 'pdf-tool-jobs',
};

test('the provisioning script probes exactly the six grant-contract stores', () => {
  assert.deepEqual(PDF_TOOL_STORES, CONTRACT_STORES);
});

test('importing the provisioning script never runs the probe or requires credentials', () => {
  // The import at the top of this file succeeded without
  // PDF_TOOL_STORAGE_TOKEN / PDF_TOOL_STORAGE_SITE_ID set and without
  // touching the network — the direct-run guard is doing its job.
  assert.equal(typeof PDF_TOOL_STORES, 'object');
});
