# Artifact upload paths

The retained binary artifact path is the direct upload flow:

1. Call the MCP tool `create_artifact_upload_intent` with the request id, artifact kind, content type, expected size, and expected SHA-256.
2. Upload the exact raw bytes with `POST /api/artifacts/upload` using `Content-Type: application/octet-stream` and the returned required headers.
3. Store and pass through only the returned immutable `ArtifactReference`.

### Server-side pull fallback

If a browser or cloud agent cannot perform a raw binary HTTP POST to `/api/artifacts/upload`, it should use the `create_artifact_from_url` tool. This is the **preferred fallback** for restricted environments.

The `create_artifact_from_url` tool requires:

- `requestId`: The workflow request id.
- `artifactKind`: The kind of artifact (e.g., `image`, `pdf`).
- `contentType`: The MIME type of the artifact.
- `sourceUrl`: A public HTTPS URL where the artifact is available.
- `expectedSizeBytes`: The exact expected size in bytes.
- `expectedSha256`: The exact SHA-256 hex digest of the bytes.
- Optional: `filename`, `label`, `tags`, `metadata`.

**Behavior:**

1. The server validates the `sourceUrl` (HTTPS only, no credentials, public IP validation, redirect limits).
2. The server fetches the bytes from the URL.
3. The server verifies that the received bytes match the `expectedSizeBytes` and `expectedSha256`.
4. The server performs format-specific validation (e.g., image decoding check, PDF header check).
5. The server saves the bytes and writes the same `ArtifactReference` and index format as a direct upload.

`save_artifact` remains registered only as a legacy small-artifact MCP compatibility path for tiny base64-encoded payloads. Agents should prefer direct upload or the `create_artifact_from_url` pull path.

**Production Recommendation:** For enhanced security, set the `ARTIFACT_URL_INGEST_ALLOWED_HOSTS` environment variable to a comma-separated list of trusted domains (e.g., `images.unsplash.com,.dropbox.com`). If unset, the server allows any public HTTPS host that passes strict IP checks, which carries a residual DNS-rebinding risk.

Final artifact bytes are stored under `{artifactKind}/{safeRequestId}/{sha256}{extension}`. Retained indexes are written under:

- `request-artifacts/{requestId}/{sha256}.json`
- `by-request/{requestId}/{artifactKind}/{sha256}.json`
- `by-kind/{artifactKind}/{sha256}.json`
- `by-tag/{tag}/{sha256}.json`

The obsolete MCP JSON chunk and upload-session transports are intentionally removed from the production MCP tool list and Netlify function routes.
