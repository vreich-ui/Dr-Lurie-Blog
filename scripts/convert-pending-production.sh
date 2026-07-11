#!/usr/bin/env bash
#
# Convert the whole SEEDED-at-RENDERS backlog to production in one run and one
# deploy: the 8 W1 interior/system pages, the 3 W2.5 starter templates, and the
# 2 W2 form pages (page_contact + page_thank_you) — 13 objects total.
#
# Run this from a machine that holds the credentials, on the latest `main`:
#
#   export PUBLISH_SECRET='<the x-publish-key>'
#   ./scripts/convert-pending-production.sh
#
# It calls the standing round-trip driver once against the combined seed module
# (scripts/lib/pending-conversion-seeds.mjs): every object is created/reconciled
# in the production object store, every permitted op is drilled byte-identically,
# each template's instantiation is proven with a dry_run (persists nothing), then
# ONE release fires the Netlify build hook and deploys all accumulated exports.
#
# Idempotent — safe to re-run (already-present objects reconcile to the seed).
#
# Options (passed straight through to the driver):
#   --verify-only   Prove the round-trip WITHOUT publishing or releasing (a safe
#                   dry check first). Incompatible with the default --release.
#
set -euo pipefail

if [[ -z "${PUBLISH_SECRET:-}" ]]; then
  echo "error: PUBLISH_SECRET is not set. Export it first (it is sent as the x-publish-key):" >&2
  echo "  export PUBLISH_SECRET='<the x-publish-key>'" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRIVER="$ROOT/scripts/home-conversion-roundtrip.mjs"
SEEDS="scripts/lib/pending-conversion-seeds.mjs"

# ⚠ The deployed endpoint validates against the schema that is LIVE. Make sure
#   the latest `main` (through the W2 merge) has finished deploying to production
#   before running — otherwise the new types (form_confirmation, the grid `icon`,
#   contact_form subtitle/description, template instantiate) will not yet exist
#   server-side and validation will reject the seeds (the schema-vintage gate).

# --verify-only skips publish/release; otherwise do the real run with one release.
if [[ " $* " == *" --verify-only "* ]]; then
  exec node "$DRIVER" --production --seeds "$SEEDS" "$@"
fi

exec node "$DRIVER" --production --release --seeds "$SEEDS" "$@"
