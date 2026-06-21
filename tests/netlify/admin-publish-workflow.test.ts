import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publishPagePath = 'src/pages/admin/publish.astro';

const readPublishPage = () => readFile(publishPagePath, 'utf8');

const indexAfter = (source: string, pattern: string, startIndex: number) => {
  const index = source.indexOf(pattern, startIndex);
  assert.notEqual(index, -1, `Expected to find ${pattern}`);
  return index;
};

test('admin publish flow re-fetches workflow state and requires lock before publishing', async () => {
  const source = await readPublishPage();

  const saveDraftIndex = indexAfter(source, 'await saveJsonDraftToBlobs();', 0);
  const requireLockIndex = indexAfter(source, 'if (!requestId || !lockToken)', saveDraftIndex);
  const refetchIndex = indexAfter(source, 'await fetchLatestWorkflowRequest(requestId);', requireLockIndex);
  const publishIndex = indexAfter(source, "fetch('/.netlify/functions/publish-article'", refetchIndex);
  const artifactReferenceIndex = indexAfter(
    source,
    '...(artifactReferences.length ? { artifactReferences } : {}),',
    publishIndex
  );

  assert.ok(requireLockIndex > saveDraftIndex, 'Publish must require the checked-out workflow lock after saving.');
  assert.ok(refetchIndex > requireLockIndex, 'Publish must re-fetch the latest workflow state after requiring a lock.');
  assert.ok(publishIndex > refetchIndex, 'Article publishing must start after latest workflow state is fetched.');
  assert.ok(artifactReferenceIndex > publishIndex, 'Publish payload must use latest artifact references.');
});

test('admin saved artifact picker is constrained to image artifacts', async () => {
  const source = await readPublishPage();

  const modalIndex = indexAfter(source, 'id="blob-image-modal"', 0);
  const copyIndex = indexAfter(source, 'Saved images', modalIndex);
  const imageOptionIndex = indexAfter(source, '<option value="image" selected>Image</option>', copyIndex);
  const filterIndex = indexAfter(source, 'const filterBlobImageArtifacts = (artifacts', imageOptionIndex);
  const imageGuardIndex = indexAfter(source, 'if (!isImageArtifactReference(artifact)) return false;', filterIndex);
  const selectIndex = indexAfter(source, 'const selectMarkedBlobImages = () =>', imageGuardIndex);
  const selectGuardIndex = indexAfter(
    source,
    'stagedBlobImageKeys.has(artifact.blobKey) && isImageArtifactReference(artifact)',
    selectIndex
  );

  assert.equal(source.includes('<option value="pdf">PDF</option>'), false, 'Image picker should not expose PDFs.');
  assert.equal(
    source.includes('<option value="video">Video</option>'),
    false,
    'Image picker should not expose videos.'
  );
  assert.ok(copyIndex > modalIndex, 'Modal copy should describe saved images.');
  assert.ok(imageOptionIndex > copyIndex, 'Image should be the only artifact kind option.');
  assert.ok(imageGuardIndex > filterIndex, 'Browse results should be filtered to image artifact references.');
  assert.ok(selectGuardIndex > selectIndex, 'Selection should ignore non-image references defensively.');
});

test('admin import migrates inline media entries to artifact references before draft persistence', async () => {
  const source = await readPublishPage();

  const persistableHelperIndex = indexAfter(source, 'const getPersistableSelectedMediaEntries = () =>', 0);
  const stripInlineIndex = indexAfter(source, '!hasUsableMediaEntryContent(entry)', persistableHelperIndex);
  const importIndex = indexAfter(
    source,
    'const applyContentSourceImportFormData = async (formData) =>',
    stripInlineIndex
  );
  const inlineDetectIndex = indexAfter(
    source,
    'const importedInlineMediaEntries = importedMediaEntries.filter',
    importIndex
  );
  const immediateUploadIndex = indexAfter(source, 'await uploadInlineMediaEntriesAsArtifacts(', inlineDetectIndex);
  const stageIndex = indexAfter(source, 'stagedInlineMediaEntries = mergeMediaEntries', immediateUploadIndex);
  const saveDraftIndex = indexAfter(source, 'const saveJsonDraftToBlobs = async () =>', 0);
  const uploadAfterSaveIndex = indexAfter(
    source,
    'await uploadStagedInlineMediaEntriesForRequest(savedRequestId)',
    saveDraftIndex
  );
  const secondSaveIndex = indexAfter(
    source,
    'await postJsonDraftToBlobs(clerkToken, savedRequestId',
    uploadAfterSaveIndex
  );
  const saveBeforePublishIndex = indexAfter(source, 'await saveJsonDraftToBlobs();', 0);
  const publishInlineGuardIndex = indexAfter(
    source,
    'if (selectedMediaEntries.some(hasUsableMediaEntryContent))',
    saveBeforePublishIndex
  );
  const publishIndex = indexAfter(source, "fetch('/.netlify/functions/publish-article'", publishInlineGuardIndex);
  const publishPayloadIndex = indexAfter(source, 'getPersistableSelectedMediaEntries().length', publishIndex);

  assert.ok(stripInlineIndex > persistableHelperIndex, 'Persistable media helper should strip inline image bytes.');
  assert.ok(inlineDetectIndex > importIndex, 'Import should detect inline media entries.');
  assert.ok(immediateUploadIndex > inlineDetectIndex, 'Import should upload inline media when a request exists.');
  assert.ok(stageIndex > immediateUploadIndex, 'Import should stage inline media when no request exists yet.');
  assert.ok(
    uploadAfterSaveIndex > saveDraftIndex,
    'Draft save should upload staged inline media after request creation.'
  );
  assert.ok(
    secondSaveIndex > uploadAfterSaveIndex,
    'Draft save should persist returned artifact references after upload.'
  );
  assert.ok(
    publishInlineGuardIndex > saveBeforePublishIndex,
    'Publish should block if inline media remains after save.'
  );
  assert.ok(publishPayloadIndex > publishIndex, 'Publish payload should use media entries without inline bytes.');
});

test('admin publish flow blocks when selected artifact references are missing from latest workflow state', async () => {
  const source = await readPublishPage();

  const helperIndex = indexAfter(source, 'const getLatestSelectedArtifactReferences = (latestWorkflowRecord) =>', 0);
  const referencesReturnIndex = indexAfter(source, 'return { references: [], missingBlobKeys: [] };', helperIndex);
  const missingKeysIndex = indexAfter(source, 'const missingBlobKeys = selectedBlobKeys.filter', referencesReturnIndex);
  const messageIndex = indexAfter(
    source,
    'const formatMissingArtifactWorkflowMessage = (missingBlobKeys) =>',
    missingKeysIndex
  );
  const refetchIndex = indexAfter(source, 'await fetchLatestWorkflowRequest(requestId);', messageIndex);
  const reconcileIndex = indexAfter(
    source,
    'const latestSelectedArtifacts = getLatestSelectedArtifactReferences',
    refetchIndex
  );
  const blockIndex = indexAfter(source, 'if (latestSelectedArtifacts.missingBlobKeys.length)', reconcileIndex);
  const statusIndex = indexAfter(
    source,
    'formatMissingArtifactWorkflowMessage(latestSelectedArtifacts.missingBlobKeys)',
    blockIndex
  );
  const publishIndex = indexAfter(source, "fetch('/.netlify/functions/publish-article'", statusIndex);

  assert.ok(referencesReturnIndex > helperIndex, 'Helper should return structured reconciliation results.');
  assert.ok(missingKeysIndex > referencesReturnIndex, 'Helper should compute missing selected artifact blob keys.');
  assert.ok(messageIndex > missingKeysIndex, 'Missing artifact status copy should be available.');
  assert.ok(reconcileIndex > refetchIndex, 'Publish should reconcile artifacts after fetching latest workflow state.');
  assert.ok(blockIndex > reconcileIndex, 'Publish should check for missing artifacts before validation.');
  assert.ok(statusIndex > blockIndex, 'Missing artifacts should produce an actionable status message.');
  assert.ok(publishIndex > statusIndex, 'Publish request must not be reached before the missing-artifact guard.');
});

test('admin publish flow sends lock_token to mark_published and checks in after success', async () => {
  const source = await readPublishPage();
  const markIndex = indexAfter(source, "mcpToolCall('save_json_blob_mark_published'", 0);
  const requestIdIndex = indexAfter(source, 'request_id: requestId,', markIndex);
  const expectedVersionIndex = indexAfter(
    source,
    'expected_record_version: latestWorkflowRecord?.version,',
    requestIdIndex
  );
  const lockTokenIndex = indexAfter(source, 'lock_token: lockToken,', expectedVersionIndex);
  const commitMetadataIndex = indexAfter(
    source,
    'commit_metadata: { commit, articlePath: publishedPath },',
    lockTokenIndex
  );
  const checkinIndex = indexAfter(source, 'await checkinWorkflowRequest();', commitMetadataIndex);
  const catchIndex = indexAfter(source, "console.warn('Published workflow status update failed.'", checkinIndex);

  assert.ok(
    expectedVersionIndex > requestIdIndex,
    'mark_published payload must include expected_record_version from the latest workflow state.'
  );
  assert.ok(lockTokenIndex > expectedVersionIndex, 'mark_published payload must include lock_token with request_id.');
  assert.ok(commitMetadataIndex > lockTokenIndex, 'mark_published payload must include commit metadata.');
  assert.ok(checkinIndex > commitMetadataIndex, 'Workflow check-in must happen after mark_published succeeds.');
  assert.ok(catchIndex > checkinIndex, 'mark_published failure handling must not check in before the success path.');
});

test('admin publish JSON import filters unreadable artifact references before selection', async () => {
  const source = await readPublishPage();
  const applyIndex = indexAfter(source, 'const applyContentSourceImportFormData = async (formData) =>', 0);
  const checkIndex = indexAfter(source, 'await checkReadableArtifactReferences(importedArtifactReferences', applyIndex);
  const selectedIndex = indexAfter(
    source,
    '...importedReadableArtifactReferences.map(createArtifactSelectedImage),',
    checkIndex
  );
  const warningIndex = indexAfter(
    source,
    'formatArtifactReselectionMessage(importedFailedArtifactReferences)',
    selectedIndex
  );
  const awaitApplyIndex = indexAfter(source, 'await applyContentSourceImportFormData(formData);', warningIndex);

  assert.ok(checkIndex > applyIndex, 'Import should validate artifact bytes before selecting artifacts.');
  assert.ok(selectedIndex > checkIndex, 'Only readable artifact references should become selected images.');
  assert.ok(warningIndex > selectedIndex, 'Unreadable imported artifact references should produce a user warning.');
  assert.ok(awaitApplyIndex > warningIndex, 'JSON load should await asynchronous artifact validation.');
});

test('admin publish image picker uses MCP artifact browse filters and current request defaults', async () => {
  const source = await readPublishPage();
  const loadIndex = indexAfter(source, 'const loadBlobImageChoices = async () =>', 0);
  const mcpIndex = indexAfter(source, "loadAllArtifactBrowsePages('list_artifacts_by_request'", 0);
  const fallbackIndex = indexAfter(source, "loadAllArtifactBrowsePages('list_artifacts_by_kind'", 0);
  const searchIndex = indexAfter(source, "loadAllArtifactBrowsePages('search_artifacts'", 0);
  const currentRequestIndex = indexAfter(source, 'value="current" selected>Current draft/request', 0);
  const imageKindIndex = indexAfter(source, 'value="image" selected>Image', 0);
  const sortIndex = indexAfter(source, 'sortArtifactsByCreatedDesc', 0);
  const renderIndex = indexAfter(source, 'renderBlobImageChoices(availableBlobImageArtifacts);', loadIndex);

  assert.ok(mcpIndex > 0, 'Image picker should use the MCP request-scoped artifact browsing tool.');
  assert.ok(fallbackIndex > 0, 'Image picker should use the MCP kind browsing tool.');
  assert.ok(searchIndex > 0, 'Image picker should use the MCP tag search tool for search assistance.');
  assert.ok(currentRequestIndex > 0, 'Request filter should default to the current draft/request.');
  assert.ok(imageKindIndex > 0, 'Artifact kind filter should default to image.');
  assert.ok(sortIndex > 0, 'Image picker should sort artifacts by createdAtISO descending.');
  assert.ok(renderIndex > loadIndex, 'Image picker should render the filtered artifact list response.');
});

test('admin publish payload omits stale existing featured paths for selected publishable images', async () => {
  const source = await readPublishPage();
  const helperIndex = indexAfter(source, 'const getExistingFeaturedImagePathForPayload = () =>', 0);
  const selectedPublishableIndex = indexAfter(
    source,
    'isSelectedPublishableImageValue(fields.featuredImage.value)',
    helperIndex
  );
  const publishPayloadIndex = indexAfter(
    source,
    'existingFeaturedImagePath: getExistingFeaturedImagePathForPayload(),',
    selectedPublishableIndex
  );

  assert.ok(
    selectedPublishableIndex > helperIndex,
    'Existing featured path helper should check whether the selected featured image is publishable.'
  );
  assert.ok(
    publishPayloadIndex > selectedPublishableIndex,
    'Publish payload should use the helper instead of blindly sending the hidden existingFeaturedImagePath value.'
  );
});
