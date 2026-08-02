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

| #   | Sev      | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                  | Where               |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| F1  | CRITICAL | **→ T14.8.** The one-line code fix (fail-closed) CLOSES Dr-Lurié's live `/mcp` on deploy, which breaks any connector currently sending no token. That must land in lockstep with setting Dr-Lurié's token AND updating its connector's bearer — exactly T14.8's per-site-key scope. Not deploy-safe alone; flagged to Wolf as top priority.                                                                                                  | T14.8               |
| F2  | HIGH     | **FIXED + verified.** create-site now picks the export form from each core function's generation; platform artifact-upload shim corrected; regression test.                                                                                                                                                                                                                                                                                  | commit `de89b79`    |
| F3  | MEDIUM   | **PARTLY FALSE, remainder FIXED + verified.** The "empty footer" was an artifact of the agent's own screenshot tool (hidden tab → zero rAF ticks → IntersectionObserver never fires → the fade-in never runs). A real browser renders it correctly. The real defects the proper render exposed: core's Footer hardcoded Dr-Lurié's descriptor as the fleet default, and a titleless nav group rendered as an empty dropdown. Both fixed.     | commit `f3-chrome`  |
| F4  | MEDIUM   | **FIXED + verified.** Reader-safety scan no longer blocks `private`/`strategy` as ordinary prose outside the content_item annotation model; camelCase markers and JSON-key leaks still caught everywhere.                                                                                                                                                                                                                                    | commit `431186d`    |
| F5  | MEDIUM   | **wontfix-v1 (behavior) + documented.** Publish deliberately keeps the lock (pinned test: "the stamp write must preserve the lock") so concurrent drift is caught under the live lease. The contract now says so and tells callers to `object_checkin`; the surprise, not the behavior, was the defect.                                                                                                                                      | commit `3f5965f`    |
| F6  | MEDIUM   | **BUILT + verified.** `object_retire` (archive → un-export → 301 redirect, in one commit) plus the export-deletion primitive it needed, `_redirects` emission at build, 404 alternatives, and the Owner-only 30-day `purge_archived` sweep. Wolf's rulings: archive then hard-delete after 30 days; retired means gone after a release; readers are always redirected.                                                                       | commit `f6-*`       |
| F7  | LOW      | **wontfix-v1.** The get↔patch version drift is the documented eventual-consistency constraint (name-lookup blob path drops strong consistency fleet-wide). Mitigation is read-version-under-lock-and-retry (the T14.5 driver does this). The real remedy — the lock library / a blobs-scoped strong-read token — is already tracked for the genesis-entry decision; not a V1 blocker.                                                       | tracked             |
| F8  | LOW      | **FIXED + verified.** Two real type holes repaired (string guard; cast the context-validated event); `npm run test:opt-in` now compiles and is gated in the CI `check` job so it can't rot again.                                                                                                                                                                                                                                            | commit `09fb09d`    |
| F9  | HIGH     | **FIXED + verified.** F1's fail-closed gate locked out the one client that cannot send headers — claude.ai's custom connector. The shared token now also rides the URL (`/mcp?key=<token>`), same constant-time compare, same secret, never logged. Header carriers stay preferred and documented as such.                                                                                                                                   | commit `f9-url-key` |
| F10 | HIGH     | **BUILT + verified.** Wolf's call: implement OAuth, keep the URL key too. Every site is now its own OAuth 2.1 authorization server — RFC 9728/8414 metadata, RFC 7591 registration, PKCE S256, a human consent screen inside `/admin`, rotating refresh tokens, RFC 7009 revocation — and `/mcp` validates those tokens as a resource server, challenge header included. 25 tests.                                                           | commit `f10-oauth`  |
| F11 | HIGH     | **IMPLEMENTED + focused tests green; render/deploy pending.** `create-site` generated the object-page catch-all but omitted the four blog loaders, so valid published `content_item` objects were deliberately reserved from the catch-all and had no route owner. Platform now carries the loaders, its file-owned blog base matches the `site` object at `/library`, and new scaffolds generate all four loaders with regression coverage. | T14.7 follow-up     |
| F12 | MEDIUM   | **FIXED in the Platform README follow-up.** The template JSON schema advertised the broad page-section union, including `shared_ref` and the `card` leaf, while `template_registry` correctly required a concrete registered component. Template slot `allowed` now derives from `REGISTERED_SECTION_TYPES`, so discovery and validation expose the same set.                                                                                | T14.7 follow-up     |

Net: six fixed-and-verified (F2, F4, F5-doc, F8, F9, F10), one CRITICAL assigned
to its designated task (F1 → T14.8), two scoped to dedicated follow-ups (F3
chrome, F6 retire verb), one wontfix-v1 (F7). F9 and F10 were found and built
AFTER the wave, when F1's closed gate met the connector it locked out: F9 is the
carrier fix, F10 the authorization model. Suite green throughout (1761 core + 89
script + 1358 opt-in). No PR.

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
minimally (nav*header carries only "Home"), and the platform build isn't applying
the prose typography (link colour token, `list-style`) that Dr-Lurié's does. Every
new client inherits the same bare chrome, so this is fleet-shaped, not a one-site
cosmetic. **Fix (T14.7):** audit the platform theme/typography wiring and the
starter nav/footer seed content; decide what a \_born* site's chrome should look
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

## F9 — HIGH — F1's fix locked out the only connector Wolf actually uses

**Found:** 2026-07-27, after F1 was verified closed live. Not a defect in the
test plan's sense — a **consequence of a fix**, recorded here because the wave's
findings log is where the fleet's auth posture is reasoned about.

**Surface:** Dr-Lurié's `/mcp`, reached from a claude.ai **custom connector**.

**What happened:** F1 closed the fail-open gate. The connector had been working
_because_ the endpoint was unauthenticated — it never sent a token, because
claude.ai's custom-connector form gives it no way to. That form takes a URL and,
under Advanced settings, an OAuth client id/secret. There is no field for a
static bearer, and no field for a custom header. So the moment the gate closed,
the only supported way back in was to stand up an OAuth server.

**Fix (this commit):** the shared `MCP_HTTP_AUTH_TOKEN` gains a third carrier —
`?key=<token>` (alias `?mcp_key=`) — checked with the same constant-time
`safeSecretsMatch` as the two header carriers, after them, and never written to
a log line (the rejection diagnostic records `hasUrlKey` presence only). It is
NOT a second gate: with the shared token unset in a lambda runtime, a URL key
still 401s `mcp_auth_missing_token`, so F1's fail-closed posture is intact
(pinned by a test).

**The tradeoff, stated plainly:** a query string is recorded by proxies, CDN
access logs, and browser history in a way an `Authorization` header is not. The
connector URL therefore _is_ the secret and should be handled as one. Every
client that can send headers should send headers; the docs and the code comment
both say so. The durable answer is an OAuth authorization server on the site
(then the connector's own Advanced-settings fields do the work and no secret
touches a URL) — post-V1, and per-agent keys (T14.8) are the natural vehicle.

**Lesson, and it is mine:** I hardened an auth gate without first checking how
the one live consumer authenticates. "Fail closed" is correct; shipping it
without tracing the caller is how a correct fix becomes an outage.

---

## F10 — the durable answer to F9: the site is its own OAuth server

**Wolf's call, 2026-07-27:** implement OAuth (option 2), and keep F9 — the URL
key — in the same delivery rather than trading one for the other.

**What exists now.** Every site runs an OAuth 2.1 authorization server beside
the MCP resource server it protects, over one new core function
(`mcp-oauth.ts`) and two libs (`oauth-store.ts`, `oauth-server.ts`):

| Endpoint                                  | What it does                                        |
| ----------------------------------------- | --------------------------------------------------- |
| `/.well-known/oauth-protected-resource`   | RFC 9728 — names this origin as its own auth server |
| `/.well-known/oauth-authorization-server` | RFC 8414 — endpoints + `S256` only                  |
| `/oauth/register`                         | RFC 7591 dynamic registration                       |
| `/oauth/authorize`                        | validates, parks the request, sends to consent      |
| `/admin/authorize`                        | the consent SCREEN (shell route, Identity-gated)    |
| `/oauth/consent`                          | the human's decision → authorization code           |
| `/oauth/token`                            | code → token; refresh → rotated token               |
| `/oauth/revoke`                           | RFC 7009                                            |

**The design decisions worth arguing about, and why they went this way:**

- **The site is the authorization server, not a client of one.** An external
  IdP would mean another account, another secret, another thing to provision
  per client. The MCP spec explicitly allows the AS to be co-hosted with the
  resource server, and a fleet that adds a tenant in 13 minutes cannot also add
  an IdP tenancy.
- **The user is authenticated by Netlify Identity, reusing `/admin`'s login.**
  The consent screen is a shell route (`/admin/authorize`), so whatever
  providers a site has enabled — including Google — work with no second login
  surface, and no password ever reaches this code.
- **Tokens are opaque and store-backed, not JWTs.** Statelessness would buy a
  signing key, a rotation policy, and a JWKS endpoint; store-backed tokens die
  the instant the record is deleted, which is what "revoke" should mean.
- **One record per blob key, never a list document.** Two exchanges can land in
  the same second, and the name-lookup blob path is eventually consistent
  (F7/T14.4) — a read-modify-write over a shared doc would drop grants.
- **Registration is open; consent is the gate.** RFC 7591 registration with no
  human in it grants nothing at all: no client reads a byte until an admin
  approves it by name at the consent screen.
- **F1 is not weakened.** OAuth is a THIRD independent path in `getAuthResult`,
  checked before the shared secret and only when the bearer is not the shared
  secret (no extra blob read on the common path). Unset shared token in a
  lambda runtime still fails closed.

Spec MUSTs each carry a test that fails if the property is removed: PKCE S256
required (`plain` is not advertised and not accepted), exact redirect-URI match
(a prefix probe is refused **in place**, never redirected), single-use codes
consumed before PKCE is even checked, `resource` audience validated at
authorize AND on every resource request, rotating refresh tokens, and the
`WWW-Authenticate: Bearer … resource_metadata=…` challenge on every 401.

**What this does NOT do, stated so nobody assumes it:** an OAuth token grants
the SAME surface as the shared key. Per-client scope narrowing (a connector
that may read but not publish) is real work on the tool dispatcher and is
post-V1. Today the win is identity, expiry, and revocation — not least
privilege.

---

## F11 — HIGH — generated sites publish unreachable content_item routes

**Found:** 2026-08-02 while turning Platform into the live README tenant.

Platform accepted, published, and released two valid `content_item` objects.
`fetchPosts()` included them and the object-page catch-all intentionally reserved
their `/%slug%` permalinks, but the Platform scaffold had no `[...blog]` route
files. `/library` and both article slugs therefore rendered the CMS 404 after a
successful production build.

**Root cause:** `create-site` generated only `index.astro`, `404.astro`, and
`[...objectPage].astro`. The catch-all correctly refuses article permalinks and
loader-owned listing PageTypes; that safety rule assumes the site also owns the
four audited blog loaders. Dr-Lurie had them because it predates the generator.

**Fix:** add the post, list, category, and tag loaders to Platform and to every
future `create-site` plan. Align Platform's file-owned `config.yaml` list path
with its published `site` object at `/library`. Unit coverage pins the generated
paths and the two primary static-path functions. The Platform build remains the
render gate: two local attempts spent 80 and 100 minutes hydrating dependencies
through macOS File Provider, emitted no Astro diagnostic, and produced no
`dist`, so that result is infrastructure-inconclusive rather than green.

## F12 — MEDIUM — template discovery advertised two structurally invalid slot types

**Found:** 2026-08-02 during a live recipe-creation probe. A candidate template
with `allowed: ["shared_ref"]` passed the JSON body shape exposed by the MCP but
failed `template_registry` with “not a registered component.”

**Root cause:** `templateSlotSchema.allowed` reused `sectionTypeSchema`, the
broad page-section union. That union deliberately includes the `card` block-tree
leaf and the `shared_ref` pointer, while a template slot is a concrete section
recipe and the structural validator accepts registered components only.

**Fix:** derive the template slot enum directly from
`REGISTERED_SECTION_TYPES`. The JSON schema agents inspect now excludes both
non-standalone members, while the existing registry criterion remains a drift
guard. Regression coverage rejects `shared_ref` and `card` and accepts a recent
registered component (`comparison_table`).

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
