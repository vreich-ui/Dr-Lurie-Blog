# Phase 2 runbook — Navigation + footers cutover (T2.0–T2.9)

Working branch: `claude/phase-2-nav-footers-fdwfpt`. This file is the execution
record and click-path for the parts of Phase 2 that are deliberately not an
agent's to perform: the Tier 3 publishes (T2.3; T2.8+T2.9), the production
observation window (T2.6), and the acceptance drill's human half (T2.7).
Everything scripted below was built and locally verified on the branch;
nothing here has touched the live site except through the human-executed
publishes it documents.

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
| T2.8 S-2 newsletter CTA    | **scripted + chrome commit ready, NOT merged** — combined with T2.9 below                                       | §7                                                                                   |
| T2.9 Solutions dedupe      | **DECIDED (Wolf, 2026-07-06)**: scripted; combined into the same patch as T2.8                                  | §7                                                                                   |

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
nothing published), each validating with zero hard failures. **Warning-set
note (learned in the first production run):** the duplicate-target warning on
`nav_header` comes from T2.1 validator code, which reaches production only
when this PR merges and deploys — before that, the deployed validator has no
nav rules and the script says so instead of failing. Idempotent on re-run;
refuses to touch a draft that has been edited since.

To inspect exactly what the drafts contain at any time (read-only,
byte-compares store vs seed, prints version/review/lock state):

```
node scripts/seed-navigation.mjs --verify
```

## 2. Submit for review (T2.3, agent side)

```
node scripts/submit-navigation-review.mjs --execute
```

Per record: **pre-flight** (draft exists + body byte-identical to the seed +
zero validation blockers — a failing record is NOT submitted and the run
exits non-zero) → checkout → **agent publish attempt, which must be refused
(403, Tier 3)** → submit_review → checkin. A non-403 on the publish attempt is
a tier-gate regression: stop and investigate before any human publish. The
pre-flight is intrinsic to this script — it does not rely on the seed step's
exit code, so running the two commands separately is safe.

## 3. Approve + publish (T2.3, human side — Wolf)

For each of `nav_header`, `nav_footer`, `nav_footer_home` at
`/admin/objects/<id>`:

1. Open the review. The structural surface shows the seeded tree; the impact
   preview is the honest P2 stub ("affects all pages" — computed lists arrive
   in P3, per the 04 §P1 scope note). `nav_header`'s readiness report shows
   the expected duplicate-target warning **only once the Phase 2 code is
   deployed** — with the pre-merge validator the warning is absent because
   the rule doesn't exist yet, not because the data changed. Either way it is
   warn-by-design (C§1.7-4), never a blocker.
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

## 7. T2.8 + T2.9 — combined nav_header patch (both decided, both scripted)

**T2.9 decision (Wolf, 2026-07-06):** remove the 'Early Access' dropdown
item; keep 'Join Early Access' (item + header action) as-is. **T2.8
decision (settled, S-2):** the newsletter CTA becomes a plain all-device
action — no viewport-conditional schema field exists or will exist,
project-wide, absent a demonstrated recurring need and explicit sign-off.
Per your explicit instruction: both header CTAs coexist, nothing is
trimmed.

Both land as one combined Tier 3 patch (one review, one publish, since
they touch the same record in the same sitting) plus a separate,
**deliberately held-back** chrome commit.

**Step 1 — agent side (data), any time after T2.5's cutover is live:**

```
node scripts/patch-nav-header-t28-t29.mjs --verify    # confirm pre-patch state first
node scripts/patch-nav-header-t28-t29.mjs --execute
```

Pre-flight refuses to run unless `nav_header` is verifiably still in the
pre-patch shape (the 'Early Access' item present, no newsletter action yet)
— safe to re-run. Then: checkout → patch (`remove_item` + `upsert_action`
in one call) → agent-publish-refusal check (403, Tier 3) → submit_review →
checkin.

**Step 2 — your review + publish** at `/admin/objects/nav_header`: the
structural diff should show exactly one removed item and one added action,
with **zero remaining warnings** (the duplicate-target warning disappears
with the duplicate — offline-verified against the real T0.6/T0.7 engine in
`tests/netlify/nav-header-t28-t29-patch.test.ts`). Approve, then publish
(immediate).

**Step 3 — merge the chrome commit, only now.** `src/components/widgets/Header.astro`

- `src/components/common/HeaderAuthButton.astro` already have a commit ready
  on this branch (`T2.8 chrome: render header actions on every device`) that
  renders `actions` as real buttons on both mobile and desktop, replacing the
  hardcoded mobile-only newsletter link. **It is marked DO NOT MERGE YET and
  must stay that way until step 2's publish is live on `main`.** Rehearsed
  both orderings locally: merging it _before_ the data publish regresses the
  mobile menu (the newsletter CTA is replaced by 'Join Early Access' — a live
  functional loss); merging it _after_ renders both CTAs correctly on every
  device and the Solutions dropdown correctly shows only 'Shop Preview' +
  'Join Early Access'. Once step 2 is live, open this branch's commit as its
  own PR (or fold it into whatever branch is current) and merge normally —
  the same green-checks-then-merge discipline as T2.5.

Side effects to expect after step 2, both by design: `seed-navigation.mjs
--execute` re-runs will refuse with "already exists with a DIFFERENT body"
for `nav_header` — correct, the draft has legitimately moved past the
migration snapshot.
