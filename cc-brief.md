# Brief: Rebuild Article Admin/Review Interface

## Context — READ THIS FIRST, THEN VERIFY AGAINST ACTUAL CODE

Everything below is my (the user's) intent and design discussion from a planning
conversation with Claude (chat). It is NOT verified against the actual repo
source. Your first job is to read the real files and confirm, correct, or flag
contradictions before building anything.

## What this project actually is

This is an agentic CMS. Articles are NOT primarily edited by humans by hand.
The intended primary loop is:

1. AI agents draft articles (out of scope for this task — separate intake
   pipeline, doesn't exist yet)
2. AI agents continuously revise articles: A/B test variants, rewrite based
   on performance, find/match affiliate links and images to content
3. A human editor's role is mostly to VIEW the composed article, POINT AT
   something that needs fixing, and DISPATCH that fix to an agent
4. Direct manual text editing by a human should still be possible as a
   fallback, but is secondary, not the primary interaction

## Data model (as described — VERIFY against real JSON schema in repo)

- Article = JSON object, ordered list of blocks
- Each block has a stable unique ID (independent of position/order)
- Block types observed/described: hook, agitation, resolution, offer, CTA,
  image, affiliate-link, text-section (others likely exist — check repo)
- Each block type has different fields (e.g. CTA likely has label + url +
  style; image likely has src + alt + caption)
- Storage: Netlify Blobs is the actual source of truth (confirmed by user).
  NOT git-committed markdown files at runtime -- markdown/.md files are a
  DERIVED export for portability (other apps/readers), not the live truth.
  Do not build new features that treat .md as authoritative.
- A locking/version-control mechanism already exists in the repo to prevent
  concurrent human+agent edits on the same block. Described as "still needs
  some work but essentially working." READ THIS CODE CAREFULLY before
  building UI on top of it — do not duplicate or bypass it.

## What's explicitly OUT OF SCOPE for this task

- Article creation/drafting UI (separate future interface)
- Changing site structure, header, footer, navigation, menus
- Markdown preview/raw JSON debug panels (user confirmed these were
  debugging artifacts in the current admin page and should be REMOVED,
  not preserved)

## What's IN SCOPE: the new admin/review interface

Replace the current block-builder-with-textareas admin page
(`/admin/publish` — see attached screenshot description below) with a
composed-article viewer:

### Rendering

- Article renders as it will actually look live: images in place, CTAs and
  affiliate links rendered as their real styled components (buttons/cards),
  not as raw URLs, markdown, or JSON
- No markdown source view, no raw JSON view in the primary interface

### Editing interaction model (the core feature)

For each block/region:

- Default state: rendered, read-only-looking view (like GitHub's file view
  before you click "edit")
- Click/select to enter a lightweight edit mode for that block only
  (TipTap-based, see "Editor choice" below)
- NEW: user can highlight a span of text within a block and trigger an
  "Ask AI" action instead of editing manually
- "Ask AI" sends `{ blockId, selectedText, instruction }` to the existing
  agent backend. The agent independently resolves additional context (parent
  article, sibling blocks, prior versions) by querying the JSON store
  directly using blockId -- the frontend does NOT need to gather or send
  surrounding context itself. Confirm this resolution path exists/works in
  the actual agent backend code.
- Agent response should be shown as a diff/suggestion (old vs new) with
  explicit Accept / Discard actions -- do not auto-apply silently. This
  mirrors the GitHub-style "suggested change" pattern the user explicitly
  likes.

### Lock integration (critical -- reuse existing system, don't build a new one)

- On opening a block for editing, the UI must attempt to acquire the same
  lock an autonomous agent would use
- If an agent currently holds the lock: render read-only with a visible
  "agent is currently editing this" indicator. Do not allow entering edit
  mode. Provide a way to refresh/recheck lock state.
- If lock acquired successfully: editable
- On save: write back ONLY that block's content field (not the whole
  article), then release the lock
- Background/autonomous agent edits do NOT require human approval (user
  confirmed this -- option 3 in our discussion: locking is the safety
  mechanism, not an approval queue, for autonomous edits). Approval/diff UI
  is only for the human-triggered "Ask AI" highlight action described above.

### Editor choice and rationale (carried over from planning discussion)

- TipTap (MIT licensed, npm: @tiptap/react + @tiptap/starter-kit) for the
  per-block manual text editing fallback
- Deliberately minimal extension set per block type (e.g. bold/italic/link
  only for body text blocks) -- NOT a full Notion-style block canvas. The
  user explicitly does not want humans to have broad structural editing
  power; structure should stay agent-owned. Do not introduce BlockNote or
  similar full block-canvas editors for this reason.
- One TipTap instance scoped per block, not one editor for the whole article

## Your tasks, in order

1. Read the actual repo structure: locate the current admin/publish page
   component(s), the block data model/schema, the lock/version-control
   implementation, and however articles are currently fetched/rendered for
   the public site.
2. Report back a corrected/confirmed version of the assumptions above --
   flag anything in this brief that contradicts what you find.
3. Propose a component breakdown (file-by-file plan) for the new interface,
   sized so each piece is reviewable independently.
4. Wait for go-ahead before writing implementation code, unless told
   otherwise.

## Reference: old admin page being replaced

Screenshot showed: "Dr. Lurie Science Admin" -> Publish tab. Article Details
form (title, excerpt, category, tags), an "Article Builder" with an
Add-block toolbar (+Text +Image +CTA +Offer +Callout +Summary +FAQ +Chat
+More), a list of collapsible block sections each with raw textareas for
heading/content, and a right sidebar with Publish Settings, a validation
checklist, lock/overwrite controls, and a "Save backup" panel showing raw
markdown + JSON -- this raw markdown/JSON panel is the debugging artifact
to remove, per "what's out of scope" above.
