#!/usr/bin/env bash
#
# run-next-task.sh — execute ONE roadmap task via headless Claude Code, then stop.
#
# Philosophy: this does NOT run the whole pipeline unattended. It runs the next
# eligible AUTO task, commits, notifies you, and halts. Tasks marked notify/gate
# are never executed automatically — the script surfaces them and stops so you
# can run them interactively and watch. You stay in the loop by design.
#
# Usage:
#   ./run-next-task.sh            # run the next eligible task, then stop
#   ./run-next-task.sh --dry-run  # show what would run, do nothing
#
# Requires: claude (Claude Code CLI), jq, git. Run from the repo root.

set -euo pipefail

STATE_FILE=".cms-pipeline/state.tsv"   # taskID <tab> status  (status: done|pending)
QUEUE_FILE=".cms-pipeline/queue.tsv"   # taskID <tab> mode <tab> model <tab> effort <tab> briefPath
LOG_DIR=".cms-pipeline/logs"
mkdir -p "$LOG_DIR" "$(dirname "$STATE_FILE")"

# ---- pick the next pending task whose deps are done -------------------------
next_task() {
  while IFS=$'\t' read -r id mode model effort brief; do
    [ -z "${id:-}" ] && continue
    # already done?
    if grep -qP "^${id}\tdone$" "$STATE_FILE" 2>/dev/null; then continue; fi
    echo -e "${id}\t${mode}\t${model}\t${effort}\t${brief}"
    return 0
  done < "$QUEUE_FILE"
  return 1
}

ROW="$(next_task || true)"
if [ -z "$ROW" ]; then
  echo "✅ Queue empty — every task in $QUEUE_FILE is marked done."
  exit 0
fi

IFS=$'\t' read -r ID MODE MODEL EFFORT BRIEF <<< "$ROW"

# ---- notify/checkpoint tasks are NEVER auto-run ----------------------------
if [ "$MODE" != "auto" ]; then
  MSG="⏸  Next task is ${ID} (mode=${MODE}). This needs you — run it interactively, don't automate it.
     Brief: ${BRIEF}"
  echo "$MSG"
  ./notify.sh "CMS pipeline paused at ${ID} (${MODE})" "$MSG" || true
  exit 0
fi

if [ "${1:-}" = "--dry-run" ]; then
  echo "DRY RUN — would execute:"
  echo "  task=$ID  model=$MODEL  effort=$EFFORT"
  echo "  brief=$BRIEF"
  exit 0
fi

# ---- run the task headless -------------------------------------------------
echo "▶️  Running $ID  (model=$MODEL, effort=$EFFORT)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$LOG_DIR/${ID}-${STAMP}.json"
ERR="$LOG_DIR/${ID}-${STAMP}.err"

PROMPT="Read and execute the task brief at ${BRIEF}. This is a single roadmap task.
Follow the repo CLAUDE.md rules exactly. Read the architecture docs the brief
points to before writing code. Commit your work to the current branch with a
message beginning '${ID}:'. Do NOT open a PR. Do NOT start any other task.
When done, print a one-line summary and the commit hash. If any dependency the
brief relies on does not actually exist in the repo yet, STOP and say so instead
of proceeding."

# --max-turns / --max-budget-usd are your circuit breakers for unattended runs.
# --allowedTools is scoped: Claude can edit, read, run tests, and commit — but
# not push, not run arbitrary destructive shell.
set +e
claude -p "$PROMPT" \
  --model "$MODEL" \
  --output-format json \
  --max-turns 60 \
  --max-budget-usd 8 \
  --allowedTools "Read,Edit,Write,Grep,Glob,Bash(npm test),Bash(npm run build),Bash(git add:*),Bash(git commit:*),Bash(git status),Bash(git diff:*)" \
  > "$OUT" 2> "$ERR"
CODE=$?
set -e

# ---- interpret result ------------------------------------------------------
if [ $CODE -ne 0 ]; then
  MSG="❌ ${ID} failed (exit ${CODE}). See $ERR . Pipeline halted — not marking done."
  echo "$MSG"
  ./notify.sh "CMS pipeline: ${ID} FAILED" "$MSG" || true
  exit $CODE
fi

SUMMARY="$(jq -r '.result // .messages[-1].content // "(no summary)"' "$OUT" 2>/dev/null | head -c 500)"

# record done
echo -e "${ID}\tdone" >> "$STATE_FILE"

# ---- decide whether to pause for a human glance ----------------------------
# Convention: if the brief filename or a sidecar flags "notify-after", halt.
# Simplest rule: always pause at Fable tasks and at *.11 exit-drill tasks.
PAUSE_AFTER="no"
case "$ID" in
  T0.5|T0.6|*.11) PAUSE_AFTER="yes" ;;
esac

MSG="✅ ${ID} done.
Summary: ${SUMMARY}
Log: ${OUT}"

if [ "$PAUSE_AFTER" = "yes" ]; then
  MSG="${MSG}

⏸  This is a watch-closely task (Fable correctness / phase-exit drill).
Review the commit before running the next one."
  echo "$MSG"
  ./notify.sh "CMS pipeline: ${ID} done — review before continuing" "$MSG" || true
  exit 0
fi

echo "$MSG"
./notify.sh "CMS pipeline: ${ID} done" "$MSG" || true
echo ""
echo "Run ./run-next-task.sh again for the next task."
