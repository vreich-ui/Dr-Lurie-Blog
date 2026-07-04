#!/usr/bin/env bash
#
# notify.sh — send a notification when the pipeline needs your attention.
# Usage: ./notify.sh "TITLE" "BODY"
#
# Pick ONE of the options below and delete the rest. All are optional — if you
# skip this, the runner still prints to the terminal, you just won't get pinged
# away from your desk.

TITLE="${1:-CMS pipeline}"
BODY="${2:-}"

# ---- Option A: macOS desktop notification (zero setup) ---------------------
# Uncomment if you're on a Mac and just want a banner.
# osascript -e "display notification \"${BODY}\" with title \"${TITLE}\""

# ---- Option B: Linux desktop notification ----------------------------------
# notify-send "$TITLE" "$BODY"

# ---- Option C: phone push via ntfy.sh (free, works anywhere) ---------------
# 1. Install the ntfy app on your phone, subscribe to a private topic name.
# 2. Replace the topic below with yours (make it long/unguessable).
# curl -s \
#   -H "Title: ${TITLE}" \
#   -d "${BODY}" \
#   "https://ntfy.sh/your-private-cms-topic-8f3a2b" > /dev/null

# ---- Option D: Slack incoming webhook --------------------------------------
# curl -s -X POST -H 'Content-type: application/json' \
#   --data "{\"text\":\"*${TITLE}*\n${BODY}\"}" \
#   "$SLACK_WEBHOOK_URL" > /dev/null

# ---- Fallback: just echo (always runs if nothing above is enabled) ---------
echo "🔔 [$TITLE] $BODY"
