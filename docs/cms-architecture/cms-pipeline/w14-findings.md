# W14 findings — T14.6 test plan execution (2026-07-26)

Executed live against both production sites: **kugel-platform**
(`https://kugel-platform.netlify.app`) and **drluriescience**
(`https://drluriescience.netlify.app`). One row per finding: surface, repro,
severity, suspected cause. T14.7 is scoped from this; T14.8 owns the per-site
key work that F1 pulls forward.

Severity: **CRITICAL** (prod exposure / data loss) · **HIGH** (every new client
inherits a broken surface) · **MEDIUM** (real defect, limited live blast radius
today) · **LOW** (constraint / infra).

---

## Disposition (T14.7 fix wave) — every finding accounted for

| #   | Sev      | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Where            |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| F1  | CRITICAL | **→ T14.8.** The one-line code fix (fail-closed) CLOSES Dr-Lurié's live `/mcp` on deploy, which breaks any connector currently sending no token. That must land in lockstep with setting Dr-Lurié's token AND updating its connector's bearer — exactly T14.8's per-site-key scope. Not deploy-safe alone; flagged to Wolf as top priority.                                                                                                                                                             | T14.8            |
| F2  | HIGH     | **FIXED + verified.** create-site now picks the export form from each core function's generation; platform artifact-upload shim corrected; regression test.                                                                                                                                                                                                                                                                                                                                             | commit `de89b79` |
| F3  | MEDIUM   | **→ dedicated platform-chrome pass.** Root-caused below (header Logo renders empty though the site object carries `logo.text`; footer content present but unrendered; prose link/list typography not applied). Cosmetic, on a placeholder site; the real fix is live Astro-build debugging, not a seed tweak (a speculative nav-brand seed change was tried and REVERTED — the header wordmark comes from `site.logo.text` via `Logo.astro`, not the header nav's brand, so that change fixed nothing). | scoped           |
| F4  | MEDIUM   | **FIXED + verified.** Reader-safety scan no longer blocks `private`/`strategy` as ordinary prose outside the content_item annotation model; camelCase markers and JSON-key leaks still caught everywhere.                                                                                                                                                                                                                                                                                               | commit `431186d` |
| F5  | MEDIUM   | **wontfix-v1 (behavior) + documented.** Publish deliberately keeps the lock (pinned test: "the stamp write must preserve the lock") so concurrent drift is caught under the live lease. The contract now says so and tells callers to `object_checkin`; the surprise, not the behavior, was the defect.                                                                                                                                                                                                 | commit `3f5965f` |
| F6  | MEDIUM   | **→ dedicated verb task.** A governed `object_retire`/delete is real fleet-law surface — archive-vs-hard-delete, restore, interaction with a live committed export, review-state, and the inventory default — that should be designed, not rushed in at the tail of a fix wave. The `archived` status infra is already half-present (schema + inventory filter); building notes are in the finding. Not wontfix — worth doing, in its own change.                                                       | scoped           |
| F7  | LOW      | **wontfix-v1.** The get↔patch version drift is the documented eventual-consistency constraint (name-lookup blob path drops strong consistency fleet-wide). Mitigation is read-version-under-lock-and-retry (the T14.5 driver does this). The real remedy — the lock library / a blobs-scoped strong-read token — is already tracked for the genesis-entry decision; not a V1 blocker.                                                                                                                  | tracked          |
| F8  | LOW      | **FIXED + verified.** Two real type holes repaired (string guard; cast the context-validated event); `npm run test:opt-in` now compiles and is gated in the CI `check` job so it can't rot again.                                                                                                                                                                                                                                                                                                       | commit `09fb09d` |

Net: four fixed-and-verified (F2, F4, F5-doc, F8), one CRITICAL assigned to its
designated task (F1 → T14.8), two scoped to dedicated follow-ups (F3 chrome, F6
retire verb), one wontfix-v1 (F7). Suite green throughout (1711 core + 89 script;
opt-in 1304). No PR.

---

## F1 — CRITICAL — Dr-Lurié's `/mcp` is fully unauthenticated

**Surface:** `POST https://drluriescience.netlify.app/mcp`

**Repro (no credentials at all):**

```
curl -X POST https://drluriescience.netlify.app/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"object_inventory","arguments":{}}}'
# → 200, full production object inventory
```

A **wrong** bearer (`Authorization: Bearer wrong-key-123`) returns the same 200.
The mutating path is reachable too: an unauthenticated `object_checkout` of a
non-existent id reaches the genuine `"Object record not found"` **404** — i.e.
auth passed and the verb executed its lookup. A checkout of a _real_ object would
take a 15-minute lock; patch / publish / release / (once F6 lands) delete are all
one call away for an anonymous caller.

**Root cause:** `packages/core/server/functions/mcp.ts` ~L1937-1940 — the gate
**fails open** when the env var is absent:

```ts
const token = toNonEmptyString(process.env.MCP_HTTP_AUTH_TOKEN);
if (!token) {
  if (process.env.MCP_HTTP_AUTH_TOKEN === undefined) return { ok: true, verifiedAgentName }; // ← OPEN
  return verifiedAgentName ? { ok: true, verifiedAgentName } : { ok: false, reason: 'missing_token' };
}
```

`MCP_HTTP_AUTH_TOKEN` is **not set** on `drluriescience` (Netlify env API returns
404 for the key), so `undefined → {ok:true}` → wide open. It **is** set on
`kugel-platform` (create-site minted it), so platform is correctly gated: wrong
key **and** no key → `401` on both `tools/list` and `tools/call`
(`mcp_auth_invalid_authorization` / `mcp_auth_missing_authorization`).

**Fix (T14.8, pull forward):** (a) set `MCP_HTTP_AUTH_TOKEN` on Dr-Lurié — but in
lockstep with the bearer its live MCP connectors already send, or their access
breaks the moment the gate closes; (b) code: in a lambda runtime the `undefined`
branch must fail **closed** (same fail-closed posture the genesis fix put on the
blob store). "No token configured" should never mean "open" in production.

---

## F2 — HIGH — create-site emits the wrong export form for v2 functions; platform `artifact-upload` is dead at init

**Surface:** `https://kugel-platform.netlify.app/.netlify/functions/artifact-upload`
(and `/api/artifacts/upload`) — every request, **including GET**, returns:

```
502  error decoding lambda response: invalid status code returned from lambda: 0
```

That is an init-time crash, not a per-request rejection. Dr-Lurié's same function
answers cleanly (`401 Missing bearer upload token`).

**Root cause:** core `artifact-upload` is a Netlify **v2** function —
`export const config = { path: '/api/artifacts/upload' }` plus a `Response`-based
handler. A v2 `config` requires the handler to be exported as **`export default`**.
Dr-Lurié's hand-written shim does exactly that. But create-site's
`functionShimTemplate` (`packages/core/cli/create-site.mjs` ~L1149-1161) always
emits `export const handler = createHandler(siteBinding)`, and re-exports the v2
`config` via `export *`. Netlify sees the v2 `config.path`, finds no default
export, and the function never initializes → status 0.

Only two core functions carry `export const config`: `artifact-upload` (broken,
generated shim) and `mcp` (fine — it is v1 `export const handler` with no `config`
of its own; the grep matched `configureMcp`). So today exactly one generated shim
is wrong, but any future v2 core function inherits the same break.

**Impact:** direct artifact/image uploads (the admin canvas image path) are down
on platform and on **every** create-site client. **Fix (T14.7):** in
`functionShimTemplate`, detect functions that export `config` and emit
`export default createHandler(...)` for them (or emit both `default` and
`handler` universally, since re-exported `config` is the only trigger).

---

## F3 — MEDIUM — platform site chrome renders bare vs Dr-Lurié

**Surface:** `https://kugel-platform.netlify.app/` and `/manual/` (screenshots
attached to the T14.6 handoff). On platform:

- the **brand wordmark is absent** from the header (a lone chevron sits
  centre-top where "PLATFORM" should be, the way "DR. LURIÉ SKINCARE" renders
  top-left on Dr-Lurié);
- **no header nav items** (Dr-Lurié shows Start Here / Learn / Offers);
- the **footer is an empty dark band** — no footNote, no groups;
- in prose, **links are unstyled** (same colour/weight as body text) and **`<ul>`
  bullets are missing** — the `/manual` index links look like plain sentences.

CSS is not wholesale broken: the blue "Sign in to editor" button on `/admin`
renders correctly, and body serif type is fine. So this is theme-token / nav-content
/ typography-plugin specific.

**Suspected cause:** the platform `site` singleton + nav objects were seeded
minimally (nav_header carries only "Home"), and the platform build isn't applying
the prose typography (link colour token, `list-style`) that Dr-Lurié's does. Every
new client inherits the same bare chrome, so this is fleet-shaped, not a one-site
cosmetic. **Fix (T14.7):** audit the platform theme/typography wiring and the
starter nav/footer seed content; decide what a _born_ site's chrome should look
like out of the box.

---

## F4 — MEDIUM (fleet-wide) — reader-safety scan over-blocks ordinary page prose

**Surface:** any `page` create/publish whose prose contains the literal words
`private` or `strategy`. Hit for real in T14.5: the `content_item` manual page
could not describe its own model ("private strategy metadata") — `422`,
`reader_safety` criterion, `Found forbidden internal keyword "private"`.

**Root cause:** `packages/core/lib/article-content/assert-reader-safe.ts` —
`FORBIDDEN_READER_KEYWORDS = ['private','strategy','agentNotes','sourcePromptId','inputTemplateId']`,
matched word-boundary + case-insensitive against **all** reader-facing content,
applied at page validation, not just content_item reader projections.

**Impact:** a client cannot publish an "Our Strategy" page, or any copy using the
word "strategy" / "private" — on any site. **Fix (T14.7):** scope the scan to the
content_item projection (where private strategy annotations actually live), not to
generic page prose. (T14.5 worked around it by rewording; the constraint remains.)

---

## F5 — MEDIUM — `object_publish` (and `object_discard`) do not release the lock

**Surface:** the object lifecycle. After `object_publish`, the checkout lock is
held for the full 15-minute lease; `object_discard` also leaves it held.
Reproduced across all 13 pages of the T14.5 drive's first pass — every one was
still `LOCKED` a full lease later, blocking the re-run (and any other agent).

**Root cause:** `packages/core/server/lib/object-verbs.ts` publish path — publish
does not imply check-in. The T14.5 driver now calls `object_checkin` explicitly
after publish.

**Impact:** an agent that publishes and moves on locks the object out of the whole
fleet's reach until the lease expires. **Needs a ruling:** should publish
auto-checkin, or is the held lock intentional (publish-then-continue-editing)? If
intentional, the contract should say so loudly.

---

## F6 — MEDIUM — no governed deletion / retire verb exists

**Surface:** the object store has no front-door way to remove an object. Three
probe pages created during the T14.5 422 bisection could not be deleted through
MCP at all; they were removed via the Netlify **Blobs API back door** — delete
both the `objects/page/by-id/<id>.json` record **and** the
`objects/page/index/by-status/active/<id>` index key, in store `site:site-objects`
(note: the API store name is prefixed `site:`, the literal key paths from
`object-store-keys.ts`, using the fleet token).

**Impact:** an agent's mistaken `object_create` is **permanent** through the
sanctioned interface; cleanup requires account-level blob access. **Fix (T14.7):**
add a governed `object_retire` / `object_delete` verb that performs exactly the
record + status-index removal the back door had to do by hand (and, ideally,
archives rather than hard-deletes).

---

## F7 — LOW — version drift between `object_get` and `object_patch` under eventual reads

**Surface:** `object_patch`. The first page_home meta patch returned
`"Record version conflict"` using a version freshly read via `object_get`; a
retry that re-read the version under the held lock succeeded on the next attempt.

**Root cause:** the documented eventual-consistency constraint — the name-lookup
blob path silently drops `consistency:'strong'` fleet-wide (see the genesis
state-of-play entry), so a `get` can lag the true head version by tens of seconds.

**Impact:** drivers must read-version-under-lock-and-retry, not read-then-patch.
Already flagged for the lock-library / strong-consistency decision; recorded here
with a live reproduction.

---

## F8 — LOW / INFRA — the `tests/netlify` opt-in suite does not compile on `main`

**Surface:** `npm run test:opt-in`. Fails `tsc` on a **clean** `main` tree (not a
regression from this branch — verified by stashing):

```
packages/core/server/functions/admin-blob-manager.ts(151,20): TS2339: Property 'startsWith' does not exist on type '{}'.
packages/core/server/lib/blob-admin.ts(41,17): TS2345: ... 'headers' is missing in type 'NetlifyLambdaEvent' ...
```

CI never runs this suite, so it rotted. The e2e tests it guards (including the
new `site-genesis.e2e.test.ts`) currently only run via ad-hoc `tsx`. **Fix
(T14.7):** repair the two type errors and wire the suite into CI so it can't rot
again silently.

---

## Gated — needs Wolf's login or a test harness (not completed here)

- **Authenticated `/admin` screens, both sites** (content library, object
  workspace, studio, users, maintenance, agents) — need a Netlify Identity login.
  The **login gate itself renders correctly on both** (platform `/admin` reaches
  the "ADMIN LOGIN REQUIRED → Sign in to editor" screen, styled — T14.0's fix is
  live, not a blank page).
- **Governance toggles** (approval / creation policy flip + revert) — the config
  seam exists (`src/config/creation-policy.ts`, `approval-policy.ts`, and the
  per-site `sites/*/config/*` copies) but exercising it live needs an admin
  session; not flipped.
- **Per-agent key mint → use → revoke** — minting is admin-gated; the
  verified-token code path exists (`resolveVerifiedAgentNameForRequest`) but was
  not drilled end-to-end. This is T14.8's core work.
- **Mobile-viewport layout audit** — the cloud browser renders at a fixed
  ~1568 px canvas; window resize did not change the captured width, so a real
  responsive audit was not possible here. Do it in T14.7 via device emulation or
  the authenticated path.

## Confirmed good — no finding

- **MCP tool-surface parity (live):** platform 50 tools / **0** legacy; Dr-Lurié
  62 / **12** legacy (50 + 12). Distinct identities `Platform_MCP` /
  `Dr_Lurie_Science_MCP`. The T14.4 legacy-omission fix holds in production.
- **Platform `/mcp` auth:** wrong key **and** no key → 401 on both `tools/list`
  and `tools/call`.
- **Non-MCP function authz, both sites (deny-by-default all correct):**
  `object-store` 401; `admin-object` / `admin-release` / `admin-blob-manager` /
  `admin-users` / `admin-governance` / `admin-agent-chat` all `401 Authentication
is required`; `save-artifact` 401; `run-publisher-agent` 401; `track-ingest` 400
  (schema); `save-opt-in` 400 (needs formName); `deploy-status` / `admin-audit`
  405 on GET.
- **Legacy trio isolation:** absent on platform (`save-json-blob` /
  `publish-article` → **404**); present + gated on Dr-Lurié (`publish-article`
  401, `verify-article-images` 401, `save-json-blob` 400 schema).
- **Platform agent E2E:** the T14.5 manual drive (15 pages create → publish →
  release, plus the page_home meta patch) is itself a live platform round-trip;
  the `--check` drift guard regenerates from the live contracts and passes 15/15.
