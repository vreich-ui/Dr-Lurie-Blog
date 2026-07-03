# Dr-Lurie-Blog — CLAUDE.md

## CMS architecture project — mandatory pre-task reading

If the task you've been given relates to the agent-actionable CMS project (object store, Pages, Sections, Navigation, Taxonomy, Site config, Templates, or anything under `docs/cms-architecture/`), **read these files in full before writing any code, in this order**:

1. `docs/cms-architecture/cms-architecture-consolidated.md` — start here. Master reference: the 12 concepts, standing constraints, amendment log, settled decisions, tiered agent-operability contract, phase-by-phase plan.
2. `roadmap.yaml` — the task you were given, its `depends_on`, `mode`, and recommended `model`/`effort` live here. **Check `depends_on` before starting anything — if a dependency isn't actually built and merged yet, stop and say so. Don't proceed on the assumption it exists.**
3. For task-specific detail beyond the consolidated summary: `docs/cms-architecture/05-task-breakdown-and-open-questions.md` has the full per-task spec. `docs/cms-architecture/02-architecture-and-schema.md` and `03-mapping-and-agent-contract.md` have the full reasoning behind any schema or permission decision you're implementing.
4. For Phase 2 specifically, use `phase-2-cc-briefs/T2.X-*.md` instead of the roadmap summary — those are the full standalone spec for each task.

Do not skip this because the task instructions in front of you look self-contained. They're deliberately terse and assume this context is already loaded.

## Hard constraints — every session, every task

- **`admin-workflow-lock.ts`, `publish-article.ts`, and the existing article MCP tools are off-limits** except for the two explicitly bounded exceptions (T5.6, T5.7) — and even those must be additive, isolated, single-purpose PRs with zero behavior change to existing tests.
- **Never open a PR unless the task brief explicitly says to.** Commit to the working branch and stop; ask before pushing further or opening a PR if it isn't specified.
- **Check `roadmap.yaml`'s `mode` field before starting any task.** `checkpoint` tasks do not start until Wolf has answered the open question in the brief — don't infer an answer and proceed. `human_gate` tasks can be prepared in full, but the task isn't done until the specified human action happens — don't attempt to complete that step yourself.
- **Every surface migration task (Phase 2 onward) follows the seed → publish → cutover → verify → cleanup template** and must produce an empty diff from `scripts/build-diff.mjs` (once T2.0 exists) before a cutover is considered done. Don't invent a different verification approach.
- **One task, one commit, minimal diff.** Don't bundle cleanup, refactoring, or "while I'm in here" changes into a task's commit — flag them separately instead.

## Known gotchas

- File-deletion tasks require verifying every importer first — never delete a file just because a task says to; confirm nothing else references it.
- The taxonomy source of truth is committed frontmatter, not the blob draft aggregation — using the wrong source reintroduces the exact drift the project exists to fix (see consolidated doc §3).
- `route`-kind navigation targets are a deliberate transitional type, not a bug — don't "fix" them to `page`-kind before the corresponding Page object actually exists.

## Project basics

- Astro static site, deployed via Netlify. Netlify Blobs is the source of truth for CMS-managed content; git-committed exports are derived.
- Test suite exists but wasn't run in CI until T0.10 — check whether that task has landed yet before assuming CI will catch a regression.
