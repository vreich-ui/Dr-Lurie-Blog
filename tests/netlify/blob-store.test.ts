import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getArtifactBlobStore,
  getArtifactIndexBlobStore,
  getBlobStoreSourceDiagnostics,
  getCoreBlobStoreSourceDiagnostics,
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

test('getWorkflowBlobStore treats enabled NETLIFY env values as production Netlify runtime', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    const store = createFakeStore();
    const getStoreInputs: unknown[] = [];
    const connectedEvents: unknown[] = [];

    process.env.NETLIFY = 'yes';

    setNetlifyBlobsModuleForTesting({
      connectLambda(event: unknown) {
        connectedEvents.push(event);
      },
      getStore(input) {
        getStoreInputs.push(input);
        return store;
      },
    });

    const result = await getWorkflowBlobStore({});

    assert.equal(result, store);
    assert.deepEqual(connectedEvents, []);
    assert.deepEqual(getStoreInputs, ['workflows']);
  });
});

test('blob store diagnostics parse NETLIFY env values explicitly', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    for (const value of ['true', '1', 'yes']) {
      process.env.NETLIFY = value;
      assert.equal(getBlobStoreSourceDiagnostics('workflows', {}).source, 'netlify-name-lookup');
    }

    for (const value of ['', 'false', '0', 'no']) {
      process.env.NETLIFY = value;
      assert.equal(getBlobStoreSourceDiagnostics('workflows', {}).source, 'local-file-backed');
    }

    delete process.env.NETLIFY;
    assert.equal(getBlobStoreSourceDiagnostics('workflows', {}).source, 'local-file-backed');
  });
});

test('getWorkflowBlobStore supports NETLIFY_AUTH_TOKEN with NETLIFY_SITE_ID explicit API config', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    const store = createFakeStore();
    const getStoreInputs: unknown[] = [];

    process.env.NETLIFY_SITE_ID = 'site-auth-token';
    process.env.NETLIFY_AUTH_TOKEN = 'auth-token-abc';

    setNetlifyBlobsModuleForTesting({
      connectLambda() {},
      getStore(input) {
        getStoreInputs.push(input);
        return store;
      },
    });

    const result = await getWorkflowBlobStore({});

    assert.equal(result, store);
    assert.deepEqual(getStoreInputs, [
      { consistency: 'strong', name: 'workflows', siteID: 'site-auth-token', token: 'auth-token-abc' },
    ]);
  });
});

test('getWorkflowBlobStore treats NETLIFY=false as local runtime without site ID or blob context', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    process.env.NETLIFY = 'false';

    const store = await getWorkflowBlobStore({});
    const key = `blob-store-netlify-false-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;

    await store.setJSON(key, { ok: true });

    assert.deepEqual(JSON.parse((await store.get(key)) ?? 'null'), { ok: true });
  });
});

test('getWorkflowBlobStore treats NETLIFY=false with NETLIFY_SITE_ID as Netlify runtime', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    const store = createFakeStore();
    const getStoreInputs: unknown[] = [];

    process.env.NETLIFY = 'false';
    process.env.NETLIFY_SITE_ID = 'site-from-env';

    setNetlifyBlobsModuleForTesting({
      connectLambda() {},
      getStore(input) {
        getStoreInputs.push(input);
        return store;
      },
    });

    const result = await getWorkflowBlobStore({});

    assert.equal(result, store);
    assert.deepEqual(getStoreInputs, ['workflows']);
  });
});

test('getWorkflowBlobStore treats NETLIFY=false with blob context as Netlify runtime', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    const store = createFakeStore();
    const event = { blobs: { context: true } };
    const getStoreInputs: unknown[] = [];
    const connectedEvents: unknown[] = [];

    process.env.NETLIFY = 'false';

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

test('blob store source diagnostics redact site IDs and expose no tokens', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    process.env.NETLIFY_SITE_ID = 'site-diagnostics-1234';
    process.env.NETLIFY_BLOBS_TOKEN = 'super-secret-token';

    const diagnostics = getBlobStoreSourceDiagnostics('workflows', { blobs: { context: true } });

    assert.deepEqual(diagnostics, {
      storeName: 'workflows',
      source: 'explicit-api-config',
      explicitApiConfigUsed: true,
      lambdaBlobContextUsed: false,
      siteId: {
        envVar: 'NETLIFY_SITE_ID',
        present: true,
        redacted: '…1234',
      },
    });
    assert.equal(JSON.stringify(diagnostics).includes('super-secret-token'), false);
    assert.equal(JSON.stringify(diagnostics).includes('site-diagnostics-1234'), false);
  });
});

test('core blob store diagnostics identify Lambda context for all admin stores', async () => {
  await withCleanWorkflowBlobEnv(async () => {
    process.env.SITE_ID = 'fallback-site-5678';
    const diagnostics = getCoreBlobStoreSourceDiagnostics({ blobs: { context: true } });

    assert.deepEqual(Object.keys(diagnostics), ['workflows', 'artifactIndex', 'artifacts']);
    assert.equal(diagnostics.workflows.storeName, 'workflows');
    assert.equal(diagnostics.artifactIndex.storeName, 'artifact-index');
    assert.equal(diagnostics.artifacts.storeName, 'artifacts');
    assert.equal(diagnostics.workflows.source, 'lambda-context');
    assert.equal(diagnostics.artifactIndex.source, 'lambda-context');
    assert.equal(diagnostics.artifacts.source, 'lambda-context');
    assert.equal(diagnostics.workflows.explicitApiConfigUsed, false);
    assert.equal(diagnostics.workflows.lambdaBlobContextUsed, true);
    assert.deepEqual(diagnostics.workflows.siteId, {
      envVar: 'SITE_ID',
      present: true,
      redacted: '…5678',
    });
  });
});
