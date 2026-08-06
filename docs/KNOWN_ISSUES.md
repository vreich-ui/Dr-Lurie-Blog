# Known Issues — deferred / to be addressed later

This file tracks issues that were identified during work on the platform but
deliberately NOT fixed in the same change — either because the fix is a
larger design decision than the triggering bug warranted, or because it
requires a human call this repo's code cannot make on its own. Each entry
should stay here until it is either fixed (link the PR that closes it) or
explicitly decided against (note the decision and who made it).

## 1. QA-W16-1 follow-up: write-timeout root cause not investigated

**Status:** open. **Landed so far:** `fix/qa-w16-bridge-hardening` (PR #529)
added a client-suppliable `idempotency_key` bridge
(`packages/core/server/lib/idempotency-store.ts`, wired into `mcp.ts`'s
`callTool` switch) so a same-key retry after a client-visible timeout/502
replays the original result instead of re-running the write. That is
mitigation **(a)** from the original QA-W16-1 ask. Mitigations **(b)** and
**(c)** below were NOT done.

**The bug:** `object_create`, `object_publish`, `create_pdf_template`,
`create_agent_artifact_job`, and `release_to_production` returned a
client-facing Cloudflare 502 / hit a ~60s timeout ceiling at least 14 times
in the 2026-08-06 QA session — every single time, the underlying write had
already landed server-side by the time the client saw the failure. The
idempotency-key fix makes a *retry* safe; it does nothing to make the
original call finish inside its timeout budget, or to explain why these five
calls specifically are the ones that blow it.

**What still needs doing:**
- Instrument (or manually trace) how long each of the five calls' actual
  underlying work takes end-to-end, against the serverless function's real
  timeout budget:
  - `object_publish` / `release_to_production`: git export commit(s) to the
    content repo, plus (for `release_to_production`) the Netlify build-hook
    trigger and `deploy_status` polling loop it may wait on synchronously
    (see `packages/core/server/lib/production-release.ts`,
    `resolveReleaseWaitBudgetSeconds` in
    `packages/core/server/lib/mcp-tool-handlers.ts`).
  - `create_pdf_template` / `create_agent_artifact_job`: the render-dispatch
    round trip to the separate pdf-tool service (`packages/core/server/lib/
    pdf-tool-client.ts`) — check whether pdf-tool's own render latency
    (rather than this platform's serverless budget) is the actual ceiling.
  - `object_create`: usually fast, but worth confirming it isn't incidentally
    paying for a synchronous validation-context build across every object
    type (see `packages/core/server/lib/object-validation-context.ts` and
    related perf work in PR #527) on some sites.
- Once the actual bottleneck is identified, consider mitigation **(b)** from
  the original QA-W16-1 ask: move the genuinely slow paths
  (`object_publish`, `release_to_production`) off the synchronous
  request/response path the way `create_agent_artifact_job` already does —
  return a job/receipt id immediately, let the caller poll
  (`get_agent_artifact_job_status`-style) for completion, instead of holding
  the MCP HTTP connection open for the full duration of the underlying work.
- Mitigation **(c)**: reconcile the serverless function's actual timeout
  ceiling (Netlify Functions invocation limit) against the platform's own
  release-wait budget config (`resolveReleaseWaitBudgetSeconds`) — if the
  function's own hard timeout is shorter than the wait budget it's
  configured to honor, the mismatch itself is a bug independent of pdf-tool
  or git-export latency.

## 2. QA-W16-3 follow-up: four destructive admin tools share the same broken auth, left unfixed on purpose

**Status:** open, needs a human decision. **Related fix already landed:**
PR #529 fixed the identical broken-auth bug for `list_artifacts_by_kind`,
`search_artifacts`, and `list_artifacts_by_request` via a new
`requireArtifactBrowseAccess` helper in
`packages/core/server/lib/mcp-artifact-admin.ts`, which trusts the
`event.mcpGateAuthenticated` flag (set once per request in
`packages/core/server/functions/mcp.ts`'s `handler`, immediately after
`getAuthResult` succeeds) instead of re-checking an unrelated Netlify
Identity/GoTrue browser session — a check that always fails for an MCP
caller regardless of how valid their MCP credentials are.

**The bug, still present:** `soft_delete_artifact`, `restore_artifact`,
`migrate_artifact_indexes`, and `reconcile_artifact_indexes` (all in
`packages/core/server/lib/mcp-artifact-admin.ts`, dispatched from
`packages/core/server/functions/mcp.ts`'s `callTool`) still call the
stricter, unchanged `requireAdminToolAccess` gate, which has the same
Netlify-Identity-session check at its root and will surface the same
generic "Authentication token could not be verified" error for any MCP
caller who isn't also carrying a valid browser session cookie — which no
MCP agent ever is.

**Why it was left unfixed:** unlike the three read-only browsing tools,
these four are destructive or index-mutating. Applying the same
`event.mcpGateAuthenticated` trust fix would make them callable by *any*
authenticated MCP caller (same shared-secret/verified-agent-token/OAuth
surface as every other tool), not just an admin. That is a real widening of
who can soft-delete an artifact, restore one, or rewrite the artifact index
— a security-relevant decision, not a pure bug fix, so it was deliberately
left for a human to decide rather than auto-applied alongside the read-tool
fix.

**The decision a human needs to make:**
- **Option A** — apply the same `requireArtifactBrowseAccess`-style fix
  (trust `event.mcpGateAuthenticated`) to these four tools too, accepting
  that any MCP-authenticated caller (not just an "admin") can then
  soft-delete/restore artifacts or trigger index migration/reconciliation.
- **Option B** — keep these four admin-only, but fix `requireAdminToolAccess`
  so a caller who fails the *admin* check gets a correct, clear `403` /
  `admin_required` response instead of the current broken-auth error that
  looks identical to "your MCP credentials are invalid" (which they are not
  — the caller may be a perfectly valid MCP caller who simply isn't an
  admin).

Either option is a legitimate call; this file exists so the choice doesn't
get lost. Whoever makes it should update this entry with the decision and
the PR that implements it.
