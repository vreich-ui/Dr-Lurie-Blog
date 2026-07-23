import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkoutRequest,
  createRequest,
  patchCanonicalInput,
  type WorkflowRecord,
} from '../../netlify/functions/save-json-blob.js';
import { writeArtifactReferenceIndexes, type ArtifactIndexStore } from '../../netlify/lib/artifact-index.js';
import type { ArtifactReference } from '../../netlify/lib/artifacts.js';

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
type ResponseBody = { ok?: boolean; error?: string; error_code?: string; record?: WorkflowRecord };
const parseBody = (r: { body: string }): ResponseBody => JSON.parse(r.body) as ResponseBody;

const makeRequestId = (nn: number) => `req_promotion_trust_20260703_${String(nn).padStart(2, '0')}`;
const hexSha = (fill: string) => fill.repeat(64);

const makeImageRef = (
  requestId: string,
  fill: string,
  overrides: Partial<ArtifactReference> = {}
): ArtifactReference => {
  const sha256 = hexSha(fill);
  return {
    blobKey: `image/${requestId}/${sha256}.png`,
    sha256,
    sizeBytes: 12345,
    contentType: 'image/png',
    createdAtISO: '2026-07-03T00:00:00.000Z',
    artifactKind: 'image',
    ...overrides,
  };
};

const makeInput = (requestId: string, heroSrc?: string, heroType = 'image') => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    title: 'Canonical Promotion Trust',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'n_hero',
          kind: 'content',
          public: {
            title: 'Hero',
            ...(heroSrc ? { media: { type: heroType, src: heroSrc, alt: 'Hero' } } : {}),
          },
        },
        { id: 'n_body1', kind: 'content', public: { body: 'Some body copy.' } },
      ],
    },
  },
  publication: { schema_version: 'publication.v2', published_time: null },
  workflow: { schema_version: 'content_workflow.v1', workflow_id: requestId },
});

const setupRecord = async (store: Store, requestId: string) => {
  const createResp = await createRequest(store, {
    action: 'create_request',
    request_id: requestId,
    input: makeInput(requestId),
  });
  assert.equal(createResp.statusCode, 201, createResp.body);

  const checkoutResp = await checkoutRequest(store, {
    action: 'checkout_request',
    request_id: requestId,
    owner_id: 'publishing_conductor',
    owner_label: 'Publishing Conductor',
    lease_seconds: 900,
  });
  assert.equal(checkoutResp.statusCode, 200, checkoutResp.body);
  const record = parseBody(checkoutResp).record!;
  return { lockToken: record.lock!.token, record };
};

// ---------------------------------------------------------------------------
// Stage 3.3 — reason-specific rejection messages
// ---------------------------------------------------------------------------

describe('patch_canonical_input rejection messages are reason-specific', () => {
  it('names the owning request for a cross-request blobKey', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore() as unknown as ArtifactIndexStore;
    const requestId = makeRequestId(1);
    const { lockToken, record } = await setupRecord(store, requestId);

    const foreignRef = `image/req_other_flow_topic_20260703_09/${hexSha('a')}.png`;
    const resp = await patchCanonicalInput(
      store,
      {
        action: 'patch_canonical_input',
        request_id: requestId,
        lock_token: lockToken,
        expected_record_version: record.version,
        node_patches: [{ node_id: 'n_hero', public_media_src: foreignRef }],
      },
      indexStore
    );

    assert.equal(resp.statusCode, 400, resp.body);
    const error = parseBody(resp).error ?? '';
    assert.match(error, /belongs to request 'req_other_flow_topic_20260703_09', not '/);
    assert.match(error, /Cross-request artifact references are not accepted/);
    // Recovery is via the pdf-tool storage grant, the only artifact transfer path.
    assert.match(error, /get_pdf_tool_storage_grant|storage grant/);
  });

  it('says an indexed-but-soft-deleted artifact is soft-deleted', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore() as unknown as ArtifactIndexStore;
    const requestId = makeRequestId(2);
    const deletedRef = makeImageRef(requestId, 'b', {
      deletedAtISO: '2026-07-01T00:00:00.000Z',
      deletedBy: 'admin@example.com',
    });
    await writeArtifactReferenceIndexes(indexStore, requestId, deletedRef);
    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(
      store,
      {
        action: 'patch_canonical_input',
        request_id: requestId,
        lock_token: lockToken,
        expected_record_version: record.version,
        node_patches: [{ node_id: 'n_hero', public_media_src: deletedRef.blobKey }],
      },
      indexStore
    );

    assert.equal(resp.statusCode, 400, resp.body);
    const error = parseBody(resp).error ?? '';
    assert.match(error, /soft-deleted/);
    assert.ok(error.includes(deletedRef.blobKey), `error must name the rejected blobKey: ${error}`);
    assert.match(error, /restore/i);
  });

  it('tells the agent to upload first when the blobKey was never uploaded for this request', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore() as unknown as ArtifactIndexStore;
    const requestId = makeRequestId(3);
    const { lockToken, record } = await setupRecord(store, requestId);

    const neverUploaded = `image/${requestId}/${hexSha('c')}.png`;
    const resp = await patchCanonicalInput(
      store,
      {
        action: 'patch_canonical_input',
        request_id: requestId,
        lock_token: lockToken,
        expected_record_version: record.version,
        node_patches: [{ node_id: 'n_hero', public_media_src: neverUploaded }],
      },
      indexStore
    );

    assert.equal(resp.statusCode, 400, resp.body);
    const error = parseBody(resp).error ?? '';
    assert.match(error, /not in the artifact index for request/);
    assert.ok(error.includes(neverUploaded), `error must name the rejected blobKey: ${error}`);
    // The sanctioned recovery path is the pdf-tool storage grant (the only
    // artifact transfer protocol), not the legacy upload tools.
    assert.match(error, /get_pdf_tool_storage_grant|storage grant/);
    assert.match(error, /list_artifacts_for_request/);
  });
});

// ---------------------------------------------------------------------------
// Stage 3.4 — plain HTTPS URLs as image media.src are rejected at create time
// ---------------------------------------------------------------------------

describe('create_request (admin_publish_draft) rejects unmaterializable image media.src', async () => {
  const attemptCreate = async (heroSrc: string, heroType = 'image') => {
    const store = createMemoryStore();
    const requestId = makeRequestId(20);
    return createRequest(store, {
      action: 'create_request',
      request_id: requestId,
      validation_mode: 'admin_publish_draft',
      input: makeInput(requestId, heroSrc, heroType),
    });
  };

  it('rejects a plain HTTPS URL on an image node — it would never be materialized', async () => {
    const resp = await attemptCreate('https://example.com/hero.png');

    assert.equal(resp.statusCode, 400, resp.body);
    const body = parseBody(resp);
    assert.equal(body.error_code, 'invalid_node_media_src');
    assert.match(String(body.error), /never materialized/i);
    assert.match(String(body.error), /input\.content\.article_body\.nodes\[0\]/);
  });

  it('rejects a data URI on an image node', async () => {
    const resp = await attemptCreate('data:image/png;base64,AAAA');

    assert.equal(resp.statusCode, 400, resp.body);
    assert.equal(parseBody(resp).error_code, 'invalid_node_media_src');
  });

  it('accepts an artifact pointer on an image node', async () => {
    const resp = await attemptCreate(`image/${makeRequestId(20)}/${hexSha('f')}.png`);

    assert.equal(resp.statusCode, 201, resp.body);
  });

  it('still accepts remote URLs for non-image media (video/embed)', async () => {
    const resp = await attemptCreate('https://example.com/clip.mp4', 'video');

    assert.equal(resp.statusCode, 201, resp.body);
  });
});
