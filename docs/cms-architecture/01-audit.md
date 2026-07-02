# CMS Architecture — Session 1: Audit (fact-finding only)

Date: 2026-07-02. Branch: `docs/cms-architecture-design`. Scope: factual inventory of (1) the existing agent-operable article workflow and (2) everything on the site that is *not* agent-operable today. No design proposals here beyond short "observations" notes.

Method note: every claim below is cited as `file:line` against the repo at commit `ddeb353` (tip of `main` at audit time). Items that could not be verified from source alone are flagged inline with **UNVERIFIED**.

---

## 1. The existing article workflow (full mechanics)

### 1.1 Storage: Netlify Blobs

**Blob stores** (all defined in `netlify/lib/blob-store.ts`):

| Store | Consistency | Contents | Accessor |
|---|---|---|---|
| `workflows` | strong | JSON `WorkflowRecord` drafts incl. lock + history | `getWorkflowBlobStore` (`blob-store.ts:172-174`) |
| `artifacts` | strong | raw image/PDF bytes | `getArtifactBlobStore` (`blob-store.ts:180-182`) |
| `artifact-index` | strong | JSON `ArtifactReference` records + pointer keys | `getArtifactIndexBlobStore` (`blob-store.ts:184-186`) |
| `opt-ins` | eventual | newsletter/contact form captures | `getOptInBlobStore` (`blob-store.ts:176-178`) |

Local dev falls back to a filesystem store under `.netlify/local-blobs/` (`netlify/lib/local-blobs.ts`); in production `@netlify/blobs` is required (`blob-store.ts:133-139`).

**Key naming**:
- Workflow record: `workflows/by-id/{request_id}.json` (`netlify/functions/save-json-blob.ts:232`)
- Stage index: `workflows/index/by-stage/{nextAgent}/{requestId}`; status index: `workflows/index/by-status/{status}/{requestId}` — empty-string marker blobs (`save-json-blob.ts:233-234, 722-726`)
- Artifact bytes: `{kind}/{requestId}/{sha256}{ext}` (`netlify/lib/artifacts.ts:434`); kinds: `image, pdf, video, doc, audio, data, attachment, other` (`artifacts.ts:7`)
- Artifact index: `request-artifacts/{requestId}/{sha256}.json` plus pointer keys `by-kind/...`, `by-request/...`, `by-tag/...` (`netlify/lib/artifact-index.ts:26-54`)

**Envelope: `WorkflowRecord`** (`src/schema/schema-v1.ts:304-320`, zod at `:707-743`): `request_id, created_at, updated_at, workflow_status, current_stage, next_agent, completed_agents[], failed_agents[], last_error, needs_review, input (ContentSourceV1), agent_outputs (per-agent versioned envelopes), lock?, history[], version` (record-level optimistic concurrency). Workflow statuses: `pending | in_progress | completed | failed`; agent pipeline: `reader_insight → research → angle → draft → final_article` (`src/schema/workflow-contract.ts:1-5`; transitions hardcoded in `netlify/functions/mcp.ts:191-200`).

**`ContentSourceV1`** (`schema-v1.ts:147-302`) is the per-article envelope inside `input`, with independently versioned sub-sections: `ids`, `publication_context`, `content` (title/deck/description/`article_body`/future `structure`+`blocks`), `taxonomy` (tags), `seo`, `media` (image prompt register, generation runs, asset register, image sets), `editorial`, `emotional_strategy`, `sources`, `claims`, `compliance`, `commercial` (offers), `approvals`, `publication` (`published_time`, `publish_payload`), `workflow`, `revision_control`, `versioning`.

**Article body: `article_body.v1`** (`src/schema/article-content-v1.ts:200-217`). **Important corrective finding**: nodes are *not* a discriminated union of types like "hook" or "offer". Every node has one generic shape (`articleBodyNodeSchema`, `article-content-v1.ts:162-193`):

- `id` — opaque, `/^n_[a-z0-9]+$/i`; explicitly forbidden to contain `hook|agitation|cta|advert|offer` (`:166-179`)
- `kind` — `content | action | placement | interactive` (`:180`)
- `public` — the only reader-visible fields: `eyebrow, title, body, items[], ctaText, ctaLink, label, media{type: image|video|audio|embed|document, title, contentType, src, alt, caption}` (`:137-157`)
- `private` — internal strategy metadata, never rendered: `strategy ∈ {hook, agitation, context, explanation, proof, example, comparison, myth, step, recommendation, resolution, summary}`, `intent ∈ {educate, persuade, reassure, convert, navigate}`, `agentNotes`, `sourcePromptId`, `inputTemplateId` (`:64-87`)
- `commercial` — `type ∈ {adSlot, sponsoredPlacement, productMention, affiliateMention, partnerResource, offer, housePromotion}`, source, sponsor/merchant/product/offer/campaign IDs, `destinationUrl`, `rel`, `disclosure{required,label,mode}`, `offer{couponCode,expiresAt,terms,eligibility}`, `adSlot{...}` (`:6-56`)
- `chat` — `{invitationText, suggestedQuery}` (`:184-189`)
- `rendering` — `presentation ∈ {plain, section, callout, inline, card, panel, faq, summary, chatInvite, adSlot, offerInline, offerCard}`, `emphasis`, `placement ∈ {inline, section, sidebar, afterParagraph, footer}` (`:94-115`)
- `visibility` — `public | internal | hidden` (`:191`)

So the "node types" named in project shorthand (hook, agitation, resolution, offer, CTA, image, callout, prose_section, soft_action, contextual_offer, affiliate mention) are actually **combinations** of `kind` + `rendering.presentation` + `private.strategy` + `commercial.type`. The authoring-template vocabulary lives in `src/lib/article-content/input-bank.ts:37-299` (`articleNodeTemplates`): `prose_section, image, plain_text, callout, summary, soft_action, contextual_offer, commerce_offer, product_mention, ad_slot, chat_invite, faq` — each a blueprint mapping to kind/public/commercial/rendering defaults, stamped into `private.inputTemplateId` on instantiation (`input-bank.ts:311-333`). `inferTemplateId` reverse-maps a node to its template (`input-bank.ts:358-373`).

Reader-safety guard: `src/lib/article-content/assert-reader-safe.ts:5-29` throws if internal keywords (`private, strategy, agentNotes, sourcePromptId, inputTemplateId`) leak into reader-facing content.

Schema-doc drift: `docs/agents/article-content-structure.md:94` documents a node kind `reference` that the zod enum does not allow (`article-content-v1.ts:180`).

### 1.2 Locking — article-level only

**Confirmed: the lock is a single record-level lease on the whole workflow record (one article), not per-node.** The lock is a field on the record itself — `WorkflowRecord.lock = {token, owner_id, owner_label, acquired_at, expires_at}` (`schema-v1.ts:34-40`) stored inside `workflows/by-id/{requestId}.json`; there is no separate lock store and no node-scoped lock anywhere.

Two clients of the same lock:
- **Human editors** → `netlify/functions/admin-workflow-lock.ts` (Netlify Identity auth; the browser never sees the publish secret — stated at `admin-workflow-lock.ts:2-5`). Actions `checkout | checkin | refresh | status | force_release` (`:23-30`). `checkout` returns **HTTP 423** with the sanitized holder if a live lock exists (`:107-114`), else writes `{token: randomUUID(), ...}` with default lease **900 s** / max 3600 s (`:40, :116-139`). `checkin`/`refresh` require the matching token; mismatch or expiry → 423 (`:142-148`). `force_release` is an admin override that clears any lock and records `admin_force_release` with the previous owner in history (`:190-213`). Every mutation appends a history entry and bumps `record.version` (`:127-136`).
- **Agents** → `save-json-blob.ts` actions `checkout_request / refresh_lock / checkin_request / force_unlock` authenticated by `x-publish-key` (`save-json-blob.ts:116-183, 221-229`); every mutating action validates the active lock (`validateMutationLock`, `save-json-blob.ts:345-353`; expired → 423).

Client-side lifecycle: `src/lib/admin/lock-manager.ts` — `LockManager` wraps the endpoint with `checkout(leaseSeconds=900)` (`:52-68`), auto-refresh timer firing at 80 % of lease elapsed (`REFRESH_AT_REMAINING_FRACTION = 0.2`, `:22, 98-122`), `checkin()`, `forceRelease()`, `status()`, and a best-effort `navigator.sendBeacon` checkin on `beforeunload` (`:132-144`). On failed refresh (lock expired or stolen) it drops the token and notifies the UI (`:117-121`).

Conflict handling in the editor: `publish.astro` acquires the lock lazily on first edit (`onEditClick`, `publish.astro:3390-3394`) and again before accepting an AI suggestion (`:3493-3500`); if another party holds it, the lock bar shows the holder (`lock-manager.ts:61-67`) and editing is blocked. Node saves are additionally guarded server-side: `admin-update-node.ts` rejects a stale/missing/mismatched `lockToken` with 423 (`admin-update-node.ts:92`). Separately, `admin-patch-workflow.ts` uses **409** for optimistic `expected_record_version` conflicts (`admin-patch-workflow.ts:186-188`).

### 1.3 Diff/review flow (word-level diff overlay, Accept/Discard)

Implemented entirely in `src/lib/admin/ai-suggestion.ts` + the inline script of `src/pages/admin/publish.astro`. (Note: `src/pages/admin/review/[draftId].astro` is *not* the editor — it is a read-only styled preview that fetches `admin-get-json-draft` and injects pre-rendered `draft.html` (`[draftId].astro:499-508, 476`).)

- **Trigger**: an AI suggestion returned from Ask-AI (§1.4). There is no diff view for manual TipTap edits — those save directly.
- **Diff computation**: `renderWordDiff` uses `diffWords` from the npm `diff` package (`ai-suggestion.ts:16, 26-49`), emitting `<ins>`/`<del>` spans. `renderFieldDiff` (`:51-88`) picks word-level diff only for prose fields (`PROSE_FIELDS = ['body']`) when either side is > 80 chars; short fields (title, ctaText, ctaLink, label, eyebrow) render side-by-side old-vs-new blocks (`:60-85`).
- **Overlay**: `renderSuggestionOverlay` (`:92-171`) mounts an absolutely-positioned overlay on the node wrapper, diffs each field in the suggestion against `node.public`, skips unchanged fields (`:126-131`), and renders Accept/Discard buttons.
- **Accept**: calls the `onAccept` callback → `publish.astro:3488-3503`: acquires the lock if needed, then `saveNodeUpdate(...)` → `POST admin-update-node` with `{requestId, lockToken, nodeId, updatedPublicFields}` (`publish.astro:3536-3540`). The server merges the fields into `node.public`, appends an `admin_update_node` history entry with previous/next snapshots, increments `record.version`, and writes the record back (`admin-update-node.ts:105-162`). The client updates its local `currentNodes`, re-renders the node, syncs `currentRecordVersion`, and shows a one-step per-node undo badge (`publish.astro:3546-3567, 3346-3376`).
- **Discard**: removes the overlay and returns mode to idle; **nothing is written** (`ai-suggestion.ts:158-161`; `publish.astro:3504-3506`).
- **State produced**: only the workflow-record blob (node public fields + version + history). No diff artifacts persist; the diff is ephemeral browser DOM.

### 1.4 Ask-AI (`admin-ask-ai-node.ts`)

- **Selection capture** (`publish.astro:3436-3449`): if the block is in TipTap edit mode, uses `activeEditor.getSelectionText()` (TipTap `doc.textBetween`, `node-editor.ts:516-520`); otherwise reads `window.getSelection()` and uses it only when non-collapsed and anchored inside that node's wrapper. A `mouseup` handler toggles an `ai-has-selection` class on the AI button (`publish.astro:3311-3319`).
- **Whole-node fallback**: with no selection, `selectedText` stays `undefined`; the popover title switches to "Ask AI to revise this block" (`ai-suggestion.ts:303-305`) and the endpoint operates on the whole node.
- **Endpoint** `netlify/functions/admin-ask-ai-node.ts`: POST, admin-gated; body zod-validated `{requestId, nodeId (/^n_[a-zA-Z0-9]+$/), selectedText? ≤4000, instruction 1–2000}` (`:21-28`). Loads `workflows/by-id/{requestId}.json`, finds the node, builds context from the article title plus up to 2 preceding and 2 following public nodes (~300-char snippets each) (`:59-84`). Calls the Anthropic Messages API directly via fetch with model `claude-sonnet-4-6` (override env `ANTHROPIC_MODEL`), `max_tokens: 1500`, and a single **forced tool** `update_node_content` whose input schema is exactly the editable public fields (`:86-128`). Returns `{suggestion, nodeId}` where suggestion is the tool-use input with null/undefined stripped (`:199-212`).
- **Read-only**: the function takes no lock and writes nothing (`:2-4`); persistence happens only if the human Accepts (§1.3).

### 1.5 Rendering today (`node-renderer.ts`, `node-editor.ts`)

- `src/lib/admin/node-renderer.ts` — client-side display renderer (admin preview mirrors public blog styling; header comment `:1-5`). `renderNode(node)` (`:440-460`) dispatches on `rendering.presentation` (callout, plain, offerInline, offerCard, summary, faq, chatInvite, adSlot, inline+action → soft-action, card, media → image, default → section). `wrapNode` (`:463-472`) wraps output in `.dl-node-wrapper` carrying `data-node-id / data-node-kind / data-node-presentation`. Internals: TipTap-HTML sanitizer with tag allowlist `p, br, strong, em, a, ul, ol, li, h2, h3` and http(s)-only forced-`rel` links (`:45-82`); artifact-ref detection renders placeholders since `image/{id}/{sha256}.{ext}` blob keys can't resolve in the browser (`:94-96, 248-267`); source-section heuristics (`/\b(source|further reading)\b/i`) render items as titled external links (`:123-164`).
- `src/lib/admin/node-editor.ts` — per-block TipTap editor (one instance per block, deliberately minimal; `:1-5`). Extension set chosen by node role: rich text (headings 2/3, bold, italic, link, lists) for prose; plain-text for action/CTA blocks (URL lives in separate inputs); list-only for faq/summary (`:31-70, 376-379, 414`). `mount()` builds toolbar + optional section-title input + optional CTA text/URL fields + Save/Cancel footer, hides the rendered preview, and mounts over it (`:373-492`). `doSave` computes only changed fields and calls `onSave(fields)`; unchanged → `onNoChange` (`:428-465`).
- **Public-site rendering of published articles is entirely separate**: published posts are Astro content-collection markdown rendered by `src/pages/[...blog]/index.astro` → `src/components/blog/SinglePost.astro`. The node structure does not survive to the public page; it is flattened to markdown at publish time (§1.6–1.7).

### 1.6 Publishing (`publish.astro` and the real publish path)

**Key finding: there are three distinct "publish" mechanisms with different semantics.**

1. **Admin UI Publish button** (`publish.astro:3770-3843`): after validating title/path/nodes and readiness, it POSTs `{action: 'set_published_time', request_id, lock_token, published_time: now}` to `admin-patch-workflow` (`:3816-3827`), then checks in the lock. It **only stamps `input.publication.published_time` on the blob record** — the confirm dialog and success message say so explicitly: "Trigger a site deploy separately to make the article live" (`:3794, 3835`). No markdown is generated, no git commit happens.
2. **MCP `save_json_blob_publish_by_time`** — the actual end-to-end publish (`mcp.ts:1900-2046`): validates lock + `content_source.v1`; promotes the `final_article` agent's richer `article_body` into canonical input if applicable (`:1637-1699`); validates `article_body.v1` with ≥1 reader-visible node (`:1701-1722`); gathers the request's artifact references; builds a canonical `PublishPayload` including featured-image selection by priority scoring across `media.image_asset_register`, image sets, node media, and image artifacts, with hero designation (`id === 'n_hero'` or `presentation === 'hero'`) winning (`buildCanonicalPublishPayload`, `:1739-1898`); then invokes the `publish-article` handler in-process with the server-side `x-publish-key` (`:1444-1473`); finally writes a publish receipt back onto the workflow record via `set_published_time` (`:2027-2035`). Passing `published_time: null` runs the same path to unpublish (`:1941-1992`).
3. **`toggle-article-publish.ts`** (admin identity auth): directly rewrites the `published_time:` frontmatter line of `src/data/post/{slug}.md` via the GitHub Contents API (also stripping legacy `draft:` lines) and commits `Update publish state: {slug}` (`toggle-article-publish.ts:99-132, 242-250`). Used by `/admin/library`.

**`publish-article.ts` step by step** (`netlify/functions/publish-article.ts:1520-1812`):
1. Auth: valid `x-publish-key` (timing-safe compare against `PUBLISH_SECRET`/`NETLIFY_PUBLISH_SECRET`) OR authenticated admin identity (`verifyPublisher`, `:916-948`).
2. Validate slug/title/body/dates; `articlePath` must be exactly `src/data/post/{slug}.md` (`:1587-1595`; content root constant `:131`).
3. Requires env `GITHUB_CONTENT_TOKEN` + `GITHUB_REPOSITORY` (+ `GITHUB_BRANCH`, default `main`) (`:1597-1605`).
4. Duplicate check via GitHub contents API; 409 unless `overwrite` (`:1638-1646`).
5. Media materialization (`getMediaEntries`, `:1211-1518`): resolves `artifactReferences` (+ node media artifact pointers) to bytes from the `artifacts` blob store; images validated by actual `sharp` decode (JPEG/PNG/WebP only; `netlify/lib/image-validation.ts:65-153`); PDFs validated by `%PDF-` header (`netlify/lib/pdf-validation.ts`). Images land at `src/assets/images/uploads/{slug}/…`, documents at `src/assets/documents/uploads/{slug}/…` (`:132-136`).
6. Markdown generation: `articleBodyToMarkdown(article_body)` (`:1680-1694`) + `buildFrontmatter` (`:969-1017`, emits `publishDate`, `published_time`, `title`, `excerpt`, `image`, `tags`, `metadata.description`, optional `author`/`category`/`video`/`cta`) + rewrite of artifact blob keys to committed display paths (`replacePublishedArtifactReferences`, `:1711`). Any leftover raw artifact ref in the committed markdown → 422 (`:554-598, 1715`).
7. **Git commit via the GitHub Git Data API** (no local git): create blob(s) → create tree on `base_tree` → create commit (author `GITHUB_COMMIT_AUTHOR_NAME/EMAIL`, default "Dr. Lurié Publisher") → PATCH branch ref (`:1717-1768`).
8. The push triggers Netlify's normal build; `getPublishDeployReceipt` optionally polls Netlify deploys up to ~120 s and returns `deployId/deployStatus/commit/...` in the 201 response (`:156-194, 1770-1791`). Non-fatal `image_not_rendered` warnings flag image nodes that won't render inline (`collectUnrenderedImageWarnings`, `:486-534`).

Additional publish surfaces: `run-publisher-agent.ts` (OpenAI Agents SDK runner wrapping a single `publish_approved_article` tool that POSTs to publish-article; used by the ChatKit admin page; `run-publisher-agent.ts:132-172, 271-362`) and the browser helper `src/lib/publishArticleFromPayload.ts:48-90` (identity-token client call to publish-article).

**Publish gating in the UI** — `src/lib/admin/readiness-criteria.ts`: `evaluateReadiness` (`:139-373`) returns grouped criteria (metadata, content structure, sources, media alt-text, editorial-quality placeholder scan, publishing safety: lock held / agent lock / canonical saved), each `complete|warning|missing|optional`; `readinessLevel` (`:379-384`) rolls up, and the Publish button is disabled while anything is `missing` (`publish.astro:2473-2474`). No numeric score exists (`readiness-criteria.ts:1-5`).

### 1.7 Git-committed markdown export — derived, not authoritative

**Confirmed derived.** Markdown is generated at publish time from `article_body` by `src/lib/article-content/to-markdown.ts` and committed to `src/data/post/{slug}.md`; the admin editor never reads the .md files (it loads JSON drafts from Blobs, `publish.astro:2039`). Corroborating statements: `cc-brief.md:30-34` ("Netlify Blobs is the actual source of truth … .md files are a DERIVED export"), `docs/mcp-article-body-v1.md:13`, `mcp/save-json-blob-mcp/README.md:7`, `docs/workflow-map.md:5`.

Serialization rules (`to-markdown.ts:36-155`), per public node in order: commercial disclosure `*label*` if `disclosure.required`; eyebrow as `*italic*`; title as `##` (presentation `section`) else `###`; media only when `rendering.placement === 'inline'` and not a hero image node (hero images go to the frontmatter `image:` field instead — `:91-102`), documents as links, images as `![alt](url)` with `src/assets/` → `~/assets/` normalization; `items[]` as a bullet list; `body` verbatim; CTA as a styled HTML `<a>` button (`renderCtaButton`, `:18-20`). `node.private` is never serialized (`:33-35`). `normalizeArticleBodyFromLegacy` wraps legacy markdown in a single-node body (`:49-63`).

Verified against a real published post: `src/data/post/how-to-restore-your-skin-barrier-after-over-exfoliation.md:1-14` carries the machine-written frontmatter pair `publishDate` + `published_time`, `~/assets/...` image path, and the exact CTA button HTML shape from `renderCtaButton`. **Flag:** the committed .md files carry **no explicit "generated — do not edit" marker**; their derived status is only discoverable from the pipeline code and docs.

Post visibility on the public site is controlled solely by `published_time`: `src/utils/blog.ts:111-123` filters the content collection to posts whose `published_time` is a valid date ≤ now (missing/null/future = not live).

### 1.8 The MCP/agent write surface (how agents operate on articles)

- **Production MCP server**: `netlify/functions/mcp.ts` (~3,400 lines), JSON-RPC 2.0 over POST at `/mcp`, server name `Dr_Lurie_MCP_Server`, protocol `2025-06-18` (`mcp.ts:86-88, 3323-3330`). Optional transport auth via `MCP_HTTP_AUTH_TOKEN` (open if unset — `:1278-1294`); admin/maintenance tools additionally require the publish key or an admin identity (`requireAdminToolAccess`, `:2465-2471`). The function proxies to `save-json-blob`/`publish-article`/`save-artifact` server-side by injecting `x-publish-key` (`:1349-1357, 1444-1465`).
- **Tools** (`TOOL_DEFINITIONS`, `mcp.ts:761-1240`): workflow CRUD + locking (`save_json_blob_create_request`, `..._create_article_draft`, `..._get_request`, `..._list_pending_requests`, `..._patch_agent_output`, `..._mark_agent_complete`, `..._checkout_request`, `..._refresh_lock`, `..._checkin_request`, `..._publish_by_time`, `..._patch_canonical_input`, gated `..._force_unlock`); 10 per-agent convenience tools (`{agent}_update_output` / `{agent}_mark_complete`); publish/deploy (`deploy_status`, `verify_article_images`); artifacts (`create_artifact_upload_intent`, `create_artifact_from_url`, `save_artifact` (legacy), `list_artifacts_for_request`, `get_artifact_metadata`); admin artifact maintenance (`list_artifacts_by_kind/by_request`, `search_artifacts`, `soft_delete_artifact`, `restore_artifact`, `migrate_artifact_indexes`, `reconcile_artifact_indexes`, `wipe_blob_stores`); `ping`.
- **Lock discipline for agents**: checkout → patch (with `expected_agent_version` / `expected_record_version` optimistic checks, conflict → error; `save-json-blob.ts:955-1123, 1186-1290`) → mark complete → checkin (`mcp.ts:188-189`).
- **HTTP backing function**: `netlify/functions/save-json-blob.ts` implements the same actions behind `x-publish-key` (`:116-183, 2258-2283`); `create_request` with `validation_mode: 'admin_publish_draft'` requires a title and ≥1 reader-visible node (`:824-854`); `patch_agent_output` for `final_article` enforces the artifactReferences contract and node `media.src` patterns (`:988-1090`).
- **Naming contract**: `src/lib/agents-naming.ts` — `request_id` must match `req_<flow>_<topic>_<yyyymmdd>_<nn>` (`:2, 61-68`); also template-id/slot/slug/filename validators (`:70-108`). Documented in `docs/agents/naming-convention.md`.
- **Local mirror**: `mcp/save-json-blob-mcp/` is a stdio/HTTP test mirror of the workflow subset that forwards to `save-json-blob` (`mcp/save-json-blob-mcp/src/server.js:246-579`); `AGENTS.md:24-26` states production is the Netlify function.
- **Admin-side equivalents** (identity-auth, so the browser never holds the publish secret): `admin-workflow-lock` (locks), `admin-update-node` (single-node write), `admin-patch-workflow` (`patch_canonical_input` with strict artifact-ref validation + `set_published_time`; `admin-patch-workflow.ts:160-272`), `admin-save-json-draft` (create/update whole drafts; new drafts get id `admin-draft-{uuid}` and `next_agent: 'reader_insight'` — `admin-save-json-draft.ts:272-294`).

### 1.9 Observations (article workflow) — noted, not designed

- Node "types" are metadata combinations on a generic node, not a schema union; any CMS extension will inherit this indirection (template vocabulary lives in `input-bank.ts`, presentation dispatch in `node-renderer.ts`, markdown flattening in `to-markdown.ts` — three places that must agree).
- Locking, versioning, history, readiness, and Ask-AI are all **article-scoped** (`requestId`-scoped); nothing in the stack is aware of any entity other than an article workflow record.
- Divergent publish semantics (UI timestamp-only vs MCP full git publish vs direct frontmatter toggle) mean "published" is not a single state.
- `createRequestId()` fallbacks generate `req_<uuid>` (`mcp.ts:235`; `mcp/save-json-blob-mcp/src/server.js:70`) which fails the `validateRequestId` regex enforced at creation (`save-json-blob.ts:765-774`) — auto-generated ids are rejected.
- CI builds and type-checks but does not run the test suite (`.github/workflows/actions.yaml:26-28, 39-40`; `# - run: npm test`).
- The public site renders published articles from markdown; the admin renderer (`node-renderer.ts`) re-implements the block styling by hand ("Mirrors the public blog's block styling", `node-renderer.ts:2-3`) — two renderers to keep in sync.

---

## 2. Everything else on the site (the non-article surface)

Site framework: Astro 5 + AstroWind template, Tailwind, deployed on Netlify. Site-level config: `src/config.yaml` (name `Dr. Lurié`, blog list path `learn/library`, `postsPerPage: 6`), injected as virtual module `astrowind:config` by the vendored integration `vendor/integration/index.ts:25-58` (registered in `astro.config.ts`).

### 2.1 Homepage (`src/pages/index.astro`)

**Fully hardcoded Astro markup with inline const arrays — no CMS, no content collection, no widgets.** Sections in order:

1. **Hero** (`index.astro:89-106`) — literal kicker, `<h1>` "Healthy Skin for Skincare Newcomers", two paragraphs, two link buttons (`/start-here`, `/newsletter`).
2. **Audience qualifier** "This is for you if…" (`:108-124`) — maps the inline `audienceNotes` array of 4 literal strings (`:51-56`).
3. **"Start here" article grid** (`:126-143`) — maps the inline `startHereArticles` array of 5 literal `{title, description}` objects (`:58-79`). These are **placeholder titles not linked to real posts** — the homepage grid is not driven by the content collection at all.
4. **Bio block** "Meet Dr. Lurié" (`:145-162`) — maps inline `trustNotes` (3 strings, `:81-85`).
5. **Newsletter signup** (`:164-201`) — inline Netlify form `name="newsletter"` posting to `/thank-you?form=newsletter` (`:176-198`).

The homepage **overrides the global footer** with its own hardcoded `homeFooterData` object (`:6-35`) rendered via `<Fragment slot="footer"><Footer {...homeFooterData}/>` (`:203-205`) — verified firsthand. Its link set diverges from the global `footerData` in `navigation.ts`. Page metadata is a literal object (`:37-49`).

`src/pages/homes/*.astro` (mobile-app, personal, saas, startup) are unused AstroWind demo leftovers (e.g. `homes/personal.astro:14` "Personal Homepage Demo", `github.com/arthelokyo` links) — not referenced by navigation or the homepage.

### 2.2 Navigation

- **Single config source**: `src/navigation.ts` `headerData` (`:4-77`) — three dropdown groups (Start Here / Learn / Solutions) plus one `actions` CTA ("Join Early Access" → `/solutions/early-access`, `:70-76`), built with `getPermalink`/`getBlogPermalink` helpers. `src/layouts/PageLayout.astro:18` spreads it into `<Header {...headerData} isSticky showRssFeed showToggleTheme/>`.
- **`src/components/widgets/Header.astro`** renders it generically (dropdown when a link has child `links`, `:94-167`; plain link otherwise, `:169-177`) — nav *content* is purely config. But Header.astro itself hardcodes several things outside `navigation.ts`: a mobile "Join Newsletter" CTA to `/newsletter` (`:210-216`); the entire **search overlay UI + inline client-side search engine** (`:184-308` markup, `:310-564` script) fetching `/search.json` (`:430`); `HeaderAuthButton`/`LoginModal` (`:182, 255, 262`); RSS link + theme toggle (`:242-252`); an `authAction` link type currently unused by `navigation.ts` (`:124-143`).
- Editing any menu item = editing TypeScript source (`navigation.ts`). There is no data/API surface for navigation.

### 2.3 Footer

- **`src/components/widgets/Footer.astro`** is a pure prop-driven widget: `links` (grouped columns), `secondaryLinks`, `socialLinks`, `footNote` (rendered with `set:html`), `brand` (defaults to `SITE.name`), `descriptor` (`Footer.astro:18-36, 50-119`).
- **Global content** from `footerData` in `navigation.ts:79-108`: "Explore" and "Next steps" groups, Terms/Privacy secondary links, one RSS social icon, footNote "Educational content only — not medical advice. © Dr. Lurié."
- **Homepage uses a different hardcoded footer object** (§2.1) — two divergent footer definitions exist.

### 2.4 CTAs outside articles

- **Newsletter form**: only one real form — homepage inline Netlify form (`index.astro:176-198`). `src/pages/newsletter.astro` itself has **no form** (placeholder page with a single link, `newsletter.astro:18-20`).
- **Contact form**: `src/pages/contact.astro:17-42` uses the AstroWind `Contact` widget (`formName="contact"`, Netlify form).
- **Opt-in capture**: `src/components/common/NetlifyOptInCapture.astro` is injected globally by `src/layouts/Layout.astro:49`; it intercepts submits on any `form[data-netlify="true"]`, harvests email/name/consent/form-name/source/pathname, and mirrors them to `/.netlify/functions/save-opt-in` (`NetlifyOptInCapture.astro:73-112`), which writes to the `opt-ins` blob store.
- **Link-only CTAs** hardcoded on: `start-here.astro:19-22`, `guides/free-guide.astro:19-21` (points at `/newsletter`; the "free guide" itself doesn't exist yet), `member-updates.astro:19-21`, `solutions/early-access.astro:11-25`, `solutions/shop-preview.astro:71-74`, `about.astro:152-153`.
- **`thank-you.astro`**: static page; inline script swaps title/message from a hardcoded map keyed on `?form=` (`thank-you.astro:14-29, 56-77`).
- **`CallToAction` widget** (`src/components/widgets/CallToAction.astro`) is used only on template-leftover pages (pricing, services, landing/*, homes/*) — no real page uses it.
- Article-embedded CTAs (soft_action/offer nodes, frontmatter ctaLink/ctaText) are part of the article pipeline (§1); there is no shared CTA registry between articles and pages.

### 2.5 Article index / listing pages

- `src/pages/[...blog]/[...page].astro` — the paginated "Library" listing: `getStaticPathsBlogList({paginate})` (`:14-16`), renders `Headline` + `blog/List` + `Pagination` (`:38-48`). Leftover commented-out category/tag link blocks at `:43-46`.
- `src/pages/[...blog]/index.astro` — the **single-post** route: `getStaticPathsBlogPost()`, renders `blog/SinglePost` + `ToBlogLink` + `RelatedPosts` (`:18-20, 53-59`).
- Data layer `src/utils/blog.ts`: `fetchPosts()` memoizes `load()` (`:143-149`); `load()` reads `getCollection('post')`, normalizes (`getNormalizedPost`, `:43-109`), sorts by `publishDate` desc, and filters to posts with `published_time` ≤ now (`:111-123`). Permalinks from config pattern `/%slug%`.

### 2.6 Category, tag, and author pages

- **Category**: `src/pages/[...blog]/[category]/[...page].astro`, paths from `getStaticPathsBlogCategory` (`blog.ts:208-229`) — distinct `post.category.slug` values collected from frontmatter at build time.
- **Tag**: `src/pages/[...blog]/[tag]/[...page].astro`, paths from `getStaticPathsBlogTag` (`blog.ts:232-255`); tag pages are `robots index:false` (`config.yaml:61`).
- **Author pages: none exist.** `author` is a frontmatter field (`src/content/config.ts:66`) carried through normalization (`blog.ts:97`) but there is no author route, no author listing, and no author entity anywhere.

### 2.7 Learn/topics pages

- `src/pages/learn/topics/index.astro` builds a topic map at build time by grouping `fetchPosts()` by `post.category.slug` (`:6-24`); page copy itself states it's "generated from article category frontmatter" (`:48-50`). `learn/topics/[topicSlug].astro` derives static paths the same way (`:10-25`). **Topics are exactly categories** — no separate topic entity, data file, or admin surface. (The admin `admin-taxonomy` endpoint is unrelated to these pages — see §2.10.)

### 2.8 Search

- `src/pages/search.json.ts` — prerendered JSON index of all published posts `{title, excerpt, permalink, category, tags, publishDate}` (`:8-21`).
- **No search page exists.** The search UI is the hardcoded overlay inside `Header.astro` (§2.2) filtering `/search.json` client-side (`Header.astro:427-486`).

### 2.9 Landing pages and other static pages

- `src/pages/landing/*.astro` (6 files) — **unmodified AstroWind demos** ("… Landing Page Demo" titles, `href="#"` CTAs, Unsplash images). `src/layouts/LandingLayout.astro` is likewise a leftover (hardcoded "Download" action linking to `github.com/arthelokyo/astrowind`, `:21-31`).
- Real hand-built pages, all hardcoded literal Astro markup: `about.astro` (bespoke copy; portrait `<img>` from an external `kugelmedia.netlify.app` URL, `:28`), `start-here.astro`, `solutions/shop-preview.astro` (product images from external URLs, `:5-14`), `solutions/early-access.astro`, `newsletter.astro`, `member-updates.astro`, `guides/free-guide.astro`, `thank-you.astro`, `404.astro`.
- `contact.astro` uses AstroWind widgets with inline literal props. `services.astro` and `pricing.astro` are template leftovers (generic template copy, lorem pricing).
- `privacy.md` / `terms.md` — markdown pages with `layout: '~/layouts/MarkdownLayout.astro'`; content authored in-file.
- `rss.xml.ts` — feed from `fetchPosts()` + `astrowind:config` values.

### 2.10 Page templates / layouts (informal template system)

- `src/layouts/Layout.astro` — base HTML shell (meta, favicons, styles, analytics, `ClientRouter`; body slot + `BackToTop` + `NetlifyOptInCapture` + `BasicScripts`).
- `src/layouts/PageLayout.astro` — standard chrome: `Header {...headerData}` and `Footer {...footerData}` with named `header`/`footer` slots for per-page override (`:16-26`).
- `src/layouts/MarkdownLayout.astro` — PageLayout + title + prose slot (used by privacy/terms).
- `src/layouts/LandingLayout.astro` — template leftover.
- **Two informal page patterns coexist**: (a) AstroWind widget composition (`WidgetWrapper`-based widgets in `src/components/widgets/` — Hero, Features*, Content, Steps, Testimonials, Contact, Pricing, CallToAction, etc.), used only by contact + leftover pages; (b) bespoke hand-rolled sections with `dl-*` utility classes (index, about, start-here, solutions, topics). Neither pattern has any data-driven indirection: page structure and copy live in the `.astro` files themselves.

### 2.11 Taxonomy as it exists today

- **Schema**: post frontmatter `category: z.string().optional()` and `tags: z.array(z.string()).optional()` (`src/content/config.ts:64-65`) — one free-string category, free-string tags. No controlled vocabulary, no taxonomy file, no taxonomy collection.
- **Public derivation**: category/tag routes and topics pages compute distinct values from frontmatter at build time (`blog.ts:208-255`).
- **Admin suggestion source**: `netlify/functions/admin-taxonomy.ts` (GET, admin-gated) scans all `workflows/by-id/*.json` blob records and aggregates lowercased tags/categories from `publish_payload` and `input.taxonomy` (`:46-95`) — used only for autocomplete pills in the publish editor (`publish.astro:2827+`). It reads the **blob drafts**, not the published frontmatter, so the two taxonomies can drift.

### 2.12 Publishing hub / admin dashboard beyond the article editor

All admin pages live under `src/pages/admin/`, are `robots noindex`, gate on Netlify Identity via `GET admin-auth-state`, and hold their logic in inline `<script>` blocks (only `publish.astro` imports the `src/lib/admin/*` modules):

- `admin/index.astro` — dashboard of cards linking to the other admin pages (`:44-96`).
- `admin/drafts.astro` — JSON-draft list from `admin-list-json-drafts` (which also cross-references GitHub to see if `src/data/post/{slug}.md` already exists, `admin-list-json-drafts.ts:157-208`), with per-row links to review/publish.
- `admin/publish.astro` — the block editor + metadata form + readiness panel + Publish (§1).
- `admin/review/[draftId].astro` — read-only preview (§1.3).
- `admin/library.astro` — GitHub-backed published/unpublished article list (`list-draft-articles`) + publish-state toggle (`toggle-article-publish`).
- `admin/blobs.astro` — raw blob-store browser/editor backed by `admin-blob-manager.ts` (list stores/blobs, get/set/delete/duplicate/rename, wipe-store, wipe-all with confirm phrase "WIPE ALL"; `admin-blob-manager.ts:333-344`).
- `admin/agent-admin.astro` — embeds the OpenAI **ChatKit** widget exported at `src/chatkit/widgets/AI Publishing Workflow.widget`; sessions minted by `create-chatkit-session.ts` (requires `OPENAI_API_KEY` + `OPENAI_CHATKIT_WORKFLOW_ID`); widget actions drive `run-publisher-agent` and `publish-article` (`agent-admin.astro:4-49, 88-91, 906-963`).
- `src/components/admin/AdminNav.astro` — pill nav across Dashboard/Library/Publish/Drafts/AI Publisher/Blob Store (`:13-20`).

**Auth model**: Netlify Identity (GoTrue) + an email allowlist. `netlify/lib/admin-auth.ts:57-117` verifies the bearer token against GoTrue and computes `isAdmin = email ∈ ADMIN_EMAILS` (`:50-55, 71-76`). **No roles/permissions exist** — a user is either admin (full access to everything) or nothing. Client side: hand-rolled GoTrue client `src/utils/goTrueClient.ts` (localStorage token, password + Google OAuth), `LoginModal.astro`, `HeaderAuthButton.astro`. A second auth class uses the shared `x-publish-key` secret (`deploy-status.ts:58-76`, `verify-article-images.ts:43-61`; `admin-get-blob-pdf.ts:21-46` accepts either).

**Decap CMS vestige**: `public/decapcms/` contains a configured Decap CMS (git-gateway backend, branch `main`) whose single collection points at folder `src/content/post` (`public/decapcms/config.yml:1-29`) — but the live pipeline reads/writes `src/data/post` (`get-article-for-edit.ts:27`, `list-draft-articles.ts:34`). No admin page links to it. **UNVERIFIED whether it is functional on the live site** (depends on Netlify git-gateway settings not visible in the repo); from source it appears vestigial and mis-pointed.

### 2.13 Observations (non-article surface) — noted, not designed

- Zero data-driven indirection exists for pages, homepage sections, nav, footer, or CTAs: every one is TypeScript/Astro source. The only content-driven public surfaces are the blog routes, topics, search.json, and rss.xml — all reading `src/data/post/*.md` frontmatter, which is itself derived output of the article pipeline.
- The homepage "Start here" grid contains placeholder article titles not linked to real posts (`index.astro:58-79`) — the most visible symptom that non-article surfaces are disconnected from the content pipeline.
- Two footer definitions (global + homepage) and two page-building idioms (AstroWind widgets vs bespoke `dl-*` sections) already exist; taxonomy exists in two disconnected places (blob drafts vs committed frontmatter).
- Site identity (brand colors, fonts, logo text) is split between `src/config.yaml`, `src/components/CustomStyles.astro:29-74` (hardcoded CSS custom properties), and `src/components/Logo.astro:6` (hardcoded 'DR. LURIÉ SCIENCE').

---

## 3. Plain inventory (files touched by this audit)

### Schema & shared article logic
| File | What it is |
|---|---|
| `src/schema/article-content-v1.ts` | Zod schema for `article_body.v1`: generic nodes (kind/public/private/commercial/chat/rendering/visibility) |
| `src/schema/schema-v1.ts` | `WorkflowRecord`, `ContentSourceV1`, `PublishPayload` types + zod; `patchAgentOutput`/`markAgentComplete` helpers |
| `src/schema/workflow-contract.ts` | Agent-name and workflow-status enums (the whole contract file) |
| `src/schema/article-content-helpers.ts` | Get/create article_body from content source; preferred-markdown helper |
| `src/lib/article-content/to-markdown.ts` | Node[] → markdown serializer used at publish time (+ legacy markdown → single-node body) |
| `src/lib/article-content/input-bank.ts` | Authoring templates (prose_section, image, callout, soft_action, contextual_offer, commerce_offer, product_mention, ad_slot, chat_invite, faq…) + opaque node-id generator |
| `src/lib/article-content/assert-reader-safe.ts` | Guard that internal/private metadata never reaches reader-facing output |
| `src/lib/agents-naming.ts` | `request_id`/template/slot/slug/filename validators (naming contract) |
| `src/lib/contentSourceBody.ts` | Renders markdown from a content-source record's article_body |
| `src/lib/contentSourceImportFormData.ts` | Maps a content-source record into admin form fields |
| `src/lib/publishArticleFromPayload.ts` | Browser-side identity-auth helper POSTing to publish-article |

### Admin editor client modules
| File | What it is |
|---|---|
| `src/lib/admin/lock-manager.ts` | Client lock lifecycle: checkout/checkin/refresh/force-release, auto-refresh at 80% lease, unload beacon |
| `src/lib/admin/node-renderer.ts` | ArticleBodyNode → HTMLElement display renderer (presentation dispatch, HTML sanitizer, artifact placeholders) |
| `src/lib/admin/node-editor.ts` | Per-block TipTap editor class (extension sets by node role, CTA fields, changed-fields save) |
| `src/lib/admin/ai-suggestion.ts` | Ask-AI client: instruction popover, word-level diff overlay (diffWords), Accept/Discard |
| `src/lib/admin/readiness-criteria.ts` | Grouped publish-readiness evaluation (no numeric score) |
| `src/lib/admin/article-path.ts` | Slug → `src/data/post/{slug}.md` path generation |

### Admin pages & components
| File | What it is |
|---|---|
| `src/pages/admin/index.astro` | Admin dashboard (link cards) |
| `src/pages/admin/drafts.astro` | Blob-draft list (admin-list-json-drafts) |
| `src/pages/admin/publish.astro` | The block editor/publisher workspace (~4,050 lines, all logic inline script) |
| `src/pages/admin/review/[draftId].astro` | Read-only draft preview (admin-get-json-draft → pre-rendered HTML) |
| `src/pages/admin/library.astro` | GitHub-backed article list + publish-state toggle |
| `src/pages/admin/blobs.astro` | Raw blob-store browser/editor |
| `src/pages/admin/agent-admin.astro` | OpenAI ChatKit "AI Publishing Workflow" host page |
| `src/components/admin/AdminNav.astro` | Admin pill navigation |
| `src/chatkit/widgets/AI Publishing Workflow.widget` | ChatKit widget export (form + actions driving run-publisher-agent) |

### Netlify functions — article workflow
| File | What it is |
|---|---|
| `netlify/functions/mcp.ts` | Production MCP server (JSON-RPC, all agent tools, publish_by_time orchestration, canonical payload builder) |
| `netlify/functions/save-json-blob.ts` | Publish-key HTTP backing store for workflow records (create/get/list/patch/lock/publish-time actions) |
| `netlify/functions/publish-article.ts` | The real publisher: validation, artifact materialization, markdown+frontmatter build, GitHub Git Data API commit, deploy receipt |
| `netlify/functions/run-publisher-agent.ts` | OpenAI Agents SDK server-side publisher (single publish tool) |
| `netlify/functions/admin-workflow-lock.ts` | Identity-auth lock endpoint (checkout/checkin/refresh/status/force_release; 423 conflicts) |
| `netlify/functions/admin-update-node.ts` | Lock-guarded single-node public-field write-back (+history, +version) |
| `netlify/functions/admin-patch-workflow.ts` | Identity-auth `patch_canonical_input` (strict artifact-ref validation, 409 on version conflict) + `set_published_time` |
| `netlify/functions/admin-ask-ai-node.ts` | Read-only Ask-AI endpoint (Anthropic API, forced `update_node_content` tool) |
| `netlify/functions/admin-save-json-draft.ts` | Create/update whole content-source drafts (admin-draft-{uuid}) |
| `netlify/functions/admin-get-json-draft.ts` | Load one workflow record + render preview HTML + filtered history |
| `netlify/functions/admin-list-json-drafts.ts` | Draft summaries incl. GitHub cross-reference & mini-readiness |
| `netlify/functions/admin-taxonomy.ts` | Aggregate tags/categories from all blob drafts (editor autocomplete) |
| `netlify/functions/get-article-for-edit.ts` | Fetch+parse one committed .md from GitHub |
| `netlify/functions/list-draft-articles.ts` | List unpublished committed .md posts from GitHub |
| `netlify/functions/toggle-article-publish.ts` | Rewrite `published_time` frontmatter of a committed .md via GitHub Contents API |
| `netlify/functions/deploy-status.ts` | Publish-key deploy receipt lookup (commit/deployId) |
| `netlify/functions/verify-article-images.ts` | Publish-key post-publish image render verification (fetch page, check img srcs) |
| `netlify/functions/admin-auth-state.ts` | Returns `{authenticated, isAdmin, email}` for the admin UI gate |
| `netlify/functions/create-chatkit-session.ts` | Mints OpenAI ChatKit session client secrets |
| `netlify/functions/save-opt-in.ts` | Stores form opt-ins to the `opt-ins` blob store |

### Netlify functions — artifacts & blobs
| File | What it is |
|---|---|
| `netlify/functions/artifact-upload.ts` | Signed direct artifact upload endpoint (`/api/artifacts/upload`) |
| `netlify/functions/save-artifact.ts` | Legacy small base64 artifact save |
| `netlify/functions/admin-blob-manager.ts` | Admin blob CRUD/wipe action dispatcher |
| `netlify/functions/admin-blob-store-diagnostics.ts` | Blob-store source/config diagnostics |
| `netlify/functions/admin-list-blob-images.ts` | List image artifacts via index pointers |
| `netlify/functions/admin-get-blob-image.ts` | Serve image artifact bytes by blobKey |
| `netlify/functions/admin-get-blob-pdf.ts` | Serve PDF artifact bytes (publish-key or admin) |
| `netlify/functions/get-public-pdf.ts` | Public PDF serving route |

### Netlify shared libs
| File | What it is |
|---|---|
| `netlify/lib/blob-store.ts` | Store accessors (`workflows`, `artifacts`, `artifact-index`, `opt-ins`) + env/lambda/local resolution |
| `netlify/lib/blob-admin.ts` | Managed store handles for the blob manager |
| `netlify/lib/blob-list.ts` | List-response normalization helper |
| `netlify/lib/local-blobs.ts` | Filesystem blob fallback for local dev |
| `netlify/lib/admin-auth.ts` | GoTrue token verification + `ADMIN_EMAILS` allowlist check |
| `netlify/lib/artifacts.ts` | ArtifactReference type, blobKey construction/validation, byte read/reconciliation |
| `netlify/lib/artifact-index.ts` | Index/pointer key scheme + reference listing |
| `netlify/lib/artifact-upload.ts` | HMAC upload tokens, integrity-checked byte save, 5 MB default cap |
| `netlify/lib/artifact-url-ingest.ts` | SSRF-guarded save-from-URL fallback |
| `netlify/lib/publisher-artifact-upload-client.ts` | Inline-base64 → verified ArtifactReference conversion |
| `netlify/lib/image-validation.ts` | sharp-decode image validation (JPEG/PNG/WebP) |
| `netlify/lib/pdf-validation.ts` | `%PDF-` header validation |
| `netlify/lib/netlify-deploys.ts` | Netlify deploy receipt lookup/poll |
| `netlify/lib/opt-in-record.ts` | Opt-in record shape |
| `netlify/lib/crypto.ts` | Timing-safe compare etc. |

### Public site
| File | What it is |
|---|---|
| `src/pages/index.astro` | Homepage — fully hardcoded sections + own footer override |
| `src/navigation.ts` | headerData + footerData config objects (the entire nav/footer content source) |
| `src/components/widgets/Header.astro` | Nav renderer + hardcoded search overlay/engine + auth button |
| `src/components/widgets/Footer.astro` | Prop-driven footer widget |
| `src/pages/[...blog]/index.astro` | Single-post route (SinglePost + RelatedPosts) |
| `src/pages/[...blog]/[...page].astro` | Paginated "Library" listing |
| `src/pages/[...blog]/[category]/[...page].astro` | Category listing (frontmatter-derived) |
| `src/pages/[...blog]/[tag]/[...page].astro` | Tag listing (frontmatter-derived, noindex) |
| `src/pages/learn/topics/index.astro` | Topics index (grouped by post category at build) |
| `src/pages/learn/topics/[topicSlug].astro` | Per-topic listing |
| `src/pages/search.json.ts` | Prerendered search index endpoint |
| `src/pages/rss.xml.ts` | RSS feed |
| `src/pages/about.astro`, `start-here.astro`, `newsletter.astro`, `member-updates.astro`, `guides/free-guide.astro`, `thank-you.astro`, `contact.astro`, `solutions/shop-preview.astro`, `solutions/early-access.astro` | Real pages, all hardcoded markup (contact uses AstroWind widgets) |
| `src/pages/privacy.md`, `terms.md` | Markdown pages via MarkdownLayout |
| `src/pages/404.astro` | Hardcoded 404 |
| `src/pages/homes/*.astro`, `src/pages/landing/*.astro`, `src/pages/services.astro`, `src/pages/pricing.astro` | AstroWind template leftovers (unlinked) |
| `src/layouts/Layout.astro`, `PageLayout.astro`, `MarkdownLayout.astro`, `LandingLayout.astro` | Layout stack (LandingLayout is leftover) |
| `src/utils/blog.ts` | fetchPosts/normalization/static-path generators/published_time gate |
| `src/content/config.ts` | Post collection schema (glob over `src/data/post`; category/tags/author free strings) |
| `src/config.yaml` + `vendor/integration/*` | Site config + virtual-module injection (`astrowind:config`) |
| `src/components/CustomStyles.astro`, `src/components/Logo.astro` | Hardcoded design tokens / logo text |
| `src/components/common/NetlifyOptInCapture.astro` | Global form-submit mirror to save-opt-in |
| `src/utils/goTrueClient.ts`, `src/utils/netlifyIdentityLoader.ts`, `src/components/common/HeaderAuthButton.astro`, `LoginModal.astro` | Identity auth client stack |
| `public/decapcms/config.yml`, `index.html` | Vestigial Decap CMS (points at wrong content folder) |

### Docs, scripts, CI, MCP mirror
| File | What it is |
|---|---|
| `AGENTS.md` | Project agent rules; declares `netlify/functions/mcp.ts` as production MCP |
| `cc-brief.md` | Self-described unverified planning brief (correct on blobs-authoritative; block-type list doesn't match schema) |
| `docs/workflow-map.md` | published_time semantics + contract pointer (matches code) |
| `docs/mcp-final-agent-sequence.md` | final_article agent publish sequence (matches code) |
| `docs/agents/article-content-structure.md` | Body schema doc (drift: documents node kind `reference` not in zod) |
| `docs/agents/mcp-article-body-v1.md` | Publishing reads only article_body; markdown is generated (matches code) |
| `docs/agents/naming-convention.md` | Naming contract doc (matches `agents-naming.ts`) |
| `docs/agents/artifact-upload-paths.md` | Artifact upload paths + index key formats (matches code) |
| `docs/agents/pdf-tool-artifacts.md` | External pdf-tool service contract — **UNVERIFIED**, references endpoints not in this repo |
| `docs/agents/shop-layout.md` | Shop-preview layout notes |
| `mcp/save-json-blob-mcp/*` | Local stdio/HTTP MCP mirror forwarding to save-json-blob (test-only per AGENTS.md) |
| `scripts/agent-builder-publish-dry-run.mjs` | Legacy flat-markdown publish dry-run/POST tool |
| `scripts/validate-upload-images.mjs` | Build validator: decode uploads + cross-check .md image references exist |
| `.github/workflows/actions.yaml` | CI: build (Node 22/24) + astro check; tests commented out |
| `netlify.toml` | Netlify routing/config (routes `/mcp` per AGENTS.md) |

### Things not verifiable from source alone (flags)
- Live Netlify environment: values of `ADMIN_EMAILS`, `PUBLISH_SECRET`, `MCP_HTTP_AUTH_TOKEN` (unset = MCP transport auth open), `ANTHROPIC_API_KEY`, `OPENAI_*`, `GITHUB_CONTENT_TOKEN` — behavior branches on their presence.
- Whether Decap CMS (`/decapcms/`) is reachable/functional on the live site (git-gateway is a Netlify dashboard setting).
- The external `pdf-tool` Netlify service described in `docs/agents/pdf-tool-artifacts.md`.
- Actual contents of the live blob stores (drafts, locks, artifact indexes) — only their schemas/key formats are verifiable here.
