# AGENTS (Project rules)

## Core structure — read `docs/cms-architecture/core-structure.md` FIRST

The system standardizes on **Contentful's content model**: typed entry objects
(pages/sections — already built) + **Contentful Rich Text** JSON for all rich
content fields (replaces HTML strings). That doc has the canonical example for each
level and the ordered task list to finish the CMS. It is the entry point.

## Design north star — flexible objects, not a site replica (READ FIRST)

We are building a **flexible content backbone, not reproducing today's pages
one-for-one.** Prefer **reusable, agent-configurable components** (a `content_grid`
an agent can point at any content and set to N cells) over **bespoke per-page types**
(a section that renders exactly one page). Byte-identical cutover was migration
_safety_, not the goal — "an agent can now reconfigure this to play a different role"
is. **Litmus test:** if an agent can't repoint or reuse a thing without a code
change, it's a replica, not backbone — generalize it. Full rule + consequences:
`docs/cms-architecture/design-principles.md`. This **governs** where the phased-plan's
"faithful reproduction" / "new component type per page" framing conflicts.

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

## CMS architecture project — mandatory context

If any task touches the object store, Pages, Sections, Navigation, Taxonomy, 
Site config, Templates, or anything under `docs/cms-architecture/`, read these 
files in full before writing any code, in this order:

1. The task's standalone brief: `docs/cms-architecture/cms-pipeline/T<phase>.<n>-*.md` 
   — its header carries the task's `depends_on`, `mode`, and recommended 
   model/effort. **Check `depends_on` before starting — if a dependency isn't 
   built and merged yet, stop and say so.**
2. `docs/cms-architecture/cms-pipeline/queue.tsv` — task ordering and per-task 
   mode/model/effort (the runner config; see `README.md` alongside it).
3. For full schema/type detail: `docs/cms-architecture/02-architecture-and-schema.md`
4. For permission/action rules: `docs/cms-architecture/03-mapping-and-agent-contract.md`
5. For the full per-task spec: `docs/cms-architecture/05-task-breakdown-and-open-questions.md`. 
   (A consolidated master reference, `cms-architecture-consolidated.md`, is named 
   by some briefs but has not been committed — the numbered source docs are 
   ground truth where anything conflicts.)
6. `docs/cms-architecture/object-inventory.md` — the current catalog of content 
   objects (each marked LIVE / SHELL / TODO), every object type's use + boundaries, 
   and the MVP todo list. Read it to see what is already an editable object vs. still 
   hardcoded. It is hand-maintained and drifts easily: **update the matching row in 
   the SAME change** when you cut over a surface or publish/retire an object. For 
   always-current machine truth, prefer the `object_contract` / `object_inventory` 
   MCP tools over any doc.

## CMS hard constraints — every task, no exceptions

- `admin-workflow-lock.ts`, `publish-article.ts`, and existing article MCP 
  tools are **off-limits**. Do not modify, import from, or refactor them.
- Every new file is additive. The public site must remain fully functional 
  after every commit.
- One task, one commit. Do not bundle cleanup or unrelated fixes.
- Commit message must begin with the task ID, e.g. `T0.1: envelope schema module`.
- Do not open a PR unless the task brief explicitly says to.
- Do not push to `main`. Work on the task's integration branch.
- `route`-kind nav targets are intentional — do not "fix" them to `page`-kind.
- The `content_revision` counter and the `version` counter are independent — 
  never conflate them. Lock writes bump `version` only, never `content_revision`.

## CMS amendment log — bake these in, do not miss them

When implementing body schemas (T0.2), all of the following must be present:
- M-1: `NavItem.description`
- M-2: `groups[].slot`
- M-5: `groups[].target` (stored, not rendered as a link)
- M-7: `NavItem.icon` and `NavItem.ariaLabel`
- Transitional `NavTarget {kind:'route', href}` union variant (deliberate, not a placeholder)
- `shared_ref` union member in section schema
- Transitional `content_grid` static-cards variant

M-8 (grid manual+fallback) is deliberately NOT in T0.2 — it lands in T3.3.

## Remote MCP / ChatGPT connector notes

- Production ChatGPT/Atlas connects to `https://drluriescience.netlify.app/mcp` and should see the connector name `Dr_Lurie_MCP_Server`.
- Keep `/mcp` routed through Netlify (`netlify.toml`) to the site function in `netlify/functions/mcp.ts`. The package under `mcp/save-json-blob-mcp/` is still useful for local stdio/standalone HTTP tests, but it is not the production Netlify entry point by itself.
- If ChatGPT reports `No tool was defined under the given paths`, verify the deployed `/mcp` route first with `initialize` and `tools/list` JSON-RPC requests before changing tool names or schemas.
- Do not expose `NETLIFY_PUBLISH_SECRET` or `PUBLISH_SECRET` to browser code, tool schemas, prompts, or checked-in client configuration. MCP tool calls must use server-side environment variables only.

## Agent artifact workflow rules

- When an agent generates artifacts (images, audio, video, binary files, or markdown files), it must upload them immediately and store the returned `ArtifactReference`/`blobKey` in MCP request state or the relevant agent output. For generated binary files and images, use `create_artifact_upload_intent` plus raw HTTP `POST /api/artifacts/upload` as the default upload path. `save_artifact` remains available only for legacy small-artifact MCP compatibility.
- Agents must never attempt to generate deterministic artifact blob keys themselves. Let the artifact tool return `blobKey`, `sha256`, size, content type, and timestamp.
- Treat every `ArtifactReference` as immutable. If an artifact must be regenerated, upload it again and use the newly returned reference.
- If an artifact upload tool call or direct HTTP upload fails or times out, retry the same upload flow when safe and rely on server-side idempotency/checksum deduplication instead of inventing a new handle.
- Before publishing, re-fetch the workflow/request state and use the current `artifactReferences` returned from MCP. Publishing payloads may include `mediaEntries` (existing base64) and/or `artifactReferences`; do not publish until artifact references are present and resolvable by the server-side publishing path.
- Do not ask users for, display, or pass Netlify/GitHub publishing credentials. Artifact upload, artifact resolution, and publication use server-side environment variables only.

## Page-specific rules

- See `docs/agents/shop-layout.md` for `/shop` mobile rules.
