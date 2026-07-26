# 2026-07-26 — Platform-site ruling (W14) + V1 finish-line directive

**Status: RATIFIED by Wolf, 2026-07-26** (iterated through three revisions
of the review brief in-session; this doc is the recorded result).

## Wolf's directive

One repo for now. Dr-Lurie becomes one client among clients. Core is
separated into its own site — staging + administration + documentation —
able to birth new sites on demand, in-repo for now. The core site's
reader-facing content is a **user instruction manual** describing how the
system works (every object type: attributes, what it can be used as,
permitted actions, lifecycle) to support Wolf's understanding and design of
further development. Then: test and fix all current errors (authorization,
layout, etc.) against a real test plan; make sure MCP connections and agent
editing are clean; then birth a **third site**. Later: the mechanism to
separate assets into different repos, Netlify sites, and domain names —
with the **Netlify split coming as soon as possible**.

## Ratified decisions

| # | Decision |
| --- | --- |
| R1 | **Monorepo stands for now** (OQ-W11-1/2 unchanged). Repo/domain split is designed later (T14.10 design doc), not built in W14. |
| R2 | **The core site is named `platform`** — `sites/platform`, `site_platform`. Netlify project + renamed repo use the same name. |
| R3 | **Dr-Lurie is a worked example, not a constraint.** Byte-identical build-diff is DROPPED as a hard gate for this wave; `build-diff` remains informational. Dr-Lurie is kept for now (only tenant with rich content across all ten object types — valuable test material) but may be scrapped whenever Wolf says so. Nothing in W14 depends on preserving it. |
| R4 | **"Netlify split ASAP"** = birth `platform` as its own Netlify project (T14.3, human gate). The existing `drluriescience` project is NOT renamed — it stays Dr-Lurie's, correctly named; old `*.netlify.app` names get no redirect, and renaming would break every MCP connector + env URL for zero benefit. |
| R5 | **Repo rename → `platform`** (T14.3, same sitting). Assessed LOW pain: GitHub redirects web/git/API; Netlify follows the repo by ID; only the `GITHUB_REPOSITORY` env var value needs updating (already in `SECRETS_SCAN_OMIT_KEYS`); the tree is pre-cleaned of literal repo strings by the standing secrets-scanner rule. ~1 hour incl. one verification deploy. |
| R6 | **Site birth stays CLI + runbook for V1** (documented in the platform manual). An admin-UI "create site" surface is later work, not W14. |
| R7 | **Third site is synthetic** — a made-up brand, disposable, run as the timed repeatability proof ("cost of a new client" baseline). |
| R8 | **V1 FINISH-LINE DIRECTIVE (governing):** no more blockers or questions parked for later. Agents make reasonable decisions, record them, and keep moving; the only permissible halts are genuine account-authority gates (Netlify token, GitHub admin clicks). The project crosses the line as a solid V1. |

## Supersessions

- **T11.11** (second-site acceptance, "staging") → subsumed by
  **T14.2–T14.4**: the second site IS the platform site; same four proofs,
  permanently useful subject.
- **T11.12** (W11 records close-out) → folds into **T14.10**.
- The byte-identical-cutover discipline (Phase-2-era law) is retired as a
  *gate* for W14 by R3. It remains best practice where preserving output
  is actually desired.

## End state (W14)

```
ONE REPO                                    THREE NETLIFY SITES
──────────────────────────────              ─────────────────────────────
packages/core/     engine + app shell (after T14.1)
sites/platform/    the PLATFORM SITE:       platform's own project
                   manual, staging/admin,   (name picked at T14.3)
                   births new sites
sites/drlurie/     example client           drluriescience.netlify.app
sites/<synthetic>/ repeatability proof      disposable
```

Code fleet-propagates; content copies at birth. Each site: own Netlify
project, env, blob stores, `/mcp`, `/admin` (OQ-W11-3/4 unchanged).

## W14 task table (queued ahead of W12/W13)

| Task | Mode | What |
| --- | --- | --- |
| T14.0 | notify | **Admin-login fix** (Wolf-reported: login on drluriescience `/admin` doesn't work). Triage already done — see below. |
| T14.1 | notify | App-shell extraction: `src/` shell into `packages/core`; each site a thin build entry. Gates: suite green; both sites build + render. NOT gated on byte-identity (R3). |
| T14.2 | auto | `create-site --name platform` scaffold; local build renders starter pack. |
| T14.3 | human_gate | Netlify provisioning of `platform` (Wolf: token + runbook env) + seed drive through the front door + **repo rename → `platform`** (Wolf: one click; agent: `GITHUB_REPOSITORY` env update, linkage verify, straggler sweep). |
| T14.4 | auto | Fleet propagation proof: trivial + real core commits → both sites build; MCP round-trip on platform; no unintended Dr-Lurie change. |
| T14.5 | notify | Instruction manual v1, authored AS OBJECTS on the platform site via MCP: one reference page per governed type (all ten) + lifecycle/roles/genesis pages. Drift-guard vs `object_contract`. |
| T14.6 | notify | Test plan + execution → findings log: authz matrix (functions × MCP verbs × principal classes), layout audit (public + admin, both sites), MCP connectivity, agent E2E drills, governance toggles. Seeded with Wolf's reported issues. |
| T14.7 | auto | Fix wave from the findings log (one task one commit per fix cluster). |
| T14.8 | auto | Agent-connection hygiene: per-agent keys minted for real fleet agents (T11.10 mechanism), connectors verified, round-trip green per site; includes the standing `PUBLISH_SECRET` rotation (Wolf executes per secrets-runbook). |
| T14.9 | human_gate | Synthetic third site born on demand; timed; Wolf's hands-on = runbook checklist only. |
| T14.10 | auto | Close-out: state-of-play, CLAUDE.md platform framing, inventory/conversion-map pointers, queue hygiene, and the **separation design doc** (repos/Netlify/domains — doc only). |

## Known-issue log (seed for T14.6)

1. **Admin login broken on drluriescience `/admin`** (Wolf, 2026-07-26).
   Session triage (same day, unauthenticated probes only):
   - `/admin` page renders; login form (email/password/Google) present.
   - GoTrue backend healthy: `/.netlify/identity/settings` returns valid
     JSON — `email: true`, `google: true`, `disable_signup: false`,
     `autoconfirm: false`.
   - `admin-users` function boots: GET → clean 405 (not a module-load
     crash; the W11 factory-shim import chain is not the culprit).
   - ⇒ Fault is inside the login round trip. Ordered hypotheses:
     (a) server-side JWT verification/role resolution rejects a valid
     token (`IDENTITY_URL` value, `getAdminStateFromEvent`,
     `resolveRolesFromEvent`/users-store state, `ADMIN_EMAILS`);
     (b) browser-side GoTrue exchange fails (island hydration or gotrue
     client URL);
     (c) account-level: unconfirmed Identity user (autoconfirm is off).
   - T14.0 starts here: Netlify function logs + one observed browser
     symptom during Wolf's next login attempt pin the branch; fix follows.
   - **RESOLVED (T14.0, same day) — hypothesis (b) confirmed, (a) and (c)
     cleared.** A W11 T11.5 regression: the five client `<script>` entries
     that reach `goTrueClient` (and the edit-mode chunk) never imported
     `src/config/policy-bindings`, so `getSiteIdentity()` threw inside the
     storage helpers' `try/catch` and the session was never read or written.
     Silent by construction — no console error, no function-log trace, which
     is why unauthenticated probes found everything healthy. Fixed by one
     side-effect import per entry; guarded by
     `tests/scripts/client-scripts-site-bindings.test.mjs`. Full write-up:
     `state-of-play.md`, 2026-07-26 T14.0 entry.
2. **`goTrueClient` swallows every storage error** (`try/catch` with an
   `// ignored` body in `currentUser`/`writeStorage`/`clearStorage`/
   `isKeepSignedIn`/`setKeepSignedIn`). That is what turned issue 1 from a
   loud crash into a month-shaped mystery. Deliberately NOT changed in T14.0
   (making it loud is a behavior change — private-mode browsers throw on
   localStorage legitimately). T14.6: decide the right signal (one-shot
   `console.warn`? a diagnostic surfaced in the gate?) and cover it.
3. **`src/components/common/EditMode.astro` hardcodes
   `'dr-lurie-gotrue-user'`** in its zero-cost pre-check — a surviving site
   literal in the shell. T14.1 (app-shell extraction) must de-site it; it
   cannot move into `packages/core` as written.
4. **Prettier drift outside the `check:prettier` glob**: 45 files under
   `tests/netlify/**` and `tests/scripts/roundtrip-reconcile.test.mjs` are
   unformatted on `origin/main`. Not swept by T14.0 (bundled-cleanup rule).
   T14.10 queue hygiene.
5. (further entries accrue from T14.6 execution)

## Non-goals (W14)

No repo split or per-client content repos (design doc only). No public DNS
for platform/synthetic sites. No one-console-over-many-sites admin. No
agent-approves-agent review (M-6 human-only). No admin-UI site-birth
button (R6).
