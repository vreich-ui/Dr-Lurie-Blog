# Editorial Workspace — Reviewed Roadmap

**What this is.** The master spec (`master-spec.md`) reviewed against the *verified* state of `vreich-ui/platform` and `vreich-ui/CMS-Agent` (full code audits + a live console session on the deployed admin), merged with the pre-existing bug register (`admin-plan.md`), and cut into milestone-sized prompts for **Sonnet** (`prompts` below and in `sonnet-prompts.md`).

**File map for this directory:**

| File | Role |
|---|---|
| `master-spec.md` | Product vision & design law. Project context for every run. |
| `roadmap.md` | This file — review verdict, corrections, execution order, milestone prompts M1–M4. |
| `admin-plan.md` | The verified bug & feature register (B1–B16, F1–F8) with evidence. |
| `sonnet-prompts.md` | Prompt pack P0–P6 from the bug-fix plan. M0 and the parallel tracks execute from here. |

---

## Part 1 — Review verdict on the master spec

**The spec is sound and unusually well-grounded — keep it as law.** Its factual claims were spot-checked against the clone and hold: `ObjectWorkspace` is chat-first at `3fr:2fr` (`ObjectWorkspace.tsx:697`); `reviewStateSchema.state` is `open | changes_requested | approved` with `publish_receipt` and `published_time` separate from release (`object-record-v1.ts:43-139`); `editorial_voice.v1` carries `audience, tone, cadence, lexicon, claim_policy, cta_policy, safety, frameworks[] + default_framework` (`editorial-voice-v1.ts:82-100`); `template.v1` is page-oriented; publish and Netlify release are already separate operations. The product model — object-first, permanent agent rail, controlled vocabulary, forms-as-exception, Draft→Approved→Published→Live — is the right destination, and the milestone discipline (M1 spatial model first, stop, evaluate) is exactly how to run a lower-cost model.

The corrections below are not disagreements with the vision. They are places where the spec's picture of the *current code* is too optimistic, or where it doesn't know about bugs we have already confirmed — several of which are load-bearing for this redesign.

## Part 2 — Corrections and amendments (each verified)

**C1 — A bug gate must precede Milestone 1.** The spec says "do not fix unrelated visual/content bugs during this task" — right instinct, wrong boundary, because four confirmed bugs are *not* unrelated:

- **B12 — there is no error boundary anywhere in the repo** (grep: 0 matches). The lens registry (§8) multiplies render surfaces; today one throwing lens blanks the entire admin because `AdminShell` is the chrome. The registry is not safe to build without per-lens boundaries.
- **B1 — `/admin/maintenance` crashes the app** (confirmed live: React #31; `blob-store.ts` returns `siteId` as `{envVar, present, redacted}`, the client type says `string`, `MaintenancePage.tsx:96` renders the object).
- **B3 — chat renders raw text**: `chat.tsx:194-199` is `<Bubble>{String(text)}</Bubble>` — no markdown, no `whitespace-pre-wrap`. The agent rail is the centerpiece of this redesign; it cannot ship on unreadable output.
- **B2 — Admins shows "0 members"** for a bootstrap Owner (`ADMIN_EMAILS` short-circuits before the store; the synthesized record is never persisted).

These are M0. They are small, already written up as prompts P0.1–P0.4, and everything after gets safer.

**C2 — "The chat thread already scrolls independently" is optimistic.** `ChatThread` has `overflow-y-auto`, but the height chain above it is broken: `Card` wraps children in a plain `<div className="px-5 py-4">` (`primitives.tsx:221`), so `ChatThread`'s `min-h-0 flex-1` is a child of a block, not a flex column, and `lg:max-h-[calc(100vh-14rem)]` sits on an `overflow: visible` element. **The agent rail must own its flex chain end-to-end and must not be built inside `Card`.** Use `dvh`, not `vh`. This is bug B5; fix it as part of building the rail, not before.

**C3 — "Tool calls visually quiet unless action/approval is required" does not exist and is new work.** `chat.tsx:422` renders a `ToolCallCard` for every non-hidden event; there is no flag, no collapse state. Result labels are raw snake_case (`get_contract finished`). Building the quiet-tools behavior means: collapse consecutive tool events into one activity line with the server's human `summary`; expandable step detail; **`ApprovalCard` never collapsed; `is_error` results never hidden**; a `TOOL_LABELS` map replacing raw tool names (shared later with the Guardrails rewrite).

**C4 — "Working on: \<focus\>" and approvals need one identity source, which doesn't exist.** Three notions of "who is signed in" are live at once: the admin top bar shows the raw localStorage email; the public header shows `email.split('@')[0]` and its "Account settings" item re-opens the login modal; Profile's `display_name` renders nowhere else (B7). Milestone 1's shell work must include `useCurrentUser()` (cached `fetchMe`) and a single account menu — otherwise the new shell inherits the old confusion.

**C5 — Conversations are not scoped per user.** `listChatDocs` returns *every* admin's chats; `created_by` is recorded but never filtered (B16). The moment conversations surface prominently in the new IA, this becomes a privacy bug. Filter **server-side** in the `list_chats` action during M1.

**C6 — Demoting the Agents hub makes a hidden override invisible-squared.** Autonomy resolves as `profileOverrides ?? governanceChatTools ?? default` (`tools.ts:578`) — **an agent profile's overrides silently beat the Guardrails page** (B10). The spec moves both the roster and Guardrails out of editor sight, which is correct — but the owner surface must then disclose the precedence, or an Owner sets "ask" and watches the tool run anyway with no visible cause. Handled in the owner track (P4.1).

**C7 — Status vocabulary maps cleanly onto verified fields; derive, don't persist.** Draft/Approved from `review.state` vs current revision; Published from `publish_receipt` / `published_time`; Live from comparing the receipt's commit against the latest *confirmed* production deploy (`release_to_production` / `deploy_status` exist on every tenant connector). The spec already says "derive where possible" — treat that as binding: no new persisted status field in M4 without a written justification.

**C8 — Model names are one demotion away, not zero.** "Site Agent (Claude)" / provider / model are UI strings from the profiles store rendered by `AgentChip` and the roster — moving them to the owner surface is a UI change only; the resolution chain (object → type → site default) stays. Cheap, but list it explicitly so M1 doesn't forget the chip inside the rail header.

**C9 — Routes are law in one file.** New primary destinations and aliases go through `packages/core/app/shell-routes.ts` (`SHELL_ROUTES` + `injectRoute`) — that is what guarantees every tenant gets them. Island entries in `packages/core/app/admin/*.ts` **must** import `@site/config/policy-bindings` before re-exporting (the hydration-order race is real; the guard test that should catch it is currently vacuous — fixed in M0/P0.4). The command palette derives from the `NAV` array (`AdminShell.tsx:207-216`), so the IA change updates it automatically — verify, don't rebuild.

**C10 — Execution model: Sonnet, milestone-scoped.** The spec's "master brief as context, one milestone per run" discipline is right and is exactly how the prompts below are cut. Each run: read `master-spec.md` + this file's relevant correction items → 10–20 line implementation note naming files → build → `npm run check` && `npm run test` → verify all three sites (`drlurie`, `fernwell`, `platform`) build → browser screenshots → **stop and report**. Multi-client discipline is absolute: everything lands in `packages/core/**`, nothing brand-specific in core, "Publication" identity comes from `getSiteIdentity()`.

## Part 3 — What the spec doesn't cover (parallel tracks, unchanged)

These stay on their own tracks from `sonnet-prompts.md`, sequenced around the milestones:

- **Track O — Owner surfaces:** P4.1 Guardrails human-facing rewrite + B10 disclosure; P4.2 Admins CRUD (+re-enable/remove/publisher-editor roles); P4.3 Profile enrichment; P4.4 Maintenance scale (B15); P1.3 Component kit into the shell (satisfies §17's "move, don't delete"). Run any time after M0; P4.1 pairs naturally with M4's simplification pass.
- **Track R — Article rendering:** P5.1 code blocks through all four gates; P5.2 shiki via a `code` theme axis; P5.3 the silently-dropped presentations (`callout/card/panel/faq/summary`) — these directly improve the Article lens; P5.4 theme contract stays agent-authorable (hard constraint per D4 in `admin-plan.md`).
- **Track C — CMS-Agent conductor conversation:** P6.1–P6.5 (different repo; structural; `awaiting_input`, input-bearing resume, prose runner mode, notification, actor identity). Independent of this UI work except that M1's rail is the surface it will eventually speak through.
- **Node-targeted chat (P3.1–P3.2):** unchanged, after M2 — the `run_workspace_node` tool and `node:<id>` chat kind slot into the rail without UI rework.

**Superseded from the earlier prompt pack:** P2.1 (ChatPanel) and P2.2 (activity line) are absorbed into M1's agent rail. P1.2 (sessions tree in the left nav) is superseded by the object-first model — its two real needs survive as: server-side chat scoping (C5, in M1) and a "waiting on you" approvals surface (M4 Release). P2.3's artifact cards move to M3 (candidates render in the object area per §14, which is better than chat attachments); composer attachments are deferred until after M3. P1.1's `Tree` primitive is still built, in M1, for the object browser. P1.4 is absorbed into M1 (C4).

## Part 4 — Execution order

| Milestone | Contents | Prompt |
|---|---|---|
| **M0 — Bug gate** | B1+B12 error boundaries & Maintenance fix; B3 markdown; B2 Admins; B14 guard test | `sonnet-prompts.md` P0.1–P0.4, unchanged |
| **M1 — Spatial model** | Spec §26 A–F + C2/C3/C4/C5/C8/C9 corrections: IA, Editorial root, object browser, object-first workspace, agent rail, Brand Voice lens, lens registry seed | M1 below |
| **M2 — Interaction** | Quick-context framework (§10), Add (§12), Save & Add Next (§11, one path end-to-end) | M2 below |
| **M2b — Learning Mode** | Candidate choice UI in rail + lens; preference events captured in the `dataset.export_preferences` pair shape; learning-mode governance toggle | M2b below |
| **M3 — Templates, Media, PDF** | Templates IA (§13), Media, PDF lens + PDF-tool bridge (§14), artifact candidate display | M3 below |
| **M4 — Status, Release, simplification** | Draft/Approved/Published/Live (§16), Release surface, retire Agents from primary nav (§13/17), simplification pass (Task 14), done-criteria walkthrough (§25) | M4 below |
| Track O / R / C | In parallel, from `sonnet-prompts.md` | P4.x+P1.3 / P5.x / P6.x |

Gate between milestones is the spec's own: screenshots against the principles, listed problems, explicit go before the next run.

---

## Part 5 — Milestone prompts for Sonnet

**Prepend to every prompt:**

> You are working in the `vreich-ui/platform` monorepo (Astro + React). Read `docs/admin-redesign/master-spec.md` (design law) and `docs/admin-redesign/roadmap.md` Part 2 (verified corrections) before anything else. The admin is shared by three clients — `drlurie`, `fernwell`, `platform` — via `packages/core/**`; nothing brand- or client-specific may land in core, and publication identity comes from `getSiteIdentity()`. Line numbers cited below were verified recently but may have drifted — find code by name if a number misses. Before coding, give a 10–20 line implementation note naming the files you expect to modify and the behaviors you will preserve. When finished: run `npm run check` and `npm run test`, confirm all three sites build, verify visually in the browser with screenshots, then STOP and report changed files, tests, screenshots, and anything intentionally deferred. Do not continue into the next milestone.

---

### M1 — The spatial model

Execute only Milestone 1 (spec §26 A–F), amended by corrections C2–C5, C8, C9. This is a recomposition of working machinery, not a rewrite: per-object chat creation, checkout/patch/checkin, validation, approval cards, write-refresh of previews, and locking all work today and must survive byte-for-byte in behavior.

**A. AdminShell IA** (`packages/core/admin/AdminShell.tsx`, `NAV` at :43-76; routes in `packages/core/app/shell-routes.ts`)

1. New primary groups: **Editorial** (default, `/admin`), **Templates**, **Media**, **Content**, **Release** (may be a stub destination this milestone). New **Settings / Platform** group (Owner-gated visibility): Guardrails, Admins, Profile, Maintenance, Component kit, Agents (owner diagnostics). `NavItem` gains `ownerOnly?: boolean`.
2. Add new route patterns in `shell-routes.ts`; keep every existing pattern as an alias or working owner route — no dead deep links. New island entries in `packages/core/app/admin/*.ts` must import `@site/config/policy-bindings` first (the hydration race is real — see the guard test fixed in M0).
3. The command palette derives from `NAV` (`AdminShell.tsx:207-216`) — verify it reflects the new IA.
4. **Identity (C4):** create `packages/core/lib/admin/use-current-user.ts` — cached, deduped `fetchMe` returning `{user, roles, loading, refresh}`, invalidated on `cms:login`/`cms:logout` and after `update_me`. Replace the top bar's raw email + logout icon (`AdminShell.tsx:284-292`) with one `DropdownMenu`: `Avatar` + `display_name || email` + role chip; menu = Profile, Settings (owner), divider, Sign out. Fix the public header's "Account settings" item (`HeaderAuthButton.astro:290`) to navigate to `/admin/profile` instead of re-opening the login modal, and label it `display_name || email local part`.

**B. Editorial root** (rework `packages/core/admin/AdminHome.tsx` per spec §5)

Sparse Publication Map: **Foundation** slots (Publication identity → the site object; Brand Voice → `editorial_voice`; Visual Identity → an aggregate view over theme + site brandTokens + logo, a *view model*, no new schema), each opening its workspace directly, missing ones showing a quiet Create that opens a scoped agent conversation; **Structure** (Pages, Navigation — summary counts, not every page); **Templates / Media / Content** as family summaries with counts. Reuse the existing inventory data the admin already fetches (`library-client` / `object_inventory`); add no backend endpoint unless something is truly missing — say so in the implementation note if it is. Stat cards and activity feed are demoted or removed per §17. Empty publication must still read as a starting point, not a dashboard of zeros.

**C. Object browser** (new, per spec §6)

A compact left-column browser used inside Editorial: grouped by family, semantic names via `objectTypeLabel` (`packages/core/lib/admin/display-name.ts`), search, small status marker, counts, expandable only where real hierarchy exists. **No object IDs, no created-by, no timestamp columns.** Build the small `Tree` primitive for it in `packages/core/admin/` (ARIA tree semantics, keyboard navigation, chevrons from `icons.tsx` — there is currently no tree/disclosure component in the kit) and add a KitGallery entry. Reuse the Cmd-K inventory/fuzzy infrastructure. ContentLibrary's table remains for owners.

**D. ObjectWorkspace layout** (`packages/core/admin/ObjectWorkspace.tsx`, grid at :697)

Convert chat-first `3fr:2fr` to: orientation/browser ~18–22% · **object dominant** ~50–58% · agent rail ~26–32%. Restrained header per §7: breadcrumb, human name, one status, one primary action, overflow `…` for Details / Activity / Raw data (owner) / Discard — the readiness `<details>` strip and the forms `Drawer` content move behind overflow. Preserve the auto-created per-object chat (`createObjectChat` on load), write-refresh (`writeStamp`), and lock banner behavior exactly.

**E. Agent rail** (recompose `chat.tsx` components; do not touch the `admin-agent-chat` protocol)

1. **Fix the scroll chain (C2/B5):** the rail is NOT built inside `Card` — `primitives.tsx:221` wraps children in a plain padded div that breaks the flex chain. Own it end-to-end: rail root `h-[calc(100dvh-<topbar>)] flex flex-col`; header `shrink-0`; `ChatThread` `flex-1 min-h-0 overflow-y-auto overscroll-contain`; composer `shrink-0`, sticky. Auto-scroll only when already near bottom; "Jump to latest" pill otherwise; no scroll jumps from the poll cycle (`chat.tsx:88-101`).
2. Header: `Publishing Agent` + `Working on: <focus>` (object display name; later a narrower focus target). **No model/provider names (C8)** — `AgentChip` and profile info move to the owner Agents surface.
3. **Quiet tools (C3):** collapse consecutive `tool_call`/`tool_result` events into one activity line using the server's `summary` (already human: "Read the content_item contract") with step count; expandable detail; collapsed by default, preference persisted. `ApprovalCard` always full-size inline; `is_error` results always break out visibly. Introduce a `TOOL_LABELS` map for result labels — no raw snake_case in the reading line.
4. Composer placeholder: `Ask for a change or describe what you need…`; Enter/Shift+Enter as today. Messages render through the `Markdown` component from M0; user messages stay plain text.
5. **Scope chats server-side (C5):** in the `list_chats` action (`admin-agent-chat.ts:251`), filter to the caller's `created_by` by default with an Owner-only include-all flag.

**F. Lens registry seed + Brand Voice lens** (per spec §8, minimal this milestone)

`ObjectLensRegistry`: type → lens component, defaulting to the current `ObjectPreview` rendering so nothing regresses. **Every lens mounts inside the M0 `ErrorBoundary`** — a broken lens degrades to a fallback card, never a blank workspace (C1/B12). Ship one real new lens: **Brand Voice** — digestible sections for `audience`, `tone`, `cadence`, lexicon (preferred/avoided language), `claim_policy`, `cta_policy`, `safety`, and `frameworks[]` with the `default_framework` marked (schema: `packages/core/schema/bodies/editorial-voice-v1.ts:82-100`). No raw JSON, no field dumps; the agent rail sits beside it for revisions.

**Acceptance** — spec §26 checkpoints plus: `/admin` shows the Publication Map on all three sites; an object page shows browser + dominant object + full-height rail with no nested scrollbars at 1280×800; a 6-tool-call run reads as one activity line + one formatted answer; an approval card is impossible to miss; Brand Voice renders as prose sections; legacy deep links (`/admin/agents`, `/admin/studio`, `/admin/content/<id>`) still resolve; a deliberately-thrown lens error shows a fallback card with the shell intact; a non-owner sees no Settings/Platform group and no other admin's conversations. Screenshots of `/admin`, Brand Voice, a page object, and an article object. **Stop after M1.**

---

### M2 — Interaction: quick context, Add, Save & Add Next

Execute spec §10–§12 on top of the M1 spatial model.

1. **`ObjectContextAction` framework** (§10): a declarative registry — `{id, label, appliesTo, choices?, buildContext, icon?, visible?}` — rendered as sparse chips above the composer. An action either sets structured context for the next turn, inserts concise natural language into the composer, or (only for unambiguous small instructions) sends after explicit confirmation. Never bypasses the agent, never patches fields directly. Unit-test every `buildContext`. **Banned vocabulary test:** no action label or generated text may contain internal strategy terms (`hook`, `agitation`, offer mechanics) — assert it.
2. Ship the **Section** action set first (Add CTA / Remove CTA / Add another item / Reduce items / More concise / More educational / More persuasive; `Items: − n +` only where the section's schema has a repeatable collection). Then PDF/image/newsletter sets ride with M3 when those lenses exist.
3. **Add** (§12): in parent contexts (Page → Add section; Navigation → Add item), Add establishes parent + type, opens a scoped creation conversation, asks the minimum question, and the agent creates via the governed `object_create`/patch path under existing approval semantics. No multi-field modals.
4. **Save & Add Next** (§11): one path completely — Page → section → Save & Add Next → new sibling section focused, parent context and rail retained, composer seeded with `What should this section accomplish?`. Respect existing checkout/checkin semantics; make creation idempotent on retry (test: no duplicate sibling). Generalize only after this path passes.

**Acceptance:** §24's quick-context and Save & Add Next suites; an editor adds three sections to a page in sequence without leaving the workspace or seeing an object ID. **Stop after M2.**

---

### M2b — Learning Mode: candidate choice as preference capture

**Why this exists.** The platform's agents learn from deltas, and the learning sink already exists in CMS-Agent: `dataset.export_preferences` exports **chosen/rejected pairs as DPO/ORPO-ready JSONL** (`src/agent/mcp/workspace/improvementTools.ts:148`), `dataset.finetune_readiness` gates the flywheel on pair counts (`:149`, thresholds `IMPROVEMENT_FINETUNE_MIN_PREFERENCE_PAIRS`), and `feedback.record` accepts `approve | reject | edit` with `editDiff`. Today decisive pairs come only from **automated pairwise trial verdicts** (`replay.ts:95-116` — champion vs challenger). This milestone adds the missing, higher-value source: **a human editor choosing between candidates**. This is a capture-UI + event-store task, not new learning infrastructure. Do not build training machinery in the platform repo.

**The interaction (fits the M1 rail + lens, per spec §3 "no chat-only workflow"):**

1. **Learning mode** is a governed toggle (Guardrails, Owner-set; off by default — candidates cost 2–3× generation). When on, the run's system prompt gains an instruction: for substantive generative turns (drafting/rewriting a focus target), produce 2–3 distinct candidates, each with a one-line self-description of how it differs; mechanical turns (lookups, validation, small patches) stay single-candidate.
2. **In the rail:** a compact `CandidateSet` card — "3 versions — pick the one that reads best" — with A/B/C chips and each candidate's one-line difference summary. It must stay small; the rail is a conversation, not a gallery.
3. **In the lens:** selecting A/B/C previews that candidate **full-size in the object area** with an A/B/C switcher and a diff-vs-current toggle. Candidates never auto-replace the preview mid-reading — switching is always an explicit click (calm-UI rule, spec §18). Keyboard: 1/2/3 to preview, Enter to pick.
4. **Picking:** the chosen candidate becomes the proposed patch and flows through the **existing approval semantics unchanged** — learning mode adds a choice step before the approval card, never a second write path. "None of these" is a first-class button (a rejection-of-all is also a signal) and asks the agent for a new round with the editor's reason.
5. **Post-pick edits are the strongest signal:** the approval card's edit-and-approve flow already captures human-edited args — record the delta between chosen candidate and what was finally approved.

**Capture (platform side, new but small):**

- A `preference-events` Netlify blob store (follow the `agent-chats` store pattern). Event shape — align field names with what `dataset.export_preferences` emits; verify its exact JSONL columns in the CMS-Agent repo before freezing:
  `{ event_id, at, site, chat_id, run_id, object_id, object_type, focus, prompt_context, candidates: [{candidate_id, content, self_description}], chosen_id | null, rejected_ids, none_chosen?: {reason}, post_edit_delta?, editor_email, profile_id, model }`
- One pick with 3 candidates yields **two pairs** (chosen>rejected₁, chosen>rejected₂); "none of these" yields rejections with no chosen — keep them, they are hard negatives.
- An **export action** (Owner, Maintenance/owner surface) producing JSONL in the `export_preferences` pair shape, so CMS-Agent-side tuning can ingest human pairs alongside trial pairs. Wiring a live forward to `feedback.record` for pipeline-born objects is a follow-up, not this milestone — but record `object_id` faithfully so the join is possible later.
- Editor identity comes from `useCurrentUser` (M1); events are Owner-readable only.

**Guardrails:** candidate content is the same governed patch material as any agent write — no new write authority. The learning-mode instruction addendum lives with the profile system prompt server-side, never client-side. No vendor/model names in the editor-facing UI (C8): the card says "3 versions", not which model made them.

**Acceptance:** with learning mode on, a substantive request yields 2–3 candidates; previewing switches the lens; picking produces a normal approval card; the event store holds correctly-shaped pairs including a none-of-these case and a post-edit delta; with learning mode off, behavior is byte-identical to M2; export produces valid JSONL. **Stop after M2b.**

---

### M3 — Templates, Media, and the PDF lens

Execute spec §13–§14.

1. **Discovery first, written down:** how each template family is actually stored — `template.v1` (page-oriented — do not widen it), `section_template.v1`, `theme.v1`, and PDF templates via the PDF-tool subsystem (`docs/agents/pdf-tool-storage-grant.md`; MCP: `list_pdf_templates`, `get_pdf_template`, `validate_pdf_template`, `publish_pdf_template`, `create_agent_artifact_job`, `get_agent_artifact_job_status`). Where Image standards or Newsletter templates have **no** governed representation, document the gap and propose the minimum model — do not jam them into `template.v1`, do not invent schemas silently.
2. **Templates IA:** editor-facing families (Articles, Pages, Sections, Images, PDFs, Newsletters) replacing Studio's schema taxonomy; each template workspace = visual representation + plain-language purpose (the recipe metadata trio — description/whenToUse/scope — already required to publish) + scoped agent rail + sparse context chips. `/admin/studio` aliases into this.
3. **PDF lens:** page thumbnails, selected page large, candidates central. When the agent manufactures a PDF/image: working state in the rail; **poll the existing job, never create duplicates**; on completion the candidate becomes the main preview with accept / try-another; candidate history secondary. **Never expose storage grants, PATs, blob store names, or raw job payloads** — all bridge calls stay server-side.
4. **Media:** family-grouped browsing (logos, product, editorial, illustrations, documents) over the existing artifact index; artifact cards (thumbnail/icon + name) — this supersedes the old "attachments in chat" item; results display in the object area per §14.

**Acceptance:** template families browsable on all three sites with honest counts; the §25 PDF sequence (open template → see it prominently → request change → result appears in object area → approve) works end-to-end; a documented gap note exists for image/newsletter representation; no secret material reaches the client bundle. **Stop after M3.**

---

### M4 — Status, Release, retirement, simplification

Execute spec §16–§17 + Tasks 12–14, correction C7 binding.

1. **`getEditorialObjectState(record, deployState)`** → `draft | approved | published | live`, derived: Draft/Approved from `reviewStateSchema.state` (`open|changes_requested|approved`, `object-record-v1.ts:43`) against the current revision; Published from `publish_receipt`/`published_time` (`:96-103`); Live by comparing the receipt's commit/artifact set against the latest **confirmed** production deploy (investigate `release_to_production` + `deploy_status` responses first). No new persisted status field without written justification. Unit-test all four states plus stalled-deploy.
2. **Release surface:** `N published changes waiting to go live`, batch release action (existing release verb), deploy progress, failed/stalled build state. Publish never triggers a Netlify build (already true — keep it true). This is also the "waiting on you" home: pending approvals surface here.
3. **Retire Agents as a primary destination** (Task 13): remove from primary nav (owner Settings keeps it for diagnostics); starters and roster capabilities live on objects now. Object chats deep-link to the object workspace.
4. **Simplification pass** (Task 14): audit every visible control against §20/§21; remove what fails; run the §25 done-criteria walkthrough on all three sites and file what fails as the next round's register.

**Acceptance:** the four states render truthfully (including published-but-not-live); batch release of several published objects works with one build; §25 walkthrough recorded with screenshots; every §17 removal either done or moved to an owner surface. **Stop and report.**

---

## Part 6 — Codex model & effort allocation

Rules of thumb behind the table: **Sol + high** where a run makes decisions that are expensive to reverse (schema versioning, data models, cross-cutting layout architecture) or where a subtle wrong answer looks right (status derivation, auth). **Terra + high** for bounded-but-careful implementation against a precise spec. **Terra + medium** for well-specified single-surface work. **Luna** only for mechanical work with a strong acceptance test. Every run starts with the 10–20 line implementation note — read it before letting the run continue; a wrong note at Luna prices is cheaper than a wrong implementation at Sol prices.

| Run | Model | Effort | Why |
|---|---|---|---|
| P0.1 error boundary + Maintenance fix | Terra | high | Small but touches every island; the type-derivation decision matters |
| P0.2 markdown + prose styles | Terra | medium | Bounded; security notes (no raw HTML) are spelled out |
| P0.3 Admins "0 members" | Terra | high | Auth-adjacent; precedence rules must not shift |
| P0.4 guard test | Luna | medium | Mechanical; acceptance test is self-checking |
| **M1 spatial model** | **Sol** | **high** | The architectural run of the project; everything after builds on it. If splitting: A+B+C (shell/root/browser) Terra high, D+E+F (workspace/rail/lenses) Sol high |
| M2 quick context + Save & Add Next | Terra | high | Framework design + idempotency against object verbs |
| M2b learning mode | Terra | high | New event store + UI; pair shape must match the export format exactly |
| M3 templates/media/PDF | Terra | high | Discovery-heavy, integration across the PDF-tool bridge; secrets must stay server-side |
| M4 status/release | Sol | high | `getEditorialObjectState` is subtle — published-vs-live comparison is easy to get plausibly wrong |
| M4 retirement + simplification pass | Terra | medium | Judgment against a written checklist |
| P4.1 Guardrails rewrite + B10 | Terra | medium | Copy + one disclosure feature |
| P4.2 Admins CRUD + roles | Terra | high | Authorization changes; last-owner guards |
| P4.3 Profile | Luna | medium | Wiring existing endpoints; clear accept criteria |
| P4.4 Maintenance scale | Terra | medium | Performance work with measurable targets |
| P3.1 CMS-Agent MCP client + node tool | Terra | high | Server-side auth boundary; latency handling |
| P3.2 `node:` chat kind | Terra | medium | Follows the pattern P3.1 establishes |
| P5.1 code blocks (4 gates) | Sol | high | Schema versioning decision + threaded change; structure-aware `<br/>` fix |
| P5.2 shiki + code axis | Terra | medium | Follows an existing axis pattern exactly |
| P5.3 dropped presentations | Terra | medium | Renderer + CSS from tokens |
| P5.4 theme contract | Terra | medium | Audit + error-message quality |
| P6.1 run turn structure | Sol | high | Data-model change in a CAS-persisted record; migration |
| P6.2 input-bearing resume | Terra | high | Fix the dropped-`dependencies` bug carefully; idempotency |
| P6.3 prose runner mode | Sol | high | Must not weaken schema enforcement for autonomous nodes |
| P6.4 notification/waiting list | Terra | medium | Cheapest-thing-that-works, contract written down |
| P6.5 actor identity | Terra | high | Threading a type through many call sites without semantic drift |

## Part 7 — Reconciliation: earlier prompt pack → this roadmap

| Old | Disposition |
|---|---|
| P0.1–P0.4 | **M0, unchanged** — run first |
| P1.1 Tree primitive | Folded into M1-C |
| P1.2 Sessions tree in nav | Superseded; survives as C5 scoping (M1) + Release "waiting on you" (M4) |
| P1.3 Component kit into shell | Track O, unchanged (satisfies §17) |
| P1.4 Identity | Folded into M1-A |
| P2.1 ChatPanel | Folded into M1-E |
| P2.2 Activity line | Folded into M1-E |
| P2.3 Attachments/artifact cards | Artifact cards → M3; composer attachments deferred post-M3 |
| P3.1–P3.2 Node chat | Unchanged, after M2 |
| P4.1–P4.4 Owner surfaces | Track O, unchanged; P4.1 pairs with M4 |
| P5.1–P5.4 Rendering | Track R, unchanged; improves the Article lens |
| P6.1–P6.5 Conductor | Track C, unchanged (CMS-Agent repo) |
