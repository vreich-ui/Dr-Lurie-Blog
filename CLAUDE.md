# Dr-Lurie-Blog — CLAUDE.md

## Core structure — read [`docs/cms-architecture/core-structure.md`](docs/cms-architecture/core-structure.md) FIRST

The system standardizes on **Contentful's content model**: typed entry objects
(pages/sections — already built) + **Contentful Rich Text** JSON for all rich
content fields (replaces HTML strings). That doc has the canonical example for each
level and the ordered task list to finish the CMS. It is the entry point; everything
below elaborates it.

## Design north star — flexible objects, not a site replica (READ FIRST)

We are building a **flexible content backbone, not reproducing today's pages
one-for-one.** Prefer **reusable, agent-configurable components** (a `content_grid`
an agent can point at any content and set to N cells) over **bespoke per-page types**
(a section that renders exactly one page). Byte-identical cutover was migration
_safety_, not the goal — "an agent can now reconfigure this to play a different role"
is. **Litmus test:** if an agent can't repoint or reuse a thing without a code
change, it's a replica, not backbone — generalize it. Full rule + consequences:
[`docs/cms-architecture/design-principles.md`](docs/cms-architecture/design-principles.md).
This **governs** where the phased-plan's "faithful reproduction" / "new component
type per page" framing conflicts.

## CMS architecture project — mandatory pre-task reading

If the task you've been given relates to the agent-actionable CMS project (object store, Pages, Sections, Navigation, Taxonomy, Site config, Templates, or anything under `docs/cms-architecture/`), **read these files in full before writing any code, in this order**:

1. Your task's standalone brief: `docs/cms-architecture/cms-pipeline/T<phase>.<n>-*.md` (e.g. `T0.6-patch-grammar-inverses.md`). Its header carries the task's `depends_on`, `mode`, and recommended `model`/`effort`. **Check `depends_on` before starting anything — if a dependency isn't actually built and merged yet, stop and say so. Don't proceed on the assumption it exists.** (Phase 0 briefs are committed so far; later-phase briefs land in the same directory as they're written.)
2. `docs/cms-architecture/cms-pipeline/queue.tsv` — task ordering and per-task `mode`/model/effort; `docs/cms-architecture/cms-pipeline/README.md` explains the runner around it.
3. For the full per-task spec: `docs/cms-architecture/05-task-breakdown-and-open-questions.md`. `docs/cms-architecture/02-architecture-and-schema.md` and `docs/cms-architecture/03-mapping-and-agent-contract.md` have the full reasoning behind any schema or permission decision you're implementing. These numbered session docs (01–05) are the authoritative sources: a consolidated master reference (`cms-architecture-consolidated.md`) is named by some briefs but has not been committed to the repo — where anything conflicts, the source docs are ground truth.
4. `docs/cms-architecture/object-inventory.md` — the human-facing catalog of what content objects exist right now (each marked LIVE / SHELL / TODO), every object type's use + boundaries, and the MVP todo list. Read it to know what is already an editable object vs. still hardcoded. **It is hand-maintained and drifts easily: update the matching row in the SAME change whenever you cut over a surface or publish/retire an object.** For always-current machine truth, prefer the `object_contract` / `object_inventory` MCP tools over any doc.
5. **Converting a surface to an object? `docs/cms-architecture/conversion-playbook.md` is mandatory** — the exact lifecycle recipe, the call/response field names (do not guess them), and the trap table (deep-merge patch semantics, reference seeding, rich-text vocabularies, the expected sandbox publish block). Every trap in it was hit for real once; the playbook exists so it never costs a second fix-up pass.

Do not skip this because the task instructions in front of you look self-contained. They're deliberately terse and assume this context is already loaded.

## Hard constraints — every session, every task

- **`admin-workflow-lock.ts`, `publish-article.ts`, and the existing article MCP tools are off-limits** except for the two explicitly bounded exceptions (T5.6, T5.7) — and even those must be additive, isolated, single-purpose PRs with zero behavior change to existing tests.
- **Never open a PR unless the task brief explicitly says to.** Commit to the working branch and stop; ask before pushing further or opening a PR if it isn't specified.
- **Check the task's `mode` before starting any task** (the `mode` column in `docs/cms-architecture/cms-pipeline/queue.tsv`, repeated in each brief's header). `checkpoint` tasks do not start until Wolf has answered the open question in the brief — don't infer an answer and proceed. `human_gate` tasks can be prepared in full, but the task isn't done until the specified human action happens — don't attempt to complete that step yourself. (`notify` marks tasks run interactively and watched rather than by the headless runner.)
- **Every surface migration task (Phase 2 onward) follows the seed → publish → cutover → verify → cleanup template** and must produce an empty diff from `scripts/build-diff.mjs` (once T2.0 exists) before a cutover is considered done. Don't invent a different verification approach.
- **One task, one commit, minimal diff.** Don't bundle cleanup, refactoring, or "while I'm in here" changes into a task's commit — flag them separately instead.

## Known gotchas

- File-deletion tasks require verifying every importer first — never delete a file just because a task says to; confirm nothing else references it.
- The taxonomy source of truth is committed frontmatter, not the blob draft aggregation — using the wrong source reintroduces the exact drift the project exists to fix (see `docs/cms-architecture/02-architecture-and-schema.md` §5.5).
- `route`-kind navigation targets are a deliberate transitional type, not a bug — don't "fix" them to `page`-kind before the corresponding Page object actually exists.

## Project basics

- Astro static site, deployed via Netlify. Netlify Blobs is the source of truth for CMS-managed content; git-committed exports are derived.
- Test suite exists but wasn't run in CI until T0.10 — check whether that task has landed yet before assuming CI will catch a regression.
