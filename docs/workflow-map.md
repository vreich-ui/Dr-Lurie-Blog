# Workflow map

## Artifact-aware publishing path

1. Agents create or fetch the MCP workflow request and keep MCP state authoritative.
2. For agent-orchestrated artifact generation, agents call `pdf-tool` directly and then patch the returned Dr. Lurie-native `ArtifactReference` into workflow JSON; see `docs/agents/pdf-tool-artifacts.md`. Dr. Lurie remains the workflow owner, while `pdf-tool` is the artifact generation/storage utility.
3. For direct byte uploads to Dr. Lurie, agents upload bytes using `create_artifact_upload_intent` plus raw HTTP `POST /api/artifacts/upload` as the default path. `save_artifact` remains available only for legacy small-artifact MCP compatibility.
4. The returned `ArtifactReference` is the deterministic handle. Store the whole reference in the workflow record or stage output; never derive `blobKey` in the model and never store binary bytes or base64 payloads in workflow JSON.
5. If upload or generation fails, retry the same idempotent upload/job flow when safe and use the ArtifactReference returned by the artifact system. The obsolete MCP JSON chunk and upload-session transports are removed.
6. Before final publication, re-fetch the workflow/request state and build `publication.publish_payload` from the latest article body plus current `artifactReferences` and any existing base64 `mediaEntries`.
7. The server-side publishing path resolves `artifactReferences` to base64 media entries and commits them through the existing GitHub media flow. Agents must not request, store, or forward Netlify/GitHub credentials.
8. After the trusted publish process returns commit/deploy metadata, call `save_json_blob_mark_published`, then check in the workflow lock.

## Workflow contract source

The canonical workflow contract lives in `src/schema/workflow-contract.ts`. Use its exported `allowedAgentNames`, `workflowStatuses`, `knownPublicationStatuses`, and `publicationStatusDescription` when updating schema validation, Netlify functions, MCP tool schemas, or docs so agent names, workflow lifecycle states, and first-party publication-status semantics stay aligned. The standalone Node MCP package keeps a local runtime mirror that is tested against this TypeScript contract.

## Immutability rules

- `ArtifactReference` is immutable: `blobKey`, `sha256`, `sizeBytes`, `contentType`, and `createdAtISO` describe one uploaded byte sequence.
- Regeneration means a new upload and a new reference.
- Publication must use current MCP state, not stale local guesses.

## Publication status semantics

- `publication_status: "draft"` means the article payload is not publishable yet.
- `publication_status: "ready"` means publish now through the immediate publishing path.
- `publication_status: "scheduled"` plus `scheduled_for` means publish later through the due scheduled-publish path.
- `workflow_status: "published"` is set only after actual successful publish.
