# MASTER DEV TASK — KUGEL AGENTIC EDITORIAL WORKSPACE MVP

> **How to use this document.** This is the product vision and design law for the admin/editor
> redesign — project context, not a single coding task. Execution is milestone-by-milestone via
> `roadmap.md` in this directory, which corrects a small number of factual points against the
> verified repo state and weaves in the pre-existing bug register. Where this document and
> `roadmap.md` disagree on a *repo fact*, the roadmap wins; where they disagree on *product
> intent*, this document wins.

## Objective

Rework the current Kugel `/admin` experience into an object-oriented, agent-first Editorial Workspace.

This is not a conventional CMS redesign.

Do not create forms for every object field.
Do not expose every configurable setting because it exists.
Do not turn the agent into an optional assistant attached to traditional CMS controls.

The design principle is:

**The human focuses on an object. The object stays visually present. The publishing agent is always beside it. The human provides intent, judgment and small amounts of context; the agent performs the actual manipulation.**

The target editor has genuine subject expertise but may have little or no knowledge of online publishing, SEO, CMS architecture, conversion copywriting, website structure or design systems.

The platform's publishing agents already know the DTC / evergreen publishing workflow. Do not ask the editor to choose an agentic workflow.

The interface must minimize decisions, navigation, typing and configuration work.

## 0. BEFORE WRITING CODE — REQUIRED DISCOVERY

Inspect current `main`, especially:

- `packages/core/admin/AdminShell.tsx`
- `packages/core/admin/AdminHome.tsx`
- `packages/core/admin/ContentLibrary.tsx`
- `packages/core/admin/ObjectWorkspace.tsx`
- `packages/core/admin/ObjectPreview.tsx`
- `packages/core/admin/AgentsHub.tsx`
- `packages/core/admin/Studio.tsx`
- `packages/core/admin/chat.tsx`
- admin primitives / menus / overlays / data components
- admin clients used by those components
- object schemas under `packages/core/schema/`
- `editorial-voice-v1.ts`
- `article-content-v1.ts`
- `template-v1.ts`
- `section-template-v1.ts`
- `theme-v1.ts`
- `object-record-v1.ts`
- existing tests covering admin, object contracts, chat and publishing.

Do not assume file contents from this task. Re-read current `main`.

Inspect the current deployed Dr. Lurié admin (`/admin`, `/admin/content`, several `/admin/content/<object>`, `/admin/agents`, `/admin/studio`) and compare implementation with repository code. Do not fix unrelated visual/content bugs during this task.

Inspect the actual tenant's object inventory, contracts, editorial voice object, site object, navigation, templates, section templates, themes, current content items, artifact/PDF capabilities, and agent conversations where relevant. Do not mutate production data merely for discovery.

Inspect authoritative contracts and MCP operations for: object discovery/get, object creation, checkout / patch / checkin, validation, approval/review, publish, template instantiation, artifacts/PDF-tool bridge, conversations / object chat.

**Discovery deliverable.** Before implementation, produce a short implementation note containing:

1. existing components that will be reused;
2. existing APIs/MCP operations that already satisfy the new UX;
3. APIs/data missing for the MVP;
4. schema changes, if any, that are actually necessary;
5. routes that can remain aliases during migration.

Do not start by redesigning schemas. Prefer UI composition and derived view models over contract churn.

## 1. PRODUCT MODEL

The admin has one primary concept: the **Editorial Workspace**.

It is where humans:

- establish a publication;
- create missing objects;
- inspect publication objects;
- work on unpublished objects;
- manipulate site structure;
- create pages, navigation entries and sections;
- establish brand/editorial standards;
- establish reusable creation standards/templates;
- manage uploaded/generated media;
- inspect/manufacture PDFs and images through agents;
- prepare content prior to publication;
- approve objects;
- publish approved objects;
- eventually release a batch.

Editing already-published article copy on the live page/canvas remains a separate workflow and is not the focus of this refactor.

## 2. CONTROLLED USER-FACING VOCABULARY

Use these words consistently.

**Publication** — The complete publishing property/site.

**Object** — A governed unit the platform can create, inspect, change, reference, approve or publish. Use "object" where technically useful, but prefer a concrete human name when known: Page, Section, Image, PDF Template, Brand Voice.

**Template** — A reusable standard/specification used by the publishing system/agent to create something. The Editorial UI must accommodate at least these conceptual template families: Article, Page, Section, Image, PDF, Newsletter / Email. Do not assume they must all share the same backend object schema.

**Media** — Uploaded, found or manufactured visual/document artifacts: logos, product imagery, editorial imagery, illustrations, documents/PDF output where appropriate.

**Brand Voice** — The publication's governed editorial identity.

**Visual Identity** — The publication-level visual standards: themes/tokens, logos and visual direction. Do not call all of this "Theme"; a theme is currently only part of the implementation.

**Publishing Agent** — The user-facing name for the agent beside an object. Do not expose model/vendor names as primary UI.

**Status vocabulary** — Use: Draft → Approved → Published → Live.

- Draft — working state; not approved.
- Approved — accepted by the human/editor but not yet exported/published.
- Published — committed/exported into the publication build source, but not necessarily visible on production.
- Live — the release containing that published revision is confirmed deployed on the public site.

Do not label an object "Live" merely because it has previously been published if its latest published revision has not reached the currently confirmed production deployment. Investigate existing release/deploy metadata and derive Live where possible before adding persistent state.

## 3. USER EXPERIENCE PRINCIPLES — NON-NEGOTIABLE

**Object first.** The largest visual area belongs to the selected object or its visual representation.

**Agent always present.** The right rail is the object's Publishing Agent. The editor should not navigate to `/admin/agents` to work on an object.

**One focus target at a time.** The selected target can be: object, section, article portion, navigation node, template part, PDF page, image, image region, relevant nested element. A focus target does not automatically need to become its own persisted object.

**Progressive focus.** When a user drills from `Homepage → Education section → item`, the screen should narrow cognitively to that target while retaining breadcrumb context.

**No settings cockpit.** Do not render a control merely because the backend supports it. If an editor can naturally say "Make this more restrained.", prefer sending that context to the agent rather than displaying six typography controls.

**Clicks supply context.** Buttons/chips should usually do one of: select an object; select scope; select one meaningful bounded preference; insert context into the agent request; approve/reject an agent proposal; move to the next object.

**Few options.** Prefer 3–6 purposeful choices over large parameter panels. Think early-iPhone restraint rather than WordPress configuration density.

**Preserve spatial orientation.** The user should normally continue seeing: (1) where they are; (2) what object they are working on; (3) the object itself; (4) the agent conversation.

**No chat-only workflow.** Visual references, generated candidates, PDF pages, images, theme samples and previews belong in the object workspace, not buried as tiny chat attachments. The chat may reference them. The object area displays them.

## 4. NEW ADMIN INFORMATION ARCHITECTURE

Change primary editor navigation toward:

- **Editorial** — Default admin destination and publication/object browser.
- **Templates** — Browse reusable creation standards.
- **Media** — Browse uploaded/generated visual/document assets.
- **Content** — Browse articles/pages/drafts.
- **Release** — Batch publishing/deployment status.

Move the following out of normal editor attention: Agents, Component Kit, Guardrails, Admins, Maintenance, raw technical configuration. Owner/admin capabilities may remain under an unobtrusive **Settings / Platform** area.

Do not delete required routes immediately. Provide redirects/aliases or retain hidden owner routes during migration. `/admin/agents` should cease being a normal editor destination, but its agent infrastructure must be reused. `/admin/studio` should evolve into or be replaced by the Templates experience.

## 5. EDITORIAL ROOT — PUBLICATION MAP

Replace the current dashboard-oriented `/admin` emphasis. Current activity feed/stat cards/history are secondary information.

The default Editorial view should answer: **What makes up this publication, and what should I work on?** Keep the page sparse.

Suggested hierarchy:

**Foundation.** Show a small stable set of important publication objects/slots: Publication identity, Brand Voice, Visual Identity, Audience (only if this remains a separate useful concept), Editorial policy (only if backed by a meaningful object/contract). Existing objects open immediately. Missing objects display a quiet empty state with **Create**. Clicking Create should open a scoped agent creation workspace rather than a form.

**Structure.** Pages, Navigation, Shared sections where relevant. Do not show every page simultaneously on the root if there are many. Show a small summary and open an object browser/list on selection.

**Templates.** Show template families, not dozens of cards: Articles, Pages, Sections, Images, PDFs, Newsletters. Each displays count + representative preview where available.

**Media.** Logos, Product images, Editorial images, Illustrations, Other documents as applicable.

**Content.** Articles, Pages, Draft/incomplete work.

**Empty publication.** A brand-new publication with zero articles must still feel complete enough to begin. Do not present an empty analytics dashboard. Missing foundational objects should give the editor concrete starting points.

## 6. OBJECT BROWSER

Create/rework a compact object browser used inside Editorial. It is an orientation tool, not a spreadsheet.

Required: semantic search by human display name; category/family grouping; small status marker; counts; expandable hierarchy where a real hierarchy exists; selected-object state; object thumbnails only when visually useful.

Avoid: IDs in primary UI; large tables by default; last-modified columns everywhere; created-by; history metadata; excessive status pills.

Retain the existing Content Library table if owners need it, but the new Editorial browser should become the primary editor route to objects. Reuse the existing Cmd-K object inventory/fuzzy-finding infrastructure where appropriate.

## 7. OBJECT WORKSPACE — PRIMARY MVP SCREEN

Refactor `ObjectWorkspace`. Current implementation is chat-first. New implementation is object-first with a permanent agent rail.

Desktop target: orientation/browser roughly 18–22%; object workspace roughly 50–58%; agent rail roughly 26–32%. Exact CSS proportions may be tuned.

**Header.** Keep it restrained. Show: breadcrumb/context; human object name; object type only where useful; one status representation; primary state action. Potential actions: Save; Save & Add Next (where creation-in-sequence applies); Approve (where applicable); Publish (only where role/state permits); View live / Edit on site (where applicable); overflow menu. Do not put history, revision IDs, timestamps and agent/model information into the main header.

**Overflow.** Move rare actions/details behind `…`: Details, Activity/history, Raw data (owner only), Discard, technical diagnostics. History must consume no permanent workspace.

## 8. OBJECT LENSES

`ObjectPreview` should evolve into a system of object-specific lenses. A lens is primarily for seeing and thinking about an object. It does not imply direct manipulation.

Implement architecture such as `ObjectLensRegistry` or equivalent. Do not create one huge switch forever if this can be kept modular.

MVP lenses:

- **Page** — Rendered structure / useful preview.
- **Section** — Section preview with clear selected scope.
- **Article / content item** — Readable article/outline representation. Internal DTC strategy metadata such as hook/agitation must not appear as reader/editor labels.
- **Brand Voice / editorial_voice** — This currently needs a real lens. Render digestible sections from existing governed fields: audience; tone; cadence; preferred language; avoided language; claim policy; CTA policy; safety notes; article frameworks. Do not dump raw fields. Allow the agent to propose revisions beside this view.
- **Theme** — Visual token/sample representation.
- **Site / Visual Identity** — For MVP, construct a useful visual board from what currently exists: theme/tokens; logos/images if accessible; representative typography/color use. If no unified Visual Identity backend object exists yet, create a view model/aggregate lens before inventing a new persistent schema.
- **Navigation** — Readable tree.
- **Page template** — Visual/page-structure representation.
- **Section template** — Rendered sample section + purpose.
- **PDF template / PDF artifact** — If PDF templates/artifacts currently come through the PDF-tool subsystem rather than `template.v1`, adapt their actual contract. Display: page thumbnails; selected page large; generated candidate(s) when returned; useful template description.
- **Image standard/template** — Show representative imagery/candidates and succinct standard summary.
- **Image** — Large visual preview. Future region annotation can wait.
- **Newsletter/email template** — Show a rendered email-style preview if the existing contract supports it; otherwise implement the lens after confirming how newsletter templates are represented.

## 9. AGENT RAIL

The right column must be a genuine, obvious scrolling conversation. Do not replace chat with a list of AI buttons.

**Header.** `Publishing Agent`. Secondary text: `Working on: <current focus target>`. Do not display "Claude", model IDs, workflow selectors or technical routing in normal editor mode.

**Conversation.** Reuse existing `ChatThread`. Requirements: independent vertical scroll; full prior conversation for that object/focus context; auto-scroll on new messages as today; tool calls visually quiet unless action/approval is required; approval cards remain clear; generated visual results should link/activate the corresponding object workspace representation.

**Composer.** Persistent at bottom. Natural placeholder: `Ask for a change or describe what you need…`. Retain Enter-to-send / Shift+Enter newline.

**Context actions.** Above the composer or adjacent to it, add object-specific quick context controls. These are not commands that bypass the agent. Selecting one should preferably: set structured context for the next agent turn; or insert concise natural language into the composer; or send an unambiguous small instruction after user confirmation. Do not display more than a small useful set at once.

## 10. OBJECT-SPECIFIC QUICK CONTEXT

Implement a declarative mechanism rather than hardcoding random buttons inside every screen.

Suggested type: `ObjectContextAction` with fields conceptually like: id; label; applicable object/focus type; optional value choices; agent context/instruction builder; icon; optional visibility predicate. Do not expose internal agent prompts directly to the user.

Examples:

- **Section:** Add CTA; Remove CTA; Add another item; Reduce items; More concise; More educational; More persuasive. If a section supports a repeatable collection, a control like `Items: − 3 +` may be justified because the user instantly understands it. Do not expose the underlying array operations.
- **PDF template/page:** More visual; More text; Stronger branding; Softer branding; Add page; Shorten; More whitespace. No full layout editor in MVP.
- **Image standard:** More editorial; More product-focused; More clinical; More lifestyle; Less branding; More branding. Only expose choices consistent with the current publication.
- **Newsletter template:** Short; Standard; Detailed; Educational; Promotional; CTA emphasis.
- **Article/page:** Keep quick controls contextual and sparse. Do not expose internal copywriting strategy terms.

## 11. SAVE & ADD NEXT

Implement this as an important creation accelerator. Where the user is adding sequential siblings — especially sections, menu items, template parts, repeated object structures — provide **Save** and **Save & Add Next**.

Behavior of `Save & Add Next`:

1. ensure current agent-proposed work is accepted/saved;
2. finalize/check in the current focus target according to existing object semantics;
3. create or initialize the next valid sibling/focus target;
4. immediately focus that new target;
5. keep parent/publication context;
6. keep the Publishing Agent visible;
7. start the new target with a clean task focus while preserving relevant parent context;
8. do not force the editor back through object selection.

Example: `Homepage → Education section` → Save & Add Next → `Homepage → New section`. Composer can begin with: `What should this section accomplish?`

This is deliberately optimized for flow and reduced decision cost. Do not invent a large wizard around it.

## 12. ADD / CREATE INTERACTION

Use Add in logical parent contexts: Page → Add section; Navigation → Add item; Templates → Add PDF template; Media → Add image; Article structure → Add section/part if supported.

Clicking Add should:

1. establish the intended parent/object type;
2. create a scoped creation conversation/focus;
3. ask the minimum necessary question through the agent;
4. permit one-click context answers when obvious;
5. let the agent create the object via existing governed `object_create`/appropriate tool;
6. show the result in the object lens;
7. require existing approval semantics where a write requires approval.

No multi-field creation modal unless a field is truly impossible/reckless to infer conversationally.

## 13. TEMPLATE EXPERIENCE

The editor thinks in what something creates, not backend schema families.

Templates UI must expose: Article templates; Page templates; Section templates; Image standards/templates; PDF templates; Newsletter templates.

For MVP, first discover how each is actually stored. Do not extend `template.v1` blindly: it is currently page-specific. If PDF-tool maintains PDF template definitions separately, use/adapt that source. If image standards or newsletter templates lack a governed representation, stop and propose the minimum clean model rather than jamming them into page templates.

Each template workspace should contain: visual/example representation; purpose/when it is useful in plain language; the scoped Publishing Agent; sparse quick-context controls; status/actions.

Editors create or revise templates through the agent. Example PDF interaction: "Make this more appropriate for a premium evidence-led guide." Agent uses appropriate tool → generates candidate → candidate becomes the main preview → editor reacts. Do not bury the PDF candidate inside the chat transcript.

## 14. MEDIA + PDF-TOOL INTEGRATION

Keep PDF-tool technical plumbing server-side. Never expose: storage grants; PATs; blob store names; raw PDF-tool job data; internal MCP payloads.

When an agent manufactures an image/PDF:

1. show working state in agent rail;
2. poll the existing job rather than creating duplicates;
3. when complete, resolve the artifact;
4. display it in the object workspace;
5. let editor ask for another revision;
6. keep candidate history accessible but visually secondary.

For an image/PDF, the human interaction is: **look → request → compare → accept**, not: open image/PDF editor → manipulate controls.

## 15. ARTICLE MODEL

Do not change the existing principle separating private publishing strategy from presentation. Agents may continue using internal DTC strategy concepts.

The normal editor UI must not show labels such as: hook; agitation; offer mechanics; internal conversion strategy.

Render an article according to reader/editor-facing structure and content. If private metadata is useful for owners/debugging, keep it in technical details. The editor is supplying subject expertise, not becoming a copywriting operator.

## 16. STATUS AND RELEASE IMPLEMENTATION

Implement a single status helper/view model. Example conceptual API: `getEditorialObjectState(record, deployState)` returning `draft` | `approved` | `published` | `live`. Derive from existing review/publication/release metadata wherever possible. Do not duplicate truth.

- **Draft** — No valid current approval covering the current revision.
- **Approved** — Current revision approved but no matching publish receipt yet.
- **Published** — Current approved revision has a publish/export receipt, but its containing commit has not been confirmed as production-live.
- **Live** — The relevant published revision/commit is known to be present in the latest confirmed live deployment.

Investigate exact current release/deploy endpoints before implementing comparison.

**Batch release.** Keep Release separate from per-object Publish. Publishing may accumulate commits/exports without triggering Netlify. Release triggers the batch build. UI should clearly say something like `12 published changes waiting to go live` rather than ambiguous "unpublished changes" terminology when the changes have actually been published but not deployed. Do not trigger a Netlify build on every object publish.

## 17. REMOVE / DE-EMPHASIZE

From normal editor workspace, remove/de-emphasize: agent roster; workflow/model selection; generated raw object inspector; permanent history view; timestamps unless directly relevant; created-by fields; large stat cards; activity feed as homepage centerpiece; raw JSON; schema terminology; object IDs; developer-oriented readiness dumps; repeated status chips; duplicate Publish/Release language; broad settings forms; Component Kit; Maintenance; Guardrails administration.

Do not delete underlying capabilities required by owners. Move them to owner/advanced surfaces.

## 18. ACCESSIBILITY / ADHD-FRIENDLY REQUIREMENTS

The interface should be intentionally calm.

Requirements: one obvious dominant object; one obvious conversation; one primary action per state; strong spatial consistency; avoid large collections of equally weighted cards; avoid dashboard noise; no surprise panel movement during chat updates; preserve keyboard navigation; visible focus states; sensible ARIA labels; independent chat scrolling; sticky composer; sticky object/workspace header only if it helps orientation; no endless full-page scroll combining browser, object and chat; avoid unnecessary animation; use progressive disclosure; keep visual hierarchy stronger than decorative styling.

Responsive behavior should preserve this model. On narrow desktop/tablet, object browser may collapse first. The agent should remain easily reachable.

## 19. IMPLEMENTATION TASKS / COMMIT SEQUENCE

Execute in this order.

- **Task 1 — Freeze vocabulary and view-model types.** Create the UI vocabulary/status helpers and object-category/view-model layer. No major UI refactor yet. Add tests.
- **Task 2 — Refactor AdminShell IA.** Introduce new navigation. Keep legacy/owner routes accessible. Do not break deep links. Update command palette destinations.
- **Task 3 — Build Editorial root.** Replace/rework AdminHome into the sparse Publication Map. Reuse existing inventory data. Do not add backend endpoints unless necessary.
- **Task 4 — Build Editorial object browser.** Create lightweight grouped browser/search. Reuse inventory/cache logic from ContentLibrary/AdminShell.
- **Task 5 — Refactor ObjectWorkspace layout.** Convert from chat-first 3:2 to: browser/orientation + dominant object + right agent rail. Preserve: per-object chat creation; write refresh; locking; validation; approval mechanism; existing object verbs. Move technical details to overflow/drawer.
- **Task 6 — Stabilize agent rail.** Reuse `ChatThread` and `ChatComposer`. Make the rail independently scrollable with sticky composer. Add explicit current focus target. Do not rewrite backend chat.
- **Task 7 — Introduce Object Lens registry.** Move type-specific preview rendering behind modular lenses. Preserve existing working previews. Add Brand Voice lens first. Then improve template/theme/site lenses.
- **Task 8 — Implement scoped quick-context actions.** Declarative object/focus-specific chips/options. Ensure actions supply context to agent rather than directly manipulating arbitrary backend fields. Unit test instruction/context builders.
- **Task 9 — Implement Add and Save & Add Next.** Start with one concrete path: Page → Add section → agent creates/patches → Save & Add Next. Do this path completely before generalizing. Then extend to other suitable sibling structures.
- **Task 10 — Templates IA.** Replace current Studio-facing taxonomy with editor-facing families. Reuse page/section/theme implementation. Discover and wire PDF template source. Document gaps for Image and Newsletter template representation rather than inventing bad schemas.
- **Task 11 — PDF object lens.** Wire existing Platform/PDF-tool bridge into visual workspace. Show artifact centrally. Keep tool execution in agent. No manual PDF editing.
- **Task 12 — Publishing-state UI.** Implement Draft / Approved / Published / Live derived state. Update Content/Editorial/Release labels consistently. Retain batch Netlify release.
- **Task 13 — Retire Agents as primary editor page.** Normal editors should encounter agents through objects. Keep `/admin/agents` for owner diagnostics/legacy if necessary. Remove it from primary editor navigation.
- **Task 14 — Simplification pass.** Audit every visible button, tab, field, chip, card, status, tooltip. For each ask: Does this help an editor understand the object, give useful context to the agent, make a necessary decision, or advance the workflow? If no, remove it from the primary surface.

## 20. BUTTON RULES

Every primary-screen button must satisfy one of these purposes:

- **Navigation** — Open/focus an object.
- **Context** — Tell the agent something quickly.
- **Workflow** — Save / Save & Add Next / Approve / Publish / Release.
- **Comparison** — Accept candidate / Try another.
- **Recovery** — Cancel / discard / retry.

Avoid buttons for operations the agent can infer and perform conversationally. No "Edit every property" button.

## 21. FORM RULES

Forms are the exception. A form field is justified only where: the user already knows the exact value; typing it conversationally would be slower; the value is bounded and obvious; mistakes have enough consequence that explicit selection improves safety.

Good examples: count; one of 3 presentation choices; upload/select a logo; URL/domain where required; publish approval decision.

Bad examples: full brand-voice form; 30 theme token inputs; SEO form for inexperienced editor; layout parameter panel; giant article metadata form.

The agent should gather/infer those values through conversation and propose the resulting governed object.

## 22. GENESIS — KEEP OUT OF THIS MVP IMPLEMENTATION, DESIGN FOR IT

Do not rebuild provisioning in this UI task. However, architecture must accommodate a future **Create publication** action. The eventual UX should allow creation with almost no prerequisite information. A publication may initially be unnamed/incomplete. Genesis may create baseline/site objects through the existing provisioning workflow, after which Editorial shows missing/incomplete foundation slots. Do not implement a long onboarding wizard. Do not require brand decisions before creating the publication.

## 23. NON-GOALS

Do not: redesign the public article canvas; rebuild the agent runtime; introduce multiple selectable publishing workflows; build a manual PDF editor; build a manual image editor; build a Canva/Figma clone; expose all theme tokens; gamify the product in this pass; change DTC agent instructions merely to fit UI; rewrite publishing contracts without demonstrated need; trigger Netlify on every publication action; solve future multi-agent routing; rewrite unrelated tenant content.

## 24. TESTING

For each phase run existing project checks plus targeted tests. At minimum verify:

**Navigation:** all new primary destinations; legacy deep links; role-restricted surfaces.

**Object workspace:** loads with object selected; scoped chat loads; long conversation scrolls; composer stays usable; accepted write refreshes visual lens; rejected/failed write does not falsely update preview; lock behavior remains correct.

**Quick context:** correct context for correct object type; no action shown where unsupported; no private strategy vocabulary exposed.

**Save & Add Next:** current work persists; exactly one new sibling/target created; parent context retained; focus moves correctly; no accidental duplicate creation on retry.

**Publishing:** Draft state; Approved state; Published-but-not-Live state; Live after confirmed release; failed/stalled Netlify build; multiple published objects released in one batch.

**Empty states:** completely new publication; no articles; missing brand voice; no PDF templates; no media. Empty states must provide a direct agentic next action.

**Accessibility:** keyboard; focus order; ARIA; visible focus; color/status not sole signal.

## 25. DONE CRITERIA

The MVP is successful when an inexperienced editor can perform this sequence without understanding CMS terminology:

1. open Editorial;
2. see what makes up the publication;
3. open Brand Voice;
4. visually understand what has been defined;
5. tell the already-present agent how it should change;
6. review/approve the proposal;
7. navigate to a Page;
8. select/add a Section;
9. work only on that section with the agent;
10. use Save & Add Next to continue;
11. open a PDF template;
12. see the PDF prominently;
13. request a visual change through the agent;
14. see the manufactured result in the object area;
15. approve it;
16. identify whether an object is Draft, Approved, Published or Live;
17. publish several objects without automatically paying for separate Netlify builds;
18. release the accumulated published work as a batch.

If accomplishing this requires navigating to Agents, manipulating raw fields, understanding object IDs, choosing an AI workflow, or learning internal publishing strategy vocabulary, the design is not finished.

## 26. FIRST IMPLEMENTATION MILESTONE

Do not attempt all tasks in one giant PR. The first coding milestone should contain only:

- A. AdminShell IA
- B. Editorial root / Publication Map
- C. Object browser
- D. ObjectWorkspace object-first layout + permanent agent rail
- E. Brand Voice visual lens
- F. existing chat/approval/write behavior preserved

Do not implement PDF templates, image templates, Save & Add Next, or status overhaul until this first spatial model is working and can be evaluated in the browser.

At the end of milestone 1: run checks/tests; open the deployed admin; inspect `/admin`; open Brand Voice; open Homepage; open an article; compare each against the product principles above; provide screenshots and list remaining visual/behavioral problems before beginning milestone 2. Do not continue blindly into milestone 2.

## Important instruction to the coding agent

Favor removal over addition. Do not compensate for uncertainty by adding another tab, field, filter, card, toggle, setting or modal.

When uncertain, first ask: **Can the Publishing Agent handle this while the editor simply sees the object and supplies intent?** If yes, keep it in the agentic workflow.

The purpose of this interface is not to expose the power of Kugel. The purpose is to make that power disappear behind a calm workspace where a person can think about one thing at a time.
