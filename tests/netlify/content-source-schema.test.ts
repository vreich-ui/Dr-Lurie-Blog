import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequest } from '../../netlify/functions/save-json-blob.js';
import { normalizeContentSourceImportToFormData } from '../../src/lib/contentSourceImportFormData.js';
import { getContentSourceMarkdown } from '../../src/lib/contentSourceBody.js';
import { validateContentSourceV1 } from '../../src/schema/schema-v1.js';

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

test('publication_status stays open while documenting first-party states separately from workflow_status', () => {
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
