# Phase 2 runbook — Navigation + footers cutover (T2.0–T2.9)

Working branch: `claude/phase-2-nav-footers-fdwfpt`. This file is the execution
record and click-path for the parts of Phase 2 that are deliberately not an
agent's to perform: the Tier 3 publish (T2.3), the production observation
window (T2.6), the acceptance drill's human half (T2.7), the post-cutover S-2
application (T2.8), and the T2.9 checkpoint. Everything scripted below was
built and locally verified on the branch; nothing here has touched the live
site.

## State of the branch (what is already done)

| Task                       | State                                                                                                           | Where                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| T2.0 build-diff harness    | **done** — self-test passed (no-op rebuild empty; 1-char change caught, confined to `/`)                        | `scripts/build-diff.mjs`, normalizer tests in `npm test`                             |
| T2.1 nav validators        | **done** — fixtures per rule; verbatim `nav_header` = zero blockers, exactly the duplicate-target warning       | `netlify/lib/object-validate.ts`, `tests/netlify/object-validate-navigation.test.ts` |
| T2.2 seed script           | **done (offline)** — data + script committed, validated locally; **`--execute` not yet run against production** | `scripts/seed-navigation.mjs`                                                        |
| T2.3 first Tier 3 publish  | **agent side scripted; human side is yours** — see below                                                        | `scripts/submit-navigation-review.mjs`                                               |
| T2.4 prop adapter          | **done** — deep-equals the current literals                                                                     | `src/utils/navigation-data.ts`                                                       |
| T2.5 cutover commit        | **code committed on the branch + rehearsed to an empty diff locally**; the real gate re-runs after your publish | this runbook §4                                                                      |
| T2.6 observation + cleanup | **PARKED** — waits for your production-observation confirmation                                                 | §5                                                                                   |
| T2.7 agent-flow drill      | scripted click-path below; needs the live Tier 3 flow + you                                                     | §6                                                                                   |
| T2.8 S-2 newsletter CTA    | prepared; applies only after T2.5/T2.6                                                                          | §7                                                                                   |
| T2.9 Solutions dedupe      | **DECIDED (Wolf, 2026-07-06)**: remove the 'Early Access' item; op prepared, applies post-T2.5                  | §8                                                                                   |

Environment for every script below (run from the repo root, never in a browser
context):

```
export OBJECT_STORE_BASE_URL="https://<the production site>"   # e.g. https://drluriescience.netlify.app
export PUBLISH_SECRET="<the shared x-publish-key>"             # server-side only
```

## 1. Seed the three navigation drafts (T2.2, execute)

```
node scripts/seed-navigation.mjs --execute
```

Expected: `nav_header` / `nav_footer` / `nav_footer_home` created (drafts,
nothing published), each validating with zero hard failures; `nav_header`
carries exactly one warning — the duplicate-target class for the audited
'Early Access' + 'Join Early Access' pair. Idempotent on re-run; refuses to
touch a draft that has been edited since.

## 2. Submit for review (T2.3, agent side)

```
node scripts/submit-navigation-review.mjs --execute
```

Per record: checkout → **agent publish attempt, which must be refused
(403, Tier 3)** → submit_review → checkin. A non-403 on the publish attempt is
a tier-gate regression: stop and investigate before any human publish.

## 3. Approve + publish (T2.3, human side — Wolf)

For each of `nav_header`, `nav_footer`, `nav_footer_home` at
`/admin/objects/<id>`:

1. Open the review. The structural surface shows the seeded tree; the impact
   preview is the honest P2 stub ("affects all pages" — computed lists arrive
   in P3, per the 04 §P1 scope note). `nav_header`'s readiness report shows
   the one expected duplicate-target warning; it is warn-by-design (C§1.7-4),
   not a blocker.
2. **Approve.**
3. After approving all three, run the stronger tier check once:
   `node scripts/submit-navigation-review.mjs --verify-tier3`
   (agent publish must still be refused _with_ approval on the record).
4. **Publish** each record (immediate; navigation is not schedulable —
   future-dated publishes are rejected for chrome types by design, D§5.6).
   Publish materializes `src/data/site/navigation/<id>.json` (with the
   `__generated` marker) and commits to `main` via the Git Data API, then
   stamps receipt + `published_time`.

Verify (any one of us can run): the three JSON exports exist on `main`; each
record carries a publish receipt; the site itself is **unchanged** (the
exports are inert until T2.5 merges — that is the parallel-path guarantee).

## 4. Cutover (T2.5) — ordering and the mechanical gate

The cutover commit on this branch touches exactly two files:
`src/layouts/PageLayout.astro` (loader + adapter instead of `~/navigation`)
and `src/pages/index.astro` (footer override renders `nav_footer_home` from
the loader — an interim direct reference until T3.5 moves it into
`page_home.navigationOverrides`). One revert restores today's wiring.

**Ordering is load-bearing:** merge this branch only **after** step 3's
publish commit is on `main`. The cutover build fails loudly (by design) if the
navigation exports are missing — no half-fed fallback exists, deliberately.

The gate (run after merging, before calling T2.5 done):

```
git fetch origin main
node scripts/build-diff.mjs --base <pre-cutover-main-sha> --head <post-merge-main-sha>
```

Required: `RESULT: EMPTY DIFF` across every route, and a green deploy
preview. **Rehearsal already performed on the branch** (seed data
materialized locally through the real materializer + cutover code, working
tree vs HEAD): 210 pages compared, 210 identical — but the rehearsal does not
replace the post-merge run against the real published exports; run it.

## 5. T2.6 — PARKED: production observation window + cleanup

**Waiting on:** your explicit confirmation that the cutover has survived a
production deploy for an observation window of your choosing. Do not run this
step the moment T2.5 merges.

Then the cleanup commit deletes the verified import chain **together**
(delete-only-with-all-importers, build-verified): `src/navigation.ts`,
`src/layouts/LandingLayout.astro`, `src/pages/homes/saas.astro`, all six
`src/pages/landing/*.astro`. Verification: build green;
`grep -r "~/navigation" src/` empty; build-diff shows **only** the unlinked
demo routes disappearing (`/homes/saas`, `/landing/*` — the one _expected_
dist change, listed here so it is never mistaken for a regression).

## 6. T2.7 — acceptance drill: "update the footer CTA"

Needs the live flow (post-T2.5) and your review clicks. Agent side (curl-level
calls against `object-store`; an MCP agent uses the same-named `object_*`
tools for everything except submit/publish, which are HTTP actions):

1. `{action:'checkout', object_type:'navigation', object_id:'nav_footer'}` → `lockToken`, `record_version`
2. `{action:'patch', …, lock_token, expected_record_version, ops:[{op:'update_item', group_id:'g_next_steps', item_id:'i_early_access', fields:{label:'Get Early Access'}}]}`
3. `{action:'validate', object_type:'navigation', object_id:'nav_footer'}` → eligible, same single-warning profile
4. `{action:'submit_review', …, note:'T2.7 drill: footer CTA label'}` → checkin
5. **You:** field diff at `/admin/objects/nav_footer` shows exactly the label
   word-diff → approve → publish → the live footer shows "Get Early Access".
6. Revert the same way (`fields:{label:'Early Access'}`), through the same
   review + publish. Attach both records' history (checkout → patch →
   submit → approve → publish, with actors) to the task notes — that history
   _is_ the acceptance evidence.

## 7. T2.8 — S-2 decision record (applies only after T2.5 _and_ T2.6)

Settled, not open: the mobile-only newsletter CTA becomes a plain all-device
action; **no viewport-conditional schema field exists or will exist,
project-wide, absent a demonstrated recurring need and explicit sign-off**
(standing principle, 05 §1).

Prepared change, in two halves applied together as one reviewed Tier 3 change:

- **Data** (agent-drivable, then your approve + publish):
  `{op:'upsert_action', action:{label:'Join Newsletter', target:{kind:'route', href:'/newsletter'}, style:'primary'}}`
  on `nav_header` — review's structural diff must show exactly this one added
  action. (The route target is upgraded to a page ref in P4, per Gap Note 2.)
- **Chrome** (commit): delete the hardcoded mobile-only CTA block in
  `src/components/widgets/Header.astro` (the `data-mobile-newsletter-cta`
  anchor inside the `md:hidden` utilities container) and render the header
  `actions` from props in both the mobile utilities area and the desktop
  utilities area.

**Rendering consequence, now determined by the T2.9 answer (§8):** the
'Join Early Access' header action is **kept** — so once the header renders
`actions` from data, **both** 'Join Early Access' and 'Join Newsletter'
appear as header CTAs on all devices. The T2.8 review's structural diff and
deploy preview will show exactly that; approve it knowingly (or trim the
action first as an ordinary reviewed edit if you change your mind).

Expected post-deploy dist diff: header nav block only, on all pages — an
_approved, intentional_ visible change (the byte-identical rule governs
cutovers, not settled content decisions).

## 8. T2.9 — DECISION-RECORD (answered by Wolf, 2026-07-06)

**Decision: remove the 'Early Access' dropdown item; keep the
'Join Early Access' item and the 'Join Early Access' header action as-is.**
(Confirmed directly in-session after the original question tool call failed
to deliver; recorded here verbatim so the answer has a durable home.)

The prepared op — one reviewed Tier 3 change through the standard flow,
applied **after** the T2.5 cutover is verified (removing it earlier would
break the byte-identical gate, since today's live dropdown shows the item):

```
{action:'checkout', object_type:'navigation', object_id:'nav_header'}
{action:'patch', …, ops:[{op:'remove_item', group_id:'g_solutions', item_id:'i_early_access'}]}
{action:'validate'} → zero blockers and ZERO warnings — the duplicate-target
                      warning disappears with the duplicate
{action:'submit_review', note:'T2.9: remove Early Access item (Wolf 2026-07-06)'} → checkin
→ your approve + publish (structural diff: exactly one removed item)
```

Sequencing note: natural slot is together with (or just before) T2.8's
review, since both touch `nav_header`. Expected visible diff: the Solutions
dropdown drops from three entries to two on every page.

Side effects to expect, both by design: (a) `nav_header` then validates with
zero warnings — update any expectation pinned to the seed profile if you
re-run checks against the live record; (b) `seed-navigation.mjs --execute`
re-runs will refuse with "already exists with a DIFFERENT body" — correct,
the draft has legitimately moved past the migration snapshot.
