# Artifact upload paths and indexes

This note documents the current artifact upload implementation for the Netlify MCP server and related helpers.

## `ArtifactReference` creation paths

All durable `ArtifactReference` objects are created through `createArtifactReference` in `netlify/lib/artifacts.ts`. The helper derives the artifact SHA-256, builds the immutable blob key as `{artifactKind}/{safe requestId}/{sha256}{extension}`, records byte size, content type, creation timestamp, kind, original filename, label, tags, and metadata, and validates that generated blob keys match the server format.

The production upload paths that call this helper are:

1. **Single-shot upload**
   - MCP tool: `save_artifact`.
   - Netlify function path: `netlify/functions/mcp.ts` delegates to `netlify/functions/save-artifact.ts`.
   - Runtime behavior: the JSON payload is decoded from base64 by default, or from `binary` string encoding when requested. If no chunk fields are present, `save-artifact` creates a reference for logging and then calls `finalizeUpload`, which creates the durable reference, validates image/integrity constraints, stores final bytes, writes indexes, and returns `artifact`.

2. **MCP JSON chunk upload**
   - MCP tool: `save_artifact_chunk`.
   - Netlify function path: `netlify/functions/mcp.ts` delegates to `netlify/functions/save-artifact.ts` with `clientUploadId`, `chunkIndex`, and `totalChunks`.
   - Runtime behavior: each JSON chunk is decoded from base64 by default, or `binary` string encoding when requested. Chunks are stored under the `artifacts` store, with a chunk manifest. When all chunks are present, chunks are assembled and passed to `finalizeUpload`, which creates the final `ArtifactReference`, writes final bytes, writes indexes, and returns `artifact`. Incomplete uploads return `complete: false` and do not return an artifact reference.

3. **Binary upload session finalization**
   - MCP tools: `save_artifact_create_upload_session` / `create_upload_session`, followed by raw HTTP chunk uploads, followed by `save_artifact_finalize_upload_session` / `finalize_upload_session`.
   - Netlify function paths: upload-session creation and finalization are handled by `netlify/functions/mcp.ts`; raw chunks are accepted by `netlify/functions/upload-session-chunk.ts` and the older `netlify/functions/save-artifact-upload-chunk.ts` endpoint.
   - Runtime behavior: `create_upload_session` writes a session manifest but does not create an `ArtifactReference`. Raw HTTP chunks are stored through `storeUploadSessionChunk`. Finalization verifies the manifest, chunk presence, per-chunk digests, total size, and complete SHA-256, then passes assembled bytes to `finalizeUpload`. The returned artifact is saved back into the session manifest as `finalizedArtifact`, making retries idempotent.

4. **Index reconciliation updates**
   - `reconcileArtifactReference` can correct an existing reference's `blobKey` in the request index if stored bytes are found under an equivalent normalized/corrected key. This path updates index JSON for existing references but does not create a new artifact from uploaded bytes.

## Blob stores and index records currently written

The artifact system uses two Netlify Blob stores:

- `artifacts`: binary final artifacts plus temporary MCP JSON chunks and binary upload-session chunks.
- `artifact-index`: durable JSON `ArtifactReference` records, search/list pointers, and binary upload-session manifests.

Current writes are:

| Store            | Key pattern                                                               | Written by                                                                                            | Value                                                                                  |
| ---------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `artifacts`      | `{artifactKind}/{safe requestId}/{sha256}{extension}`                     | `finalizeUpload` via `saveFinalArtifact`                                                              | Final artifact bytes with content type, SHA-256, size, and created-at metadata.        |
| `artifact-index` | `request-artifacts/{encodeURIComponent(requestId)}/{sha256}.json`         | `saveReference` in `finalizeUpload`; also `reconcileArtifactReference` when correcting blob-key drift | Full `ArtifactReference` JSON.                                                         |
| `artifact-index` | `by-kind/{artifactKind}/{sha256}.json`                                    | `saveReferencePointers`                                                                               | Pointer `{ requestId, sha256, artifactKind }`.                                         |
| `artifact-index` | `by-request/{encodeURIComponent(requestId)}/{artifactKind}/{sha256}.json` | `saveReferencePointers`                                                                               | Pointer `{ requestId, sha256, artifactKind }`.                                         |
| `artifact-index` | `by-tag/{safe tag}/{sha256}.json`                                         | `saveReferencePointers` when reference tags are present                                               | Pointer `{ requestId, sha256, artifactKind }`.                                         |
| `artifacts`      | `artifact-chunks/{requestId}/{clientUploadId}/{chunkIndex}`               | `save_artifact_chunk` via `saveUploadedChunk`                                                         | Temporary JSON-transport chunk bytes.                                                  |
| `artifacts`      | `artifact-chunks/{requestId}/{clientUploadId}/manifest.json`              | `save_artifact_chunk` via `writeChunkManifest`                                                        | JSON chunk manifest with metadata, received indexes, and per-chunk digests.            |
| `artifact-index` | `artifact-upload-sessions/{sessionId}/manifest.json`                      | `create_upload_session`, `storeUploadSessionChunk`, and finalization                                  | Upload-session manifest, uploaded chunk indexes/digests, optional `finalizedArtifact`. |
| `artifacts`      | `upload-session/{sessionId}/chunk-{chunkIndex}`                           | `upload-session-chunk` / `save-artifact-upload-chunk` via `storeUploadSessionChunk`                   | Raw binary session chunk bytes.                                                        |
| `artifacts`      | `artifact-upload-sessions/{sessionId}/chunks/{chunkIndex}`                | Legacy read/delete path only in current code                                                          | Older binary session chunk location; finalization still checks it for compatibility.   |

## MCP tools and exposed transports

### Base64 or binary-in-JSON transport

- `save_artifact` exposes single-shot JSON upload. It accepts `payload` plus optional `encoding`; `encoding` is `base64` by default and may be `binary`.
- `save_artifact_chunk` exposes JSON chunk upload. It accepts `payload` plus optional `encoding`; `encoding` is `base64` by default and may be `binary`. This is the documented default publisher-agent upload path.
- `probe_artifact_chunk_size` is a diagnostic JSON chunk tool that accepts base64 `payload` and checks decoded size; it is not a durable artifact-creation path.

### Binary upload-session transport

- `save_artifact_create_upload_session` and alias `create_upload_session` expose upload-session setup. They return `sessionId`, `uploadUrl`, `uploadToken`, `chunkSizeBytes`, `maxBytes`, and `totalChunks`.
- Raw session chunk endpoints are not MCP tool calls: clients upload bytes to the returned URL with `x-upload-token`, `x-session-id`, `x-chunk-index`, `x-total-chunks`, and optional `x-chunk-sha256` headers. `upload-session-chunk` accepts `PUT` and `POST`; the older `save-artifact-upload-chunk` endpoint accepts `PUT` only.
- `save_artifact_finalize_upload_session` and alias `finalize_upload_session` expose upload-session finalization and return the immutable `ArtifactReference`.
- `diagnostic_upload` is an MCP diagnostic helper for session upload troubleshooting; it does not create an `ArtifactReference`.

## Call-site notes

- `netlify/lib/mcp-artifact-upload-client.ts` validates caller-provided image base64, computes expected SHA-256/size, and chooses among single-shot, MCP JSON chunks, or binary upload sessions. Its explicit legacy fallback path uses `save_artifact_chunk` if upload-session setup or binary chunk upload fails.
- `netlify/lib/image-validation.ts` is called during final artifact validation for image artifacts. Invalid image bytes prevent finalization and therefore prevent reference/index writes.
- MCP tests under `mcp/save-json-blob-mcp/test/` cover the remote MCP contract, including tool exposure, artifact chunk upload behavior, upload-session behavior, artifact listing/searching, and publishing payloads that include `artifactReferences`.
