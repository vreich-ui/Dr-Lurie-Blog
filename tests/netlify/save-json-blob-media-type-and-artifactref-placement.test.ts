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
// In-memory blob store (same shape used by all save-json-blob tests).
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
type ParsedBody = { ok?: boolean; error?: string; error_code?: string; record?: WorkflowRecord };
const parseBody = (r: { body: string }): ParsedBody => JSON.parse(r.body) as ParsedBody;

const REQUEST_ID = 'req_repair_mediatype_20260702_01';
const SLUG = 'trust-index-image';

// Node media src used only as the pre-existing value; each test overwrites it.
const makeInput = (existingMedia: Record<string, unknown>) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    title: 'Media Type Article',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [{ id: 'n_hero', kind: 'content', public: { title: 'Hero', media: existingMedia } }],
    },
  },
  publication: { schema_version: 'publication.v2', published_time: null },
  workflow: { schema_version: 'content_workflow.v1', workflow_id: REQUEST_ID },
});

const setup = async (store: Store, existingMedia: Record<string, unknown>) => {
  const createResp = await createRequest(store, {
    action: 'create_request',
    request_id: REQUEST_ID,
    input: makeInput(existingMedia),
  });
  assert.equal(createResp.statusCode, 201, createResp.body);

  const checkoutResp = await checkoutRequest(store, {
    action: 'checkout_request',
    request_id: REQUEST_ID,
    owner_id: 'test-agent',
    owner_label: 'Test Agent',
    lease_seconds: 900,
  });
  assert.equal(checkoutResp.statusCode, 200, checkoutResp.body);
  const record = parseBody(checkoutResp).record!;
  return { lockToken: record.lock!.token, version: record.version };
};

const patchHeroSrc = (store: Store, lockToken: string, version: number, src: string) =>
  patchCanonicalInput(store, {
    action: 'patch_canonical_input',
    request_id: REQUEST_ID,
    lock_token: lockToken,
    expected_record_version: version,
    node_patches: [{ node_id: 'n_hero', public_media_src: src }],
  });

const heroMedia = (r: { body: string }) =>
  parseBody(r).record?.input.content?.article_body?.nodes?.find((n) => n.id === 'n_hero')?.public?.media;

// ===========================================================================
// Fix 1: legacy media.type inference for src/assets/.../uploads/<slug>/ paths
// ===========================================================================

describe('applyNodePatch — legacy media.type inference', () => {
  it('resolves media.type to "document" for a legacy PDF under documents/uploads', async () => {
    const store = createMemoryStore();
    const existing = { type: 'image', src: 'src/assets/images/uploads/trust-index-image/old.webp', alt: 'old' };
    const { lockToken, version } = await setup(store, existing);

    const src = `src/assets/documents/uploads/${SLUG}/handout.pdf`;
    const resp = await patchHeroSrc(store, lockToken, version, src);

    assert.equal(resp.statusCode, 200, resp.body);
    const media = heroMedia(resp);
    assert.equal(media?.src, src);
    assert.equal(media?.type, 'document', 'PDF upload must not be labelled as an image');
  });

  it('still resolves media.type to "image" for a legacy image under images/uploads', async () => {
    const store = createMemoryStore();
    const existing = { type: 'image', src: 'src/assets/images/uploads/trust-index-image/old.webp', alt: 'old' };
    const { lockToken, version } = await setup(store, existing);

    const src = `src/assets/images/uploads/${SLUG}/hero.webp`;
    const resp = await patchHeroSrc(store, lockToken, version, src);

    assert.equal(resp.statusCode, 200, resp.body);
    assert.equal(heroMedia(resp)?.type, 'image');
  });

  it('resolves a PDF placed under images/uploads to "document" via the extension', async () => {
    const store = createMemoryStore();
    const existing = { type: 'image', src: 'src/assets/images/uploads/trust-index-image/old.webp', alt: 'old' };
    const { lockToken, version } = await setup(store, existing);

    const src = `src/assets/images/uploads/${SLUG}/misfiled.pdf`;
    const resp = await patchHeroSrc(store, lockToken, version, src);

    assert.equal(resp.statusCode, 200, resp.body);
    assert.equal(heroMedia(resp)?.type, 'document', 'extension must win over the images/ path segment');
  });

  it('preserves the existing media.type when the extension is ambiguous', async () => {
    const store = createMemoryStore();
    // Existing node is a video; the new legacy path has no image/pdf extension.
    const existing = { type: 'video', src: 'src/assets/images/uploads/trust-index-image/clip', alt: 'clip' };
    const { lockToken, version } = await setup(store, existing);

    const src = `src/assets/images/uploads/${SLUG}/reel`;
    const resp = await patchHeroSrc(store, lockToken, version, src);

    assert.equal(resp.statusCode, 200, resp.body);
    assert.equal(heroMedia(resp)?.type, 'video', 'ambiguous extension must not clobber existing type with "image"');
  });
});

// ===========================================================================
// Fix 2: misplaced artifactReferences are rejected loudly, never silently dropped
// ===========================================================================

const validRef = (fill: string) => ({
  blobKey: `image/${REQUEST_ID}/${fill.repeat(64)}.png`,
  sha256: fill.repeat(64),
  sizeBytes: 150000,
  contentType: 'image/png',
  createdAtISO: '2026-07-02T00:00:00.000Z',
});

const patchFinalArticleOutput = (store: Store, lockToken: string, output: Record<string, unknown>) =>
  patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: REQUEST_ID,
    agent_name: 'final_article',
    expected_agent_version: 0,
    lock_token: lockToken,
    output,
  });

describe('patchAgentOutput — misplaced artifactReferences are rejected, not dropped', () => {
  it('rejects artifact refs under output.metadata.artifactReferences', async () => {
    const store = createMemoryStore();
    const { lockToken } = await setup(store, { type: 'image', src: 'x', alt: 'x' });

    const resp = await patchFinalArticleOutput(store, lockToken, {
      metadata: { artifactReferences: [validRef('a')] },
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.equal(parseBody(resp).error_code, 'misplaced_artifact_references');
    assert.match(parseBody(resp).error ?? '', /output\.metadata\.artifactReferences/);
  });

  it('rejects a singular output.artifactReference', async () => {
    const store = createMemoryStore();
    const { lockToken } = await setup(store, { type: 'image', src: 'x', alt: 'x' });

    const resp = await patchFinalArticleOutput(store, lockToken, { artifactReference: validRef('b') });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.equal(parseBody(resp).error_code, 'misplaced_artifact_references');
    assert.match(parseBody(resp).error ?? '', /output\.artifactReference/);
  });

  it('rejects artifact-ref-shaped entries under output.images', async () => {
    const store = createMemoryStore();
    const { lockToken } = await setup(store, { type: 'image', src: 'x', alt: 'x' });

    const resp = await patchFinalArticleOutput(store, lockToken, { images: [validRef('c')] });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.equal(parseBody(resp).error_code, 'misplaced_artifact_references');
    assert.match(parseBody(resp).error ?? '', /output\.images/);
  });

  it('does NOT reject output.images that hold non-artifact descriptors (no blobKey)', async () => {
    const store = createMemoryStore();
    const { lockToken } = await setup(store, { type: 'image', src: 'x', alt: 'x' });

    const resp = await patchFinalArticleOutput(store, lockToken, {
      images: [{ src: 'https://example.com/inline.png', alt: 'inline' }],
    });

    assert.equal(resp.statusCode, 200, resp.body);
    assert.equal(parseBody(resp).error_code, undefined);
  });

  it('accepts artifact refs in the canonical top-level output.artifactReferences location', async () => {
    const store = createMemoryStore();
    const { lockToken } = await setup(store, { type: 'image', src: 'x', alt: 'x' });

    const resp = await patchFinalArticleOutput(store, lockToken, { artifactReferences: [validRef('a')] });

    assert.equal(resp.statusCode, 200, resp.body);
    const stored = parseBody(resp).record?.agent_outputs?.final_article?.output as
      | { artifactReferences?: unknown[] }
      | undefined;
    assert.equal(stored?.artifactReferences?.length, 1, 'canonical refs must be stored so publish can read them');
  });
});
