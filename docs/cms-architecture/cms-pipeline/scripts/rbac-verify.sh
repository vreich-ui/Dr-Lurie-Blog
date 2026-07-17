#!/usr/bin/env bash
#
# T9.7 — RBAC credentialed verification (server-side proofs).
#
# Proves the two-tier role gate on the DEPLOYED site: an Admin's bearer token is
# denied (403) at every owner-only endpoint, and permitted (200) at every
# Admin-readable one; auth-state resolves each token to the right tier. Every
# denial probe is rejected at the role gate BEFORE its request body is
# dispatched, so this script mutates nothing and is safe to re-run.
#
# Usage:
#   SITE_URL="https://<deploy>.netlify.app" \
#   OWNER_TOKEN="<owner access token>" \
#   ADMIN_TOKEN="<admin access token>" \
#   bash docs/cms-architecture/cms-pipeline/scripts/rbac-verify.sh
#
# Exit code 0 = all assertions passed; non-zero = at least one failed.

set -u

: "${SITE_URL:?set SITE_URL to the deploy base URL}"
: "${OWNER_TOKEN:?set OWNER_TOKEN to a bootstrap-owner access token}"
: "${ADMIN_TOKEN:?set ADMIN_TOKEN to a plain-admin access token}"

BASE="${SITE_URL%/}/.netlify/functions"
PASS=0
FAIL=0

# status_of <token> <function> <json-body>  → prints the HTTP status code
status_of() {
  local token="$1" fn="$2" body="$3"
  curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "${BASE}/${fn}" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    --data "${body}"
}

# expect <label> <expected-status> <token> <function> <json-body>
expect() {
  local label="$1" want="$2" token="$3" fn="$4" body="$5"
  local got
  got="$(status_of "$token" "$fn" "$body")"
  if [ "$got" = "$want" ]; then
    printf '  PASS  %-52s [%s]\n' "$label" "$got"
    PASS=$((PASS + 1))
  else
    printf '  FAIL  %-52s [got %s, want %s]\n' "$label" "$got" "$want"
    FAIL=$((FAIL + 1))
  fi
}

# field_of <token> <function> <json-body> <json-key>  → prints a top-level string field
field_of() {
  local token="$1" fn="$2" body="$3" key="$4"
  curl -sS -X POST "${BASE}/${fn}" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    --data "${body}" |
    grep -o "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//'
}

# expect_field <label> <expected> <token> <function> <json-body> <json-key>
expect_field() {
  local label="$1" want="$2" token="$3" fn="$4" body="$5" key="$6"
  local got
  got="$(field_of "$token" "$fn" "$body" "$key")"
  if [ "$got" = "$want" ]; then
    printf '  PASS  %-52s [%s=%s]\n' "$label" "$key" "$got"
    PASS=$((PASS + 1))
  else
    printf '  FAIL  %-52s [%s=%s, want %s]\n' "$label" "$key" "${got:-<none>}" "$want"
    FAIL=$((FAIL + 1))
  fi
}

echo "RBAC verification against ${BASE}"
echo

echo "Tier resolution (admin-auth-state):"
expect_field "owner token → tier owner" "owner" "$OWNER_TOKEN" "admin-auth-state" '{}' "tier"
expect_field "admin token → tier admin" "admin" "$ADMIN_TOKEN" "admin-auth-state" '{}' "tier"
echo

echo "Owner-only endpoints DENY the Admin token (expect 403):"
expect "admin-users list"                403 "$ADMIN_TOKEN" "admin-users"      '{"verb":"list"}'
expect "admin-users invite"              403 "$ADMIN_TOKEN" "admin-users"      '{"verb":"invite","email":"probe@example.com","role":"admin"}'
expect "admin-users set_role"            403 "$ADMIN_TOKEN" "admin-users"      '{"verb":"set_role","email":"probe@example.com","role":"admin"}'
expect "admin-users disable"             403 "$ADMIN_TOKEN" "admin-users"      '{"verb":"disable","email":"probe@example.com"}'
expect "admin-governance set"            403 "$ADMIN_TOKEN" "admin-governance" '{"verb":"set","approval":{"master":"all-require-approval","overrides":{}}}'
expect "admin-blob-manager (maintenance)" 403 "$ADMIN_TOKEN" "admin-blob-manager" '{"action":"list"}'
expect "admin-object checkin force"      403 "$ADMIN_TOKEN" "admin-object"     '{"action":"checkin","object_type":"page","object_id":"__rbac_probe__","force":true}'
echo

echo "Admin-readable endpoints PERMIT the Admin token (expect 200):"
expect "admin-governance get"            200 "$ADMIN_TOKEN" "admin-governance" '{"verb":"get"}'
expect "admin-object inventory"          200 "$ADMIN_TOKEN" "admin-object"     '{"action":"inventory"}'
expect "admin-audit"                     200 "$ADMIN_TOKEN" "admin-audit"      '{}'
echo

echo "Owner token is PERMITTED at an owner-only read (expect 200):"
expect "admin-users list (owner)"        200 "$OWNER_TOKEN" "admin-users"      '{"verb":"list"}'
echo

echo "-------------------------------------------"
printf 'RESULT: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
