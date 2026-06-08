import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getArtifactBlobStore,
  getArtifactIndexBlobStore,
  getWorkflowBlobStore,
  setNetlifyBlobsModuleForTesting,
} from '../../netlify/lib/blob-store.js';

const workflowEnvKeys = [
  'NETLIFY',
  'NETLIFY_SITE_ID',
  'SITE_ID',
  'NETLIFY_BLOBS_TOKEN',
  'NETLIFY_AUTH_TOKEN',
  'NETLIFY_BLOBS_API_URL',
] as const;

type WorkflowEnvKey = (typeof workflowEnvKeys)[number];

const withCleanWorkflowBlobEnv = async (run: () => Promise<void>) => {
  const previousEnv = new Map<WorkflowEnvKey, string | undefined>(
    workflowEnvKeys.map((key) => [key, process.env[key]])
  );

  for (const key of workflowEnvKeys) delete process.env[key];
  setNetlifyBlobsModuleForTesting(undefined);

  try {
    await run();
  } finally {
    setNetlifyBlobsModuleForTesting(undefined);

    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const createFakeStore = () => ({
  async set() {},
  async setJSON() {},
  async get() {
    return null;
  },
  async del() {},
  async list() {
    return { blobs: [], directories: [] };
  },
});

test('getWorkflowBlobStore uses explicit strong API config only when site ID and token are configured', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    const store = createFakeStore();
    const getStoreInputs: unknown[] = [];
    const connectedEvents: unknown[] = [];

    process.env.NETLIFY_SITE_ID = 'site-123';
    process.env.NETLIFY_BLOBS_TOKEN = 'token-abc';
    process.env.NETLIFY_BLOBS_API_URL = 'https://api.example.test';

    setNetlifyBlobsModuleForTesting({
      connectLambda(event: unknown) {
        connectedEvents.push(event);
      },
      getStore(input) {
        getStoreInputs.push(input);
        return store;
      },
    });

    const result = await getWorkflowBlobStore({ blobs: { context: true } });

    assert.equal(result, store);
    assert.deepEqual(connectedEvents, []);
    assert.deepEqual(getStoreInputs, [
      {
        apiURL: 'https://api.example.test',
        consistency: 'strong',
        name: 'workflows',
        siteID: 'site-123',
        token: 'token-abc',
      },
    ]);
  });
});

test('getWorkflowBlobStore connects Lambda context and uses Lambda-compatible lookup without token config', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    const store = createFakeStore();
    const event = { blobs: { context: true } };
    const getStoreInputs: unknown[] = [];
    const connectedEvents: unknown[] = [];

    process.env.NETLIFY_SITE_ID = 'site-without-token';

    setNetlifyBlobsModuleForTesting({
      connectLambda(lambdaEvent: unknown) {
        connectedEvents.push(lambdaEvent);
      },
      getStore(input) {
        getStoreInputs.push(input);
        return store;
      },
    });

    const result = await getWorkflowBlobStore(event);

    assert.equal(result, store);
    assert.deepEqual(connectedEvents, [event]);
    assert.deepEqual(getStoreInputs, ['workflows']);
  });
});

test('artifact stores use explicit strong API config when site ID and token are configured', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    const store = createFakeStore();
    const event = { blobs: { context: true } };
    const getStoreInputs: unknown[] = [];
    const connectedEvents: unknown[] = [];

    process.env.NETLIFY_SITE_ID = 'site-with-artifacts';
    process.env.NETLIFY_BLOBS_TOKEN = 'token-xyz';

    setNetlifyBlobsModuleForTesting({
      connectLambda(lambdaEvent: unknown) {
        connectedEvents.push(lambdaEvent);
      },
      getStore(input) {
        getStoreInputs.push(input);
        return store;
      },
    });

    assert.equal(await getArtifactBlobStore(event), store);
    assert.equal(await getArtifactIndexBlobStore(event), store);
    assert.deepEqual(connectedEvents, []);
    assert.deepEqual(getStoreInputs, [
      { consistency: 'strong', name: 'artifacts', siteID: 'site-with-artifacts', token: 'token-xyz' },
      { consistency: 'strong', name: 'artifact-index', siteID: 'site-with-artifacts', token: 'token-xyz' },
    ]);
  });
});

test('artifact stores connect Lambda context and use Lambda-compatible lookup without token config', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    const store = createFakeStore();
    const event = { blobs: { context: true } };
    const getStoreInputs: unknown[] = [];
    const connectedEvents: unknown[] = [];

    process.env.NETLIFY_SITE_ID = 'site-without-token';

    setNetlifyBlobsModuleForTesting({
      connectLambda(lambdaEvent: unknown) {
        connectedEvents.push(lambdaEvent);
      },
      getStore(input) {
        getStoreInputs.push(input);
        return store;
      },
    });

    assert.equal(await getArtifactBlobStore(event), store);
    assert.equal(await getArtifactIndexBlobStore(event), store);
    assert.deepEqual(connectedEvents, [event, event]);
    assert.deepEqual(getStoreInputs, ['artifacts', 'artifact-index']);
  });
});

test('getWorkflowBlobStore falls back to the local file-backed store when Netlify runtime is absent', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    const store = await getWorkflowBlobStore({});
    const key = `blob-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;

    await store.setJSON(key, { ok: true });

    assert.deepEqual(JSON.parse((await store.get(key)) ?? 'null'), { ok: true });
  });
});
