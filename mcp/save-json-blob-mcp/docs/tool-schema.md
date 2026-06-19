# MCP tool schema notes

Production `/mcp` registers workflow tools plus the retained artifact tools:

- `create_artifact_upload_intent`
- `create_artifact_from_url` (preferred fallback for restricted clients)
- `save_artifact` (legacy tiny base64 compatibility only)
- artifact listing/admin tools such as `list_artifacts_for_request`, `get_artifact_metadata`, `list_artifacts_by_kind`, `list_artifacts_by_request`, `search_artifacts`, `soft_delete_artifact`, `restore_artifact`, `migrate_artifact_indexes`, `wipe_blob_stores`, and `reconcile_artifact_indexes`

Generated binary files and images should use `create_artifact_upload_intent`, then raw HTTP `POST /api/artifacts/upload` with `application/octet-stream` and the returned required headers.

Clients that cannot perform raw binary POST should use `create_artifact_from_url` to trigger a server-side fetch of a public HTTPS URL. This tool requires `requestId`, `artifactKind`, `contentType`, `sourceUrl`, `expectedSizeBytes`, and `expectedSha256`. The server verifies integrity and format before saving. In production, it is highly recommended to set the `ARTIFACT_URL_INGEST_ALLOWED_HOSTS` environment variable to limit ingestion to trusted domains.

`save_artifact` accepts a single base64 payload and remains only for legacy/tiny-artifact clients. It writes the final artifact blob and retained ArtifactReference indexes.

Legacy MCP JSON chunk and upload-session tools are intentionally no longer registered.
