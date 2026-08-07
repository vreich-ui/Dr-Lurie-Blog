# Codex Handoff — Editorial Workspace Execution

**Read this first, once. Then execute one milestone per run from `docs/admin-redesign/roadmap.md`.**

---

## 1. Where you are working

| | |
|---|---|
| Local repo | `~/Code/Dr-Lurie-Blog` |
| Git remote | `github.com/vreich-ui/platform` (the folder name is historical — the repo was renamed) |
| State at handoff | branch `main`, clean, in sync with `origin` (0 ahead / 0 behind), HEAD `76fe465b` |
| Docs | `docs/admin-redesign/` — `master-spec.md`, `roadmap.md`, `admin-plan.md`, `sonnet-prompts.md` |

**Work from the local filesystem.** Read files from disk, not through a GitHub connector — every connector file fetch lands in context and costs tokens, while a local read costs nothing. Use ordinary `git` in the terminal. (Pushing itself is free; it is *reading* the repo remotely that is expensive. So: local reads, normal commits, push when a milestone is done.)

## 2. Two setup facts that will break your first run if you skip them

**`node_modules` is not installed.** Run `npm install` before anything else, or every `npm run check` and `npm run test` fails in a way that looks like a code error and is not.

**`CLAUDE.md` contains a delivery rule that does not apply to you.** It says work reaches Wolf as a zip containing a `git format-patch` series and a `land.command`, "because push access does not exist from the sandbox." That was written for sandboxed agents. **You are running locally with real git access — do not produce zips or patch series.** Commit to a branch and stop. Every other rule in `CLAUDE.md` and `AGENTS.md` stands.

## 3. Repo law you must follow (from `AGENTS.md`)

- **Never push to `main`.** Work on an integration branch.
- **One task, one commit, minimal diff.** No "while I'm in here" cleanup bundled in — flag it separately instead.
- **Commit messages begin with the task ID**: `P0.1: …`, `M1: …`, `M2b: …`.
- **Do not open a PR** unless explicitly told to.
- Every new file is additive; the public site must remain functional after every commit.
- If a task touches the object store, Pages, Sections, Navigation, Taxonomy, Site config or Templates, read the mandatory context listed in `AGENTS.md` §"CMS architecture project" **before writing code**.

**Branch strategy for this program:** one integration branch, `codex/editorial-workspace`, cut from `main`. One commit per milestone (for a split M1, one per part). Wolf merges to `main` himself after reviewing each gate.

```
git checkout -b codex/editorial-workspace
git add docs/admin-redesign && git commit -m "docs: admin redesign spec, roadmap and prompt pack"
npm install
```

That first commit matters — the roadmap and spec are currently untracked, and every run references them by path.

## 4. The documents, and which one wins

| Document | Authority |
|---|---|
| `master-spec.md` | **Product vision and design law.** Read before every run. Wins on questions of product intent. |
| `roadmap.md` | **Execution order + the corrections.** Part 2 lists ten places where the spec's picture of the current code is out of date — verified against the repo. Wins on questions of repo fact. Part 5 contains the milestone prompts; Part 6 the model table. |
| `admin-plan.md` | The verified bug register (B1–B16, F1–F8) with file:line evidence. Reference when a milestone cites a bug ID. |
| `sonnet-prompts.md` | The prompt pack. **M0 runs from here** (P0.1–P0.4), as do the parallel tracks (P3.x, P4.x, P5.x, P6.x). |

If the spec and the roadmap disagree about what the code currently does, the roadmap is right — it was checked against the clone and a live browser session.

## 5. Model and effort per run

Set these before starting each run. Full table with reasoning is `roadmap.md` Part 6; the shape of it:

- **Sol + high** — five runs only: **M1** (the architectural run everything builds on), **M4 status helper**, **P5.1** (schema versioning across four gates), **P6.1** and **P6.3** (CMS-Agent data model and runner).
- **Terra + high** — M2, M2b, M3, and anything auth-adjacent: P0.1, P0.3, P4.2, P3.1, P6.2, P6.5.
- **Terra + medium** — bounded single-surface work: P0.2, P4.1, P4.4, P5.2, P5.3, P5.4, P3.2, P6.4, M4 simplification pass.
- **Luna** — only P0.4 (guard test) and P4.3 (profile wiring). Both have self-checking acceptance criteria.

### The Work chat runner itself — Sol, held constant

Separate from the per-run models above: the model driving the Work chat that dispatches these runs should be **Sol**, and it should not change for the duration of the program.

Its job here is judgment, not production — gate-keeping the implementation notes (the highest-leverage checkpoint in this process, and exactly what a cheaper model waves through, because a plausible-but-wrong note reads fine), judging screenshots against a spec that is largely about proportion and restraint, catching drift between what a run reports and what it actually did, and holding the thread of what was deferred across a dozen runs. It emits short turns — verdicts, corrections, go-aheads — while the Codex runs consume nearly all the tokens, so top tier on the runner is a small slice of total spend.

Two rules that keep it both cheap and sharp:

- **Do not switch it mid-program.** It accumulates the memory of what was built, what was deferred, and which doc claims turned out stale. Replacing it means re-litigating settled decisions.
- **Do not let it read the repo.** Codex reads files from disk and reports; the runner reads the docs and the reports. That is what keeps the expensive model's context small.

## 6. Execution order

```
M0   P0.1 → P0.2 → P0.3 → P0.4        the bug gate — not optional, see below
M1   spatial model                     ← the big one; split if it strains
M2   quick context, Add, Save & Add Next
M2b  learning mode (candidate choice → preference pairs)
M3   templates, media, PDF lens
M4   status, release, retirement, simplification
```

Parallel tracks (any time after M0, independent of the milestones): **Track O** owner surfaces (P4.x + P1.3), **Track R** article rendering (P5.x), **Track C** CMS-Agent conductor (P6.x, different repo).

**Why M0 is not optional:** four confirmed bugs are load-bearing for the redesign. There is **no error boundary anywhere in the repo**, and M1 builds a lens registry that multiplies render surfaces — today one throwing lens blanks the whole admin. Chat renders raw unformatted text, and the agent rail is the centerpiece of the new design. `/admin/maintenance` crashes the app outright. Admins reports "0 members" to an actual Owner. All four are small and already written as prompts.

## 7. The loop for every run

1. **Set model + effort** for this run from the table.
2. **Read** `docs/admin-redesign/master-spec.md`, then `roadmap.md` Part 2 (corrections) and the milestone's prompt in Part 5.
3. **Write a 10–20 line implementation note** naming the files you expect to modify and the behaviors you will preserve. **Stop and show it before coding.** — This is the cheapest checkpoint in the process; a wrong note caught here costs nothing, a wrong M1 costs a day.
4. **Implement.** Everything lands in `packages/core/**`. Nothing brand- or client-specific in core; publication identity comes from `getSiteIdentity()`.
5. **Verify:** `npm run check` && `npm run test`, then confirm all three sites build — `drlurie`, `fernwell`, `platform`.
6. **Look at it.** Screenshots of the affected surfaces in a browser. The spec is a visual spec; passing tests is not evidence it looks right.
7. **Commit** — one commit, task ID prefix.
8. **Stop and report:** changed files, test results, screenshots, anything deferred, anything you found that contradicts the docs.

**Do not continue into the next milestone.** Wolf reviews at each gate and gives an explicit go.

## 8. Standing constraints

- **Multi-client is absolute.** Three tenants share `packages/core`. A change that only works for Dr. Lurié is a defect, not a shortcut.
- **New routes go through `packages/core/app/shell-routes.ts`** (`SHELL_ROUTES` + `injectRoute`) — that is what guarantees every tenant gets them.
- **Island entries in `packages/core/app/admin/*.ts` must import `@site/config/policy-bindings` before re-exporting.** The hydration-order race is real and has broken `/admin` before; the guard test that should catch it is currently vacuous and is fixed in P0.4.
- **Line numbers in the docs were verified recently but may drift.** Find code by name if a number misses. Do not assume a cited line is still accurate — re-read.
- **Preserve working machinery.** Per-object chat creation, checkout/patch/checkin, validation, approval cards, write-refresh, locking — all work today. The redesign is a recomposition, not a rewrite.
- **When uncertain, ask the spec's question:** can the Publishing Agent handle this while the editor simply sees the object and supplies intent? If yes, it belongs in the agentic flow, not in a new control.

## 9. Product-law clarifications for M1–M4 — unified Object Stage

These are **additive product decisions**, dated 2026-08-07. They do not change M0, the branch strategy, the repo law, or the milestone order. Before M1 begins, fold the same decisions into `master-spec.md` and the affected milestone prompts in `roadmap.md`. `admin-plan.md` remains a bug register and does not need product-law edits. `sonnet-prompts.md` remains unchanged unless one of its parallel-track prompts directly conflicts.

### 9.1 One center surface: the Object Stage

The center of the admin is not a generic “preview.” It is the **Object Stage**: the persistent visual place where the current target object or focus target is represented while the Publishing Agent works beside it.

The outer spatial grammar should change as little as possible from object to object:

1. publication/admin navigation on the far left;
2. the Object Stage in the center;
3. the Publishing Agent in the persistent right rail.

The **frame is stable; the representation inside the stage changes according to the object**.

Use three stage display modes:

- **Document mode** — Letter/A4-like portrait surface for PDFs, PDF templates, articles, newsletters, guides, briefs, and other document-shaped objects. This is the preferred default whenever the content naturally maps to pages.
- **Wide mode** — horizontal surface for website sections, navigation, banners, page fragments, and other wide rendered objects.
- **Media mode** — fit-to-stage surface for images, logos, illustrations, product media, and generated visual candidates.

Do not force every object into A4. Use A4/Letter as a strong common visual convention for document-like work, while letting sections and images use their natural shape inside the same stage.

No manual graphics suite is part of the MVP. Images, PDFs, layouts, and visual templates change through the Publishing Agent and the governed manufacturing tools. The stage exists so the editor can **see, point, compare, and decide**.

### 9.2 The Publishing Agent remains visually separate from the object

The right rail is always the contextual **Publishing Agent**.

It must:

- remain visibly attached to the current object/focus target;
- have an independently scrolling conversation;
- keep the composer reachable;
- keep long-running process messages understandable;
- keep object history in the conversation without forcing the object off-screen.

Visual candidates, PDF pages, image alternatives, section renderings, and other references that require inspection belong on the Object Stage. Chat may explain or refer to them, but should not make the editor inspect important visual material inside small message attachments.

The simplest mental model is:

> **Right rail: what are we trying to do?**
> **Center stage: what are we doing it to, and do I accept the result?**

### 9.3 Separate object lifecycle from running work

Do not collapse editorial lifecycle and agent/process activity into one state machine.

**Object lifecycle** remains:

`Draft → Approved → Published → Live`

**Work/process state** is transient and may coexist with any lifecycle state:

- Working
- Researching
- Writing
- Generating
- Rendering
- Validating
- Waiting for you
- Ready to review
- Failed

Examples:

- `Draft · Writing article`
- `Draft · Rendering PDF sample`
- `Published · Waiting for release`
- `Draft · Ready to review`

A working operation must not blank the last usable object representation. Keep the current version visible and show that a new result is being produced.

### 9.4 Publication Map is also a quiet work map

Where the publication lists the objects being built, show transient work status inline:

```text
Brand Voice          Ready
Homepage             Ready
Retinoid Article     ⟳ Writing
Late Starter PDF     ⟳ Rendering
Welcome Newsletter   • Ready to review
```

Do not reintroduce a general activity feed to solve this.

Add a small global work affordance such as **Working · N**. Opening it may show the currently running operations and their objects. It is a utility, not a new primary navigation destination.

Also support one universal human-attention affordance:

**Needs you · N**

It may include:

- agent question;
- candidate selection required;
- factual/expert judgment required;
- validation issue requiring a decision;
- proposal ready;
- approval required.

`Needs you` is not an analytics dashboard and not gamification. It is a low-friction way to tell an editor where their expertise is currently required.

### 9.5 Put state-changing actions next to the Object Stage

Save/approve/publish decisions belong to the object, not to distant global chrome.

Use a small sticky action area attached to the stage. Show only the current meaningful decision.

Examples:

```text
Proposal ready        [Ask for changes] [Save] [Save & Add Next]
Draft saved                                      [Approve]
Approved                                          [Publish]
Published · waiting for release
```

Rules:

- Do not duplicate these actions in the agent rail.
- `Save & Add Next` appears only in a sequential creation context.
- Release stays in the Release workspace; publishing an object does not trigger a build.
- The action area must not become a permanent status-control cockpit.

### 9.6 Return to Publication is an explicit escape hatch

Every focused Object Room needs a visually obvious **← Publication** action. Do not make the editor interpret breadcrumbs to escape a focused object.

Behavior depends on what is actually at risk:

1. **No local unsaved state** → return immediately.
2. **Local rich-text edits not yet saved** → prompt:
   - Save draft
   - Discard changes
   - Keep editing
3. **Publishing Agent is still running** → allow immediate return and say that work continues. The Publication Map/Working list carries the process state.
4. **Persisted agent proposal is waiting for review** → allow return without forcing Save/Discard. Show the object as `Ready to review`.
5. Do not use an unsaved-changes modal for server-persisted agent jobs or proposals.

### 9.7 Rich text is the narrow direct-editing exception

Most object manipulation remains agentic.

A lightweight direct rich-text mode is allowed where typing a small textual correction is faster than asking the agent. This is an **input convenience**, not a second CMS editing paradigm.

Every manual direct edit must produce a potential learning signal that can be consumed by M2b:

- publication/site identity;
- governed object ID and type;
- focus target;
- original text;
- replacement text;
- limited surrounding context;
- timestamp;
- editor identity/role where already available;
- source (`manual_rich_text_edit`).

Do **not** automatically rewrite the global agent profile, system prompt, brand voice, or model behavior from one edit.

Treat manual corrections as candidate preference evidence. M2b may turn repeated or explicitly accepted signals into preference pairs. A future UI may ask something like “Use changes like this as a writing preference?” but that confirmation interaction is **not required in the current MVP**.

Do not log secrets, hidden strategy prompts, unrelated full-document content, or sensitive authentication data as learning context.

### 9.8 Engagement is reserved, not part of this implementation

A future **Engagement** destination may join the far-left navigation when engagement/behavioral data is real and useful.

Do not add a dead Engagement nav item in M1–M4.

When eventually introduced, it should open an object through the same Object Room rather than creating a separate editing paradigm. Engagement data should become context the Publishing Agent can use, not a reason to rebuild the admin UI.

### 9.9 Milestone ownership of these clarifications

Keep the existing milestone order. Fold the decisions in without creating a new program.

- **M1** — Object Stage spatial grammar, A4/Letter document convention, Wide/Media modes, permanent Publishing Agent rail, obvious Return to Publication, stage-local action area, visual slots for `Working`/`Needs you`.
- **M2** — quick context, Add, Save, Save & Add Next, and navigation-away behavior while creation work is active.
- **M2b** — candidate-choice learning plus manual rich-text edit deltas as preference evidence; no automatic model/profile mutation.
- **M3** — real document/media implementations: PDF and PDF-template page surfaces, image/media candidates, template samples, long-running manufacturing state on the stage.
- **M4** — authoritative separation of lifecycle state from transient work state, global Working/Needs-you summaries, release state, and the final simplification pass.

If an existing milestone prompt conflicts with this section on product intent, update that prompt before executing the milestone rather than quietly implementing the older interaction.

---

## First message to paste into Codex

> You are executing a staged UI program in the local repo at `~/Code/Dr-Lurie-Blog` (remote: `vreich-ui/platform`). Read `docs/admin-redesign/CODEX-HANDOFF.md` in full first — it explains the documents, the repo law, the branch strategy, and the per-run loop. Note especially that `CLAUDE.md`'s zip/patch delivery rule does **not** apply to you (you have local git), and that `node_modules` is not installed yet.
>
> Then execute **only M0**: prompts P0.1 through P0.4 from `docs/admin-redesign/sonnet-prompts.md`, in order, one commit each on branch `codex/editorial-workspace`.
>
> Before coding each one, give me the 10–20 line implementation note and wait for my go. After each, run `npm run check` and `npm run test`, confirm all three sites build, and report changed files and results. Stop after P0.4 — do not start M1.
