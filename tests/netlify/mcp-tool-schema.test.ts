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
  assert.deepEqual(tool.inputSchema.required, [
    'request_id',
    'lock_token',
    'scheduled_publish_token',
    'agent_id',
    'agent_owner',
  ]);
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

test('artifact MCP tools are registered with precise byte-vs-metadata descriptions', async () => {
  const body = await listTools();
  const tools = new Map(body.result.tools.map((tool) => [tool.name, tool]));

  for (const name of [
    'save_artifact',
    'save_artifact_chunk',
    'save_artifact_create_upload_session',
    'save_artifact_finalize_upload_session',
    'list_artifacts_for_request',
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

  const saveArtifact = tools.get('save_artifact')!;
  assert.deepEqual(saveArtifact.inputSchema.required, ['requestId', 'artifactKind', 'contentType', 'payload']);
  assert.ok(property(saveArtifact.inputSchema, 'payload'));
  assert.ok(property(saveArtifact.inputSchema, 'metadata'));
  assert.equal(property(saveArtifact.inputSchema, 'label').maxLength, 120);
  assert.equal(property(saveArtifact.inputSchema, 'tags').maxItems, 20);
  assert.equal((property(saveArtifact.inputSchema, 'tags').items as { maxLength: number }).maxLength, 40);
  assert.deepEqual((property(saveArtifact.inputSchema, 'artifactKind') as { enum: string[] }).enum, [
    'image',
    'pdf',
    'video',
    'doc',
    'audio',
    'data',
    'attachment',
    'other',
  ]);
  assert.deepEqual(property(saveArtifact.inputSchema, 'expectedSizeBytes'), {
    type: 'integer',
    minimum: 0,
    description: 'Optional expected complete artifact byte size for upload integrity checks.',
  });
  assert.deepEqual(property(saveArtifact.inputSchema, 'expectedSha256'), {
    type: 'string',
    pattern: '^[a-fA-F0-9]{64}$',
    description: 'Optional expected complete artifact SHA-256 hex digest for upload integrity checks.',
  });
  assert.match(String((saveArtifact as { description?: string }).description), /immediately after creating/i);
  assert.match(
    String((saveArtifact as { description?: string }).description),
    /store only the returned ArtifactReference/i
  );
  assert.match(String((saveArtifact as { description?: string }).description), /never invent blobKey/i);
  assert.match(String((saveArtifact as { description?: string }).description), /preferred\/default artifact path/i);
  assert.match(
    String((saveArtifact as { description?: string }).description),
    /50-150 KB JPEG\/PNG images should be uploaded in one call/i
  );
  assert.match(
    String(property(saveArtifact.inputSchema, 'payload').description),
    /do not chunk merely because an image is around 50 KB/i
  );
  assert.match(String((saveArtifact as { description?: string }).description), /Writes final artifact bytes/i);
  assert.match(String((saveArtifact as { description?: string }).description), /ArtifactReference index/i);
  assert.match(String((saveArtifact as { description?: string }).description), /dedup is success/i);

  const saveChunk = tools.get('save_artifact_chunk')!;
  assert.deepEqual(saveChunk.inputSchema.required, [
    'requestId',
    'artifactKind',
    'contentType',
    'clientUploadId',
    'chunkIndex',
    'totalChunks',
    'payload',
  ]);
  assert.equal(property(saveChunk.inputSchema, 'label').maxLength, 120);
  assert.equal(property(saveChunk.inputSchema, 'tags').maxItems, 20);
  assert.deepEqual((property(saveChunk.inputSchema, 'artifactKind') as { enum: string[] }).enum, [
    'image',
    'pdf',
    'video',
    'doc',
    'audio',
    'data',
    'attachment',
    'other',
  ]);
  assert.ok(property(saveChunk.inputSchema, 'clientUploadId'));
  assert.ok(property(saveChunk.inputSchema, 'chunkIndex'));
  assert.ok(property(saveChunk.inputSchema, 'totalChunks'));
  assert.match(
    String(property(saveChunk.inputSchema, 'totalChunks').description),
    /For normal 50-150 KB images, use save_artifact/i
  );
  assert.match(
    String(property(saveChunk.inputSchema, 'payload').description),
    /target about 256000 raw bytes per chunk/i
  );
  assert.deepEqual(property(saveChunk.inputSchema, 'expectedSizeBytes'), {
    type: 'integer',
    minimum: 0,
    description: 'Optional expected complete artifact byte size for upload integrity checks.',
  });
  assert.deepEqual(property(saveChunk.inputSchema, 'expectedSha256'), {
    type: 'string',
    pattern: '^[a-fA-F0-9]{64}$',
    description: 'Optional expected complete artifact SHA-256 hex digest for upload integrity checks.',
  });

  const createSession = tools.get('save_artifact_create_upload_session')!;
  assert.deepEqual(createSession.inputSchema.required, [
    'requestId',
    'artifactKind',
    'contentType',
    'expectedSizeBytes',
    'expectedSha256',
  ]);
  assert.equal(property(createSession.inputSchema, 'expectedSizeBytes').maximum, 50 * 1024 * 1024);
  assert.match(String((createSession as { description?: string }).description), /chunkSizeBytes=5242880/);
  assert.match(String((createSession as { description?: string }).description), /larger binary assets/i);
  assert.ok(property(createSession.inputSchema, 'metadata'));

  const finalizeSession = tools.get('save_artifact_finalize_upload_session')!;
  assert.deepEqual(finalizeSession.inputSchema.required, [
    'sessionId',
    'requestId',
    'artifactKind',
    'contentType',
    'expectedSizeBytes',
    'expectedSha256',
  ]);
  assert.match(String((finalizeSession as { description?: string }).description), /Idempotent retries/i);
  assert.ok(property(finalizeSession.inputSchema, 'sessionId'));
  assert.match(
    String((saveChunk as { description?: string }).description),
    /fallback for artifacts too large for one MCP tool call/i
  );
  assert.match(
    String((saveChunk as { description?: string }).description),
    /Do not use this for ordinary 50-150 KB generated web images/i
  );
  assert.match(String((saveChunk as { description?: string }).description), /largest safe chunks/i);
  assert.match(
    String((saveChunk as { description?: string }).description),
    /store only the final returned ArtifactReference/i
  );
  assert.match(String((saveChunk as { description?: string }).description), /never invent blobKey/i);
  assert.match(String((saveChunk as { description?: string }).description), /Writes one chunk blob/i);
  assert.match(String((saveChunk as { description?: string }).description), /assembles final artifact bytes/i);
  assert.match(String((saveChunk as { description?: string }).description), /complete=false/i);
  assert.match(String((saveChunk as { description?: string }).description), /dedup is success/i);

  const listArtifacts = tools.get('list_artifacts_for_request')!;
  assert.deepEqual(listArtifacts.inputSchema.required, ['requestId']);
  assert.match(
    String((listArtifacts as { description?: string }).description),
    /Reads the request artifact index only/i
  );
  assert.match(
    String((listArtifacts as { description?: string }).description),
    /does not read or write artifact bytes/i
  );

  const listByKind = tools.get('list_artifacts_by_kind')!;
  assert.deepEqual(listByKind.inputSchema.required, ['artifactKind']);
  assert.ok(property(listByKind.inputSchema, 'limit'));
  assert.ok(property(listByKind.inputSchema, 'cursor'));
  assert.ok(property(listByKind.inputSchema, 'includeDeleted'));
  assert.match(String((listByKind as { description?: string }).description), /Admin-only/);

  const listByRequest = tools.get('list_artifacts_by_request')!;
  assert.deepEqual(listByRequest.inputSchema.required, ['requestId']);
  assert.ok(property(listByRequest.inputSchema, 'artifactKind'));
  assert.ok(property(listByRequest.inputSchema, 'includeDeleted'));

  const searchArtifacts = tools.get('search_artifacts')!;
  assert.ok(property(searchArtifacts.inputSchema, 'tag'));
  assert.ok(property(searchArtifacts.inputSchema, 'createdAfter'));
  assert.ok(property(searchArtifacts.inputSchema, 'createdBefore'));
  assert.match(String((searchArtifacts as { description?: string }).description), /prefix indexes/);
  assert.ok(property(searchArtifacts.inputSchema, 'includeDeleted'));

  const softDeleteArtifact = tools.get('soft_delete_artifact')!;
  assert.deepEqual(softDeleteArtifact.inputSchema.required, ['requestId', 'sha256']);
  assert.ok(property(softDeleteArtifact.inputSchema, 'deletedBy'));
  assert.match(String((softDeleteArtifact as { description?: string }).description), /soft delete/i);

  const restoreArtifact = tools.get('restore_artifact')!;
  assert.deepEqual(restoreArtifact.inputSchema.required, ['requestId', 'sha256']);
  assert.match(String((restoreArtifact as { description?: string }).description), /restore/i);

  const migrateArtifacts = tools.get('migrate_artifact_indexes')!;
  assert.ok(property(migrateArtifacts.inputSchema, 'cursor'));
  assert.ok(property(migrateArtifacts.inputSchema, 'limit'));
  assert.ok(property(migrateArtifacts.inputSchema, 'dryRun'));
  assert.match(String((migrateArtifacts as { description?: string }).description), /one-time artifact-index migration/);

  const wipeBlobStores = tools.get('wipe_blob_stores')!;
  assert.ok(property(wipeBlobStores.inputSchema, 'dryRun'));
  assert.ok(property(wipeBlobStores.inputSchema, 'confirm'));
  assert.ok(property(wipeBlobStores.inputSchema, 'prefixes'));
  assert.match(String((wipeBlobStores as { description?: string }).description), /maintenance tool/);

  const reconcileArtifacts = tools.get('reconcile_artifact_indexes')!;
  assert.ok(property(reconcileArtifacts.inputSchema, 'requestId'));
  assert.ok(property(reconcileArtifacts.inputSchema, 'artifactKind'));
  assert.ok(property(reconcileArtifacts.inputSchema, 'limit'));
  assert.match(
    String((reconcileArtifacts as { description?: string }).description),
    /Admin-only artifact-index correction job/
  );
  assert.match(
    String((reconcileArtifacts as { description?: string }).description),
    /corrects stale artifact-index blobKey values/
  );

  for (const name of [
    'save_artifact',
    'save_artifact_chunk',
    'save_artifact_create_upload_session',
    'save_artifact_finalize_upload_session',
    'list_artifacts_for_request',
    'list_artifacts_by_kind',
    'list_artifacts_by_request',
    'search_artifacts',
    'soft_delete_artifact',
    'restore_artifact',
    'migrate_artifact_indexes',
    'wipe_blob_stores',
    'reconcile_artifact_indexes',
  ]) {
    const serialized = JSON.stringify(tools.get(name));

    assert.equal(serialized.includes('NETLIFY_PUBLISH_SECRET'), false);
    assert.equal(serialized.includes('PUBLISH_SECRET'), false);
    assert.equal(serialized.includes('secret'), false);
    assert.equal(serialized.includes('credential'), false);
  }
});
