# Live rendering & verification audit (image pipeline, Stage 5)

**Date:** 2026-07-03. Companion to `image-publish-trust-index.md` and
`post-publish-render-gap.md`. Scope: `src/utils/images.ts` (findImage),
`src/components/blog/SinglePost.astro`, `src/pages/[...blog]/index.astro`,
`src/lib/admin/node-renderer.ts`, `src/lib/article-content/to-markdown.ts`,
`netlify/functions/verify-article-images.ts`, `netlify/functions/admin-get-blob-image.ts`.

## 1. findImage / Vite asset resolution — checked, found clean

- `findImage` (`src/utils/images.ts:36-66`) resolves `~/assets/images/**` through
  `import.meta.glob` covering `jpeg,jpg,png,tiff,webp,gif,svg` in both cases. Publish
  materialization only commits sharp-validated JPEG/PNG/WebP under
  `src/assets/images/uploads/{slug}/`, so every committed extension is inside the glob.
- A committed-but-unresolvable path returns `null`, and `SinglePost.astro` renders a divider
  instead of a hero — a *silent* miss, never a build error. That gap is guarded upstream:
  `validateCommittedImageReferences` (PR #329) refuses to commit markdown/frontmatter whose
  image references are not materialized in the same commit, and
  `scripts/validate-upload-images.mjs` cross-checks committed `.md` references at build time.
- Document paths are explicitly kept away from `getImage` via `isDocumentPath` +
  the `~/assets/documents/` null branch. No fix needed.

## 2. Public renderer vs admin renderer parity (01-audit.md §1.9)

The two renderers agree on the load-bearing presentations (section, plain, callout,
image/media, summary, soft action/CTA, offer inline/card). Remaining presentation-type gaps,
all pre-existing and acknowledged by the TODO at `to-markdown.ts:65-66` — documented here,
deliberately NOT changed (public rendering changes are out of audit scope):

| Node shape | Admin renderer (node-renderer.ts) | Published markdown (to-markdown.ts) |
|---|---|---|
| `presentation: 'faq'` | q/a pairs as `<dl>` | flat `- item` bullet list |
| `presentation: 'chatInvite'` | styled card + disabled button | only eyebrow/title/body text; `chat.invitationText` never serialized |
| `presentation: 'adSlot'` | dashed placeholder box with `label` | nothing (label is not serialized) |
| `commercial.rel` / sponsored link attrs | not rendered | not serialized (plain link) |
| media `placement` | **now flagged** (see §3) | only `placement: 'inline'` renders |

The structural answer to this two-renderer fork is the Component Registry design in
`docs/cms-architecture/02-architecture-and-schema.md` §4.4 — future work, not this audit.

## 3. Admin preview fixes shipped in this stage

- **Artifact preview:** `node-renderer.ts` claimed artifact blobKeys "cannot be resolved to a
  real URL in the browser." They can: the identity-gated `admin-get-blob-image` function
  serves the bytes. `src/lib/admin/artifact-preview.ts` builds the endpoint URL and an
  authenticated loader (identity token → fetch → object URL); `publish.astro` registers it
  via `setArtifactPreviewLoader`, so image-artifact nodes now render real previews in the
  editor, falling back to the old placeholder on any failure.
- **Placement mismatch note:** the admin preview used to render every image node regardless
  of `rendering.placement`, while the live page drops anything without `placement: 'inline'`
  (the PR #331 warning case). Non-hero image nodes without inline placement now carry an
  orange note in the preview mirroring the publish-time `image_not_rendered` warning.

## 4. verify_article_images fixes shipped in this stage

Checked against Stage 5.4 (a–d):

- (a) It fetches the live page HTML and inspects `<img>` tags — now including `srcset`
  variants, which Astro's Image component emits.
- (b) **Hashed build URLs previously could not match.** Expected values like
  `~/assets/images/uploads/{slug}/{file}.png` were compared exactly against page sources,
  but Astro rewrites committed assets to `/_astro/{file}.{hash}.{ext}` (often with a new
  extension) — verification of any committed asset always failed. Matching now falls back
  from exact URL to filename-stem, the fetch probe targets the URL the page actually serves,
  and each result reports `matchedUrl`/`matchedBy`.
- (c) **Timing:** the function performs a single immediate check and deploys take 30–120s.
  Rather than blocking a synchronous Netlify function on a deploy poll, the response now
  distinguishes a not-live page (`inconclusive: true`, `pageStatus`, guidance to poll
  `deploy_status` until `"ready"`) from a proven defect, and the MCP tool description
  instructs agents to wait for the deploy before verifying.
- (d) Classification: see `docs/agents/publishing-instructions.md` — `verified: true` →
  PUBLISHED; live page with failed images → PUBLISHED_WITH_DEFECTS; `inconclusive: true` →
  PUBLISHED_VERIFICATION_INCONCLUSIVE.

## 5. Residual gaps (documented, not fixed)

- The admin artifact preview requires a browser session; the read-only review page
  (`admin/review/[draftId].astro`) uses server-rendered HTML from `admin-get-json-draft` and
  still shows placeholders for artifact refs.
- Stem matching assumes Astro preserves the source filename stem in built asset names (true
  for the current asset service). A renamed-output image service would need `expectedImages`
  passed as final URLs.
- `verify_article_images` checks `<img>` elements only; the hero image is one, so both hero
  and inline slots are covered, but CSS background images (none used today) would not be.
