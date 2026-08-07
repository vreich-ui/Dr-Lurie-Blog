# Platform Admin — Bug & UI Register, Architecture Decisions, Resolution Plan

**Scope:** `github.com/vreich-ui/platform` (Astro + React monorepo). Every fix lands in `packages/core/**` so it reaches **drlurie, fernwell and platform** alike. Per-client variation is only ever allowed through `sites/<client>/config` and the brand-token system — never a hardcoded brand string, colour or copy in core.

**Investigated:** `packages/core/admin`, `packages/core/server`, `packages/core/lib`, `packages/core/schema`, `packages/core/app`, plus `github.com/vreich-ui/CMS-Agent` and a live console/network read of `drluriescience.netlify.app/admin/maintenance`.

---

## Part 1 — What is actually true today

Three findings change the shape of the plan. Read these before the register.

### 1.1 The admin chat is not connected to CMS-Agent at all

The agent chat you are using is **entirely home-grown inside `platform`**:

- UI: `packages/core/admin/chat.tsx` (`ChatThread`, `ChatComposer`, `ToolCallCard`, `ApprovalCard`)
- API: `packages/core/server/functions/admin-agent-chat.ts` (verb-dispatched, 10 actions)
- Runner: `packages/core/server/functions/admin-agent-chat-run-background.ts`
- Model call: `packages/core/server/lib/agent/provider.ts` — **direct `@anthropic-ai/sdk` / `openai` SDK calls**
- Tools: `packages/core/server/lib/agent/tools.ts` — 18 CMS tools with autonomy classes and approval gating
- Storage: Netlify Blobs, store `agent-chats`, one doc per chat

There is **no MCP hop to CMS-Agent anywhere in this path**. "Site Agent (Claude)" and "Site Agent (GPT)" are just two rows in `packages/core/server/lib/agent/profiles.ts` — a provider + a model string + a system prompt.

So your instinct was right that you are talking to a generic model — but the reason the tool steps are visible is *not* that it's generic. It's that `ToolCallCard` (`chat.tsx:215`) renders every tool event unconditionally, with no collapse. There is no flag to hide them.

### 1.2 CMS-Agent cannot host a chat today

This is the finding that most affects your plan. In `CMS-Agent`:

- **No conversation entity.** No chat, thread, message, or turn — server or UI. 100+ MCP tools, none of them conversational.
- **`node_execute` is one-shot and `.strict()`.** Input is `{nodeId, input, runId, dependencyOutputs, executionMode, modelConfig, expectedWorkspaceVersion}`. Adding a `messages` key would be *rejected*, not ignored. Each execution builds a single fresh user message (`AnthropicNodeRunner.ts:90`).
- **Every node is forced to emit JSON.** `if (!node.outputSchema) errors.push("outputSchema is required")` and `tool_choice: {type:'tool', name:'emit_output'}`. A node cannot reply in prose.
- **Streaming is explicitly refused.** `GET /mcp` → HTTP 405, "This MCP endpoint does not offer a GET SSE stream." Executions run 1–5 minutes.
- **The only "talk to a node" UI is a JSON textarea** — `ui/src/components/NodeConsole.tsx`, 84 lines, output rendered as `<pre>{JSON.stringify(...)}</pre>`.

### 1.3 LibreChat is not code you can reuse

`CMS-Agent/deploy/librechat/` is **eleven deployment files** — a Caddyfile, a docker-compose, a `librechat.yaml`. No LibreChat source, no fork, no npm dependency. Its own README: *"LibreChat here is a consumer of the MCP servers — it does not replace, wrap, or re-implement any engine."*

And what it gives you is precisely what you said you don't want: a **generic Anthropic/OpenAI model that calls `workspace_*` tools**. Adopting it would be a large, self-hosted, MongoDB-backed dependency to obtain the exact architecture you're trying to move away from. CMS-Agent's own `docs/plan/GUI-PLAN.md:14` already reached this conclusion.

**Recommendation: do not adopt LibreChat.** Keep your own chat loop — it is genuinely better than LibreChat's for this job (per-object chats, approval cards with dry-run diffs, per-tool autonomy, governance-resolved permissions). Fix its *presentation*, and add node addressing as a capability rather than a replacement.

### 1.4 "Can I just edit conductor mode to talk to a human editor?"

Short answer: **no, and a node will not do it either.** The gap is structural, not a missing node. But it is bounded, and every piece has a name. Here is what I found.

**The conductor is not an agent and has no prompt to edit.** The word means three things in the repo:

- `publishing_conductor` — a workflow **id** string (`executor.ts:20`).
- `conductor.ts` — 206 lines of **cost control**: `RunScopedCache`, `summarizeRunCost`, `planRun`. Its own header says so. No model, no prompt, no execution.
- The real orchestrator is **`advanceRun`** (`executor.ts:582`) — a deterministic TypeScript DAG stepper. `findNextRunnableNode` picks the first queued node whose dependencies are complete, dispatches it, CAS-persists state. One node per call.

So there is no "conductor mode" prompt to open and teach conversational manners. It is a state machine.

**And a conversational node cannot work, for four reasons enforced outside any node definition:**

1. **No suspend point.** `executeRunnableNode` (`executor.ts:686-930`) is straight-line: dispatch, validate, `status = 'completed'`. A "ask the editor" node would have to block for hours inside a 120-second default timeout, in a batch Cloud Run job.
2. **Output must be JSON or the run fails.** `executor.ts:893-908` sets `errors = ['output_schema_violation']` and `run.status = 'failed'`. Both runners force it — `OpenAINodeRunner.ts:104` requires `outputSchema`; `AnthropicNodeRunner.ts:91-92` pins `tool_choice: {type:'tool', name:'emit_output'}`. Conversation is not schema-shaped.
3. **No channel for a human reply to reach a node.** Node input comes only from `initialInput` + upstream `stageOutputs` (`executor.ts:716`). The one parameter shaped like mid-flight input — `workflow.run_node`'s `dependencies` (`tools.ts:120`, `:208`) — is **parsed and then silently dropped**; the handler at `:480` never reads it. That is a latent bug worth fixing regardless.
4. **Store mode cannot add nodes.** `executor.ts:222-227`: new nodes, changed edges and changed risk levels reach a run only via `npm run nodes:update` **plus a redeploy**. So even the node route is not an MCP edit.

**What genuinely exists as human-in-the-loop:** the publish gate. A `publish`/`admin` risk node with `approved !== true` goes `blocked`, mints one `ApprovalRequired`, and resumes via `retryNode(..., {approved: true})`. That skeleton works — and it carries **exactly one bit** of human information. `ApprovalRequired` (`executionTypes.ts:49-55`) has no response side at all: no answer, no answered-by, no timestamp. `resume_run` accepts `{runId, budgetUsd}` and nothing else.

Everything else that sounds human is not. `human_texture` and "Human Texture Editor" (`nodes.ts:934`) are LLM review nodes. `feedback.record` is a post-hoc learning corpus write that no run reads. The callback-based human-in-the-loop line in `DIRECTION.md:70` describes a Google product under evaluation, not shipped code.

**Actor identity exists but never reaches a run.** `WorkspaceActor` (`changeTypes.ts:13-19`, kinds `human|agent|system`) is stamped by the secure proxy and threaded into workspace *edit* history. `WorkflowExecutionRecord` has no actor field; `ApprovalRequired` has no actor field; `approved` is an unattributed boolean. A run knows which **client** it serves and nothing about which **person** started it, approved it, or is waiting on it.

**So the honest work list for a real conversation with the conductor** — five items, each with a named file:

| # | Gap | Where |
|---|---|---|
| 1 | No `awaiting_input` status; no message/turn structure on a run; `ApprovalRequired` has no response side | `executionTypes.ts` |
| 2 | No input-bearing resume; `run_node.dependencies` accepted and dropped | `mcp/workspace/tools.ts`, `executor.ts:939` |
| 3 | No prose output, no message history — every dispatch builds a one-shot prompt | `OpenAINodeRunner.ts`, `AnthropicNodeRunner.ts` |
| 4 | No streaming, no notification — a hold is logged and the job exits 0 | nothing exists today |
| 5 | Approvals are anonymous; actor never reaches the run | `executor.ts:419`, `executionTypes.ts` |

That is Phase 6, with prompts. It is real work but it is finite, and none of it is speculative.

**Two watch-outs while you are in there:** `ExecutionRepository` has no append operation — every write is a whole-record CAS `saveRun`, so per-message appends will contend on the run lock. And `TERMINAL_STATUSES` is hardcoded in **two places that already disagree** (`executor.ts:94` includes `paused`, `runConductorJob.ts:18` does not).

---

## Part 2 — Architecture decisions

### D1 — Chat: keep the loop, replace the window, add node targeting

Three layers, shipped in order:

**Layer 1 — the window (Phase 2).** Extract chat out of the page grid into a `ChatPanel` primitive: a docked, full-viewport-height right rail with an independent scroll region and a sticky composer, plus a slide-over variant. Claude-app styling: assistant text flat on the surface (no bubble), user text in a soft right-aligned block, tool activity collapsed into one line.

**Layer 2 — node addressing (Phase 3).** Add a `run_workspace_node` tool to the *existing* 18-tool catalog in `tools.ts`, backed by a small MCP client that speaks to CMS-Agent's `/mcp` endpoint server-side. Add a third chat kind alongside `free` and `obj:` — `node:<nodeId>` — where the system prompt is seeded from `node_get_effective_prompt` and the chat is pinned to that node. The editor then genuinely talks *to* a node, with your approval gates intact, without CMS-Agent needing a conversation model.

**Layer 3 — real conversations with the conductor (Phase 6).** The five-item work list in §1.4: an `awaiting_input` status and turn structure, an input-bearing resume, a prose-capable runner mode, a notification path, and actor identity on runs. This is a CMS-Agent change, not a platform change.

**Why still do Layer 2 first, even though Layer 3 is the thing you actually want.** Layer 2 is not throwaway. The chat window, the collapsed activity line, the approval cards and the conversation tree are the *same* surface Layer 3 will be driven through — Phase 6 changes what is on the other end of the pipe, not the pipe. And Layer 2 will teach you concretely what an editor asks a node, which is the input you need to design the turn structure well rather than guess at it. Doing them in this order costs nothing and de-risks the structural change.

**Auth note:** CMS-Agent's browser path hands a *workspace-wide bearer* to the browser (`ui/src/mcp/client.ts:28`). Never do that here. The MCP client lives in the Netlify function; the browser only ever talks to `admin-agent-chat`.

### D2 — One identity source for the whole admin

Today there are three: `localStorage` GoTrue email (admin top bar), `email.split('@')[0]` (public header), and `UserRecord.display_name` (Profile + Admins table only). Introduce `useCurrentUser()` in `packages/core/lib/admin/` — a cached `fetchMe` — and make every surface read from it.

### D3 — Guardrails: human sentence first, machine key behind a disclosure

Every control gets a plain-language title, a one-sentence "what this does", and a `<details>Technical</details>` holding the raw key, enum values and tool name. Nothing machine-shaped stays in the primary reading line.

### D4 — Richer body rendering stays token-driven, and themes stay agent-authorable

Code blocks and callouts must render from the site's brand tokens and theme axes, never from a hardcoded Claude palette. Add a `code` axis to `THEME_AXES` (`packages/core/lib/registry/theme-tokens.ts`) so each client's code styling is a bounded, per-site choice.

**Agents must be able to create and edit themes per client over MCP — this is a hard constraint on every theme change, not a nice-to-have.** Themes are already `theme.v1` objects reachable through the standard object verbs on each client's connector (`object_contract`, `object_create`, `object_patch`, `object_validate`) plus `site_apply_theme`. That must stay true as the token vocabulary grows. Concretely, any new axis or token key must satisfy all five:

1. **Self-describing in the contract.** `object_contract` for `theme` is how an agent learns the shape — it is the same `get_contract` the chat agent calls. A new axis that is not enumerated there, with its allowed values and a human sentence per value, is invisible to every agent. Adding the axis to `THEME_AXES` without adding it to the contract is a half-change.
2. **Bounded enums, never free-form.** Follow the existing pattern exactly: each axis value maps to a **pre-built** CSS-var set, so user or agent input is never echoed into CSS. The injection guards (`HARD_FLOOR_RE`, `COLOR_VALUE_RE`, `FONT_STACK_RE`) stay in force. An agent that can write arbitrary CSS values is a stylesheet-injection vector.
3. **Validation errors that teach.** `object_validate` must reject an unknown axis value by **naming the allowed values**. An agent's only feedback loop is the error string — "Invalid theme" teaches it nothing and burns a turn, which is exactly the react-pdf failure mode in your own screenshot.
4. **Dry-run diff preserved.** `site_apply_theme` supports `dry_run` and computes an exact-token diff, including unsetting keys the theme lacks. A new axis must participate in that diff so the approval card still shows the truth. Note the totality gate: a theme missing any consumed colour key is rejected 422 rather than silently deleting it.
5. **Defaults stay byte-identical.** `resolveAxisVars` emits nothing for a default axis. A site that never sets `code` must render exactly as it does today.

The theme system is one of the few places an agent already has genuine creative latitude within safe bounds. Widening the vocabulary without widening the contract would quietly take that away.

---

## Part 3 — Register

Severity: **S1** blocks a workflow · **S2** materially degrades it · **S3** polish/debt.

### Confirmed bugs

| ID | Sev | Issue | Root cause (verified) |
|---|---|---|---|
| **B1** | S1 | `/admin/maintenance` paints then goes blank | **Confirmed live.** `blob-store.ts:60-66` returns `siteId` as an **object** `{envVar, present, redacted}`. The client interface `StoreDiagnostic` (`maintenance-client.ts:33-39`) declares `siteId: string` — a hand-written lie with no runtime validation. `MaintenancePage.tsx:96` renders `site: {diag.siteId \|\| '(none)'}` → React error #31, *"Objects are not valid as a React child (found: object with keys {envVar, present, redacted})"*. Console shows 4 render retries then an uncaught exception. |
| **B12** | S1 | Any render throw blanks the entire admin | `grep -rn "componentDidCatch\|ErrorBoundary\|getDerivedStateFromError"` → **0 matches repo-wide**. `AdminShell` *is* the page chrome, so one bad child takes the nav, header and content with it. B1 is only visible-as-blank because of B12. |
| **B2** | S1 | Admins shows "0 members" though you are Owner | `roles.ts:92` — an `ADMIN_EMAILS` bootstrap owner **short-circuits before the store is read** and therefore never gets a stored record. `admin-users.ts:118` builds a `synthesizedRecord` **in memory and never persists it**. `list` (`users-store.ts:82`) reads only persisted `by-email/` blobs. So "0" is accurate about the store and wrong about reality. |
| **B3** | S2 | AI output is an unreadable wall | `chat.tsx:194-199` — `<Bubble>{String(event.detail?.text ?? '')}</Bubble>`. No markdown renderer, no `whitespace-pre-wrap`. `**Topic**` prints literally; every newline collapses. No markdown library is a dependency. |
| **B4** | S2 | Every tool step shown as its own row | `chat.tsx:422` falls through to `ToolCallCard` for all non-hidden events. `HIDDEN_EVENTS` is only `{run_started, events_trimmed}`. No prop, no state, no toggle exists. |
| **B5** | S2 | Chat area is short and scrolls wrong | `Card` wraps children in a plain `<div className="px-5 py-4">` (`primitives.tsx:221`), so `ChatThread`'s `min-h-0 flex-1` (`chat.tsx:398`) is a child of a block, not a flex column. The `lg:max-h-[calc(100vh-14rem)]` sits on an `overflow: visible` element. |
| **B6** | S2 | Recent sessions unreachable | It is a `Card` at the bottom of the **left column** of `/admin/agents`, below the roster — below the fold. Not in the nav. `list_chats` already exists and returns everything sorted by `updated_at` with `object_type`, so the data for a tree is there today. |
| **B7** | S2 | Name/account/logout incoherent | Admin bar: raw email + `Avatar name={email}` (which yields one initial from the whole string) + a bare logout icon (`AdminShell.tsx:284-292`). Public header: an "Account" dropdown showing `email.split('@')[0]`, whose **"Account settings" item re-opens the login modal** instead of going to `/admin/profile` (`HeaderAuthButton.astro:290`). `display_name` saved on Profile appears in **neither** header. |
| **B8** | S2 | Component kit loses the left nav | It is the **only** admin route not on `AdminLayout`. `kit.astro` uses `PageLayout` + the public Header/Footer, and `KitGallery` never renders `AdminShell`. |
| **B10** | S2 | Guardrails silently overridden | `tools.ts:578` — precedence is `profileOverrides ?? governanceChatTools ?? default`. **An agent profile's `tool_autonomy_overrides` beats the Guardrails page**, and the UI says nothing about it. An Owner can set a tool to "ask" and watch it run anyway. |
| **B15** | S2 | Maintenance will not scale past B1 | `MaintenancePage.tsx:158-167` fires **one POST per key**, unbatched, up to `MAX_LISTED_KEYS = 10_000`, each resolution doing a full-array `map` → O(n²) re-renders. `DataTable` is unvirtualized with 4 buttons per row. The effect at `:191-195` reads `owner`, `store`, `refreshBlobs` but lists only `[search]`, so it never fires on the `owner: null → true` transition. |
| **B13** | S3 | Kit page duplicates the auth gate | ~120 lines of the `AdminLayout` gate re-implemented inline in `kit.astro`. Two copies of a security-adjacent flow. |
| **B14** | S3 | The binding guard test is vacuous | `tests/scripts/client-scripts-site-bindings.test.mjs` walks `join(ROOT,'src')` for `*.astro` — that directory has **0 astro files** since routes moved to `packages/core/app`. It also matches `'~/config/policy-bindings'` while live code imports `'@site/config/policy-bindings'`. The guard passes because it inspects nothing. |
| **B16** | S3 | Chat list is not scoped per user | `listChatDocs` returns every chat in the store; `created_by` is recorded but never filtered. Any admin sees everyone's conversations. |

### Machine terminology leaking to users (B9, S2)

`GovernancePage.tsx`, complete list:

- `:462-467` — **raw snake_case tool names in `<code>` as the primary row label**: `get_object`, `get_contract`, `list_objects`, `inventory`, `validate`, `search_artifacts`, `checkout`, `patch`, `checkin`, `refresh_lock`, `create_object`, `create_variant`, `instantiate_template`, `instantiate_section_template`, `submit_review`, `publish`, `discard`, `apply_theme`. The human description is **tooltip-only**.
- `:478` — `Default (${tool.default})` renders literally as "Default (ask)".
- `:430` — card title "Per-tool autonomy (auto / ask / off)" — three enum values in a heading.
- `:137, :215, :279, :322, :431` — "Runtime override" / "Committed default" / "Class defaults": internal provenance vocabulary as user-facing badges.
- `:148` — "Master switch"; `:152-154`, `:182-184` — enum values re-spaced into labels.
- `:143` — "the disaster fallback"; `:220` — "The creation matrix editor lands alongside the studio" (roadmap language shipped to users).
- `:284` — `<code>{trackingProjectId}</code>`, a raw `trk_*` id mid-sentence.
- `:299` — badge "Pinned" (override-vs-master jargon).
- `:317-321` — raw agent names joined: *"agent creation is limited to X, Y (the seed driver)"*.
- Adjacent: `ObjectPreview.tsx:276` renders `target.kind` raw; `primitives.tsx:180` falls back to `status.replace(/_/g,' ')`.

Also: **Card 3 (Creation policy) has zero controls** — it is a paragraph. The policy *is* enforced (`creation-policy.ts:89`), just not editable.

### Missing features

| ID | Sev | Feature | Current state |
|---|---|---|---|
| **F1** | S2 | Chat as a proper docked window | Inline grid column; see B5. |
| **F2** | S2 | Attachments / artifacts in chat | Nothing. `send` is `{action, chat_id, text}`; the transcript type is text-only; providers get no image blocks. Upload endpoints (`admin-artifact-upload-intent`, `artifact-upload`, `save-artifact`) exist and are unused by chat. `search_artifacts` returns refs that render as a one-line "finished" row. |
| **F3** | S2 | Chat to a workspace node | Does not exist on either side. See §1.2 and D1. |
| **F4** | S2 | Admins CRUD | Have: `me`, `update_me`, `list`, `invite`, `set_role`, `disable`. **Missing:** remove, re-enable (disable is terminal via UI), resend invite, search/pagination. `publisher`/`editor` roles **exist and are enforced** (`canExecutePublish`, `canDecideReview`) but `userRoleSchema` is `owner\|admin` only — they can only be granted by env var. |
| **F5** | S2 | Profile depth | `display_name` saves. **Avatar:** server accepts `avatar_artifact` (sha-pinned, `admin-users.ts:31`) but no UI calls it. **Timezone:** uncontrolled `defaultValue="auto"`, hint says "Placeholder". **Notify switch:** local `useState`, never sent. |
| **F6** | S2 | Code blocks & richer body | Effective article vocabulary is exactly: `p, h2, h3, ul, ol, li, blockquote, link, bold, italic, inline-code`. Fenced code is rejected at **four** gates: `from-markdown.ts:208` throws, `rich-text-v1.ts` has no member, `object-validate.ts:2444` grammar excludes it and `:263` `RICHTEXT_ALLOWED_TAGS` has no `pre`, `prosemirror.ts:219` has no mapping. No highlighter is a direct dependency (`shiki` exists only transitively via Astro, for `.md` only). |
| **F7** | S3 | Callouts / pull-quotes silently dropped | `article-content-v1.ts:96-111` accepts `callout, card, panel, faq, summary` for `rendering.presentation`. `render-nodes.ts:248-259` reads **only** `offerInline` / `offerCard`. Everything else validates and renders as a plain paragraph. A pull-quote style exists but only as a *page section* (`Testimonial.astro:27`), unreachable from an article body. |
| **F8** | S2 | Session tree in the nav | `NavItem` has no `children`; `NavList` is a flat two-level map. **No tree, accordion or disclosure component is exported** from the admin kit. `NavItemTree` (`ObjectPreview.tsx:262`) is module-private and always-expanded. Chevron icons already exist in `icons.tsx`. |

---

## Part 4 — Answering your Component kit question

**What it is:** a design-system reference page. `KitGallery.tsx` (571 lines) renders every admin primitive in every state with a light/dark toggle. It is not part of the AI admin and has no CMS actions.

**Why it loses the nav:** it is the only admin route on `PageLayout` instead of `AdminLayout`, and `KitGallery` never wraps itself in `AdminShell` — so you get the public site header and no sidebar.

**What it should become — three actions:**

1. **Move it onto `AdminLayout` + `AdminShell`** (B8). One-line route change plus a shell wrapper. This also deletes the duplicated auth gate (B13).
2. **Demote it out of the primary nav** into the `Settings` group, Owner-visible only. It is a developer surface; it does not deserve rank alongside Content and Agents.
3. **Make it the acceptance surface for this whole plan.** Every new primitive — `Tree`, `Markdown`, `ChatPanel`, `ActivityLine`, `CodeBlock` — gets a state-complete entry there before it ships into a page. That turns a dead reference page into the place you review UI work without hunting for a real object in the right state.

---

## Part 5 — Sequencing

Each phase is independently shippable. Prompts in `sonnet-prompts.md` are numbered to match.

**Phase 0 — Stop the bleeding (do these first, they are small)**

| # | Work | IDs |
|---|---|---|
| P0.1 | Error boundary around every admin island + Maintenance diagnostics shape fix | B1, B12 |
| P0.2 | Chat text normalization — markdown renderer + prose styles + system-prompt tightening | B3 |
| P0.3 | Admins "0 members" — persist bootstrap owners, merge env owners as read-only rows | B2 |
| P0.4 | Restore the binding guard test to scan the real directory | B14 |

**Phase 1 — Shell & navigation**

| # | Work | IDs |
|---|---|---|
| P1.1 | `Tree` primitive in the admin kit + KitGallery entry | F8 |
| P1.2 | Recent sessions as a grouped tree in the left nav | B6, F8, B16 |
| P1.3 | Component kit onto AdminShell, demoted, gate deduped | B8, B13 |
| P1.4 | Unified identity — `useCurrentUser`, account menu, public header fix | B7, D2 |

**Phase 2 — The chat window**

| # | Work | IDs |
|---|---|---|
| P2.1 | `ChatPanel` — docked, full-height, correct scroll chain, Claude styling | B5, F1 |
| P2.2 | Collapse tool steps into one activity line with expandable detail | B4 |
| P2.3 | Attachments + artifact cards in chat | F2 |

**Phase 3 — Node-targeted chat**

| # | Work | IDs |
|---|---|---|
| P3.1 | Server-side CMS-Agent MCP client + `run_workspace_node` tool | F3 |
| P3.2 | `node:<id>` chat kind, node picker, prompt seeding | F3 |

**Phase 4 — Settings surfaces**

| # | Work | IDs |
|---|---|---|
| P4.1 | Guardrails human-facing rewrite + surface the profile-override precedence | B9, B10 |
| P4.2 | Admins full CRUD + publisher/editor roles | F4 |
| P4.3 | Profile enrichment | F5 |
| P4.4 | Maintenance performance and pagination | B15 |

**Phase 5 — Richer body rendering**

| # | Work | IDs |
|---|---|---|
| P5.1 | `code_block` through schema → grammar → validator → markdown → ProseMirror → renderer | F6 |
| P5.2 | Shiki highlighting driven by a new `code` theme axis | F6, D4 |
| P5.3 | Implement `callout`, `card`, `panel`, `faq`, `summary` presentations | F7 |
| P5.4 | Theme contract + agent authoring: make the widened vocabulary discoverable and safely writable over MCP | D4 |

**Phase 6 — Real conversation with the conductor (CMS-Agent repo)**

| # | Work | IDs |
|---|---|---|
| P6.1 | `awaiting_input` status, turn structure on the run, response side on `ApprovalRequired` | §1.4 gap 1 |
| P6.2 | Input-bearing resume; fix `run_node.dependencies` being silently dropped | §1.4 gap 2 |
| P6.3 | Prose-capable runner mode with message history | §1.4 gap 3 |
| P6.4 | Notification + delivery so a waiting run reaches a person | §1.4 gap 4 |
| P6.5 | Actor identity threaded onto runs and approvals | §1.4 gap 5 |

Phase 6 is the only phase in a different repo, and the only one with a structural data-model change. Do P6.5 early — retrofitting identity onto an audit trail after the fact is always worse.

---

## Part 6 — Standing constraints for every prompt

1. **Multi-client.** Changes land in `packages/core/**`. No brand string, colour, font or client name in core. Anything client-varying goes through `sites/<client>/config` or `brandTokens` / `THEME_AXES`.
2. **Verify all three sites build.** `drlurie`, `fernwell`, `platform`.
3. **Run `npm run check` and `npm run test`** before declaring done.
4. **No new runtime dependency without justification.** `@tailwindcss/typography` is already present; `shiki` is already in the lockfile transitively.
5. **Type lies are the enemy.** B1 happened because a hand-written client interface disagreed with the server and nothing validated at runtime. Where a client type mirrors a server shape, derive or zod-parse it.
6. **Owner-only stays owner-only.** Server re-checks are the boundary; UI gating is convenience.
