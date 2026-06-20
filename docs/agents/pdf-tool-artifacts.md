# pdf-tool agent artifact orchestration

`pdf-tool` is the artifact generation and storage utility for agent-created images, PDFs, and related binary outputs. Dr. Lurie remains the owner of workflow JSON and publication state; agents own orchestration between the two systems.

## Current architecture

1. The agent creates or updates the Dr. Lurie workflow JSON through the existing Dr. Lurie MCP checkout, patch, and checkin tools.
2. The agent calls `pdf-tool` directly to create an artifact job:

   ```http
   POST {PDF_TOOL_BASE_URL}/.netlify/functions/create-agent-artifact-job
   ```

3. The agent polls `pdf-tool` directly until the job completes:

   ```http
   GET {PDF_TOOL_BASE_URL}/.netlify/functions/get-agent-artifact-job-status
   ```

4. `pdf-tool` returns a Dr. Lurie-native `ArtifactReference`.
5. The agent uses the existing Dr. Lurie MCP checkout, patch, and checkin tools to insert that `ArtifactReference` into the authoritative workflow JSON.
6. A later trusted publisher reads the stored `ArtifactReference` from workflow state and resolves it through the existing publication path.

Do **not** add Dr. Lurie MCP wrapper tools for `pdf-tool` yet. Dr. Lurie Functions are not required to call `pdf-tool` for this flow; agents call `pdf-tool` directly, then patch Dr. Lurie workflow JSON separately.

## Runtime configuration

Agent runtimes that orchestrate `pdf-tool` should be configured with:

- `PDF_TOOL_BASE_URL=https://pdf-x.netlify.app`
- `PDF_TOOL_AGENT_RUN_TOKEN`

Keep `PDF_TOOL_AGENT_RUN_TOKEN` in the agent/runtime secret store. Do not put it in browser code, workflow JSON, checked-in configuration, prompts, or tool schemas.

## ArtifactReference contract

Store only the returned immutable `ArtifactReference` object in workflow JSON. Do not store binary bytes, base64 payloads, generated URLs, guessed blob keys, or partial references in workflow JSON.

The returned reference has this shape:

```json
{
  "blobKey": "...",
  "sizeBytes": 0,
  "sha256": "...",
  "contentType": "image/png",
  "createdAtISO": "2026-06-20T00:00:00.000Z",
  "artifactKind": "image",
  "originalFilename": "hero.png",
  "label": "Hero image",
  "tags": ["hero"],
  "metadata": {}
}
```

Treat every `ArtifactReference` as immutable. If an artifact must be regenerated, create a new `pdf-tool` job and store the newly returned reference.

## Example agent flow: hero image slot

1. Check out the Dr. Lurie workflow JSON with the existing MCP checkout tool.
2. Patch or confirm the workflow contains a planned hero image slot, for example `slot: "hero"` in the relevant stage metadata.
3. Create a `pdf-tool` artifact job for a hero image using `PDF_TOOL_BASE_URL` and `PDF_TOOL_AGENT_RUN_TOKEN`. Include the workflow request id and a slot value of `"hero"` in the job metadata.
4. Poll `get-agent-artifact-job-status` until the job is complete.
5. Read the completed job response and copy the returned `ArtifactReference` exactly as returned.
6. Check out the latest Dr. Lurie workflow JSON again, patch the hero slot with the returned `ArtifactReference`, and check in the workflow lock through the existing Dr. Lurie MCP tools.
7. Leave publication unchanged. The publisher later reads the stored `ArtifactReference` from workflow JSON and resolves it through the current server-side publishing path.
