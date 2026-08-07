# M4 done-criteria register

Recorded: 2026-08-07

## Outcome

M4 implements one derived editorial lifecycle (`Draft`, `Approved`, `Published`, `Live`), keeps agent work as a separate transient state, adds a batch Release workspace, removes Agents from the editor navigation, and simplifies the lock and approval UI.

No lifecycle or work status is persisted on governed objects. The UI derives lifecycle from the current revision, review decision, publish receipt, and confirmed production deploy.

## Done-criteria walkthrough

| Step | Result | Evidence |
| --- | --- | --- |
| 1–4. Open Editorial, understand the publication, open and understand Brand Voice | Implemented | Publication Map and Brand Voice lens remain shared across all tenants. |
| 5–6. Ask the present agent for a change and review/approve it | Implemented | Object-scoped Agent Rail, candidate stage, and governed approval flow remain in the Object Room. |
| 7–10. Open a Page, focus/add a Section, and Save & Add Next | Implemented | Page section focus and sequential proposal path remain object-local. |
| 11–15. Open a PDF template, see it, request a visual change, see the result, approve it | Implemented with the representation limits in `m3-template-representation-gaps.md` | PDF template room, authenticated preview, artifact refresh, and object-stage comparison are shared across tenants. |
| 16. Identify Draft / Approved / Published / Live | Implemented and unit tested | `getEditorialObjectState` covers current/stale approval, current export, confirmed live commit, and autonomous object types. |
| 17. Publish several objects without separate builds | Preserved | Object Publish exports only; it does not invoke Netlify release. |
| 18. Release accumulated work as a batch | Implemented | The Release workspace shows the waiting set and invokes the existing single production-release action once. |

## M4-specific acceptance

- Lifecycle and transient work states are shown separately in the Object Room and publication browser.
- `Working · N` and `Needs you · N` are compact global utilities, backed by chat and review state rather than a new task store.
- Release shows published-but-not-live objects, pending approvals, active work, failed/stalled deploys, and one batch release action.
- Agents is absent from the five-item editor navigation and remains Owner-only under Settings for diagnostics.
- The large lock banner is removed from the Object Room. A compact lock icon refreshes the record every four seconds and disappears after check-in; Owner release remains in the existing overflow menu.
- Agent rail and candidate/approval surfaces use quieter neutral surfaces. Approval details and JSON are progressive disclosure.
- Editors can choose `Ask each time` or `Approve safe actions` for the current run. The safe mode is an allow-list; publish, discard, deletion, theme changes, artifact generation, release, and unknown tools still require an explicit decision.
- Engagement was not added.

## Verification

- Astro/type diagnostics: 0 errors.
- ESLint: pass.
- Core and script tests: 1,909 + 110 pass.
- Netlify/integration tests: 1,302 pass.
- `drlurie`, `fernwell`, and `platform` production builds: pass using their site configs.
- Fresh-site dry-run fixture: 77 files and the new per-site release-state function match generated output.

## Unverified or deferred

1. Signed-in screenshots could not be captured locally. The browser reached the real admin authentication boundary on all attempted local routes, and no authentication bypass was added. The three build outputs prove the shared surfaces render server-side, but a signed-in visual walkthrough is still required after deploy.
2. A real production batch release was not triggered from the local verification run. Doing so would release whatever is currently queued in the live publication. The existing release endpoint is reused and its auth boundary is tested.
3. A completely missing foundation object still starts a free creation chat in the retained Owner Agents surface because no governed object exists yet to host an Object Room. Existing objects never require the Agents page. A future object-creation room should close this empty-publication edge case.
4. The user-referenced `Later additions to catch up` directory was not present in this checkout, so no additional files from that directory could be evaluated. The previously supplied mockup and written additions were incorporated where they matched M4.
