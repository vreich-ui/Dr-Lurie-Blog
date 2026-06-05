# Repository Notes

- Site image assets live under `https://kugelmedia.netlify.app/drlurieblog/`; assume they are always available for this site.
- Use `https://kugelmedia.netlify.app/favicon.png` for the favicon.

## Remote MCP / ChatGPT connector notes

- Production ChatGPT/Atlas connects to `https://drluriescience.netlify.app/mcp` and should see the connector name `Dr_Lurie_MCP_Server`.
- Keep `/mcp` routed through Netlify (`netlify.toml`) to the site function in `netlify/functions/mcp.ts`. The package under `mcp/save-json-blob-mcp/` is still useful for local stdio/standalone HTTP tests, but it is not the production Netlify entry point by itself.
- If ChatGPT reports `No tool was defined under the given paths`, verify the deployed `/mcp` route first with `initialize` and `tools/list` JSON-RPC requests before changing tool names or schemas.
- Do not expose `NETLIFY_PUBLISH_SECRET` or `PUBLISH_SECRET` to browser code, tool schemas, prompts, or checked-in client configuration. MCP tool calls must use server-side environment variables only.

## Agent artifact workflow rules

- When an agent generates artifacts (images, audio, video, binary files, or markdown files), it must call `save_artifact` immediately, or `save_artifact_chunk` for large payloads, and store the returned `ArtifactReference`/`blobKey` in MCP request state or the relevant agent output.
- Agents must never attempt to generate deterministic artifact blob keys themselves. Let the artifact tool return `blobKey`, `sha256`, size, content type, and timestamp.
- Treat every `ArtifactReference` as immutable. If an artifact must be regenerated, upload it again and use the newly returned reference.
- If an artifact upload tool call fails or times out, retry the exact same upload/chunk call and rely on checksum deduplication instead of inventing a new handle.
- Before publishing, re-fetch the workflow/request state and use the current `artifactReferences` returned from MCP. Publishing payloads may include `mediaEntries` (existing base64) and/or `artifactReferences`; do not publish until artifact references are present and resolvable by the server-side publishing path.
- Do not ask users for, display, or pass Netlify/GitHub publishing credentials. Artifact upload, artifact resolution, and publication use server-side environment variables only.

## /shop mobile layout rule

- Treat `/shop` as the redirected `/solutions/shop-preview` page unless the route changes.
- Mobile-only layout rules must apply at `max-width: 767px`; do not alter desktop or tablet layout to satisfy mobile requirements.
- On mobile, content order must remain: one short justification line, page title, product image block, supporting copy, then CTA.
- The first product image must appear within the first 120% of viewport height, ideally around `70vh`; it must not appear after long intro copy or after CTAs.
- Mobile spacing targets: justification to title `8–12px`, title to first product image `≤16px`, product image block to copy `20–24px`, and product image block to CTA `16–20px`.
- First visible product image height on mobile must be at least `160px`, preferably `180–220px`, with at least one full or clearly peeking product image visible in the first natural scroll on an iPhone-sized viewport around `390×844`.
