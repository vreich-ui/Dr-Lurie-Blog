# AGENTS (Project rules)

## Rule summary

- Preserve the repository, remote MCP, and artifact workflow rules below unless a task explicitly changes them.
- Before starting Codex work, identify the correct base branch and dependency chain.
- For related or multi-step work, prefer an integration branch or the latest dependent branch instead of assuming `main`.
- Keep page-specific guidance in focused docs under `docs/agents/`.

## Repository Notes

- Site image assets live under `https://kugelmedia.netlify.app/drlurieblog/`; assume they are always available for this site.
- Use `https://kugelmedia.netlify.app/favicon.png` for the favicon.

## Codex task sequencing / base branch

- For multi-task plans, do NOT assume `main` as the base branch.
- Prefer an integration branch like `codex/<feature>` for the plan, or explicitly base from the most recent dependent branch.
- Include PR dependency note lines like `Depends on: #<PR_NUMBER>` when a PR depends on another PR, and clearly mention the required merge order.
- Warn before creating parallel PRs that touch the same files, because they are likely to create sequencing conflicts or duplicate work.

## Remote MCP / ChatGPT connector notes

- Production ChatGPT/Atlas connects to `https://drluriescience.netlify.app/mcp` and should see the connector name `Dr_Lurie_MCP_Server`.
- Keep `/mcp` routed through Netlify (`netlify.toml`) to the site function in `netlify/functions/mcp.ts`. The package under `mcp/save-json-blob-mcp/` is still useful for local stdio/standalone HTTP tests, but it is not the production Netlify entry point by itself.
- If ChatGPT reports `No tool was defined under the given paths`, verify the deployed `/mcp` route first with `initialize` and `tools/list` JSON-RPC requests before changing tool names or schemas.
- Do not expose `NETLIFY_PUBLISH_SECRET` or `PUBLISH_SECRET` to browser code, tool schemas, prompts, or checked-in client configuration. MCP tool calls must use server-side environment variables only.

## Agent artifact workflow rules

- When an agent generates artifacts (images, audio, video, binary files, or markdown files), it must upload them immediately and store the returned `ArtifactReference`/`blobKey` in MCP request state or the relevant agent output. Use `save_artifact` for small artifacts, use `save_artifact_create_upload_session` plus the binary chunk endpoint plus `save_artifact_finalize_upload_session` for larger artifacts, and use `save_artifact_chunk` only as a legacy compatibility fallback.
- Agents must never attempt to generate deterministic artifact blob keys themselves. Let the artifact tool return `blobKey`, `sha256`, size, content type, and timestamp.
- Treat every `ArtifactReference` as immutable. If an artifact must be regenerated, upload it again and use the newly returned reference.
- If an artifact upload tool call or binary chunk upload fails or times out, retry the exact same upload/chunk call and rely on idempotent chunk handling/checksum deduplication instead of inventing a new handle.
- Before publishing, re-fetch the workflow/request state and use the current `artifactReferences` returned from MCP. Publishing payloads may include `mediaEntries` (existing base64) and/or `artifactReferences`; do not publish until artifact references are present and resolvable by the server-side publishing path.
- Do not ask users for, display, or pass Netlify/GitHub publishing credentials. Artifact upload, artifact resolution, and publication use server-side environment variables only.

## Page-specific rules

- See `docs/agents/shop-layout.md` for `/shop` mobile rules.
