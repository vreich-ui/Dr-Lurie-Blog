# Workflow map

## Artifact-aware publishing path

1. Agents create or fetch the MCP workflow request and keep MCP state authoritative.
2. When an agent generates an image, PDF, video, document, audio, data, attachment, or other artifact, it immediately uploads bytes with `save_artifact` or the chunked `save_artifact_chunk` flow.
3. The returned `ArtifactReference` is the deterministic handle. Store the whole reference in the workflow record or stage output; never derive `blobKey` in the model.
4. If upload fails or the tool call times out, retry the same payload or chunk. Checksum deduplication means a duplicate upload returns the existing reference without duplicating final bytes.
5. Before final publication, re-fetch the workflow/request state and build `publication.publish_payload` from the latest article body plus current `artifactReferences` and any existing base64 `mediaEntries`.
6. The server-side publishing path resolves `artifactReferences` to base64 media entries and commits them through the existing GitHub media flow. Agents must not request, store, or forward Netlify/GitHub credentials.
7. After the trusted publish process returns commit/deploy metadata, call `save_json_blob_mark_published`, then check in the workflow lock.

## Immutability rules

- `ArtifactReference` is immutable: `blobKey`, `sha256`, `sizeBytes`, `contentType`, and `createdAtISO` describe one uploaded byte sequence.
- Regeneration means a new upload and a new reference.
- Publication must use current MCP state, not stale local guesses.
