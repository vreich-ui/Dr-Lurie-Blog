# MCP tool schema notes

Production `/mcp` registers workflow tools plus the retained artifact tools:

- `create_artifact_upload_intent`
- `save_artifact` (legacy small-artifact compatibility only)
- artifact listing/admin tools such as `list_artifacts_for_request`, `get_artifact_metadata`, `list_artifacts_by_kind`, `list_artifacts_by_request`, `search_artifacts`, `soft_delete_artifact`, `restore_artifact`, `migrate_artifact_indexes`, `wipe_blob_stores`, and `reconcile_artifact_indexes`

Generated binary files and images should use `create_artifact_upload_intent`, then raw HTTP `POST /api/artifacts/upload` with `application/octet-stream` and the returned required headers. Clients must store only returned `ArtifactReference` objects and must never invent deterministic blob keys, URLs, or repo paths.

`save_artifact` accepts a single base64 payload and remains only for legacy/small-artifact clients. It writes the final artifact blob and retained ArtifactReference indexes.

Legacy MCP JSON chunk and upload-session tools are intentionally no longer registered.
