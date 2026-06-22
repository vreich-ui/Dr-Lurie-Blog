import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';
import {
  allowedAgentNames,
  publicationStatusDescription,
  workflowStatuses,
} from '../../src/schema/workflow-contract.js';

const listTools = async () => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

  assert.equal(response.statusCode, 200);

  return JSON.parse(response.body) as {
    result: { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> };
  };
};

const property = (schema: Record<string, unknown>, key: string) => {
  const properties = schema.properties as Record<string, unknown>;

  return properties[key] as Record<string, unknown>;
};

test('save_json_blob_create_request exposes structured content_source.v1 input schema', async () => {
  const body = await listTools();
  const createTool = body.result.tools.find((tool) => tool.name === 'save_json_blob_create_request');

  assert.ok(createTool);
  assert.ok(property(createTool.inputSchema, 'current_agent'));
  assert.ok(property(createTool.inputSchema, 'next_agent'));
  assert.ok(property(createTool.inputSchema, 'validation_mode'));
  assert.deepEqual(createTool.inputSchema.required, ['input', 'validation_mode']);

  const inputSchema = property(createTool.inputSchema, 'input');
  const inputProperties = inputSchema.properties as Record<string, unknown>;

  assert.equal(inputSchema.type, 'object');
  assert.equal(inputSchema.additionalProperties, false);
  assert.deepEqual(inputSchema.required, ['record_type', 'schema_version']);
  assert.equal((inputProperties.record_type as Record<string, unknown>).const, 'content_source');
  assert.equal((inputProperties.schema_version as Record<string, unknown>).const, 'content_source.v1');

  for (const section of [
    'ids',
    'publication_context',
    'content',
    'taxonomy',
    'seo',
    'media',
    'editorial',
    'sources',
    'claims',
    'compliance',
    'commercial',
    'approvals',
    'publication',
    'workflow',
    'revision_control',
    'versioning',
  ]) {
    assert.ok(inputProperties[section], `Expected ${section} in content_source.v1 MCP schema.`);
  }

  const publication = inputProperties.publication as Record<string, unknown>;
  const publicationStatus = property(publication, 'publication_status') as { description?: string };
  assert.equal(publicationStatus.description, publicationStatusDescription);
  assert.ok(property(publication, 'scheduled_for'));
});

test('content_source.v1 MCP schema describes high-value agent fields and controlled extensions', async () => {
  const body = await listTools();
  const createTool = body.result.tools.find((tool) => tool.name === 'save_json_blob_create_request');

  assert.ok(createTool);

  const inputSchema = property(createTool.inputSchema, 'input');
  const content = property(inputSchema, 'content');
  const editorial = property(inputSchema, 'editorial');
  const publication = property(inputSchema, 'publication');
  const workflow = property(inputSchema, 'workflow');
  const versioning = property(inputSchema, 'versioning');
  const media = property(inputSchema, 'media');
  const claims = property(inputSchema, 'claims');
  const compliance = property(inputSchema, 'compliance');
  const commercial = property(inputSchema, 'commercial');
  const revisionControl = property(inputSchema, 'revision_control');

  assert.match(String(property(content, 'title').description), /title/i);
  assert.match(String(property(editorial, 'draft_markdown').description), /Markdown draft body/i);
  assert.match(String(property(publication, 'publish_payload').description), /publishing step/i);
  assert.match(String(property(publication, 'publish_payload').description), /publication\.publish_payload\.author/i);
  assert.match(String(property(workflow, 'workflow_id').description), /preserve across handoffs/i);

  const publishPayload = property(publication, 'publish_payload');
  const mediaEntries = property(publishPayload, 'mediaEntries');
  const artifactReferences = property(publishPayload, 'artifactReferences');

  assert.equal(mediaEntries.type, 'array');
  assert.deepEqual(mediaEntries.items, {});
  assert.match(String(mediaEntries.description), /runtime publisher/i);
  assert.equal(artifactReferences.type, 'array');
  assert.deepEqual(artifactReferences.items, {});
  assert.match(String(artifactReferences.description), /save_artifact/i);
  assert.match(String(artifactReferences.description), /exactly as returned/i);

  assert.match(String(property(versioning, 'record_version').description), /revision tracking/i);

  assert.ok(property(workflow, 'current_agent'));
  assert.ok(property(workflow, 'metadata'));
  assert.ok(property(claims, 'claim_list'));
  assert.ok(property(compliance, 'requirements'));
  assert.ok(property(commercial, 'offers'));
  assert.ok(property(media, 'image_asset_register'));
  assert.ok(property(revisionControl, 'revision_requests'));

  assert.equal(content.additionalProperties, false);
  assert.equal(publication.additionalProperties, false);
  assert.equal(media.additionalProperties, false);
  assert.notEqual(property(media, 'image_prompt_register').additionalProperties, true);
  assert.equal(property(workflow, 'metadata').additionalProperties, true);
});

test('admin publish page reads artifactReferences from publication.publish_payload', async () => {
  const publishPageSource = await readFile(`${process.cwd()}/src/pages/admin/publish.astro`, 'utf8');

  assert.match(publishPageSource, /const getLatestArtifactReferences = \(record\) =>/);
  assert.match(publishPageSource, /record\?\.input\?\.publication\?\.publish_payload\?\.artifactReferences/);
  assert.match(publishPageSource, /Array\.isArray\(artifactReferences\) \? artifactReferences : \[\]/);
});

test('content_source.v1 MCP schema uses concrete workflow and agent-priority section items', async () => {
  const body = await listTools();
  const createTool = body.result.tools.find((tool) => tool.name === 'save_json_blob_create_request');

  assert.ok(createTool);

  const inputSchema = property(createTool.inputSchema, 'input');
  const workflow = property(inputSchema, 'workflow');
  const claims = property(inputSchema, 'claims');
  const compliance = property(inputSchema, 'compliance');
  const commercial = property(inputSchema, 'commercial');
  const media = property(inputSchema, 'media');
  const revisionControl = property(inputSchema, 'revision_control');

  const claimItems = property(claims, 'claim_list').items as Record<string, unknown>;
  const requirementItems = property(compliance, 'requirements').items as Record<string, unknown>;
  const offerItems = property(commercial, 'offers').items as Record<string, unknown>;
  const assetItems = property(media, 'image_asset_register').items as Record<string, unknown>;
  const revisionItems = property(revisionControl, 'revision_requests').items as Record<string, unknown>;

  assert.deepEqual((property(workflow, 'current_agent') as { enum: string[] }).enum, [...allowedAgentNames]);
  assert.ok(property(claimItems, 'claim_text'));
  assert.ok(property(requirementItems, 'description'));
  assert.ok(property(offerItems, 'name'));
  assert.ok(property(assetItems, 'asset_id'));
  assert.ok(property(revisionItems, 'instruction'));
  assert.equal(claimItems.additionalProperties, false);
  assert.equal(requirementItems.additionalProperties, false);
  assert.equal(offerItems.additionalProperties, false);
  assert.equal(assetItems.additionalProperties, false);
  assert.equal(revisionItems.additionalProperties, false);
});

test('workflow mutation tools expose lock_token schemas and lock-aware descriptions', async () => {
  const body = await listTools();
  const tools = new Map(body.result.tools.map((tool) => [tool.name, tool]));

  for (const name of [
    'save_json_blob_checkout_request',
    'save_json_blob_refresh_lock',
    'save_json_blob_checkin_request',
    'save_json_blob_mark_published',
  ]) {
    assert.ok(tools.has(name), `Expected ${name} to be registered.`);
  }

  for (const name of [
    'save_json_blob_patch_agent_output',
    'save_json_blob_mark_agent_complete',
    'reader_insight_update_output',
    'reader_insight_mark_complete',
  ]) {
    const tool = tools.get(name);
    assert.ok(tool, `Expected ${name} to be registered.`);
    assert.ok(property(tool.inputSchema, 'lock_token'), `Expected ${name} to accept lock_token.`);
    assert.match(String((tool as { description?: string }).description), /checkout first/i);
    assert.match(String((tool as { description?: string }).description), /check in/i);
  }
});

test('stage mark-complete helpers expose transition fields and document common routing', async () => {
  const body = await listTools();
  const tools = new Map(body.result.tools.map((tool) => [tool.name, tool]));
  const expectedTransitions: Array<[string, string]> = [
    ['reader_insight_mark_complete', 'reader_insight → research'],
    ['research_mark_complete', 'research → angle'],
    ['angle_mark_complete', 'angle → draft'],
    ['draft_mark_complete', 'draft → final_article'],
    ['final_article_mark_complete', 'final_article → null'],
  ];

  for (const [name, transitionText] of expectedTransitions) {
    const tool = tools.get(name);
    assert.ok(tool, `Expected ${name} to be registered.`);

    for (const field of [
      'agent_name',
      'current_stage',
      'next_agent',
      'workflow_status',
      'needs_review',
      'last_error',
      'lock_token',
    ]) {
      assert.ok(property(tool.inputSchema, field), `Expected ${name} to accept ${field}.`);
    }

    assert.deepEqual(tool.inputSchema.required, ['request_id', 'expected_record_version', 'lock_token']);
    assert.match(String((tool as { description?: string }).description), new RegExp(transitionText));
  }

  const genericCompleteTool = tools.get('save_json_blob_mark_agent_complete');
  assert.ok(genericCompleteTool);
  assert.deepEqual((property(genericCompleteTool.inputSchema, 'agent_name') as { enum: string[] }).enum, [
    ...allowedAgentNames,
  ]);
  assert.deepEqual((property(genericCompleteTool.inputSchema, 'workflow_status') as { enum: string[] }).enum, [
    ...workflowStatuses,
  ]);

  const finalTool = tools.get('final_article_mark_complete');
  assert.ok(finalTool);
  assert.match(String((finalTool as { description?: string }).description), /workflow_status: "completed"/);
});

test('save_json_blob_publish_scheduled exposes gated scheduled publish inputs', async () => {
  const body = await listTools();
  const tool = body.result.tools.find((item) => item.name === 'save_json_blob_publish_scheduled');

  assert.ok(tool, 'Expected save_json_blob_publish_scheduled to be registered.');
  assert.deepEqual(tool.inputSchema.required, ['request_id', 'lock_token', 'agent_id', 'agent_owner']);
  assert.equal(property(tool.inputSchema, 'scheduled_publish_token'), undefined);
  assert.ok(property(tool.inputSchema, 'expected_record_version'));
  assert.ok(property(tool.inputSchema, 'agent_label'));
  assert.match(String((tool as { description?: string }).description), /publication\.publication_status: scheduled/);
  assert.match(String((tool as { description?: string }).description), /mark the workflow published/i);

  const serializedSchema = JSON.stringify(tool);
  assert.equal(serializedSchema.includes('NETLIFY_PUBLISH_SECRET'), false);
  assert.equal(serializedSchema.includes('PUBLISH_SECRET'), false);
});

test('save_json_blob_mark_published exposes only workflow-state inputs', async () => {
  const body = await listTools();
  const tool = body.result.tools.find((item) => item.name === 'save_json_blob_mark_published');

  assert.ok(tool, 'Expected save_json_blob_mark_published to be registered.');
  assert.deepEqual(tool.inputSchema.required, ['request_id', 'lock_token', 'commit_metadata']);
  assert.ok(property(tool.inputSchema, 'request_id'));
  assert.ok(property(tool.inputSchema, 'expected_record_version'));
  assert.ok(property(tool.inputSchema, 'lock_token'));
  assert.ok(property(tool.inputSchema, 'commit_metadata'));
  assert.match(
    String((tool as { description?: string }).description),
    /does not invoke the article publishing endpoint/i
  );

  const serializedSchema = JSON.stringify(tool);
  assert.equal(serializedSchema.includes('NETLIFY_PUBLISH_SECRET'), false);
  assert.equal(serializedSchema.includes('PUBLISH_SECRET'), false);
});

test('deploy_status exposes deploy receipt lookup inputs and structured content', async () => {
  process.env.PUBLISH_SECRET = 'mcp-deploy-status-schema-secret';
  process.env.NETLIFY_PUBLISH_SECRET = 'mcp-deploy-status-schema-secret';

  const body = await listTools();
  const tool = body.result.tools.find((item) => item.name === 'deploy_status');

  assert.ok(tool, 'Expected deploy_status to be registered.');
  assert.ok(property(tool.inputSchema, 'commit'));
  assert.ok(property(tool.inputSchema, 'deployId'));
  assert.equal(JSON.stringify(tool).includes('PUBLISH_SECRET'), false);
  assert.equal(JSON.stringify(tool).includes('NETLIFY_PUBLISH_SECRET'), false);

  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'deploy_status', arguments: { commit: 'schema-test-commit' } },
    }),
  });
  const result = JSON.parse(response.body).result as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };

  assert.equal(response.statusCode, 200);
  assert.equal(result.isError, undefined);
  assert.ok(result.structuredContent, 'deploy_status should return structuredContent.');
  assert.equal(result.structuredContent.commit, 'schema-test-commit');
});

test('artifact MCP tools register direct upload and omit legacy binary transports', async () => {
  const body = await listTools();
  const tools = new Map(body.result.tools.map((tool) => [tool.name, tool]));

  for (const name of [
    'create_artifact_upload_intent',
    'save_artifact',
    'list_artifacts_for_request',
    'get_artifact_metadata',
    'list_artifacts_by_kind',
    'list_artifacts_by_request',
    'search_artifacts',
    'soft_delete_artifact',
    'restore_artifact',
    'migrate_artifact_indexes',
    'wipe_blob_stores',
    'reconcile_artifact_indexes',
  ]) {
    assert.ok(tools.has(name), `Expected ${name} to be registered.`);
  }

  for (const name of [
    'save_artifact_chunk',
    'probe_artifact_chunk_size',
    'create_upload_session',
    'finalize_upload_session',
    'save_artifact_create_upload_session',
    'save_artifact_finalize_upload_session',
    'diagnostic_upload',
  ]) {
    assert.equal(tools.has(name), false, `Expected obsolete ${name} to be removed from tools/list.`);
  }

  const saveArtifact = tools.get('save_artifact')!;
  assert.deepEqual(saveArtifact.inputSchema.required, ['requestId', 'artifactKind', 'contentType', 'payload']);
  assert.ok(property(saveArtifact.inputSchema, 'payload'));
  assert.ok(property(saveArtifact.inputSchema, 'metadata'));
  assert.equal(property(saveArtifact.inputSchema, 'label').maxLength, 120);
  assert.equal(property(saveArtifact.inputSchema, 'tags').maxItems, 20);
  assert.match(String((saveArtifact as { description?: string }).description), /Legacy small-artifact/i);
  assert.match(String((saveArtifact as { description?: string }).description), /create_artifact_upload_intent/i);
  assert.match(
    String((saveArtifact as { description?: string }).description),
    /raw HTTP POST \/api\/artifacts\/upload/i
  );
  assert.match(String((saveArtifact as { description?: string }).description), /ArtifactReference index/i);

  const listArtifacts = tools.get('list_artifacts_for_request')!;
  assert.deepEqual(listArtifacts.inputSchema.required, ['requestId']);
  assert.match(
    String((listArtifacts as { description?: string }).description),
    /Reads the request artifact index only/i
  );

  const listByKind = tools.get('list_artifacts_by_kind')!;
  assert.deepEqual(listByKind.inputSchema.required, ['artifactKind']);
  assert.ok(property(listByKind.inputSchema, 'limit'));
  assert.ok(property(listByKind.inputSchema, 'cursor'));
  assert.ok(property(listByKind.inputSchema, 'includeDeleted'));

  const listByRequest = tools.get('list_artifacts_by_request')!;
  assert.deepEqual(listByRequest.inputSchema.required, ['requestId']);
  assert.ok(property(listByRequest.inputSchema, 'artifactKind'));
  assert.ok(property(listByRequest.inputSchema, 'includeDeleted'));

  const searchArtifacts = tools.get('search_artifacts')!;
  assert.ok(property(searchArtifacts.inputSchema, 'tag'));
  assert.ok(property(searchArtifacts.inputSchema, 'createdAfter'));
  assert.ok(property(searchArtifacts.inputSchema, 'createdBefore'));
  assert.ok(property(searchArtifacts.inputSchema, 'includeDeleted'));

  const softDeleteArtifact = tools.get('soft_delete_artifact')!;
  assert.deepEqual(softDeleteArtifact.inputSchema.required, ['requestId', 'sha256']);
  assert.ok(property(softDeleteArtifact.inputSchema, 'deletedBy'));

  const restoreArtifact = tools.get('restore_artifact')!;
  assert.deepEqual(restoreArtifact.inputSchema.required, ['requestId', 'sha256']);

  for (const name of tools.keys()) {
    const serialized = JSON.stringify(tools.get(name));

    assert.equal(serialized.includes('NETLIFY_PUBLISH_SECRET'), false);
    assert.equal(serialized.includes('PUBLISH_SECRET'), false);
  }
});

test('verify_article_images appears in tools/list with expected input schema', async () => {
  const body = await listTools();
  const tool = body.result.tools.find((item) => item.name === 'verify_article_images');

  assert.ok(tool, 'Expected verify_article_images to be registered.');
  assert.deepEqual(tool.inputSchema.required, ['url', 'expectedImages']);

  const url = property(tool.inputSchema, 'url');
  const expectedImages = property(tool.inputSchema, 'expectedImages');

  assert.equal(url.type, 'string');
  assert.equal(expectedImages.type, 'array');
  assert.equal((expectedImages.items as Record<string, unknown>).type, 'string');
  assert.equal(JSON.stringify(tool).includes('NETLIFY_PUBLISH_SECRET'), false);
  assert.equal(JSON.stringify(tool).includes('PUBLISH_SECRET'), false);
});

test('create_artifact_upload_intent exposes direct upload token and required headers', async () => {
  const previousSecret = process.env.ARTIFACT_UPLOAD_TOKEN_SECRET;
  const previousMaxBytes = process.env.ARTIFACT_UPLOAD_MAX_BYTES;
  process.env.ARTIFACT_UPLOAD_TOKEN_SECRET = 'mcp-direct-upload-secret';
  process.env.ARTIFACT_UPLOAD_MAX_BYTES = '4096';

  try {
    const body = await listTools();
    const tool = body.result.tools.find((item) => item.name === 'create_artifact_upload_intent');

    assert.ok(tool, 'Expected create_artifact_upload_intent to be registered.');
    assert.deepEqual(tool.inputSchema.required, [
      'requestId',
      'artifactKind',
      'contentType',
      'expectedSizeBytes',
      'expectedSha256',
    ]);
    assert.ok(property(tool.inputSchema, 'filename'));
    assert.ok(property(tool.inputSchema, 'label'));
    assert.ok(property(tool.inputSchema, 'tags'));
    assert.equal(property(tool.inputSchema, 'metadata'), undefined);
    assert.equal('maximum' in property(tool.inputSchema, 'expectedSizeBytes'), false);
    assert.match(
      String((tool as { description?: string }).description),
      /raw bytes with HTTP POST application\/octet-stream/i
    );

    const expectedSha256 = 'a'.repeat(64);
    const response = await handler({
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json', host: 'preview--site.netlify.app', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_artifact_upload_intent',
          arguments: {
            requestId: 'intent-request',
            artifactKind: 'image',
            contentType: 'image/png',
            expectedSizeBytes: 123,
            expectedSha256,
            filename: 'hero.png',
            label: 'Hero',
            tags: ['hero', 'agent'],
          },
        },
      }),
    });
    const result = JSON.parse(response.body).result as {
      isError?: boolean;
      structuredContent: {
        uploadUrl: string;
        uploadToken: string;
        expiresAtISO: string;
        maxBytes: number;
        requiredHeaders: Record<string, string>;
      };
    };

    assert.equal(response.statusCode, 200);
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.uploadUrl, 'https://preview--site.netlify.app/api/artifacts/upload');
    assert.equal(result.structuredContent.maxBytes, 4096);
    assert.match(result.structuredContent.expiresAtISO, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(
      result.structuredContent.requiredHeaders.Authorization,
      `Bearer ${result.structuredContent.uploadToken}`
    );
    assert.equal(result.structuredContent.requiredHeaders['Content-Type'], 'application/octet-stream');
    assert.equal(result.structuredContent.requiredHeaders['X-Artifact-Request-Id'], 'intent-request');
    assert.equal(result.structuredContent.requiredHeaders['X-Artifact-Kind'], 'image');
    assert.equal(result.structuredContent.requiredHeaders['X-Artifact-Content-Type'], 'image/png');
    assert.equal(result.structuredContent.requiredHeaders['X-Artifact-Size'], '123');
    assert.equal(result.structuredContent.requiredHeaders['X-Artifact-Sha256'], expectedSha256);
    assert.equal(result.structuredContent.requiredHeaders['X-Artifact-Filename'], 'hero.png');
    assert.equal(result.structuredContent.requiredHeaders['X-Artifact-Tags'], 'hero,agent');
  } finally {
    if (previousSecret === undefined) delete process.env.ARTIFACT_UPLOAD_TOKEN_SECRET;
    else process.env.ARTIFACT_UPLOAD_TOKEN_SECRET = previousSecret;
    if (previousMaxBytes === undefined) delete process.env.ARTIFACT_UPLOAD_MAX_BYTES;
    else process.env.ARTIFACT_UPLOAD_MAX_BYTES = previousMaxBytes;
  }
});
