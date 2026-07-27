# Running the CMS Pipeline — Automation Setup

Three files do the work: `run-next-task.sh` (the runner), `queue.tsv` (task order + modes), `notify.sh` (how you get pinged). The design is deliberately **one task at a time, halt on anything that needs you** — not a fire-and-forget overnight job. Here's why, then how.

## The core idea

Headless Claude Code (`claude -p "…"`) runs a task start-to-finish with no interactive window — that's what makes it scriptable. But "no human in the loop" is exactly wrong for the parts of this pipeline that need judgment: the two Fable correctness tasks (T0.5, T0.6), the phase-exit drill, and every `checkpoint`/`human_gate` task later on. So the runner:

1. Finds the next task in `queue.tsv` not yet marked done.
2. If its mode is **not** `auto` → prints it, notifies you, and **stops**. You run that one interactively and watch it.
3. If it **is** `auto` → runs it headless with cost/turn circuit-breakers, commits, and either continues-on-next-invocation or (for watch-closely tasks) pauses for you to review.

You never wake up to 11 tasks silently committed. You wake up to "T0.1–T0.4 done, T0.5 is Fable — your turn."

## One-time setup

1. **Install the CLI** (if not already): `npm install -g @anthropic-ai/claude-code`, then `claude` once to authenticate.
2. **Put the three files in your repo** (e.g. a `.cms-pipeline/` folder), and `chmod +x run-next-task.sh notify.sh`.
3. **Rebuild `queue.tsv` with real tabs.** The version I gave you shows spaces for readability — they won't parse. Easiest fix: open it and hand-fix, or in Claude Code just say "convert queue.tsv to be genuinely tab-separated."
4. **Commit the Phase 0 briefs into the repo** at the path `queue.tsv` references (`docs/cms-architecture/phase-0-cc-briefs/`). Headless runs read from disk — the briefs must be in the repo, not just on your machine's Downloads.
5. **Pick a notification channel** in `notify.sh` (see below) — or skip it and just watch the terminal.

## How you actually run it

**Interactively, from the VS Code integrated terminal** (recommended for this project):

```
./.cms-pipeline/run-next-task.sh
```

Run it, watch T0.1 land, run it again for T0.2, and so on. When it hits T0.5 it stops and tells you to run Fable interactively — so you open a normal Claude Code session in VS Code, set `/model claude-fable-5` and `/effort high`, paste the T0.5 brief, and watch it work. Then back to the script for T0.7 onward.

This is the sweet spot for you: the boring Sonnet tasks take one command each, the important Fable tasks get your full attention, and nothing crosses a line on its own.

**Scheduled (optional, only once you trust it):** a cron entry that runs the next auto task every few hours during the day and pings you:

```
0 9,12,15 * * *  cd /path/to/platform && ./.cms-pipeline/run-next-task.sh >> .cms-pipeline/cron.log 2>&1
```

Because the runner halts at every non-`auto` task, a schedule can only ever advance the safe tasks — it physically cannot auto-run a Fable task or a checkpoint. That's the safety guarantee that makes scheduling acceptable here at all. I'd still do Phase 0 by hand first and only schedule from Phase 1 onward.

## Getting notified when it's your turn

`notify.sh` has four options — pick one, delete the rest:

- **macOS banner** — zero setup, one `osascript` line. Good if you're at the machine.
- **Linux banner** — `notify-send`, same idea.
- **Phone push via ntfy.sh** — free, genuinely works from anywhere: install the ntfy app, subscribe to a private topic, the script `curl`s to it. This is the one to use if you want to walk away and get pinged on your phone when T0.5 needs you.
- **Slack webhook** — if you'd rather it land in a channel.

## The circuit breakers (why an unattended run can't hurt you)

Every headless invocation in the runner is capped:

- `--max-turns 60` — it can't loop forever on a stuck problem.
- `--max-budget-usd 8` — it can't silently burn your whole budget (tune this; Fable tasks cost more, so if you ever do automate them, raise it deliberately).
- `--allowedTools "…"` — scoped. It can read, edit, run tests, run the build, and `git commit` — but it **cannot push, cannot open a PR, cannot run arbitrary destructive shell.** Everything stays local and revertible until you personally push.

If a run hits a limit or errors, the task is **not** marked done and the pipeline halts with a notification — so a failure never cascades into the next task on bad state.

## What to do the first evening

1. Run T0.1 through T0.4 with the script — four commands, four commits, all Sonnet, all cheap.
2. When it stops at T0.5, open an interactive Fable session in VS Code and do T0.5, then T0.6, watching each.
3. Run the script again for T0.7 → T0.10.
4. It stops before T0.11 (the exit drill) — run that interactively too, since it's the proof Phase 0 actually works.
5. Phase 0 done. Glance at the commits, push when you're happy, then decide whether Phase 1 runs the same way or gets a real schedule.
