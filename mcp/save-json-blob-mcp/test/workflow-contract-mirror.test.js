import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ALLOWED_AGENTS, WORKFLOW_STATUSES } from '../src/server.js';

const contractSourceUrl = new URL('../../../src/schema/workflow-contract.ts', import.meta.url);

const readCanonicalContract = async () => {
  const source = await readFile(contractSourceUrl, 'utf8');

  const readArray = (name) => {
    const match = source.match(new RegExp(`export const ${name} = \\[([^\\]]+)\\] as const;`));
    assert.ok(match, `Expected ${name} to be exported from src/schema/workflow-contract.ts.`);

    return [...match[1].matchAll(/'([^']+)'/g)].map(([, value]) => value);
  };

  return {
    allowedAgentNames: readArray('allowedAgentNames'),
    workflowStatuses: readArray('workflowStatuses'),
  };
};

test('standalone MCP workflow contract mirror matches the canonical TypeScript contract', async () => {
  const canonical = await readCanonicalContract();

  assert.deepEqual(ALLOWED_AGENTS, canonical.allowedAgentNames);
  assert.deepEqual(WORKFLOW_STATUSES, canonical.workflowStatuses);
});
