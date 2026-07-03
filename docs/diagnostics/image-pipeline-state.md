# Image pipeline — current state

**Purpose:** one forward-looking reference for the image/PDF pipeline as it stands after
the 2026-07 diagnostic + audit-fix sessions (PRs #326–#339). This is a synthesis, not new
analysis — every claim below traces to a commit, PR, or an existing diagnostic doc.

**Source documents** (read these for the full reasoning; not restated here):
`docs/diagnostics/image-publish-trust-index.md`, `docs/diagnostics/post-publish-render-gap.md`,
`docs/diagnostics/live-rendering-audit.md`, `docs/agents/publishing-instructions.md`.
Architecture docs (`docs/cms-architecture/*`) describe a future, separate CMS layer and are
out of scope here.

---

## 1. What is now solid (resolved)

| # | Defect | Fixed in | Regression test |
|---|---|---|---|
| 1 | Pre-publish trust check (`gatherTrustedArtifactRefs`) read only `agent_outputs`, diverging from the index-based publish-time resolver — an artifact visible via `list_artifacts_for_request` could still be rejected by `patch_canonical_input`. | #327 | `tests/netlify/save-json-blob-patch-canonical-input-index-trust.test.ts` |
| 2 | Legacy `media.type` inference for `src/assets/.../uploads/` paths defaulted to `'image'` unconditionally, mislabeling PDF uploads. | #328 | `tests/netlify/save-json-blob-media-type-and-artifactref-placement.test.ts` |
| 3 | `artifactReferences` nested anywhere other than the top-level `output.artifactReferences` array were silently dropped — publish succeeded with an empty media array and no error. | #328 | `tests/netlify/save-json-blob-media-type-and-artifactref-placement.test.ts` |
| 4 | A raw artifact `blobKey` could survive into committed Markdown/frontmatter with no public route to serve it (silent post-publish 404). | #329 (`validateCommittedImageReferences` guard added); test coverage for its throw branches landed later in #337 | `tests/netlify/publish-committed-image-validation.test.ts` |
| 5 | `request_id` format was validated only at record creation, not at every mutating workflow action. | #330 | `tests/netlify/save-json-blob-request-id-format.test.ts` |
| 6 | An image node without `rendering.placement: 'inline'` silently failed to render in the published body with no signal to the agent. | #331 | `tests/netlify/publish-article-image-render-warning.test.ts` |
| 7 | `save_json_blob_create_request`/`_create_article_draft` accepted a missing `request_id` and fell back to `createRequestId()`, which mints `req_<uuid>` — a format `validateRequestId` always rejects. | #334 | `tests/netlify/mcp-tool-contract.test.ts` |
| 8 | Article-body media JSON schema (MCP tool input validation) omitted the `document` type and `title`/`contentType` fields that the zod schema and publish pipeline already supported. | #334 | `tests/netlify/mcp-tool-contract.test.ts` |
| 9 | `save_json_blob_publish_by_time` description claimed "future timestamps save only"; future timestamps actually materialize media and commit the article (only the `published_time` gate hides the page). | #334 | `tests/netlify/mcp-tool-contract.test.ts` |
| 10 | A document(PDF)-only article could have its PDF `blobKey` selected as `featuredImage` and written into the frontmatter `image:` field (document candidates entered selection at priority 0 and could win when no image candidate existed). Found by Codex review on #334. | #334 (follow-up commit `e8695e6`) | `tests/netlify/publish-by-time-media.test.ts` |
| 11 | Legacy `save_artifact` validated image bytes only when `artifactKind === 'image'`, so an `image/*` payload uploaded under another kind skipped sharp validation; it also never validated the `%PDF-` header at all. | #335 | `tests/netlify/artifact-lifecycle-guards.test.ts` |
| 12 | Re-uploading the exact bytes of a soft-deleted artifact returned the deleted reference as a success, but listing/trust/publish kept excluding it — no recovery path. | #335 | `tests/netlify/artifact-lifecycle-guards.test.ts` |
| 13 | `listArtifactReferencesForRequest` used `by-request` pointers exclusively whenever any existed, so one failed pointer write (writes are not atomic) hid an artifact whose `request-artifacts/` reference JSON existed. | #335 | `tests/netlify/artifact-lifecycle-guards.test.ts` |
| 14 | `admin-patch-workflow.ts` carried its own duplicate `gatherTrustedArtifactRefs` (agent_outputs-only), diverging from #327's unified helper — the human admin path rejected index-trusted artifacts the MCP path accepted. | #336 | `tests/netlify/canonical-promotion-trust.test.ts` |
| 15 | Untrusted-artifact rejection messages were generic ("not found in agent_outputs artifact indexes") regardless of cause, making self-diagnosis impossible. | #336 | `tests/netlify/canonical-promotion-trust.test.ts` |
| 16 | `create_request` (`admin_publish_draft` mode) accepted image nodes with `media.src` set to a plain `https://` URL or `data:` URI — never materializable at publish. | #336 | `tests/netlify/canonical-promotion-trust.test.ts` |
| 17 | Hero-suppression collision: a hero-designated inline image node whose artifact loses the hero-slot selection to a different candidate rendered in **neither** the body nor the frontmatter, with no warning (#331's warning explicitly skips inline-placed nodes). | #337 | `tests/netlify/publish-committed-image-validation.test.ts` |
| 18 | `verify_article_images` exact-matched expected URLs against page `<img src>` values, but Astro rewrites committed assets to hashed `/_astro/...` build URLs — verification of any committed asset was guaranteed to fail. | #338 | `tests/netlify/verify-article-images-matching.test.ts` |
| 19 | `verify_article_images` had no deploy-timing awareness — an immediate check could hit the pre-deploy page and return false negatives indistinguishable from a real defect. | #338 | `tests/netlify/verify-article-images-matching.test.ts` |
| 20 | Admin `node-renderer.ts` showed a permanent placeholder for image-artifact nodes, claiming blobKeys "cannot be resolved to a real URL in the browser" — the identity-gated `admin-get-blob-image` function can serve exactly those bytes. | #338 | `tests/netlify/verify-article-images-matching.test.ts` (artifact-preview loader unit tests) |
| 21 | Admin preview rendered every image node regardless of `rendering.placement`, while the live page drops anything non-inline — the editor gave no warning before publish. | #338 | *No automated test* — DOM-only rendering change; `tests/netlify/` is a server-side `node:test` harness with no browser/DOM test target for `node-renderer.ts`. |
| 22 | `docs/agents/publishing-instructions.md` — the contract other tooling/PRs referenced — did not exist in the repository. | #339 | N/A (documentation) |

**Not a defect fix, noted for completeness:** #326 is diagnosis only (no code change); #332 added
confirmation tests for multi-inline-image and image+PDF-CTA publish paths without finding a defect
(both already worked correctly).

---

## 2. Known gaps, deliberately deferred

- **Row 21's placement note has no regression test.** `node-renderer.ts` runs in the browser
  (DOM APIs) and the project's test harness (`tests/netlify/*.test.ts`, Node's built-in
  `node:test`) only exercises server-side Netlify functions. Nothing broke by deferring
  this — the behavior is verified by manual/visual review only — but a regression here
  would go undetected by CI.

- **Renderer parity (admin vs. published) beyond image handling** — `docs/diagnostics/live-rendering-audit.md` §2, confirmed unchanged by this work:

  | Node shape | Admin renderer | Published Markdown |
  |---|---|---|
  | `presentation: 'faq'` | q/a pairs rendered as `<dl>` | flattened to a `- item` bullet list |
  | `presentation: 'chatInvite'` | styled card + disabled chat button | only eyebrow/title/body text; `chat.invitationText` never serialized |
  | `presentation: 'adSlot'` | dashed placeholder box showing `label` | nothing — the node produces no output at all on the live page |
  | `commercial.rel` / sponsored disclosure attrs | not rendered | not serialized — the link ships as a plain `<a>`, no `rel="sponsored"` |

  Concretely: an editor previews an `adSlot` node and sees a labeled placeholder; the
  published article has no trace of it. A `chatInvite` node's invitation text is written by
  an agent, shown in the editor, and never reaches the reader. Deferred because fixing it
  means extending `to-markdown.ts` (a load-bearing file explicitly kept minimal per the
  audit's own constraint) or accepting a rendering behavior change — a product decision,
  not a bug fix, and out of this audit's "fix defects, don't extend features" scope.

- **`describeUntrustedArtifactRef` cross-request/soft-delete messages depend on same-request
  index reads only.** Cross-request pointers are still resolved permissively at publish time
  (`buildCanonicalPublishPayload`'s cross-request lookup, unchanged by #336) — staging
  rejects them, publish still accepts them by design. This asymmetry is intentional
  (`image-publish-trust-index.md` §5, "Design R") and not a new gap, just worth restating:
  staging trust ≠ publish trust for cross-request refs.

- **Index writes are still not atomic.** `writeArtifactReferenceIndexes` performs 4+
  independent blob writes (`request-artifacts/`, `by-kind/`, `by-request/`, `by-tag/`) via
  `Promise.all`. #335 made *listing* resilient to a partial failure (union of pointers +
  reference JSON), but a partial write still leaves the index internally inconsistent —
  the underlying non-atomicity was mitigated, not fixed.

- **No public `/image/*` fallback route.** PDFs have `/pdf/*` → `get-public-pdf.ts` as a
  blob-backed serving fallback; images have no equivalent (`post-publish-render-gap.md`,
  "Image artifacts vs PDF artifacts"). #329's pre-commit `validateCommittedImageReferences`
  guard now blocks the raw-ref-survives-uncommitted failure mode that made this matter in
  practice, so the residual risk is low — but the architectural asymmetry itself is
  unchanged.

- **Hero-suppression collision (row 17) is warn-only, not a hard block.** The publish still
  succeeds (201) with a `hero_image_not_rendered` warning; it does not reject the publish
  or auto-correct the hero selection. This mirrors #331's existing `image_not_rendered`
  pattern (warn, don't block) but was a deliberate choice, not the only option.

- **Accepted image formats remain JPEG/PNG/WebP only** (sharp-validated) across every
  upload path. This predates the audit; #334 only made the *documentation* match reality.
  GIF, AVIF, and SVG are rejected everywhere. Not fixed because expanding accepted formats
  is a scope decision, not a defect.

- **Diagnostic-doc items requiring production access, not a code fix** (`image-publish-trust-index.md` §6, still open):
  - How often agents place `artifactReferences` correctly (top-level, right shape) in
    practice — determinable only from production logs/traces, not static analysis.
  - Blob-store eventual-consistency timing under real Netlify Blobs (vs. the in-memory
    test fakes used throughout `tests/netlify/`).
  - `pdf-tool`'s internal write path into the artifact index — `pdf-tool` is an external
    service outside this repo's scope; its behavior is inferred from
    `docs/agents/pdf-tool-artifacts.md`, not verified from its source.

---

## 3. Prioritized next actions

Ranked by (user-visible impact × likelihood of being hit) / effort. "Model" indicates
whether the work needs judgment calls (high-capability model) or is mechanical (mostly
pattern-following, fine for a smaller/cheaper model).

1. **Add a DOM/browser test for the placement-mismatch note (row 21).** Closes the one
   test gap in this audit's own work. Effort: **S**. Model: mechanical — needs a
   jsdom-or-similar harness added to the project (not currently present for
   `src/lib/admin/*.ts`), then a straightforward assertion.
2. **Decide and implement: hard-block or keep warn-only for the hero-suppression collision.**
   If Wolf wants publish to refuse rather than warn, this is a small, well-scoped change to
   `collectUnrenderedImageWarnings`'s caller in `publish-article.ts` (already has the exact
   node/path data needed). Effort: **S**. Model: mechanical once the decision is made.
3. **`faq`/`chatInvite`/`adSlot` render-parity** — implement in `to-markdown.ts`, or make
   the schema/validation reject those presentations for published (non-draft) articles so
   the gap can't reach an editor's preview silently. Highest *product* impact of anything
   deferred (an agent-authored `adSlot` currently vanishes with zero signal), but requires
   a design decision first (see Open Questions). Effort: **M** either direction. Model:
   needs judgment — deciding the *rendering* for `faq`/`chatInvite` in Markdown, and
   whether `adSlot` even belongs in `to-markdown.ts` vs. a dedicated ad-serving mechanism,
   isn't mechanical.
4. **Public `/image/*` fallback route mirroring `/pdf/*`/`get-public-pdf.ts`.** Defense in
   depth now that #329 blocks the main failure mode; lower urgency than when
   `post-publish-render-gap.md` was written. Effort: **S** (the PDF route is a direct
   template). Model: mechanical.
5. **Make artifact-index writes atomic** (e.g., single JSON blob per request instead of
   scattered pointer files, or a documented reconciliation job run on a schedule). Real
   architectural change to `netlify/lib/artifact-index.ts`'s key scheme — touches
   `list_artifacts_by_kind`/`by_request`/`search_artifacts` and the migration/reconcile
   tools too. Effort: **L**. Model: needs a high-capability pass — this is the kind of
   change that can quietly break three call sites if done mechanically.
6. **Production observability for agent artifact-placement errors** (item in §2) — add
   structured logging/alerting on `misplaced_artifact_references` and
   `invalid_node_media_src` rejections so "how often do agents get this wrong" becomes
   answerable without re-deriving it from logs by hand. Effort: **S–M** depending on
   existing logging infra. Model: mostly mechanical.
7. **Expand accepted image formats (GIF/AVIF/SVG).** Nobody has asked for this and it's not
   blocking anything today — lowest priority on this list, listed for completeness only.
   Effort: **S** (sharp already decodes these formats; the validators just allow-list
   jpeg/png/webp). Model: mechanical, but SVG specifically needs a security review
   (XML/script injection risk) before enabling — do not treat as pure mechanical work if
   SVG is in scope.

---

## 4. Open questions for the human

1. **Render parity for `faq`/`chatInvite`/`adSlot`:** should `to-markdown.ts` be extended to
   serialize these presentations into the published article (so the editor preview matches
   the live page), or should article creation/validation reject nodes using these
   presentations until they're supported — rather than silently producing degraded/no
   output on the live page as it does today?
2. **Hero-suppression collision severity:** should publish continue to succeed with only a
   `hero_image_not_rendered` warning (current behavior, #337), or should it become a hard
   422 that blocks the commit until the agent fixes the hero/featuredImage mismatch?
3. **Image format support:** should GIF, AVIF, or SVG be added to the accepted image formats
   (currently JPEG/PNG/WebP only, enforced by sharp validation on every upload path), or is
   the current set intentional and final?
4. **Public image-serving fallback:** is a `/image/*` route (mirroring `/pdf/*` →
   `get-public-pdf.ts`) worth building as defense in depth, given #329 already blocks the
   main failure mode that used to make its absence dangerous?
5. **Artifact-index write atomicity:** is the current mitigation (resilient *listing* via
   #335's pointer+reference union) sufficient long-term, or does the underlying
   non-atomic multi-blob write in `writeArtifactReferenceIndexes` need a real architectural
   fix (item 5 in §3)?
6. **T1–T9 test-scenario identifiers:** `docs/agents/publishing-instructions.md`'s
   provenance note flags that the T1–T9 scenario IDs referenced in the original task brief
   are not defined anywhere in this repository. Do these IDs exist in an external spec Wolf
   owns (in which case they should be added to the doc), or do they need to be authored now
   — and by whom?
