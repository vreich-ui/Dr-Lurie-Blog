# Agent publishing instructions — articles with images and PDFs

The contract agents must follow to publish an article through the Dr. Lurie MCP server so
that every image and PDF actually renders on the live page. This document reflects the
pipeline as of the image-pipeline audit (PRs #326–#332 plus the audit fix series); tool
descriptions in `netlify/functions/mcp.ts` are the machine-readable version of the same
contract — if they ever disagree, one of them is a bug.

Companion references: `docs/agents/artifact-upload-paths.md` (upload transport),
`docs/agents/naming-convention.md` (ids, slugs, filenames),
`docs/agents/article-content-structure.md` (article_body.v1),
`docs/diagnostics/*` (why these rules exist).

---

## 1. The publish sequence

```
1  save_json_blob_create_request          (request_id REQUIRED — never auto-generated)
2  create_artifact_upload_intent → POST /api/artifacts/upload     (per image/PDF)
   └ or create_artifact_from_url / save_artifact (legacy, small payloads)
3  save_json_blob_checkout_request        → lock_token
4  final_article_update_output            (top-level output.artifactReferences[])
   └ and/or save_json_blob_patch_canonical_input (node_patches, promote_publish_payload)
5  save_json_blob_publish_by_time         → status published | time_set | unpublished
6  deploy_status (poll by commit until deployStatus === "ready")
7  verify_article_images                  (only after step 6)
8  save_json_blob_checkin_request
```

- `request_id` must match `req_<flow>_<topic>_<yyyymmdd>_<nn>` (lowercase snake_case). It is
  never auto-generated; omitting it fails with `missing_request_id`. A non-conforming id
  breaks every later artifact operation for the request.
- Every mutating call requires the checkout `lock_token`; refresh before the lease expires.

## 2. Image and PDF artifact contract

- **Accepted image formats: JPEG, PNG, WebP only.** Bytes are decoded server-side (sharp) on
  every upload path; GIF, AVIF, SVG, or bytes that do not decode as the declared content
  type are rejected with 400. PDFs must begin with `%PDF-`.
- **Store only the returned `ArtifactReference`.** Never synthesize blobKeys, repo paths, or
  URLs. The blobKey shape is `{kind}/{requestId}/{sha256}{ext}` and is validated everywhere.
- **Trust is per-request.** An artifact is usable in canonical input if it was uploaded for
  THIS request (it appears in `list_artifacts_for_request`) or already sits in
  `agent_outputs[*].output.artifactReferences`. Cross-request blobKeys are rejected at
  patch time with an error naming the owning request — re-upload the bytes under the current
  request id.
- **Soft delete:** a reference carrying `deletedAtISO` is excluded from listing, trust, and
  publish. `get_artifact_metadata` still returns it so you can see the state. Re-uploading
  the exact bytes restores it (`restored: true` in the upload response); admins can also run
  `restore_artifact`.
- **artifactReferences placement:** publish reads ONLY the top-level
  `output.artifactReferences` array of `final_article_update_output`. Refs nested anywhere
  else are rejected with `misplaced_artifact_references` rather than silently dropped.

## 3. Node media contract (article_body.v1)

- Image node: `public.media = { type: 'image', src: <artifact pointer>, alt, caption? }`.
  The `src` MUST be an artifact pointer (`image/{requestId}/{sha256}.{ext}`) or an existing
  committed upload path. Plain `https://` URLs and `data:` URIs are rejected
  (`invalid_node_media_src`) at draft creation and at patch — they would never be
  materialized into the commit. Non-image media (`video`, `audio`, `embed`) may use remote
  URLs.
- **Inline rendering requires `rendering.placement: 'inline'`.** Without it the node's image
  is NOT rendered in the published body; the publish succeeds with an `image_not_rendered`
  warning naming the node. Only `'inline'` renders media today.
- **Hero image:** give the node id `n_hero` and reference the same artifact as the publish
  `featuredImage`. The hero image is emitted to the frontmatter `image:` field, not the
  body. A hero-designated node whose artifact is NOT the resolved hero-slot image appears
  nowhere and the publish response carries a `hero_image_not_rendered` warning naming the
  orphaned node — fix it by aligning `featuredImage` with the node's artifact.
- **Missing hero/featured image is allowed by default.** The hero image resolves ONLY from an
  explicit `featuredImage` or `existingFeaturedImagePath` — there is no fallback that guesses
  one from the article's media. If neither is supplied, publish still succeeds (2xx) with no
  `image:` frontmatter and a `missing_featured_image` warning; if that was intentional, no
  action is needed, otherwise set `featuredImage` and republish.
- **`HERO_IMAGE_REQUIRED` is an operator-level setting, not agent-controlled.** It is an
  environment flag the site operator sets ahead of a proper per-site/per-article settings
  system; agents cannot set or override it per request. When enabled, a publish that resolves
  no hero/featured image is rejected with 422 `featured_image_required` before any commit —
  even when the article has no images at all — instead of emitting the
  `missing_featured_image` warning.
- Document (PDF) node: `public.media = { type: 'document', title, src: pdf blobKey }` —
  renders as a link to `/pdf/{requestId}/{sha256}.pdf`. PDF CTA links (`public.ctaLink`)
  must use the exact `artifactReference.blobKey`; derived or placeholder links are rejected
  with 422.
- One artifact may serve several slots (hero + inline): it is deduplicated by sha256 into
  one committed file with multiple references.

## 4. publish_by_time semantics

| `published_time` | What happens | Result status |
|---|---|---|
| omitted, or ≤ now | materialize media, commit article, stamp time | `published` |
| future ISO | SAME materialize + commit; the page stays hidden by the published_time gate until the time passes and the site rebuilds | `time_set` |
| `null` | re-commit with `published_time: null` (unpublish) | `unpublished` |

A failed publish never changes `published_time`. The publish response includes `commit`,
`deployStatus`, media paths, and any warnings.

## 5. Verification

Call `verify_article_images` ONLY after the deploy for the publish commit is live: poll
`deploy_status` until `deployStatus === "ready"` (deploys take 30–120 s; an immediate check
hits the previous deploy).

- Pass the display paths from the publish response
  (`~/assets/images/uploads/{slug}/{file}.png`). Astro rewrites committed assets to hashed
  build URLs (`/_astro/{file}.{hash}.{ext}`), so matching falls back from exact URL to
  filename-stem; each result reports `matchedUrl`/`matchedBy`.
- `inconclusive: true` (page unreachable or non-200 `pageStatus`) means the deploy is
  probably not live yet — retry after the deploy is ready. It is NOT a proven defect.

## 6. Publish result classification

Classify every publish attempt with exactly one of these statuses:

| Status | Condition |
|---|---|
| **PUBLISHED** | publish returned 2xx AND (no warnings) AND `verify_article_images` ran against the live deploy with `verified: true`. |
| **PUBLISHED_WITH_DEFECTS** | publish returned 2xx, but the response carried warnings (`image_not_rendered`, `hero_image_not_rendered`, `missing_featured_image`) OR verification against the LIVE deploy (`inconclusive: false`) reported missing/failed images. The article is live; something visual is wrong (or, for `missing_featured_image`, possibly nothing — confirm intent). Report the specific warning/image. |
| **PUBLISHED_VERIFICATION_INCONCLUSIVE** | publish returned 2xx, but verification could not run conclusively: deploy never reached `"ready"` within your polling budget, or `verify_article_images` returned `inconclusive: true`. Do NOT report this as success or failure — say verification is pending and what to re-run. |
| **PUBLISH_FAILED** | publish returned non-2xx (400/403/409/422/5xx). Nothing was committed; `published_time` is unchanged. Use the error message to self-diagnose (see §7) and repair before retrying. |

Never report PUBLISHED without a conclusive verification; never report PUBLISH_FAILED for a
2xx publish whose only problem is a warning or an inconclusive verification.

## 7. Self-diagnosis: what each rejection means

| Error | Meaning / fix |
|---|---|
| `missing_request_id` | Supply `request_id` (`req_<flow>_<topic>_<yyyymmdd>_<nn>`); it is never generated for you. |
| `... belongs to request 'X', not 'Y'` | Cross-request blobKey. Re-upload the bytes under this request id and use the returned blobKey. |
| `... refers to a soft-deleted artifact` | Re-upload the exact bytes to restore it, or ask an admin to run `restore_artifact`. |
| `... not in the artifact index for request 'Y'` | The blobKey was never uploaded for this request. Upload first; `list_artifacts_for_request` shows what exists. |
| `invalid_node_media_src` | Image node `media.src` is a remote URL / data URI / malformed pointer. Upload the image and use the artifact pointer. |
| `misplaced_artifact_references` | Move refs to the top-level `output.artifactReferences` array. |
| 422 "raw image artifact reference(s)" | A blobKey survived into the committed markdown — usually a ref the materializer could not resolve; check the artifact exists and is not deleted. |
| 422 "stale image references" | The reference JSON exists but backing bytes are missing; re-upload the image. |
| 409 on create/patch | Record/version conflict — re-read the record and retry with the current version. |
| 423 | Lock expired or held by someone else — checkout again. |
| `featured_image_required` (422) | This site has `HERO_IMAGE_REQUIRED` enabled (operator-level, not agent-controlled) and no hero resolved. Nothing was committed. Set `featuredImage` to an uploaded artifact blobKey, or `existingFeaturedImagePath` to an existing committed image path, and retry. |
| `missing_featured_image` (warning, not a rejection) | Publish succeeded with no hero/featured image because neither `featuredImage` nor `existingFeaturedImagePath` was supplied. If intentional, no action needed; otherwise set `featuredImage` and republish. |

---

**Provenance note:** this file was created during the 2026-07 image-pipeline audit. Earlier
references to `docs/agents/publishing-instructions.md` (including its four-status taxonomy)
predate the file existing in this repository; the taxonomy above is the agreed contract,
and the test-scenario identifiers T1–T9 referenced alongside it are not defined in this
repository — they should be added here by their owner rather than invented.
