import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkoutRequest,
  createRequest,
  patchAgentOutput,
  patchCanonicalInput,
  type WorkflowRecord,
} from '../../netlify/functions/save-json-blob.js';

// ---------------------------------------------------------------------------
// In-memory blob store (same shape used by all save-json-blob tests)
// ---------------------------------------------------------------------------
const createMemoryStore = () => {
  const blobs = new Map<string, string>();

  return {
    async set(key: string, value: string) {
      blobs.set(key, value);
    },
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async del(key: string) {
      blobs.delete(key);
    },
    async setJSON(key: string, value: unknown) {
      blobs.set(key, JSON.stringify(value));
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? '';
      return {
        blobs: [...blobs.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, etag: '' })),
        directories: [],
      };
    },
  };
};

type Store = ReturnType<typeof createMemoryStore>;
type RecordBody = { ok?: boolean; error?: string; issues?: unknown[]; record?: WorkflowRecord; conflict?: boolean };
const parseBody = (r: { body: string }): RecordBody => JSON.parse(r.body) as RecordBody;

// ---------------------------------------------------------------------------
// Known stable artifact refs (mirroring the retinol repair request)
// ---------------------------------------------------------------------------
const FEATURED_ARTIFACT = `image/req_repair_retinol_schema_publish_v2_20260624/94af376e6bea4d7680e75b6dcb53bf7fd4433d7c0154a5c00e61e4969350232d.png`;
const INLINE_ARTIFACT = `image/req_repair_retinol_schema_publish_v2_20260624/655373f81c38225fed48b0bb7681c727fe450d70f87817f66de7212f79858b8f.png`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeInput = (requestId: string) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    title: 'Retinol Explained Simply',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'n_r1a2b3',
          kind: 'content',
          public: {
            title: 'Hero image',
            media: {
              type: 'image',
              src: 'src/assets/images/uploads/retinol-explained-simply/retinol-hero-150kb.webp',
              alt: 'Retinol hero',
            },
          },
        },
        {
          id: 'n_r2g3h4',
          kind: 'content',
          public: {
            body: 'Body copy with inline image.',
            media: {
              type: 'image',
              src: 'src/assets/images/uploads/retinol-explained-simply/retinol-inline-150kb.webp',
              alt: 'Retinol inline',
            },
          },
        },
        {
          id: 'n_r3x4y5',
          kind: 'content',
          public: { body: 'Text-only node, no media.' },
          private: { strategy: 'explanation', agentNotes: 'Internal note.' },
        },
      ],
    },
  },
  media: {
    image_asset_register: [
      {
        asset_id: 'asset_hero_legacy',
        repoPath: 'src/assets/images/uploads/retinol-explained-simply/retinol-hero-150kb.webp',
        alt: 'Old hero',
      },
    ],
  },
  publication: { schema_version: 'publication.v2', published_time: null },
  workflow: { schema_version: 'content_workflow.v1', workflow_id: requestId },
  versioning: { schema_version: 'versioning.v1', record_version: 1 },
});

/** Agent output whose artifactReferences contain both trusted refs above. */
const makeFinalArticleOutput = () => ({
  artifactReferences: [
    {
      blobKey: FEATURED_ARTIFACT,
      sha256: '94af376e6bea4d7680e75b6dcb53bf7fd4433d7c0154a5c00e61e4969350232d',
      contentType: 'image/png',
      sizeBytes: 250000,
      createdAtISO: new Date().toISOString(),
    },
    {
      blobKey: INLINE_ARTIFACT,
      sha256: '655373f81c38225fed48b0bb7681c727fe450d70f87817f66de7212f79858b8f',
      contentType: 'image/png',
      sizeBytes: 180000,
      createdAtISO: new Date().toISOString(),
    },
  ],
  publish_payload: {
    slug: 'retinol-explained-simply',
    title: 'Retinol Explained Simply',
    author: 'Dr. Lurie',
    publishDate: '2026-06-24',
    overwrite: true,
  },
});

/** Create a workflow record, patch final_article output, then checkout. Returns { store, requestId, lockToken, record }. */
const setupRecord = async (store: Store, requestId: string) => {
  const createResp = await createRequest(store, {
    action: 'create_request',
    request_id: requestId,
    input: makeInput(requestId),
  });
  assert.equal(createResp.statusCode, 201, createResp.body);

  // Checkout to get lock
  const checkoutResp = await checkoutRequest(store, {
    action: 'checkout_request',
    request_id: requestId,
    owner_id: 'publishing_conductor',
    owner_label: 'Publishing Conductor',
    lease_seconds: 900,
  });
  assert.equal(checkoutResp.statusCode, 200, checkoutResp.body);
  const checkoutRecord = parseBody(checkoutResp).record!;
  const lockToken = checkoutRecord.lock!.token;

  // Patch final_article output with trusted artifact refs
  const patchResp = await patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: requestId,
    agent_name: 'final_article',
    expected_agent_version: 0,
    lock_token: lockToken,
    output: makeFinalArticleOutput(),
  });
  assert.equal(patchResp.statusCode, 200, patchResp.body);
  const patchedRecord = parseBody(patchResp).record!;

  return { store, requestId, lockToken, record: patchedRecord };
};

// ===========================================================================
// Tests
// ===========================================================================

describe('patchCanonicalInput — node_patches', () => {
  it('replaces legacy src/assets path with Major Key artifact ref on two nodes', async () => {
    const store = createMemoryStore();
    const requestId = `repair-nodes-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      node_patches: [
        { node_id: 'n_r1a2b3', public_media_src: FEATURED_ARTIFACT },
        { node_id: 'n_r2g3h4', public_media_src: INLINE_ARTIFACT },
      ],
    });

    assert.equal(resp.statusCode, 200, resp.body);
    const saved = parseBody(resp).record!;
    const nodes = saved.input.content?.article_body?.nodes ?? [];

    const heroNode = nodes.find((n) => n.id === 'n_r1a2b3');
    assert.ok(heroNode, 'n_r1a2b3 must exist');
    assert.equal(heroNode.public?.media?.src, FEATURED_ARTIFACT, 'hero src must be updated');
    assert.equal(heroNode.public?.media?.alt, 'Retinol hero', 'alt must be preserved');
    assert.equal(heroNode.public?.media?.type, 'image', 'type must be preserved');

    const inlineNode = nodes.find((n) => n.id === 'n_r2g3h4');
    assert.ok(inlineNode, 'n_r2g3h4 must exist');
    assert.equal(inlineNode.public?.media?.src, INLINE_ARTIFACT, 'inline src must be updated');

    // Text-only node must be untouched
    const textNode = nodes.find((n) => n.id === 'n_r3x4y5');
    assert.ok(textNode, 'n_r3x4y5 must exist');
    assert.equal(textNode.public?.media, undefined, 'text-only node must have no media');
    assert.deepEqual(
      textNode.private,
      { strategy: 'explanation', agentNotes: 'Internal note.' },
      'private must be preserved'
    );
  });

  it('removes media object when public_media_src is null', async () => {
    const store = createMemoryStore();
    const requestId = `repair-null-src-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      node_patches: [{ node_id: 'n_r1a2b3', public_media_src: null }],
    });

    assert.equal(resp.statusCode, 200, resp.body);
    const heroNode = parseBody(resp).record?.input.content?.article_body?.nodes?.find((n) => n.id === 'n_r1a2b3');
    assert.equal(heroNode?.public?.media, undefined, 'media must be removed when src is null');
  });

  it('rejects legacy src/assets/ paths in public_media_src', async () => {
    const store = createMemoryStore();
    const requestId = `repair-reject-legacy-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      node_patches: [
        {
          node_id: 'n_r1a2b3',
          public_media_src: 'src/assets/images/uploads/retinol-explained-simply/retinol-hero-150kb.webp',
        },
      ],
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /legacy repo path|src\/assets/i);
  });

  it('rejects data URIs in public_media_src', async () => {
    const store = createMemoryStore();
    const requestId = `repair-reject-datauri-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      node_patches: [
        {
          node_id: 'n_r1a2b3',
          public_media_src: 'data:image/png;base64,iVBORw0KGgo=',
        },
      ],
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /data uri|base64/i);
  });

  it('rejects artifact refs not present in agent_outputs', async () => {
    const store = createMemoryStore();
    const requestId = `repair-reject-untrusted-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const untrustedRef = `image/${requestId}/${'a'.repeat(64)}.png`;

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      node_patches: [{ node_id: 'n_r1a2b3', public_media_src: untrustedRef }],
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /not found in agent_outputs|trusted artifact/i);
  });

  it('returns 409 when node_id does not exist in article_body', async () => {
    const store = createMemoryStore();
    const requestId = `repair-missing-node-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      node_patches: [{ node_id: 'n_nonexistent', public_media_src: FEATURED_ARTIFACT }],
    });

    assert.equal(resp.statusCode, 409, resp.body);
    assert.match(parseBody(resp).error ?? '', /not found/i);
  });
});

describe('patchCanonicalInput — replace_image_asset_register', () => {
  it('replaces the image_asset_register with new Major Key entries', async () => {
    const store = createMemoryStore();
    const requestId = `repair-register-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const newRegister = [
      {
        asset_id: 'asset_hero_mk',
        url: FEATURED_ARTIFACT,
        alt: 'Retinol hero (Major Key)',
        status: 'ready',
        metadata: { purpose: 'hero' },
      },
      {
        asset_id: 'asset_inline_mk',
        url: INLINE_ARTIFACT,
        alt: 'Retinol inline (Major Key)',
        status: 'ready',
        metadata: { purpose: 'inline' },
      },
    ];

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      replace_image_asset_register: newRegister,
    });

    assert.equal(resp.statusCode, 200, resp.body);
    const saved = parseBody(resp).record!;
    assert.equal(saved.input.media?.image_asset_register?.length, 2);
    assert.equal(saved.input.media?.image_asset_register?.[0].asset_id, 'asset_hero_mk');
  });

  it('rejects register entries with legacy repoPath', async () => {
    const store = createMemoryStore();
    const requestId = `repair-register-legacy-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      replace_image_asset_register: [
        {
          asset_id: 'bad_entry',
          repoPath: 'src/assets/images/old-image.webp',
        },
      ],
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /legacy repo path|src\/assets/i);
  });

  it('rejects register entries that fail ImageAssetRecord schema', async () => {
    const store = createMemoryStore();
    const requestId = `repair-register-invalid-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      replace_image_asset_register: [{ notAValidField: true }],
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.ok(parseBody(resp).issues || parseBody(resp).error, 'must return validation details');
  });
});

describe('patchCanonicalInput — promote_publish_payload', () => {
  it('promotes a complete publish payload into input.publication.publish_payload', async () => {
    const store = createMemoryStore();
    const requestId = `repair-payload-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const payload = {
      slug: 'retinol-explained-simply',
      title: 'Retinol Explained Simply',
      author: 'Dr. Lurie',
      publishDate: '2026-06-24T10:00:00.000Z',
      overwrite: true,
      artifactReferences: [
        {
          blobKey: FEATURED_ARTIFACT,
          sha256: '94af376e6bea4d7680e75b6dcb53bf7fd4433d7c0154a5c00e61e4969350232d',
          contentType: 'image/png',
          sizeBytes: 250000,
          createdAtISO: new Date().toISOString(),
        },
      ],
    };

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      promote_publish_payload: payload,
    });

    assert.equal(resp.statusCode, 200, resp.body);
    const saved = parseBody(resp).record!;
    const storedPayload = saved.input.publication?.publish_payload as Record<string, unknown> | undefined;
    assert.ok(storedPayload, 'publish_payload must be stored');
    assert.equal(storedPayload.slug, 'retinol-explained-simply');
    assert.equal(storedPayload.overwrite, true);
  });

  it('rejects promote_publish_payload missing required slug/title', async () => {
    const store = createMemoryStore();
    const requestId = `repair-payload-invalid-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      promote_publish_payload: { overwrite: true },
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /publishpayload|required|slug|title/i);
  });
});

describe('patchCanonicalInput — repair_workflow_status', () => {
  it('resets workflow_status from failed to pending', async () => {
    const store = createMemoryStore();
    const requestId = `repair-status-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    // Manually set status to failed in the store
    const failedRecord: WorkflowRecord = {
      ...record,
      workflow_status: 'failed',
      last_error: 'publish failed: 422 Invalid image reference.',
    };
    await store.setJSON(`workflows/by-id/${requestId}.json`, failedRecord);
    await store.set(`workflows/index/by-status/failed/${requestId}`, '');

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: failedRecord.version,
      repair_workflow_status: 'pending',
      // also fix nodes in same call
      node_patches: [{ node_id: 'n_r1a2b3', public_media_src: FEATURED_ARTIFACT }],
    });

    assert.equal(resp.statusCode, 200, resp.body);
    const saved = parseBody(resp).record!;
    assert.equal(saved.workflow_status, 'pending', 'status must be reset to pending');

    const lastHistoryEntry = saved.history.at(-1);
    assert.ok(lastHistoryEntry?.details?.workflow_status_changed, 'audit must record status transition');
    const change = lastHistoryEntry?.details?.workflow_status_changed as { from: string; to: string };
    assert.equal(change.from, 'failed');
    assert.equal(change.to, 'pending');
  });

  it('rejects invalid repair_workflow_status values', async () => {
    const store = createMemoryStore();
    const requestId = `repair-status-invalid-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      repair_workflow_status: 'not_a_real_status',
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /invalid repair_workflow_status/i);
  });
});

describe('patchCanonicalInput — lock and version safety', () => {
  it('requires a lock_token', async () => {
    const store = createMemoryStore();
    const requestId = `repair-no-lock-${Date.now()}`;
    const { record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      // no lock_token
      expected_record_version: record.version,
      node_patches: [{ node_id: 'n_r1a2b3', public_media_src: FEATURED_ARTIFACT }],
    });

    assert.equal(resp.statusCode, 423, resp.body);
  });

  it('returns 409 when expected_record_version does not match', async () => {
    const store = createMemoryStore();
    const requestId = `repair-version-conflict-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version + 999,
      node_patches: [{ node_id: 'n_r1a2b3', public_media_src: FEATURED_ARTIFACT }],
    });

    assert.equal(resp.statusCode, 409, resp.body);
    assert.equal(parseBody(resp).conflict, true);
  });

  it('returns 400 when no patch types are provided', async () => {
    const store = createMemoryStore();
    const requestId = `repair-empty-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /at least one/i);
  });

  it('increments record version and appends to history', async () => {
    const store = createMemoryStore();
    const requestId = `repair-version-bump-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);
    const versionBefore = record.version;
    const historyLengthBefore = record.history.length;

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: versionBefore,
      node_patches: [{ node_id: 'n_r1a2b3', public_media_src: FEATURED_ARTIFACT }],
    });

    assert.equal(resp.statusCode, 200, resp.body);
    const saved = parseBody(resp).record!;
    assert.equal(saved.version, versionBefore + 1, 'version must be incremented');
    assert.equal(saved.history.length, historyLengthBefore + 1, 'one history entry must be appended');

    const entry = saved.history.at(-1)!;
    assert.equal(entry.action, 'patch_canonical_input');
    assert.ok(Array.isArray(entry.details?.patches), 'history must include patches array');
    const patches = entry.details?.patches as { path: string; old_value_summary: string; new_value_summary: string }[];
    assert.equal(patches.length, 1);
    assert.equal(patches[0].path, 'input.content.article_body.nodes[n_r1a2b3].public.media.src');
    assert.match(patches[0].old_value_summary, /src\/assets/);
    assert.equal(patches[0].new_value_summary, FEATURED_ARTIFACT);
  });

  it('preserves agent_outputs unchanged', async () => {
    const store = createMemoryStore();
    const requestId = `repair-preserve-outputs-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      node_patches: [{ node_id: 'n_r1a2b3', public_media_src: FEATURED_ARTIFACT }],
    });

    assert.equal(resp.statusCode, 200, resp.body);
    const saved = parseBody(resp).record!;
    // final_article output must be untouched
    assert.deepEqual(
      saved.agent_outputs.final_article?.output,
      record.agent_outputs.final_article?.output,
      'agent_outputs.final_article must not be modified'
    );
  });
});

// ===========================================================================
// Tighter validation — replace_image_asset_register
// ===========================================================================

describe('patchCanonicalInput — replace_image_asset_register tighter validation', () => {
  it('rejects register entries with untrusted Major Key artifact ref in url', async () => {
    const store = createMemoryStore();
    const requestId = `register-untrusted-url-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    // Valid Major Key format but NOT in agent_outputs for this record
    const untrustedRef = `image/${requestId}/${'b'.repeat(64)}.png`;

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      replace_image_asset_register: [{ asset_id: 'x', url: untrustedRef }],
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /not found in agent_outputs/i);
  });

  it('rejects register entries with arbitrary remote URL in url', async () => {
    const store = createMemoryStore();
    const requestId = `register-remote-url-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      replace_image_asset_register: [{ asset_id: 'asset_bad', url: 'https://cdn.example.com/image.jpg' }],
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /arbitrary remote url|remote url/i);
  });

  it('rejects register entries with arbitrary local absolute path in url', async () => {
    const store = createMemoryStore();
    const requestId = `register-local-abs-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      replace_image_asset_register: [{ asset_id: 'asset_lp', url: '/images/foo.png' }],
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /major key artifact reference/i);
  });

  it('rejects register entries with relative upload path in url', async () => {
    const store = createMemoryStore();
    const requestId = `register-rel-upload-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      replace_image_asset_register: [{ asset_id: 'asset_ru', url: 'uploads/foo.webp' }],
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /major key artifact reference/i);
  });

  it('rejects register entries with bare filename in url', async () => {
    const store = createMemoryStore();
    const requestId = `register-bare-file-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      replace_image_asset_register: [{ asset_id: 'asset_bf', url: 'old-image.webp' }],
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /major key artifact reference/i);
  });

  it('accepts trusted Major Key artifact ref in url', async () => {
    const store = createMemoryStore();
    const requestId = `register-trusted-url-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      replace_image_asset_register: [{ asset_id: 'asset_mk', url: FEATURED_ARTIFACT, alt: 'Hero', status: 'ready' }],
    });

    assert.equal(resp.statusCode, 200, resp.body);
    assert.equal(parseBody(resp).record?.input.media?.image_asset_register?.[0].url, FEATURED_ARTIFACT);
  });
});

// ===========================================================================
// Tighter validation — promote_publish_payload image-bearing fields
// ===========================================================================

describe('patchCanonicalInput — promote_publish_payload image validation', () => {
  it('rejects promote_publish_payload.featuredImage with arbitrary remote URL', async () => {
    const store = createMemoryStore();
    const requestId = `payload-featured-remote-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      promote_publish_payload: {
        slug: 'retinol-explained-simply',
        title: 'Retinol Explained Simply',
        featuredImage: 'https://cdn.example.com/hero.jpg',
      },
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /arbitrary remote url|remote url/i);
  });

  it('rejects promote_publish_payload.featuredImage with untrusted artifact ref', async () => {
    const store = createMemoryStore();
    const requestId = `payload-featured-untrusted-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      promote_publish_payload: {
        slug: 'retinol-explained-simply',
        title: 'Retinol Explained Simply',
        featuredImage: `image/${requestId}/${'c'.repeat(64)}.png`,
      },
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /not found in agent_outputs/i);
  });

  it('rejects promote_publish_payload.artifactReferences[].blobKey with guessed (untrusted) ref', async () => {
    const store = createMemoryStore();
    const requestId = `payload-blobkey-guessed-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      promote_publish_payload: {
        slug: 'retinol-explained-simply',
        title: 'Retinol Explained Simply',
        artifactReferences: [
          {
            blobKey: `image/${requestId}/${'d'.repeat(64)}.png`,
            sha256: 'd'.repeat(64),
            contentType: 'image/png',
            sizeBytes: 1000,
            createdAtISO: new Date().toISOString(),
          },
        ],
      },
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /not found in agent_outputs/i);
  });

  it('accepts promote_publish_payload with trusted artifact ref in featuredImage and artifactReferences', async () => {
    const store = createMemoryStore();
    const requestId = `payload-trusted-refs-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      promote_publish_payload: {
        slug: 'retinol-explained-simply',
        title: 'Retinol Explained Simply',
        featuredImage: FEATURED_ARTIFACT,
        artifactReferences: [
          {
            blobKey: INLINE_ARTIFACT,
            sha256: '655373f81c38225fed48b0bb7681c727fe450d70f87817f66de7212f79858b8f',
            contentType: 'image/png',
            sizeBytes: 180000,
            createdAtISO: new Date().toISOString(),
          },
        ],
      },
    });

    assert.equal(resp.statusCode, 200, resp.body);
    const saved = parseBody(resp).record!;
    const storedPayload = saved.input.publication?.publish_payload as Record<string, unknown> | undefined;
    assert.equal(storedPayload?.featuredImage, FEATURED_ARTIFACT);
  });
});

// ===========================================================================
// Status repair — clear stale failure state
// ===========================================================================

describe('patchCanonicalInput — clear stale failure state', () => {
  it('clears last_error, failed_agents, and needs_review in one call with audit trail', async () => {
    const store = createMemoryStore();
    const requestId = `repair-clear-all-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    // Simulate a failed record with stale failure state
    const failedRecord: WorkflowRecord = {
      ...record,
      workflow_status: 'failed',
      last_error: 'publish failed: 422 Invalid image reference.',
      failed_agents: ['final_article'],
      needs_review: true,
    };
    await store.setJSON(`workflows/by-id/${requestId}.json`, failedRecord);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: failedRecord.version,
      repair_workflow_status: 'pending',
      clear_last_error: true,
      clear_failed_agents: true,
      reset_needs_review: true,
    });

    assert.equal(resp.statusCode, 200, resp.body);
    const saved = parseBody(resp).record!;

    assert.equal(saved.workflow_status, 'pending');
    assert.equal(saved.last_error, null, 'last_error must be cleared');
    assert.deepEqual(saved.failed_agents, [], 'failed_agents must be cleared');
    assert.equal(saved.needs_review, false, 'needs_review must be reset');

    const histEntry = saved.history.at(-1)!;
    assert.equal(histEntry.action, 'patch_canonical_input');
    assert.ok(histEntry.details?.workflow_status_changed, 'audit must record status transition');
    assert.ok(histEntry.details?.last_error_cleared, 'audit must record last_error clear');
    assert.ok(histEntry.details?.failed_agents_cleared, 'audit must record failed_agents clear');
    assert.ok(histEntry.details?.needs_review_reset, 'audit must record needs_review reset');

    const statusChange = histEntry.details?.workflow_status_changed as { from: string; to: string };
    assert.equal(statusChange.from, 'failed');
    assert.equal(statusChange.to, 'pending');

    const failedAgentsCleared = histEntry.details?.failed_agents_cleared as { from: string[] };
    assert.deepEqual(failedAgentsCleared.from, ['final_article']);
  });

  it('does not audit clear_last_error when last_error was already null', async () => {
    const store = createMemoryStore();
    const requestId = `repair-clear-noop-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    // Record already has null last_error (default from setupRecord)
    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      clear_last_error: true,
      node_patches: [{ node_id: 'n_r1a2b3', public_media_src: FEATURED_ARTIFACT }],
    });

    assert.equal(resp.statusCode, 200, resp.body);
    const histEntry = parseBody(resp).record!.history.at(-1)!;
    assert.equal(
      histEntry.details?.last_error_cleared,
      undefined,
      'last_error_cleared must be absent when already null'
    );
  });

  it('clears failed_agents alone without requiring repair_workflow_status', async () => {
    const store = createMemoryStore();
    const requestId = `repair-clear-agents-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    // Simulate a record with failed_agents but not failed workflow_status
    const stuckRecord: WorkflowRecord = {
      ...record,
      failed_agents: ['draft'],
    };
    await store.setJSON(`workflows/by-id/${requestId}.json`, stuckRecord);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: stuckRecord.version,
      clear_failed_agents: true,
    });

    assert.equal(resp.statusCode, 200, resp.body);
    const saved = parseBody(resp).record!;
    assert.deepEqual(saved.failed_agents, [], 'failed_agents must be cleared');
  });

  it('returns 400 when only clear_last_error: false is given (no effective patch)', async () => {
    const store = createMemoryStore();
    const requestId = `repair-false-flag-${Date.now()}`;
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      // clear_last_error: false is falsy so doesn't count
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /at least one/i);
  });
});
