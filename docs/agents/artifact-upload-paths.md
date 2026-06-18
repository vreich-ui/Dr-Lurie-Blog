# Artifact upload paths

The retained binary artifact path is the direct upload flow:

1. Call the MCP tool `create_artifact_upload_intent` with the request id, artifact kind, content type, expected size, and expected SHA-256.
2. Upload the exact raw bytes with `POST /api/artifacts/upload` using `Content-Type: application/octet-stream` and the returned required headers.
3. Store and pass through only the returned immutable `ArtifactReference`.

`save_artifact` remains registered only as a legacy small-artifact MCP compatibility path. Generated binary files and images should use the direct upload intent plus raw HTTP upload path.

Final artifact bytes are stored under `{artifactKind}/{safeRequestId}/{sha256}{extension}`. Retained indexes are written under:

- `request-artifacts/{requestId}/{sha256}.json`
- `by-request/{requestId}/{artifactKind}/{sha256}.json`
- `by-kind/{artifactKind}/{sha256}.json`
- `by-tag/{tag}/{sha256}.json`

The obsolete MCP JSON chunk and upload-session transports are intentionally removed from the production MCP tool list and Netlify function routes.
