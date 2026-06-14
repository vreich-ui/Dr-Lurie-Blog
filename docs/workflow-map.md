# Workflow map

## Artifact-aware publishing path

1. Agents create or fetch the MCP workflow request and keep MCP state authoritative.
2. When an agent generates an image, PDF, video, document, audio, data, attachment, or other artifact, it immediately uploads bytes with the smallest reliable path: `save_artifact` for small artifacts, `save_artifact_create_upload_session` plus the binary chunk endpoint plus `save_artifact_finalize_upload_session` for larger artifacts, and legacy `save_artifact_chunk` only as a compatibility fallback.
3. The returned `ArtifactReference` is the deterministic handle. Store the whole reference in the workflow record or stage output; never derive `blobKey` in the model.
4. If upload fails or the tool call times out, retry the same payload, raw upload-session chunk, or legacy chunk. Upload-session chunks are idempotent when the re-uploaded chunk bytes match; finalization and checksum deduplication return the existing reference without duplicating final bytes.
5. Before final publication, re-fetch the workflow/request state and build `publication.publish_payload` from the latest article body plus current `artifactReferences` and any existing base64 `mediaEntries`.
6. The server-side publishing path resolves `artifactReferences` to base64 media entries and commits them through the existing GitHub media flow. Agents must not request, store, or forward Netlify/GitHub credentials.
7. After the trusted publish process returns commit/deploy metadata, call `save_json_blob_mark_published`, then check in the workflow lock.

## Workflow contract source

The canonical workflow contract lives in `src/schema/workflow-contract.ts`. Use its exported `allowedAgentNames`, `workflowStatuses`, `knownPublicationStatuses`, and `publicationStatusDescription` when updating schema validation, Netlify functions, MCP tool schemas, or docs so agent names, workflow lifecycle states, and first-party publication-status semantics stay aligned. The standalone Node MCP package keeps a local runtime mirror that is tested against this TypeScript contract.

## Immutability rules

- `ArtifactReference` is immutable: `blobKey`, `sha256`, `sizeBytes`, `contentType`, and `createdAtISO` describe one uploaded byte sequence.
- Regeneration means a new upload and a new reference.
- Publication must use current MCP state, not stale local guesses.
