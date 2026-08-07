# Sonnet Prompts — Platform Admin Resolution

Paste one prompt per session. Each is self-contained: it names real files verified against the repo, states the constraint, and ends with acceptance criteria.

**Repo:** `github.com/vreich-ui/platform` · **Companion:** `admin-plan.md`

**Prepend this preamble to every prompt:**

> You are working in the `vreich-ui/platform` monorepo (Astro + React). The admin console is shared by three clients — `drlurie`, `fernwell`, `platform` — via `packages/core/**`. Any change you make must be client-neutral: no brand name, colour, font or copy specific to one client in core. Client variation goes through `sites/<client>/config` or the brand-token system. When you finish, run `npm run check` and `npm run test`, and confirm the build succeeds. Read the files named below before editing anything; if a stated line number has drifted, find the code by name rather than trusting the number.

---

# PHASE 0 — Stop the bleeding

## P0.1 — Fix the Maintenance page crash and add error boundaries

`/admin/maintenance` renders for a moment and then goes blank. **The root cause is confirmed**, not a hypothesis — a live console read shows:

```
Minified React error #31 — Objects are not valid as a React child
(found: object with keys {envVar, present, redacted})
```

Four render retries, then an uncaught exception.

**The bug.** `packages/core/server/lib/blob-store.ts:60-66` returns:

```ts
export type BlobStoreSourceDiagnostics = {
  storeName: string;
  source: BlobStoreSource;
  explicitApiConfigUsed: boolean;
  lambdaBlobContextUsed: boolean;
  siteId: { envVar: 'NETLIFY_SITE_ID' | 'SITE_ID' | undefined; present: boolean; redacted: string };
};
```

`packages/core/lib/admin/maintenance-client.ts:33-39` declares `siteId: string` — a hand-written interface that disagrees with the server and is never validated at runtime. `packages/core/admin/MaintenancePage.tsx:96` then does `site: {diag.siteId || '(none)'}`, rendering an object as a React child.

**Do three things.**

1. **Fix the shape.** Correct `StoreDiagnostic` in `maintenance-client.ts` to match `BlobStoreSourceDiagnostics`. Prefer importing/deriving the type from the server module over re-declaring it; if the module boundary forbids that, add a zod parse at the client edge so a future divergence fails loudly with a readable message instead of blanking the page. Update `DiagnosticsCard` to render the site id as `siteId.present ? siteId.redacted : '(none)'` and surface `siteId.envVar` in the same tile.

2. **Add an error boundary.** There is currently **no** `componentDidCatch` / `ErrorBoundary` / `getDerivedStateFromError` anywhere in the repo — confirmed by grep. Because `AdminShell` *is* the page chrome, one bad child blanks the whole console. Create `packages/core/admin/ErrorBoundary.tsx` exporting a class component that renders a card with the error message, the component name, and a "Reload" button, styled with the existing `--adm-*` tokens. Wrap:
   - the body inside `AdminShell` (so nav and top bar survive a page crash), and
   - each island entry in `packages/core/app/admin/*.ts`.
   Log the error to `console.error` with a stable prefix like `[admin]` so it is greppable.

3. **Audit for sibling bugs.** Search every admin component for other places a hand-written client interface mirrors a server type. Report what you find; fix any that are also rendering non-primitives.

**Acceptance:** `/admin/maintenance` fully renders on a signed-in Owner with no console errors. Deliberately throwing inside `MaintenanceBody` shows the boundary card with the nav intact, not a white page. `npm run check` and `npm run test` pass.

---

## P0.2 — Normalize AI output text in the chat

Assistant messages render as an unbroken wall: literal `**Topic**`, numbered lists inline, no paragraph breaks.

**The bug.** `packages/core/admin/chat.tsx:194-199`:

```tsx
export function ChatMessage({ event }: { event: ChatEventView }) {
  if (event.type === 'user_message') return <Bubble mine>{String(event.detail?.text ?? '')}</Bubble>;
  return <Bubble>{String(event.detail?.text ?? '')}</Bubble>;
}
```

Plain string into a JSX text child — no markdown, and not even `whitespace-pre-wrap`, so newlines collapse. No markdown library is a dependency today. `@tailwindcss/typography` **is** already a devDependency.

**Task.**

1. Add `react-markdown` + `remark-gfm` and create `packages/core/admin/Markdown.tsx` exporting a `<Markdown>{text}</Markdown>` component. **Disable raw HTML** (no `rehype-raw`) and restrict link targets to `http(s)`; agent output is untrusted input. Force `target="_blank" rel="noopener noreferrer"` on links.
2. Define an `.adm-prose` class in `packages/core/app/styles/admin-tokens.css` built from the `--adm-*` tokens: paragraph spacing, tight list spacing, `h2`/`h3` scaled down to chat size, `blockquote`, `table`, inline `code` as a quiet badge, and fenced `pre` with horizontal scroll and no wrap. It must read correctly in light and dark.
3. Use `<Markdown>` for `assistant_text`. Leave user messages as plain text with `whitespace-pre-wrap` — do not render user input as markdown.
4. **Tighten the source too.** `packages/core/server/lib/agent/profiles.ts` — `DEFAULT_SYSTEM_PROMPT` currently invites the wall-of-bold style in the screenshots. Add explicit output guidance: short paragraphs; markdown lists for enumerations rather than inline `**Bold**` runs; bold reserved for genuine emphasis; ask at most one question per turn. Keep the prompt client-neutral (it already interpolates `getSiteIdentity().brandName`).
5. Add a `Markdown` entry to `KitGallery.tsx` exercising headings, lists, code, table, blockquote, long link, in both themes.

**Acceptance:** an assistant reply containing markdown renders as formatted prose in both themes. No raw HTML from a message can execute. Bundle impact noted in your summary.

---

## P0.3 — Fix "0 members" on the Admins page

`/admin/settings/admins` shows "0 members" and "No members yet" while the signed-in user is an active Owner.

**The cause is real, not cosmetic.** `packages/core/server/lib/roles.ts:92`:

```ts
const bootstrapOwners = new Set(parseAdminEmails(env.ADMIN_EMAILS));
if (bootstrapOwners.has(normalized)) return expandRole('owner');   // short-circuits BEFORE the store
```

So an `ADMIN_EMAILS` owner never acquires a stored record. `packages/core/server/functions/admin-users.ts:116-122` builds a `synthesizedRecord` **in memory and never persists it**. `listUserRecords` (`packages/core/server/lib/users-store.ts:82-98`) lists only persisted `by-email/` blobs. The count is honest about the store and wrong about reality.

**Task — do both halves.**

1. **Persist on first login.** In the `me` verb, when `activateOnLogin` returns `null` and the caller resolves as a bootstrap owner, write the synthesized record to the store (idempotent, audit action e.g. `bootstrap_activate`). This is already how Profile's `update_me` accidentally materializes a bootstrap owner — make it deliberate and not dependent on someone saving a display name.
2. **Merge env-derived principals into `list`.** `ADMIN_EMAILS`, `ROLE_EMAILS_ADMIN`, `ROLE_EMAILS_PUBLISHER`, `ROLE_EMAILS_EDITOR` grant real access. Return them as rows flagged `source: 'environment'`, deduped against stored records by normalized email. In the UI render them with a badge such as "From environment" and disable role/disable actions with a tooltip explaining they are configured in site environment variables. Never leak the variable's full contents beyond the emails already visible to an Owner.
3. Rewrite the empty state. The current copy — "Owners listed in ADMIN_EMAILS always have access" — is the bug's own confession. It should only appear when there are genuinely no principals of any kind.

Do not change the precedence in `resolveRolesForPrincipalAsync`; bootstrap-owner-beats-store is deliberate (`roles.ts:71-79`) and disabling a bootstrap owner must remain impossible.

**Acceptance:** the signed-in Owner appears in the list with the correct role. Stored and env-derived members are visually distinguishable. Env rows cannot be mutated through the UI, and the server rejects attempts. `set_role`/`disable` self-guards (409) still hold.

---

## P0.4 — Restore the site-bindings guard test

`tests/scripts/client-scripts-site-bindings.test.mjs` is vacuous. It walks `join(ROOT, 'src')` looking for `*.astro` — that directory now contains **zero** astro files, since routes moved to `packages/core/app/routes`. It also matches the literal `'~/config/policy-bindings'` while live code imports `'@site/config/policy-bindings'`. It passes by inspecting nothing.

The rule it was written to protect is real and is documented in its own header: a client entry only gets `getSiteIdentity()` registration if **it** imports the bindings; sharing a page with something that does is a hydration-order race.

**Task.** Point it at `packages/core/app` (and `sites/*/app` if client-owned entries exist there). Match both `~/config/policy-bindings` and `@site/config/policy-bindings`. Extend coverage to the React island entries in `packages/core/app/admin/*.ts` — each must import the bindings before re-exporting the core component (they do today; the test must fail if one stops). Add a self-check that fails when the scan finds zero candidate files, so the test can never silently go hollow again.

**Acceptance:** the test fails if you remove the bindings import from any island entry or inline script, and fails if its own scan matches nothing.

---

# PHASE 1 — Shell & navigation

## P1.1 — Add a `Tree` primitive to the admin kit

There is no tree, accordion, disclosure or collapsible component exported from `packages/core/admin`. `NavItemTree` (`ObjectPreview.tsx:262`) is module-private and always expanded. `JsonDisclosure` (`chat.tsx:202`) is a private native `<details>`.

**Task.** Add `Tree` to `packages/core/admin/primitives.tsx` (or a new `tree.tsx` exported from `index.ts`).

```ts
interface TreeNode {
  id: string;
  label: ReactNode;
  icon?: (p: IconProps) => ReactNode;
  href?: string;
  badge?: ReactNode;
  children?: TreeNode[];
  defaultOpen?: boolean;
}
interface TreeProps {
  nodes: TreeNode[];
  activeId?: string;
  onSelect?: (id: string) => void;
  ariaLabel: string;
  dense?: boolean;
}
```

Requirements: correct ARIA (`role="tree"` / `treeitem"` / `group`, `aria-expanded`, `aria-selected`); full keyboard support (↑↓ move, → expand or descend, ← collapse or ascend, Home/End, Enter/Space activate); roving tabindex; expansion state persisted per tree id in `localStorage` under a namespaced key; truncation with a `title` on long labels; `--adm-*` tokens only. Reuse `IconChevronDown` / `IconChevronRight` from `icons.tsx`. Add a state-complete `KitGallery` entry: deep nesting, long labels, badges, active item, empty children, both themes.

**Acceptance:** keyboard-navigable with a screen reader announcing levels and expansion; expansion survives reload; no layout shift on expand.

---

## P1.2 — Move Recent sessions into the left nav as a grouped tree

Recent sessions is a `Card` at the bottom of the left column of `/admin/agents`, below the agent roster — reliably below the fold. You jump between topics and cannot find your way back to a conversation.

**What already exists.** `list_chats` (`packages/core/lib/admin/chat-client.ts:99` → `admin-agent-chat.ts:251`) returns every chat sorted by `updated_at` desc, each with `chat_id`, `title`, `kind`, `object_type`, `object_id`, `status`, `created_by`. Object chats have the deterministic id `obj:<objectId>`; free chats are `chat_<uuid>`. So grouping is a client-side transform of data you already fetch.

**Task.**

1. Add a `Conversations` section to `packages/core/admin/AdminShell.tsx`, below the primary nav group, rendered with the `Tree` from P1.1. Group by object type using `objectTypeLabel` (`packages/core/lib/admin/display-name.ts`) — Articles, Pages, Sections, Themes, … — then object, then chat. Add a `Free conversations` group for `chat_*` ids and a pinned `New conversation` action at the top.
2. Show relative time ("2h", "3d") and a small status dot for `running` / `awaiting_approval` — awaiting-approval is the one you must not lose, so make it visually distinct.
3. Add a filter input above the tree that matches on title and object id.
4. **Fetch carefully.** `AdminShell` renders on every admin page and currently makes no network call at all. Load the list lazily after first paint, cache it in a module-level store with a short TTL, dedupe concurrent callers, and refresh on `astro:page-load` and whenever a run settles. It must never block or delay page render, and a failed fetch must render a quiet inline retry — never a boundary trip.
5. Cap the tree (e.g. 50 most recent per group) with a "Show all" that routes to `/admin/agents`.
6. **Scope it.** `listChatDocs` currently returns every admin's chats and never filters on `created_by`. Default the tree to the current user's conversations, with an Owner-only "Show all admins" toggle. Do the filtering **server-side** in the `list_chats` action, not in the browser.
7. Remove the now-duplicated Recent sessions card from `AgentsHub.tsx`, or reduce it to a wider table view that the "Show all" link targets.

**Acceptance:** every conversation is reachable in ≤2 clicks from any admin page; the tree survives navigation; a cold load with 200 chats adds no visible delay to first paint; a non-owner sees only their own.

---

## P1.3 — Put the Component kit inside the admin shell

`/admin/kit` renders with the **public site header** and no left nav. It is the only admin route not on `AdminLayout`: `packages/core/app/routes/admin/kit.astro` uses `PageLayout`, and `KitGallery` never wraps itself in `AdminShell`. It also re-implements ~120 lines of the `AdminLayout` auth gate inline — a second copy of a security-adjacent flow that will drift.

**Task.**

1. Rewrite `kit.astro` to match `profile.astro` / `maintenance.astro`: `AdminLayout` + `<KitGallery client:load />`, nothing else. Delete the inline gate script and the page-local `<style>` block, moving anything still needed into the component or `admin-tokens.css`.
2. Wrap `KitGallery`'s return in `<AdminShell currentPath="/admin/kit" title="Component kit">`.
3. In the `NAV` array in `AdminShell.tsx`, move `Component kit` out of the primary group into the `Settings` group, and render it **Owner-only** — it is a developer surface. `NavItem` will need an `ownerOnly?: boolean`, which means `AdminShell` needs the current role; take it from the `useCurrentUser` hook in P1.4 (do P1.4 first, or add a minimal `fetchMe` here and refactor in P1.4).
4. Confirm the light/dark toggle still works inside the shell and does not fight the shell's own theming.

**Acceptance:** `/admin/kit` shows the admin sidebar and top bar, no public header; a non-owner admin does not see the nav item and gets a clear message if they navigate directly; there is exactly one copy of the admin auth gate in the repo.

---

## P1.4 — Unify identity: name, account menu, logout

Three different notions of "who is signed in" are on screen at once:

- Admin top bar (`AdminShell.tsx:284-292`): the raw email from `localStorage`, an `Avatar name={email}` that produces a single initial from the whole address, and a bare logout icon.
- Public header (`packages/core/app/components/common/HeaderAuthButton.astro:271-273`): an "Account" dropdown labelled with `email.split('@')[0]`. Its **"Account settings" item re-opens the login modal** (`:290`) instead of navigating to `/admin/profile`.
- Profile's `display_name` — the field whose own hint claims it is "shown wherever you appear" — is rendered **only** on Profile itself and in the Admins table.

**Task.**

1. Create `packages/core/lib/admin/use-current-user.ts` exporting `useCurrentUser()`: a cached, deduped `fetchMe` returning `{ user, roles, loading, error, refresh }`, with a module-level cache so N components on a page make one request. Invalidate on `cms:login` / `cms:logout` and after `update_me`.
2. **Admin top bar:** replace the email span + avatar + logout icon with a single `DropdownMenu` (already exists in `menus.tsx`) whose trigger is `Avatar` + `display_name || email` + a role chip. Menu: **Profile**, **Admins** (Owner only), a divider, **Sign out**. Avatar initials derive from `display_name` when present, falling back to the email local part — never the whole address.
3. **Public header:** the "Account" dropdown label becomes `display_name || email local part`. Fix "Account settings" to navigate to `/admin/profile`. Keep "Sign out" inside the menu. If a signed-in admin has no reason to see the public-site account menu on admin routes, hide it there rather than showing two competing account controls.
4. Make `display_name` authoritative everywhere it is available, with email as the fallback and email always visible in the menu body (so people can confirm which account they are in).
5. Update `ProfilePage.tsx`'s hint text so it matches reality once this ships.

**Acceptance:** one account control per surface; changing your display name on Profile updates both headers without a hard reload; sign-out reachable in one click from anywhere; nothing shows a bare email address as a person's name.

---

# PHASE 2 — The chat window

## P2.1 — Extract chat into a real docked panel

The chat area is short, the scroll behaves oddly, and it competes for width with the page.

**The layout is genuinely broken, not just small.** `Card` wraps its children in a plain `<div className="px-5 py-4">` (`primitives.tsx:221`), so the `flex flex-col` on the Card's outer div has exactly one flex child. `ChatThread`'s `min-h-0 flex-1` (`chat.tsx:398`) is therefore a child of a block element, not a flex column, and does nothing. Meanwhile `lg:max-h-[calc(100vh-14rem)]` sits on an element with default `overflow: visible`.

**Task.** Create `packages/core/admin/ChatPanel.tsx` — a layout primitive, not a rewrite of the chat logic.

1. Own its own flex chain end to end: `h-[calc(100dvh-var(--adm-topbar-h))]`, `flex flex-col`, header `shrink-0`, thread `flex-1 min-h-0 overflow-y-auto overscroll-contain`, composer `shrink-0` and sticky. Use `dvh`, not `vh`, so mobile browser chrome does not clip the composer.
2. Two modes: `docked` (a right rail that is a sibling of the page content, full available height, its own scroll context) and `overlay` (a slide-over built on the existing `Drawer` from `overlays.tsx`, for narrow viewports and for pages that should not permanently surrender the width).
3. A resizable divider in docked mode, width persisted to `localStorage`, with sensible min/max.
4. Auto-scroll to bottom on new events **only when the user is already near the bottom**; otherwise show a "Jump to latest" pill. Preserve scroll position across the 1.2s/2s/5s poll cycle in `chat.tsx:88-101`.
5. **Claude-app styling.** Assistant text flat on the surface with no bubble and generous line height; user text in a soft, right-aligned block; the composer a rounded multiline textarea that grows to a max height then scrolls, with Enter to send and Shift+Enter for newline. Everything from `--adm-*` tokens.
6. Adopt it in both `AgentsHub.tsx` (right column) and `ObjectWorkspace.tsx` (left column, keeping the live preview opposite). Do not change the `admin-agent-chat` protocol.

**Acceptance:** the panel fills the viewport height at 1280×800 and 1440×900; the thread scrolls independently while nav and composer stay put; no nested scrollbars; reading a message is not interrupted by a poll; the composer is never covered on mobile Safari.

---

## P2.2 — Collapse tool steps into a single activity line

Every tool call and result gets its own row — "Read the content_item contract", "get_contract finished", "List taxonomy objects", "list_objects finished" — so a short answer is buried under a dozen machine rows.

**The mechanism.** `chat.tsx:422` falls through to `ToolCallCard` for every non-hidden event; `HIDDEN_EVENTS` (`:373`) is only `{run_started, events_trimmed}`. There is no prop, no state, no toggle. Result labels are literally `` `${detail.tool} ${isError ? 'failed' : 'finished'}` `` (`:222-231`) — raw snake_case tool names in the reading flow.

**Task.**

1. Add an `ActivityLine` component: while a run is active, collapse all consecutive `tool_call` / `tool_result` events into **one** row — a spinner plus the current step's human `summary` (the server already sends a good one via `tool.describe(...)`, e.g. "Read the content_item contract") plus a count, e.g. *"Working — read the taxonomy registry (4 steps)"*. When the run finishes, collapse to *"4 steps"* with a chevron.
2. Expanding reveals the full step list — the current `ToolCallCard` rows. Persist the expanded/collapsed preference per user in `localStorage`, defaulting to **collapsed**.
3. **Never collapse approvals.** `ApprovalCard` (`chat.tsx:242-369`) is a decision point and must stay inline, full size, always visible.
4. **Never hide failures.** A `tool_result` with `is_error` breaks out of the collapsed line as its own visible row.
5. Replace the raw tool name in result labels with a human phrase. Build a single `TOOL_LABELS` map keyed by tool name and reuse it in the Guardrails rewrite (P4.1) so there is one vocabulary, not two.

**Acceptance:** a run that makes 6 tool calls shows one activity line and one answer; expanding shows all 6; an approval and an error are both impossible to miss.

---

## P2.3 — Attachments and artifact cards in chat

Nothing exists today. `send` is `{action, chat_id, text}` with `text` capped at 20,000 chars; the neutral transcript (`chat-store.ts:44-57`) is text-only; the provider adapters push no image blocks. Meanwhile `search_artifacts` returns real artifact references that render as a one-line "finished" row, and upload endpoints (`admin-artifact-upload-intent`, `artifact-upload`, `save-artifact`) already exist and are unused by chat.

**Task — outbound first, it is smaller and lands value immediately.**

1. **Artifact cards (do this first).** When a `tool_result` carries artifact references, render a card — thumbnail for images, icon plus filename for PDFs, with the public path — instead of a "finished" row. Reuse whatever the object workspace already uses to display artifacts if such a component exists; otherwise add `ArtifactCard` to the kit.
2. **Attachments (larger).** Add an attach button to `ChatComposer`, going through the existing upload-intent flow so bytes never pass through `admin-agent-chat`. Extend the `send` action with `attachments: Array<{ artifact_ref, content_type, filename }>`, extend `ChatMsg` in `chat-store.ts` to carry content blocks, and extend both provider adapters (`provider.ts`) to emit image blocks for image types. Non-image types are referenced by path in the text, not inlined.
3. Enforce limits server-side: allowed content types, per-file and per-message size caps, count cap. Reject with a clear message, never silently.
4. Show attachments as chips in the composer with remove affordances, and inline in the sent message.

**Acceptance:** an image dragged into the composer reaches the model and is visible in the transcript on reload; an oversized or disallowed file is refused with a readable reason; artifact-returning tools render cards.

---

# PHASE 3 — Node-targeted chat

## P3.1 — Server-side CMS-Agent MCP client + `run_workspace_node` tool

**Read this before designing anything.** CMS-Agent (`github.com/vreich-ui/CMS-Agent`) has **no conversation capability**: no chat/thread/message entity, no multi-turn tool, no history tool. `node_execute` is one-shot with a `.strict()` input schema — adding a `messages` key is rejected, not ignored. Every node is forced to emit JSON (`tool_choice: {type:'tool', name:'emit_output'}`; `outputSchema` is required). `GET /mcp` returns 405 — there is no SSE. Executions take 1–5 minutes.

So we are **not** replacing the chat loop with CMS-Agent. We are giving the existing loop the ability to call a node.

**Task.**

1. Create `packages/core/server/lib/agent/cms-agent-client.ts` — a minimal Streamable-HTTP MCP client for CMS-Agent's `/mcp`. Handle the `Mcp-Session-Id` header issued on initialize, send it on subsequent requests, `DELETE` to end the session. Config from environment (endpoint URL + bearer), resolved through the existing per-site binding pattern used elsewhere in `packages/core/server/lib` — **not** hardcoded. If unconfigured, the tool must simply not be offered rather than erroring at runtime.
2. **The bearer never reaches the browser.** CMS-Agent's own admin UI hands a workspace-wide token to the client (`ui/src/mcp/client.ts:28`); do not repeat that. All calls originate in the Netlify function.
3. Add tools to `packages/core/server/lib/agent/tools.ts`:
   - `list_workspace_nodes` — wraps `workspace_get_nodes`, filters `status === 'active'`, returns id, name, kind, description, `riskLevel`. Class `read`, default autonomy `auto`.
   - `run_workspace_node` — wraps `node_prepare_execution` / `node_execute`. Class `privileged`, default `ask`. `describe` must render a human sentence ("Run the *input triage* node"). Implement `dryRun` using the node's input schema so the approval card shows exactly what will be sent.
4. **Respect risk.** Nodes carry `riskLevel: 'read' | 'write' | 'publish' | 'admin'`. Map that onto your autonomy model: never let a `publish` or `admin` node run under `auto`, regardless of the guardrails setting. Document the mapping in the tool description.
5. **Handle the latency honestly.** Node runs can exceed the loop's per-run budget (`loop.ts:36-41`: 12 provider turns, 16 tool calls, `minRemainingMs: 60_000`). Decide and document: either poll `node_list_executions` across turns, or return a run handle immediately and let a later turn fetch the result with `node_get_latest_output`. Do not let a node run silently blow the background function's 15-minute budget.
6. Add the new tools to the Guardrails catalog so they appear on the Guardrails page with the rest.

**Acceptance:** with the env configured, an agent can list nodes and run one under an approval card showing the exact input JSON; with it unconfigured, nothing breaks and the tools are absent; no CMS-Agent credential appears in any client bundle.

---

## P3.2 — A `node:<id>` chat kind

**Task.** Add a third chat kind alongside `free` and object chats (`chat-store.ts:174-175` mints `obj:<objectId>` and `chat_<uuid>`).

1. `chat_id = "node:<nodeId>"`, deterministic like object chats, so returning to a node resumes its conversation.
2. Seed the system prompt from `node_get_effective_prompt` plus the node's input/output schemas, so the model knows what the node expects. Keep the existing approval and autonomy rules layered on top.
3. Add a node picker to `AgentsHub` — a starter card "Talk to a workspace node" listing active nodes grouped by kind, marked with their risk level.
4. Surface node chats as their own group in the P1.2 conversations tree.
5. **Be honest in the UI about what this is.** The node answers with schema-shaped JSON, not prose; the chat agent interprets it. Render the node's raw output in a collapsed disclosure beneath the interpretation so an editor can always see ground truth.

**Acceptance:** an editor picks a node, describes what they want in plain language, sees the exact input before it runs, and gets back both an interpretation and the raw output. Re-opening the node resumes the same conversation.

---

# PHASE 4 — Settings surfaces

## P4.1 — Rewrite Guardrails for humans, and surface the hidden override

Guardrails currently shows internal vocabulary as its primary reading line. A full inventory is in `admin-plan.md` §B9. The headline offenders: **18 raw snake_case tool names in `<code>` as row labels** with the human description available only as a tooltip; option labels rendering literally as "Default (ask)"; a card titled "Per-tool autonomy (auto / ask / off)"; badges reading "Runtime override" / "Committed default" / "Class defaults"; a raw `trk_*` project id mid-sentence; and roadmap language shipped to users ("The creation matrix editor lands alongside the studio", "the disaster fallback").

**There is also a real bug here (B10).** `tools.ts:578` resolves autonomy as `profileOverrides ?? governanceChatTools ?? default` — **an agent profile's `tool_autonomy_overrides` beats this page**, and the UI never says so. An Owner can set a tool to "ask" and watch it run anyway.

**Task.**

1. **Every control gets three parts:** a plain-language title, one sentence saying what happens if you change it, and a `<details>` labelled "Technical" holding the raw key, enum values and tool name. Nothing machine-shaped in the primary line.
2. **Rename the concepts in the UI** (not in the data):
   - "Runtime override" → "Changed here"; "Committed default" → "Site default"; "Class defaults" → "Standard settings".
   - "Master switch" → "Default for everything".
   - `auto` / `ask` / `off` → "Run automatically" / "Ask me first" / "Not allowed".
   - Tool names → human phrases from the shared `TOOL_LABELS` map created in P2.2. One vocabulary across chat and guardrails.
3. **Surface the precedence.** Where an agent profile overrides a tool, show an inline warning on that row: which profile, what it forces, and a link to the roster on `/admin/agents`. Silent overrides on a security page are a defect.
4. **Give Card 3 (Creation policy) either controls or honesty.** It currently renders zero interactive elements while the policy *is* enforced server-side (`creation-policy.ts:89`). Either build the matrix editor, or replace the roadmap sentence with a plain read-only statement of the active policy.
5. Group the 18 tools under human headings — "Looking things up", "Drafting and editing", "Creating new things", "Publishing", "Site-wide changes" — replacing the engineering taxonomy.
6. Fix the adjacent leaks: `ObjectPreview.tsx:276` (raw `target.kind`) and `primitives.tsx:180` (`status.replace(/_/g,' ')` fallback) should route through `display-name.ts`.

**Acceptance:** a non-technical editor can read every row and correctly say what it does; no snake_case is visible without opening a disclosure; a profile-level override is impossible to miss.

---

## P4.2 — Complete the Admins surface

After P0.3 the list is correct. It is still not a management surface.

**What exists:** `me`, `update_me`, `list`, `invite`, `set_role`, `disable` in `packages/core/server/functions/admin-users.ts`. Owner-gated, with a self-guard returning 409.

**What is missing:**

1. **Re-enable.** `disable` is terminal through the UI — `AdminUsers.tsx:219` greys out the item for a disabled member and offers no inverse. Add an `enable` verb and wire it.
2. **Remove.** Only `disable` exists. Add `remove`, guarded so the last Owner cannot be removed and no one can remove themselves, with a typed confirmation.
3. **Resend invite** as an explicit action. It currently exists only as an idempotent side effect of `invite` (`user-invite.ts:49-58`).
4. **Publisher and editor roles.** They exist in `Role` (`roles.ts:29`) and are enforced (`canExecutePublish`, `canDecideReview`) but `userRoleSchema` is `owner|admin` only, so they can only be granted by environment variable. Widen the stored schema and the UI to all four, keeping `expandRole` semantics intact.
5. **Activity.** Every write already appends an audit entry. Surface a per-member history using `HistoryTimeline` from `data.tsx`.
6. **Search and pagination** on `list`.
7. **Pending state.** Invited-but-not-activated members need a visible "Invited" status with the invite date.

**Non-negotiable:** every action re-checks Owner server-side; env-derived rows from P0.3 stay immutable; the self-guard holds; a bootstrap owner still cannot be demoted or disabled.

**Acceptance:** an Owner can invite, promote, demote, suspend, restore and remove a member without touching environment variables; every action is audited and visible; the last Owner cannot be locked out.

---

## P4.3 — Enrich the Profile page

`packages/core/admin/ProfilePage.tsx`. Only `display_name` persists. Timezone is an uncontrolled `<Select defaultValue="auto">` with the hint "Placeholder — display-only for now". The notify switch is local `useState` that is never sent. The avatar is display-only, though the **server already accepts `avatar_artifact`** with a sha-pinned reference guard (`admin-users.ts:31`) — no UI calls it.

**Task.**

1. **Avatar upload**, wired to the existing artifact upload-intent flow, satisfying the server's `image/<id>/<sha256>.<ext>` guard. Client-side crop to a square, size and type limits, and a remove option.
2. **Timezone** — make it controlled and persist it on `UserRecord`. Then actually use it: render every timestamp in the admin (chat, history, audit, sessions) in the user's timezone. A stored preference nothing reads is worse than no preference.
3. **Notification preferences** — either wire delivery or delete the switch. A toggle that does nothing teaches people the console lies. If review notifications are not built, remove it and add it back with the feature.
4. **Account security section**: last sign-in, "Send me a password reset link" via the existing `requestPasswordRecovery` in `goTrueClient.ts`, and "Sign out of all sessions" if GoTrue supports it (verify before promising it in the UI).
5. **Locale / date format**, applied alongside timezone.
6. **Role context**: keep the read-only role badge, add plainly what the role can do and who to ask for a change, linking to `/admin/settings/admins` for Owners.
7. Correct the display-name hint once P1.4 makes it true.

**Acceptance:** every visible control either persists and takes effect, or is not there. No "Placeholder" text ships.

---

## P4.4 — Make Maintenance safe at scale

After P0.1 it renders. It will still fall over on a large store.

1. **The metadata storm.** `MaintenancePage.tsx:158-167` fires one POST per key — `keys.forEach(async ...)` with no batching or throttling, up to `MAX_LISTED_KEYS = 10_000` — and each resolution does a full-array `map`, so re-render cost is O(n²). Fetch metadata only for **visible** rows, batched, with a concurrency limit, and update via a keyed map rather than rebuilding the array.
2. **Pagination.** The server caps at 10,000 keys and returns them all. Add cursor pagination to `handleListBlobs` and a page size in the UI. If the cap is hit, say so explicitly — a silent truncation reads as "that's everything".
3. **The broken effect.** `:191-195` reads `owner`, `store` and `refreshBlobs` but declares only `[search]`, so it never fires on the `owner: null → true` transition. Fix the deps and debounce search properly.
4. **Virtualize or hard-cap** the table; four buttons per row across thousands of rows is a lot of DOM.
5. **Destructive actions.** Wipe-store and wipe-all need typed confirmation naming the store and showing the key count, plus a clear irreversibility warning. Verify the `wipeAll` response shape matches the client type (`maintenance-client.ts:86`) — the same class of mismatch that caused B1.
6. Default the store picker to something sane rather than `stores[0]` alphabetically.

**Acceptance:** a store with 5,000 keys loads in under two seconds without locking the tab; the cap is disclosed when reached; no destructive action is one click away.

---

# PHASE 5 — Richer body rendering

## P5.1 — Add code blocks to the article body vocabulary

Your screenshot article renders correctly, but the body vocabulary is narrow. The **effective** article grammar today is exactly: `p, h2, h3, ul, ol, li, blockquote, link, bold, italic, inline-code`. Fenced code blocks are rejected at **four** independent gates, so this is a threaded change, not a component:

1. `packages/core/lib/richtext/from-markdown.ts:208` — throws: *"fenced code blocks are not supported yet"*
2. `packages/core/lib/richtext/rich-text-v1.ts:34-44` — `RICH_TEXT_V1_BLOCKS` has no code member
3. `packages/core/server/lib/object-validate.ts:2444` (`ARTICLE_RENDERABLE_GRAMMAR`) and `:263` (`RICHTEXT_ALLOWED_TAGS`, which has no `pre`)
4. `packages/core/lib/richtext/prosemirror.ts:219` — no ProseMirror mapping

**Task — thread a `code_block` node through all four, in this order.**

1. Extend `rich-text-v1.ts` with a code block carrying `{ language?: string, code: string }`. Follow the file's own stated intent: *"Widening the universe later is additive."* Version it deliberately — decide and document whether this is `rich_text.v1` widened or `rich_text.v2` with a migration, and state the reasoning. Existing documents must keep parsing.
2. Add it to `ARTICLE_BODY_GRAMMAR` and `ARTICLE_RENDERABLE_GRAMMAR`; add `pre` to `RICHTEXT_ALLOWED_TAGS`. Do **not** widen `INLINE_COPY_GRAMMAR` or `PROSE_GRAMMAR` — a code block has no business in a CTA.
3. Parse fenced blocks in `from-markdown.ts` with the info string as the language. Keep the error path for anything still unsupported (nested lists, tables, hr) exactly as clear as it is now.
4. Add the ProseMirror mapping so the editor round-trips.
5. Render in `packages/core/lib/richtext/render-html.ts` as `<pre><code class="language-x">`, HTML-escaped. Note that `render-html.ts:92` does a blanket `.replaceAll('\n','<br/>')` — **that will destroy code block newlines**. Make the replacement structure-aware so it does not touch `<pre>` content.
6. Round-trip through `packages/core/lib/article-content/to-markdown.ts`.
7. Tests at each layer: parse, validate, render, round-trip, and an explicit test that a code block's newlines and indentation survive.

**Acceptance:** an article body with a fenced ```` ```ts ```` block validates, publishes, round-trips through markdown and the editor without loss, and renders as a real `<pre>` with whitespace intact.

---

## P5.2 — Syntax highlighting driven by a theme axis

Once P5.1 lands, code blocks render as unstyled `<pre>`. They must look right in **each client's** theme — this is Dr. Lurié today and something else tomorrow, so nothing may be hardcoded.

**What exists.** `shiki` is already in `package-lock.json` as Astro's transitive dependency (it powers `.md` highlighting only; object-backed articles never touch Astro's markdown pipeline). The theme system is `packages/core/lib/registry/theme-tokens.ts` — 10 colour keys, 4 font keys (including `mono`, currently unused), and six bounded enum axes in `THEME_AXES`, each mapping to a pre-built CSS-var set that never echoes user input. `tailwind.css:334-349` already points `code, kbd, samp, pre` at `var(--aw-font-mono)`.

**Task.**

1. Add `shiki` as a **direct** dependency and highlight at **build/render time**, not in the browser — the public article path must ship no highlighter JS.
2. Add a `code` axis to `THEME_AXES` with a small bounded set of values (e.g. `subtle`, `contrast`, `minimal`), each mapping to CSS vars for background, border, text and token colours. Follow the existing pattern exactly: bounded enums, pre-built var sets, `resolveAxisVars` emitting nothing for the default so the default render stays byte-identical. Respect the injection guards (`HARD_FLOOR_RE`, `COLOR_VALUE_RE`).
3. Emit shiki output using **CSS variables** rather than baked-in colours, so the same HTML re-themes per site and across light/dark without regeneration.
4. Add `.editorial-prose pre` rules to `tailwind.css`: horizontal scroll, no wrap, comfortable padding, radius from `--dl-radius-card`, mono font from `--aw-font-mono`, and a visible focus style since a scrollable region must be keyboard reachable.
5. Copy-to-clipboard button and an optional language label — progressive enhancement, no layout shift, works without JS.
6. Wire the axis into the seeded themes (`sites/drlurie/seeds/themes-seed-data.mjs`) as an available choice, not a forced default.
7. **The axis must be agent-authorable.** Do P5.4 in the same change or immediately after — an axis that agents cannot discover through `object_contract` is only half-shipped.

**Acceptance:** the same article renders correctly-themed code on all three sites; the public bundle gains no highlighter JS; a site with no `code` axis set renders exactly as before this change.

---

## P5.3 — Implement the presentations the renderer silently drops

`packages/core/schema/article-content-v1.ts:96-111` accepts `plain, section, callout, inline, card, panel, faq, summary, chatInvite, adSlot, offerInline, offerCard` for `rendering.presentation`. The renderer (`packages/core/lib/article-object/render-nodes.ts:248-259`) reads **only** `offerInline` and `offerCard`. So `callout`, `card`, `panel`, `faq` and `summary` validate cleanly, pass review, and then render as an ordinary paragraph. That is a silent contract violation and the cheapest visual win available.

Separately, a pull-quote treatment already exists — but only as a *page section* (`packages/core/components/sections/Testimonial.astro:27-31`, `variant: 'pullquote'`, `font-serif text-2xl italic`). Article bodies cannot reach it.

**Task.**

1. Implement `callout`, `card`, `panel`, `faq` and `summary` in `nodeHtml`, each emitting semantic HTML (`<aside>`, `<details>` for FAQ) with stable class names.
2. Style them in `tailwind.css` from brand tokens only — no fixed colours. A callout should read as a callout in every client's palette.
3. Add a `pullquote` presentation for content nodes, reusing the visual language of `Testimonial.astro` so a pull-quote looks the same whether it came from a section or an article body.
4. Handle unknown presentations explicitly: fall back to `plain` **and** warn at build time, so the next silently-ignored value is caught rather than shipped.
5. Add fixtures for each presentation and verify against all three sites' themes.

**Acceptance:** every value the schema accepts either renders distinctly or produces a build warning; a callout and a pull-quote look correct on drlurie, fernwell and platform without per-client CSS.

---

## P5.4 — Keep themes agent-authorable as the vocabulary grows

Themes are `theme.v1` objects (`packages/core/schema/bodies/theme-v1.ts`) that agents already create and edit through the standard object verbs on each client's MCP connector — `object_contract`, `object_create`, `object_patch`, `object_validate` — and apply through `site_apply_theme`. **That capability is a hard requirement, and P5.2's new `code` axis must not erode it.** An agent that cannot discover a token is an agent that cannot theme a client.

**Task.**

1. **Make the theme contract complete and self-describing.** `object_contract` for `theme` is the same `get_contract` your chat agent calls; it is an agent's only map. It must enumerate every colour key, every font key, and **every axis with its allowed values and a one-sentence human description per value** — "airy: more space between sections", not `sectionRhythm: 'airy'`. Audit it against `THEME_AXES` in `packages/core/lib/registry/theme-tokens.ts` and close any gap you find, not just the new `code` axis.
2. **Validation errors must name the allowed values.** Confirm `object_validate` rejects an unknown axis value with a message listing what is permitted, and rejects a token value failing `HARD_FLOOR_RE` / `COLOR_VALUE_RE` / `FONT_STACK_RE` with a message saying *why*. An agent's only feedback loop is the error string — a bare "Invalid theme" burns a turn and teaches nothing. Add tests asserting the error text, not just the failure.
3. **Keep the safety model intact.** Axis values stay bounded enums mapping to pre-built CSS-var sets; agent input is never echoed into CSS. Do not add a free-form CSS or class escape hatch, however convenient.
4. **Verify the dry-run diff still tells the truth** with the widened vocabulary. `site_apply_theme` computes an exact-token diff, unsets keys the theme lacks, and enforces a totality gate (a theme missing a consumed colour key is rejected 422 rather than silently deleting it). The new axis must participate in the diff so the approval card is accurate.
5. **Prove it end to end.** Have an agent, using only the contract, create a valid new theme with the `code` axis set, dry-run the apply, and read the diff. If it needs information not in the contract, the contract is incomplete — fix it rather than working around it.
6. Confirm a site with no `code` axis renders byte-identically to before.

**Acceptance:** an agent with only `object_contract` output can author a valid theme including the new axis; every rejection explains itself and names allowed values; no free-form CSS path exists; defaults are unchanged.

---

# PHASE 6 — Real conversation with the conductor

> **Different repo:** `github.com/vreich-ui/CMS-Agent`. The preamble about `packages/core` does not apply; the multi-client discipline does — nothing here may hardcode a client.

**Read this framing before P6.1.** "Conductor" names three things and only one orchestrates. `conductor.ts` is 206 lines of cost control (`RunScopedCache`, `summarizeRunCost`, `planRun`) — no model, no prompt. `publishing_conductor` is a workflow id string. The real orchestrator is `advanceRun` (`src/agent/workspace/executor.ts:582`), a deterministic TypeScript DAG stepper. **There is no conductor prompt to teach conversational manners to, and adding a node will not work** — node dispatch (`executor.ts:686-930`) is straight-line with no suspend point, output must satisfy `outputSchema` or the run fails (`:893-908`), node input comes only from `initialInput` + upstream `stageOutputs` (`:716`), and store mode cannot add nodes at all (`:222-227` — new nodes need a re-seed plus a redeploy).

The nearest working skeleton is the publish gate: a `publish`/`admin` risk node with `approved !== true` goes `blocked`, mints one `ApprovalRequired`, and resumes via `retryNode(..., {approved: true})`. It works, and it carries exactly one bit of human information. Phase 6 widens that bit into a conversation.

---

## P6.1 — Give a run somewhere to wait and something to remember

**Task** in `src/agent/workspace/executionTypes.ts`.

1. Add an `awaiting_input` status to `executionStatuses:6`. Today `paused` and `blocked` cannot distinguish an operator halt, a budget halt and a run waiting on a person — the file header already admits `paused` exists only because `blocked` meant three things. Do not repeat that.
2. Add a turn structure to `WorkflowExecutionRecord` (`:89-130`): an ordered list of role-tagged entries (`agent` / `human` / `system`) with text, timestamp, actor and the node id that produced or consumed it. Keep it bounded with explicit trimming, like the platform's chat store does.
3. Give `ApprovalRequired` (`:49-55`) a response side: `answeredAt`, `answeredBy`, and a free-text `answer`. Right now it is request-only, which is why approval carries one bit.
4. **Two traps.** `TERMINAL_STATUSES` is hardcoded in two places that already disagree — `executor.ts:94` includes `paused`, `runConductorJob.ts:18` does not. Reconcile them into one exported constant before adding a member. And `ExecutionRepository` (`src/agent/repository/interfaces/ExecutionRepository.ts:14-27`) has no append operation — every write is a whole-record CAS `saveRun`, so naive per-message appends will contend on the run lock. Either add a scoped append or document the contention and batch writes.
5. Migration: existing persisted runs must keep parsing. Version the record or default the new fields.

**Acceptance:** a run can enter `awaiting_input` and be told apart from paused, blocked and budget-blocked everywhere status is consumed; an approval can carry a human's words; old runs still load.

---

## P6.2 — Let a human's reply actually reach a run

**Task.**

1. **Fix the latent bug first.** `workflow.run_node` declares a `dependencies` parameter (`src/agent/mcp/workspace/tools.ts:120`, and in the JSON schema at `:208`) — and the handler at `:480` **parses it and never reads it**. It is accepted and silently dropped. That is the one existing API surface shaped like mid-flight input injection. Wire it through `RunAdvanceOptions` (`executor.ts:419`) into the input assembly at `executor.ts:716`, or remove it from the schema. Silently ignoring a documented parameter is worse than either.
2. Add an input-bearing resume. `resume_run` currently accepts `{runId, budgetUsd}` and nothing else (`tools.ts:493`, `executor.ts:939`, whose signature is literally `Partial<Pick<WorkflowExecutionRecord, 'budgetUsd'>>`). Extend it — or add a sibling tool — to carry a human turn: the answer text, the actor, and the approval id it responds to.
3. Add a read tool that projects *what the agent is asking*. `workflow.get_run` returns the entire record; there is no "what does this run need from me" view. A UI cannot build a decent waiting-list from a full record dump.
4. Preserve CAS semantics and idempotency: submitting the same answer twice must not double-append or double-advance.

**Acceptance:** a run in `awaiting_input` can be resumed with text that demonstrably reaches the next node's input; `run_node.dependencies` either works or is gone; replaying a submission is a no-op.

---

## P6.3 — A runner mode that can speak and remember

**Task** in `src/agent/execution/runners/`.

1. **Prose output.** Both runners hard-require schema-shaped JSON: `OpenAINodeRunner.ts:104` (`outputSchema is required`) plus the forced `json_schema` output type at `:187`; `AnthropicNodeRunner.ts:57` plus `tool_choice: {type:'tool', name:'emit_output'}` at `:91-92`. Add a conversational mode where a node may return a `message` string, either instead of or alongside structured output. Do **not** loosen the existing autonomous path — schema enforcement is why the pipeline is trustworthy. Make it an explicit opt-in on the node.
2. **Message history.** Every dispatch builds a one-shot prompt today — `OpenAINodeRunner.ts:209` serializes a fresh object; `AnthropicNodeRunner.ts:90` sends `messages: [{role:'user', content}]`. Carry the turn list from P6.1 into the request so a second turn knows about the first.
3. **Turn budgets.** `DEFAULT_MAX_TURNS = 4` (`OpenAINodeRunner.ts:72`) is sized for autonomous emission, and exceeding it is a node *failure* (`:327-336`). Conversational nodes need their own budget and a graceful exhaustion path.
4. **Note the asymmetry.** `AnthropicNodeRunner.ts:63-66` fails configuration for any node with `allowedTools.length > 0` — the Anthropic runner cannot use tools at all. Decide whether conversational mode is OpenAI-only for now and say so in the node contract, or close the gap. Do not leave it implicit.
5. Update `executor.ts:893-908` so a conversational node's prose output is not treated as `output_schema_violation`.

**Acceptance:** a node can hold a two-turn exchange where the second turn demonstrably references the first; existing schema-bound nodes are byte-identically unaffected; an exhausted conversational budget ends cleanly rather than failing the run.

---

## P6.4 — Tell someone the run is waiting

Today a hold is logged and the job exits 0 — `runConductorJob.ts:144-146`, `:58-59`, *"blocked is a successful unattended outcome"*. Nobody is told. There is no streaming anywhere in the run path, and the request-scoped drivers time out and return a `driverNote` telling you to come back (`tools.ts:480-482`).

**Task.**

1. A notification path when a run enters `awaiting_input`. Start with the cheapest thing that works — a queryable "runs waiting on a human" list, surfaced in the platform admin's conversation tree from P1.2 — before building push.
2. Decide and **document** the latency contract: node runs take 1–5 minutes, `GET /mcp` returns 405 by design, and there is no SSE. Polling is the honest answer for now; write down the interval and who owns it rather than leaving each caller to guess.
3. A stale-wait policy: a run that has waited days should be visible as stale, not silently pending forever.

**Acceptance:** a waiting run is discoverable without reading logs; the polling contract is written down; stale waits surface.

---

## P6.5 — Put a name on approvals

**Do this early — retrofitting identity onto an audit trail is always worse than building it in.**

Identity already exists for workspace edits: `WorkspaceActor` (`src/agent/workspace/changeTypes.ts:13-19`, kinds `human|agent|system`), stamped by the secure proxy from `x-workspace-actor` (`mcp/http/mcpEndpoint.ts:45-67`) and threaded as request-scoped attribution (`tools.ts:318-327`). It reaches change records and revisions.

It never reaches a run. `WorkflowExecutionRecord` has no actor field. `ApprovalRequired` has no actor field. `RunAdvanceOptions.approved` (`executor.ts:419`) is a bare boolean — anyone with the token approves as nobody. On the publish side, `approvedBy` is an unverified free string that **defaults to auto-approved** (`src/agent/projects/drLurie/publishReadiness.ts:33`, `:90-91`; identical in `platform/publishReadiness.ts:79-81`).

**Task.**

1. Thread `WorkspaceActor` onto run creation, approvals and human turns. `startDryRun` (`executor.ts:477`) should accept and persist it.
2. Replace the bare `approved` boolean with an approval that records who and when.
3. Keep the existing honesty about what this is. The code comments already say attribution is **not authorization** — a bearer holder can self-describe. Preserve that caveat in the new fields' documentation; do not let a `approvedBy` field imply a verification that did not happen.
4. Revisit the `auto-approved (go-live default)` branch in both `publishReadiness.ts` files. Decide deliberately whether an unattributed publish should still pass by default, and record the decision either way.

**Acceptance:** every approval and human turn on a run carries an actor; the attribution-not-authorization boundary is documented where a reader will meet it; the auto-approve default is a decision, not an accident.

---

# Suggested order if you want visible progress fastest

**P0.1 → P0.2 → P0.3** in one sitting. Those three fix a dead page, make every AI reply readable, and stop the Admins page lying — all small, all high-visibility.

Then **P2.1 + P2.2** together (the chat window and the collapsed steps are the same reading experience), then **P1.1 + P1.2** (the tree, which needs the primitive first).

Phase 3 last among the platform work — it is the only item with an external dependency and an unproven interaction model, and Phase 2 will teach you what the node chat should feel like.

**Phase 6 runs on its own track**, in the CMS-Agent repo, and can start in parallel with anything here — except P6.4, which wants the conversation tree from P1.2 to have somewhere to show a waiting run. Start with **P6.5**: identity is the one piece that gets materially more expensive the later you add it. Then P6.1 → P6.2 → P6.3.

A useful checkpoint: after P6.2 you can already have a run stop, ask a question, and receive a typed answer that reaches the next node — without any runner changes at all. That is a genuine human-in-the-loop conversation, just a structured one. Ship that and see whether P6.3's prose mode is still the thing you want, or whether structured turns with a good UI on the platform side are actually better for editors.
