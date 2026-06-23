import assert from 'node:assert/strict';
import test from 'node:test';

import { handler as publishHandler } from '../../netlify/functions/publish-article.js';
import { handler as saveArtifactHandler } from '../../netlify/functions/save-artifact.js';
import {
  checkoutRequest,
  createRequest,
  markPublished,
  patchAgentOutput,
  preparePublishNow,
} from '../../netlify/functions/save-json-blob.js';
import { normalizeContentSourceImportToFormData } from '../../src/lib/contentSourceImportFormData.js';
import { getContentSourceMarkdown } from '../../src/lib/contentSourceBody.js';
import { validateContentSourceV1 } from '../../src/schema/schema-v1.js';
import { knownPublicationStatuses } from '../../src/schema/workflow-contract.js';

const validContentSourceV1 = {
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'Skin barrier basics',
    blocks: [{ block_id: 'intro', block_type: 'markdown', payload: 'Hello' }],
  },
  publication: {
    schema_version: 'publication.v1',
    publish_payload: {
      slug: 'skin-barrier-basics',
      title: 'Skin Barrier Basics',
    },
  },
} as const;

const representativePublishingUiContentSource = {
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  ids: {
    workflow_id: 'workflow-ui-1',
  },
  content: {
    schema_version: 'content_blocks.v1',
    title: 'Representative Publishing UI Article',
    description: 'A payload shaped like the admin publishing UI output.',
  },
  workflow: {
    schema_version: 'content_workflow.v1',
    workflow_id: 'workflow-ui-1',
    current_agent: 'final_article',
    previous_agent: 'draft',
    next_agent: null,
    handoff_notes: 'Validated in the publishing UI before handoff.',
    metadata: { source: 'publishing-ui' },
  },
  publication: {
    schema_version: 'publication.v1',
    publication_status: 'ready',
    publish_payload: {
      slug: 'representative-publishing-ui-article',
      title: 'Representative Publishing UI Article',
      content: 'Final body entered through the publishing UI.',
      articlePath: 'src/data/post/representative-publishing-ui-article.md',
      publishDate: '2026-06-03T00:00:00.000Z',
      excerpt: 'Representative UI excerpt.',
      seoDescription: 'Representative UI SEO description.',
      ctaText: 'Read more',
      author: 'Dr. Lurié',
      tags: ['skin-health'],
      overwrite: false,
    },
  },
} as const;

const representativeAgentGeneratedContentSource = {
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    schema_version: 'content_blocks.v1',
    title: 'Representative Agent Article',
    blocks: [{ block_id: 'intro', block_type: 'markdown', payload: 'Agent draft introduction.' }],
  },
  sources: {
    schema_version: 'sources.v1',
    source_list: [{ source_id: 'src_1', name: 'Dermatology source', url: 'https://example.com/source' }],
  },
  claims: {
    schema_version: 'claims.v1',
    claim_list: [
      {
        claim_id: 'claim_1',
        claim_text: 'Skin barrier lipids can shift with age.',
        claim_type: 'factual',
        source_ids: ['src_1'],
        confidence: 0.82,
        status: 'needs_review',
      },
    ],
  },
  compliance: {
    schema_version: 'compliance.v1',
    requirements: [
      {
        requirement_id: 'comp_1',
        category: 'medical_claim',
        description: 'Avoid diagnosis or treatment claims.',
        related_claim_ids: ['claim_1'],
        status: 'pending',
      },
    ],
  },
  commercial: {
    schema_version: 'commercial.v1',
    offers: [
      {
        offer_id: 'offer_1',
        name: 'Early access',
        cta_text: 'Join Early Access',
        placement: 'conclusion',
        disclosure: 'Product previews are not medical advice.',
      },
    ],
  },
  media: {
    schema_version: 'media.v1',
    image_asset_register: [
      {
        asset_id: 'asset_1',
        source: 'remote',
        url: 'https://kugelmedia.netlify.app/drlurieblog/dr-lurie-product-hero.jpg',
        alt: 'Product bottle preview',
        status: 'approved',
      },
    ],
  },
  revision_control: {
    schema_version: 'revision_control.v1',
    revision_requests: [
      {
        request_id: 'rev_1',
        requested_by_agent: 'angle',
        priority: 'normal',
        instruction: 'Tighten intro before final handoff.',
        status: 'open',
      },
    ],
  },
  workflow: {
    schema_version: 'content_workflow.v1',
    workflow_id: 'workflow-agent-1',
    current_agent: 'draft',
    previous_agent: 'angle',
    next_agent: 'final_article',
    handoff_notes: 'Draft is ready for final edit.',
  },
  publication: {
    schema_version: 'publication.v1',
    publish_payload: {
      slug: 'representative-agent-article',
      title: 'Representative Agent Article',
      markdown: '# Representative Agent Article\n\nFinal body from agent output.',
      tags: ['skin-health', 'agent-generated'],
    },
  },
} as const;

const adminPublishDraftInputWithBody = (bodyPatch: Record<string, unknown>) => {
  const base = {
    record_type: 'content_source',
    schema_version: 'content_source.v1',
    content: {
      schema_version: 'content_blocks.v1',
      title: 'Shared Body Location Draft',
    },
    publication: {
      schema_version: 'publication.v1',
      publication_status: 'draft',
      publish_payload: {
        slug: 'shared-body-location-draft',
        title: 'Shared Body Location Draft',
        author: 'Dr. Lurié',
      },
    },
  };

  return {
    ...base,
    ...bodyPatch,
    content: {
      ...base.content,
      ...((bodyPatch.content as Record<string, unknown> | undefined) ?? {}),
    },
    editorial: bodyPatch.editorial,
    publication: {
      ...base.publication,
      ...((bodyPatch.publication as Record<string, unknown> | undefined) ?? {}),
      publish_payload: {
        ...base.publication.publish_payload,
        ...(((bodyPatch.publication as Record<string, unknown> | undefined)?.publish_payload as
          | Record<string, unknown>
          | undefined) ?? {}),
      },
    },
  };
};

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
        blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, etag: '' })),
        directories: [],
      };
    },
  };
};

const createWorkflow = (input: unknown) =>
  createRequest(createMemoryStore(), {
    action: 'create_request',
    request_id: 'req_schema_test',
    input,
  });

const parseResponseBody = (response: Awaited<ReturnType<typeof createWorkflow>>) => JSON.parse(response.body);

test('content_source.v1 payload validates and creates a workflow record', async () => {
  assert.equal(validateContentSourceV1(validContentSourceV1), true);

  const response = await createWorkflow(validContentSourceV1);
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 201);
  assert.equal(body.ok, true);
  assert.equal(body.record.input.record_type, 'content_source');
  assert.equal(body.record.input.schema_version, 'content_source.v1');
  assert.equal(body.record.input.publication.publish_payload.slug, 'skin-barrier-basics');
});

test('create_request honors explicit initial routing fields over workflow defaults', async () => {
  const response = await createRequest(createMemoryStore(), {
    action: 'create_request',
    request_id: 'req_explicit_routing_test',
    input: validContentSourceV1,
    current_agent: 'final_article',
    next_agent: null,
  });
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 201);
  assert.equal(body.ok, true);
  assert.equal(body.record.current_stage, 'final_article');
  assert.equal(body.record.next_agent, null);
});

test('prepare_publish_now promotes final_article with article_body and image artifact normalization', async () => {
  const store = createMemoryStore();
  const input = adminPublishDraftInputWithBody({
    content: {
      title: 'Structured Final Article',
      article_body: {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_a1b2c3',
            kind: 'content',
            public: { body: 'Structured public body wins.' },
            private: { agentNotes: 'Do not publish this private note.' },
          },
        ],
      },
    },
    publication: {
      publication_status: 'draft',
      publish_payload: {
        slug: 'structured-final-article',
        title: 'Draft shell title',
        markdown: 'Legacy markdown should lose.',
      },
    },
  });
  const publishSecret = 'content-source-publish-secret';
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.GITHUB_CONTENT_TOKEN = 'github-content-source-token';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_BRANCH = 'main';
  const pngBytesBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMDGgAcQBAJkKBAU8O1d8AAAAAElFTkSuQmCC';
  const uploadResponse = await saveArtifactHandler({
    httpMethod: 'POST',
    headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: 'req_prepare_publish_final_article',
      artifactKind: 'image',
      contentType: 'image/png',
      filename: 'normalized-hero.png',
      encoding: 'base64',
      payload: pngBytesBase64,
      metadata: { alt: 'Hero alt text', caption: 'Hero caption' },
    }),
  });
  assert.ok(uploadResponse.statusCode >= 200 && uploadResponse.statusCode < 300, uploadResponse.body);
  const artifactReference = JSON.parse(uploadResponse.body).artifact;

  const createResponse = await createRequest(store, {
    action: 'create_request',
    request_id: 'req_prepare_publish_final_article',
    input,
    current_agent: 'final_article',
    next_agent: null,
    validation_mode: 'admin_publish_draft',
  });
  assert.equal(createResponse.statusCode, 201, createResponse.body);

  const checkoutResponse = await checkoutRequest(store, {
    action: 'checkout_request',
    request_id: 'req_prepare_publish_final_article',
    owner_id: 'test-agent',
    owner_label: 'Test agent',
  });
  const checkoutBody = parseResponseBody(checkoutResponse);
  const lockToken = checkoutBody.record.lock.token;

  const patchResponse = await patchAgentOutput(store, {
    action: 'patch_agent_output',
    request_id: 'req_prepare_publish_final_article',
    agent_name: 'final_article',
    expected_agent_version: 0,
    lock_token: lockToken,
    output: {
      title: 'Reviewed Final Title',
      slug: 'structured-final-article',
      author: 'Dr. Lurié',
      image: { artifactReference, alt: 'Hero alt text', caption: 'Hero caption' },
    },
  });
  const patchBody = parseResponseBody(patchResponse);
  assert.equal(patchResponse.statusCode, 200, patchResponse.body);

  const prepareResponse = await preparePublishNow(store, {
    action: 'prepare_publish_now',
    request_id: 'req_prepare_publish_final_article',
    expected_record_version: patchBody.record.version,
    lock_token: lockToken,
  });
  const prepareBody = parseResponseBody(prepareResponse);
  assert.equal(prepareResponse.statusCode, 200, prepareResponse.body);
  assert.equal(prepareBody.record.input.publication.publication_status, 'ready');
  assert.equal(prepareBody.record.workflow_status, 'completed');
  assert.equal(prepareBody.publish_payload.title, 'Reviewed Final Title');
  assert.equal(prepareBody.publish_payload.markdown, 'Structured public body wins.');
  assert.equal(prepareBody.publish_payload.markdown.includes('Do not publish this private note.'), false);
  assert.deepEqual(
    prepareBody.publish_payload.article_body,
    (input.content as { article_body?: unknown }).article_body
  );
  assert.equal(prepareBody.publish_payload.featuredImage, artifactReference.blobKey);
  assert.deepEqual(prepareBody.publish_payload.artifactReferences, [artifactReference]);
  assert.deepEqual(prepareBody.record.agent_outputs.final_article.output.image.artifactReference, artifactReference);

  const originalFetch = globalThis.fetch;
  const blobWrites: Array<{ content: string; encoding: string }> = [];
  globalThis.fetch = (async (fetchInput: RequestInfo | URL, init?: RequestInit) => {
    const url = String(fetchInput);
    const method = init?.method ?? 'GET';

    if (url.includes('/contents/src/data/post/structured-final-article.md'))
      return new Response('not found', { status: 404 });
    if (url.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'base-sha' } });
    if (url.endsWith('/git/commits/base-sha')) return Response.json({ tree: { sha: 'base-tree' } });
    if (url.endsWith('/git/blobs') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { content: string; encoding: string };
      blobWrites.push(body);
      return Response.json({ sha: `blob-${blobWrites.length}` });
    }
    if (url.endsWith('/git/trees') && method === 'POST') return Response.json({ sha: 'new-tree' });
    if (url.endsWith('/git/commits') && method === 'POST') return Response.json({ sha: 'new-commit' });
    if (url.includes('/git/refs/heads/main') && method === 'PATCH') return Response.json({ ok: true });

    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const publishResponse = await publishHandler({
      httpMethod: 'POST',
      headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
      body: JSON.stringify({
        ...prepareBody.publish_payload,
        requestId: 'req_prepare_publish_final_article',
        request_id: 'req_prepare_publish_final_article',
        lock_token: lockToken,
      }),
    });
    assert.equal(publishResponse.statusCode, 201, publishResponse.body);
    assert.match(
      blobWrites[0]?.content ?? '',
      /image: "~\/assets\/images\/uploads\/structured-final-article\/normalized-hero\.png"/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const markResponse = await markPublished(store, {
    action: 'mark_published',
    request_id: 'req_prepare_publish_final_article',
    expected_record_version: prepareBody.record.version,
    lock_token: lockToken,
    commit_metadata: {
      commit: 'commit-after-real-publish',
      articlePath: 'src/data/post/structured-final-article.md',
      deployStatus: 'queued',
    },
  });
  const markBody = parseResponseBody(markResponse);
  assert.equal(markResponse.statusCode, 200, markResponse.body);
  assert.equal(markBody.record.workflow_status, 'published');
  assert.equal(markBody.record.lock, undefined);
});

test('create_request accepts a minimal admin-publish draft with publish payload markdown', async () => {
  const store = createMemoryStore();
  const markdown = '# Minimal Admin Draft\n\nBody text supplied through publish payload markdown.';
  const input = adminPublishDraftInputWithBody({
    publication: {
      publish_payload: {
        markdown,
      },
    },
  });

  const response = await createRequest(store, {
    action: 'create_request',
    request_id: 'req_admin_publish_minimal_markdown',
    input,
    validation_mode: 'admin_publish_draft',
  });
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 201);
  assert.equal(body.ok, true);
  assert.equal(body.record.input.publication.publish_payload.markdown, markdown);
});

test('create_request rejects admin-publish drafts missing only body text', async () => {
  const store = createMemoryStore();
  const input = adminPublishDraftInputWithBody({});

  const response = await createRequest(store, {
    action: 'create_request',
    request_id: 'req_admin_publish_missing_body',
    input,
    validation_mode: 'admin_publish_draft',
  });
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error_code, 'invalid_admin_publish_draft');
  assert.deepEqual(
    body.issues.map((issue: { path: string[] }) => issue.path.join('.')),
    ['publication.publish_payload.content']
  );
  assert.equal(await store.get('workflows/by-id/req_admin_publish_missing_body.json'), null);
});

test('create_request rejects skeletal admin-publish drafts before writing workflow records', async () => {
  const store = createMemoryStore();
  const requestId = 'req_admin_publish_validation_test';
  const response = await createRequest(store, {
    action: 'create_request',
    request_id: requestId,
    input: {
      ...validContentSourceV1,
      content: { schema_version: 'content_blocks.v1', title: 'Skin barrier basics' },
    },
    validation_mode: 'admin_publish_draft',
  });
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error_code, 'invalid_admin_publish_draft');
  assert.ok(
    body.issues.some((issue: { path: string[] }) => issue.path.join('.') === 'publication.publish_payload.author')
  );
  assert.ok(
    body.issues.some((issue: { path: string[] }) => issue.path.join('.') === 'publication.publish_payload.content')
  );
  assert.equal(await store.get(`workflows/by-id/${requestId}.json`), null);
});

test('create_request returns HTTP 400 when required schema discriminator fields are missing', async () => {
  const response = await createWorkflow({ content: { title: 'Missing discriminators' } });
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'Invalid content_source.v1 input.');
  assert.ok(body.issues.some((issue: { path: string[] }) => issue.path.includes('record_type')));
  assert.ok(body.issues.some((issue: { path: string[] }) => issue.path.includes('schema_version')));
});

test('create_request returns HTTP 400 when content_source discriminators are invalid', async () => {
  const response = await createWorkflow({
    record_type: 'legacy_topic',
    schema_version: 'topic.v0',
    topic: 'Skin barrier',
  });
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.ok(body.issues.some((issue: { path: string[] }) => issue.path.join('.') === 'record_type'));
  assert.ok(body.issues.some((issue: { path: string[] }) => issue.path.join('.') === 'schema_version'));
});

test('content_source.v1 accepts scheduled publication metadata', () => {
  const scheduledContentSource = {
    ...validContentSourceV1,
    publication: {
      ...validContentSourceV1.publication,
      publication_status: 'scheduled',
      scheduled_for: '2026-06-10T12:00:00.000Z',
    },
  };

  assert.equal(validateContentSourceV1(scheduledContentSource), true);
});

test('publication_status recognizes centralized first-party states while staying open for future values', () => {
  for (const publicationStatus of knownPublicationStatuses) {
    assert.equal(
      validateContentSourceV1({
        ...validContentSourceV1,
        publication: {
          ...validContentSourceV1.publication,
          publication_status: publicationStatus,
        },
      }),
      true
    );
  }

  const futureStatusContentSource = {
    ...validContentSourceV1,
    publication: {
      ...validContentSourceV1.publication,
      publication_status: 'external_future_state',
    },
  };

  assert.equal(validateContentSourceV1(futureStatusContentSource), true);
});

test('create_request returns HTTP 400 for invalid nested publication payloads', async () => {
  const response = await createWorkflow({
    ...validContentSourceV1,
    publication: {
      schema_version: 'publication.v1',
      publish_payload: { slug: 'missing-title' },
    },
  });
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.ok(
    body.issues.some((issue: { path: string[] }) => issue.path.join('.') === 'publication.publish_payload.title')
  );
});

test('content_source.v1 validates representative publishing UI JSON payloads', async () => {
  assert.equal(validateContentSourceV1(representativePublishingUiContentSource), true);

  const response = await createWorkflow(representativePublishingUiContentSource);
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 201);
  assert.equal(body.ok, true);
  assert.equal(body.record.input.workflow.current_agent, 'final_article');
  assert.equal(body.record.current_stage, 'final_article');
  assert.equal(body.record.next_agent, null);
  assert.equal(body.record.input.publication.publish_payload.content, 'Final body entered through the publishing UI.');
});

test('content_source.v1 validates representative agent-generated JSON payloads', async () => {
  assert.equal(validateContentSourceV1(representativeAgentGeneratedContentSource), true);

  const response = await createWorkflow(representativeAgentGeneratedContentSource);
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 201);
  assert.equal(body.ok, true);
  assert.equal(body.record.input.claims.claim_list[0].claim_text, 'Skin barrier lipids can shift with age.');
  assert.equal(body.record.input.media.image_asset_register[0].asset_id, 'asset_1');
  assert.equal(
    body.record.input.revision_control.revision_requests[0].instruction,
    'Tighten intro before final handoff.'
  );
});

test('content_source.v1 rejects unbagged extension fields in concrete agent-priority sections', async () => {
  const response = await createWorkflow({
    ...representativeAgentGeneratedContentSource,
    claims: {
      schema_version: 'claims.v1',
      claim_list: [
        {
          claim_text: 'This claim has an unbagged extension.',
          unexpected_extension: true,
        },
      ],
    },
  });
  const body = parseResponseBody(response);

  assert.equal(response.statusCode, 400);
  assert.equal(body.ok, false);
  assert.ok(body.issues.some((issue: { path: string[] }) => issue.path.join('.') === 'claims.claim_list.0'));
});

test('admin content-source import preserves publish payload description as summary and SEO fallback', () => {
  const description = 'Publication payload description fallback for admin import.';
  const input = adminPublishDraftInputWithBody({
    publication: {
      publish_payload: {
        description,
        content: 'Description fallback fixture body has more than five words.',
      },
    },
  });

  const formData = normalizeContentSourceImportToFormData(input, 'content_source.v1');

  assert.equal(formData.excerpt.exists, true);
  assert.equal(formData.excerpt.value, description);
  assert.equal(formData.seoDescription.exists, true);
  assert.equal(formData.seoDescription.value, description);
  assert.equal(formData.content.value, 'Description fallback fixture body has more than five words.');
});

test('admin-publish draft validation accepts body text only in markdown content blocks', async () => {
  const bodyVariants = [
    {
      label: 'string payload',
      payload: 'Markdown block string body has more than five words.',
    },
    {
      label: 'object markdown payload',
      payload: { markdown: 'Markdown block object body has more than five words.' },
    },
  ];

  for (const variant of bodyVariants) {
    const input = adminPublishDraftInputWithBody({
      content: {
        blocks: [
          {
            block_id: `body-${variant.label.replace(/\s+/g, '-')}`,
            block_type: 'markdown',
            payload: variant.payload,
          },
        ],
      },
    });

    const response = await createRequest(createMemoryStore(), {
      action: 'create_request',
      request_id: `req_admin_blocks_${variant.label.replace(/\s+/g, '_')}`,
      input,
      validation_mode: 'admin_publish_draft',
    });
    const body = parseResponseBody(response);

    assert.equal(response.statusCode, 201);
    assert.equal(body.ok, true);
  }
});

test('shared content source body helper reads every accepted admin body location consistently', async () => {
  const expectedMarkdown = 'Shared helper body has more than five words for preview.';
  const bodyVariants = [
    adminPublishDraftInputWithBody({ publication: { publish_payload: { markdown: expectedMarkdown } } }),
    adminPublishDraftInputWithBody({ publication: { publish_payload: { content: expectedMarkdown } } }),
    adminPublishDraftInputWithBody({ editorial: { schema_version: 'editorial.v1', draft_markdown: expectedMarkdown } }),
    adminPublishDraftInputWithBody({
      content: {
        blocks: [
          {
            block_id: 'body',
            block_type: 'markdown',
            payload: { markdown: expectedMarkdown },
          },
        ],
      },
    }),
  ];

  for (const input of bodyVariants) {
    assert.equal(getContentSourceMarkdown(input), expectedMarkdown);

    const response = await createRequest(createMemoryStore(), {
      action: 'create_request',
      request_id: `req_body_location_${bodyVariants.indexOf(input)}`,
      input,
      validation_mode: 'admin_publish_draft',
    });
    const body = parseResponseBody(response);

    assert.equal(response.statusCode, 201);
    assert.equal(body.ok, true);
    assert.equal(getContentSourceMarkdown(body.record.input), expectedMarkdown);
  }
});

test('shared content source body helper preserves documented body precedence', () => {
  const input = adminPublishDraftInputWithBody({
    content: {
      blocks: [{ block_id: 'block-body', block_type: 'markdown', payload: 'Markdown block body.' }],
    },
    editorial: { schema_version: 'editorial.v1', draft_markdown: 'Editorial draft body.' },
    publication: {
      publish_payload: {
        markdown: 'Publication markdown body.',
        content: 'Publication content body.',
      },
    },
  });

  assert.equal(getContentSourceMarkdown(input), 'Publication markdown body.');
});
