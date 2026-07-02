# Post-publish image render / 404 gap diagnostic

## Scope

This trace follows one uploaded image artifact from a successful canonical publish through the committed Markdown file and the live Astro page. It intentionally stops at diagnosis: no code changes are proposed here.

## Intended end-to-end transform

1. **Canonical MCP publish payload assembly**
   - `callPublishByTime` loads the workflow record, promotes the richer canonical `article_body` if present, validates it, and fetches request-scoped artifact references with `getArtifactReferencesForRequest`.
   - `buildCanonicalPublishPayload` scans image candidates from `media.image_asset_register`, `media.image_sets`, inline `article_body.nodes[*].public.media.src`, and top-level/cross-request `artifactReferences`.
   - The selected `featuredImage` is still an artifact-ish source at this point: it may be an image node `media.src` such as `image/<requestId>/<sha>.<ext>`, a register `repoPath`/URL, or an image artifact `blobKey`.
   - The payload sent to the write step includes:
     - `article_body` unchanged from the validated canonical record,
     - `featuredImage` equal to the highest-priority candidate path,
     - `artifactReferences` deduped by `sha256`, including cross-request references resolved from the artifact index,
     - publish metadata such as `slug`, `publishDate`, `published_time`, and `overwrite: true`.
   - `callPublishArticle` then invokes the in-process `publish-article` handler with that payload as JSON and the server-side publish secret.

2. **Publish-article materialization and rewrite**
   - `publish-article` normalizes `artifactReferences`, validates the publish payload schema, and resolves all publish media in `getMediaEntries`.
   - `getMediaEntries` accepts multiple image inputs: legacy `files`, legacy agent `images`, direct `mediaEntries`, and canonical `artifactReferences`.
   - For artifact-backed images, it reads bytes from the Netlify artifact blob store using `readArtifactBytes`, validates the bytes as an image, and creates a persisted media entry under `src/assets/images/uploads/<slug>/<filename>`.
   - The public/render-facing URL for that persisted image is the media entry `displayPath`, which rewrites the repo path to `~/assets/images/uploads/<slug>/<filename>`.
   - The body Markdown is first serialized from `article_body` by `articleBodyToMarkdown`. Inline image nodes render their raw `media.src` into Markdown only when `node.rendering.placement === "inline"`; hero image nodes are suppressed from inline Markdown because the featured image path is expected to render in the page hero.
   - After frontmatter and body Markdown are assembled, `replacePublishedArtifactReferences` replaces every occurrence of each persisted artifact reference's `blobKey`, original blob key, or URL with that media entry's `displayPath`.
   - The Git commit contains both the Markdown article file and every persisted media blob path in one tree update.

3. **Astro build/render**
   - The committed article frontmatter `image: "~/assets/images/uploads/<slug>/<filename>"` is loaded as the post hero image.
   - The post page calls `findImage(post.image)`. For `~/assets/images/...`, `findImage` maps the path to `/src/assets/images/...` and resolves it through Vite/Astro's asset graph.
   - `SinglePost` passes the resolved asset to the shared `Image` component, which emits the optimized hero `<img>`.
   - Inline Markdown image URLs that were rewritten to `~/assets/images/uploads/<slug>/<filename>` are also local asset references in the committed Markdown and are available to the Astro Markdown renderer/build as repo files.

## Where a valid ref can still become a live 404 or missing image

A successful API response does not by itself prove the live page can fetch the image. The specific fragile steps are:

1. **Raw artifact ref survives into committed Markdown or frontmatter.** If replacement misses an occurrence, the live page may contain a relative URL like `image/<requestId>/<sha>.png`. There is no public `/image/*` route comparable to `/pdf/*`, so that URL is not fetchable and will 404.
2. **Artifact bytes are not committed under `src/assets/images/uploads/<slug>/...`.** The render path depends on a real repo file, not on lazy artifact resolution at image request time. If the commit contains only the article file or only the artifact reference string, `~/assets/images/...` cannot resolve at build time and the image will render missing or blank.
3. **Inline node image is not rendered because placement is not `inline`.** `articleBodyToMarkdown` only emits an inline image when `public.media` exists and `rendering.placement === "inline"`. A node can carry a valid image artifact and still not appear in the body if its placement is absent or non-inline.
4. **Hero image suppression can hide a node image if another featured candidate wins.** Hero-designated image nodes are suppressed from inline Markdown. The code comments note an edge case: if a higher-priority hero image candidate wins frontmatter over the hero node image, the hero node image can appear in neither location.
5. **Filename collision / duplicate sha behavior can mask expected placements.** Artifact references are deduped by `sha256`; repeated use of the same underlying artifact should map to one persisted media file and multiple Markdown references. That is valid, but if a reproduction expects distinct files for repeated refs, the diff must compare URLs and body placements, not just asset count.

## Featured image vs inline node image paths

They share the artifact-byte materialization step but diverge before and after it:

- **Featured image path**
  - Selected in MCP from candidates and sent as `featuredImage`.
  - In `publish-article`, `featuredImage` is matched against resolved media entries. If it matches an artifact reference, the frontmatter `image:` becomes the media entry `displayPath` (`~/assets/images/uploads/...`).
  - Rendered by the blog page/`SinglePost` hero image path through `findImage` and Astro image optimization.

- **Inline node image path**
  - Kept inside `article_body.nodes[*].public.media.src` until Markdown serialization.
  - Serialized only when the node's rendering placement is `inline` and the node is not a hero image.
  - Rewritten after serialization from artifact blob key to `~/assets/images/uploads/...` by literal string replacement.
  - Rendered by the Markdown content pipeline rather than `SinglePost`'s explicit hero image component.

Because of this split, one path can work while the other fails. For example, a featured image can render while an inline node image is absent if the inline node lacks `rendering.placement: "inline"`; conversely, an inline image can render while the hero is missing if `featuredImage` points to a value that does not match any materialized media entry and cannot be resolved as an existing image path.

## Image artifacts vs PDF artifacts

Images and PDFs are intentionally treated differently after artifact upload:

- Image artifact refs are materialized into Git under `src/assets/images/uploads/<slug>/...`; the public page should reference them as Astro/local asset paths (`~/assets/images/uploads/...`). There is no public artifact-serving route for `image/<requestId>/<sha>.<ext>`.
- PDF artifact refs may be materialized into Git under `src/assets/documents/uploads/<slug>/...` when passed through `artifactReferences`, but `articleBodyToMarkdown` also recognizes PDF artifact blob keys and rewrites CTA/document links to `/pdf/<requestId>/<sha>.pdf`.
- Netlify has an explicit `/pdf/*` redirect to `get-public-pdf`, and that function streams bytes from the artifact blob store by `blobKey`. This means PDFs have a public artifact-backed serving fallback that images do not.

This difference is important for the observed failure mode: a raw PDF artifact URL can still be fetchable through `/pdf/*`, while a raw image artifact URL is not fetchable unless it was rewritten to and materialized as a committed site asset.

## Concrete reproduction / diff procedure

Use a new smoke article with exactly one image artifact used as both the selected featured image and an inline `article_body` image node.

1. **Capture the publish payload before the write step**
   - Trigger `publish_approved_article` / `callPublishByTime` for the workflow.
   - Capture the JSON payload immediately before `callPublishArticle` invokes `publish-article`.
   - Record:
     - `featuredImage`,
     - every `artifactReferences[*].blobKey`, `sha256`, `contentType`, and `originalFilename`,
     - every `article_body.nodes[*].public.media.src`, `type`, and `rendering.placement`.

2. **Capture what was committed to Git**
   - From the publish receipt, record `commit` and `articlePath`.
   - Fetch the committed article Markdown at that commit.
   - Diff the payload against the Markdown:
     - `featuredImage: image/<id>/<sha>.png` should become frontmatter `image: "~/assets/images/uploads/<slug>/<filename>"`.
     - inline Markdown should contain `![alt](~/assets/images/uploads/<slug>/<filename>)` for an inline image node.
     - the raw `image/<id>/<sha>.png` string should not remain anywhere in the committed article.
   - Fetch the same commit tree and confirm the image file exists at `src/assets/images/uploads/<slug>/<filename>`.

3. **Capture what the live page serves**
   - Wait for the Netlify deploy for the returned commit to finish.
   - Fetch the live article HTML and identify the hero `<img src="...">` and inline image `<img src="...">` URLs.
   - Request each image URL directly.
   - A 404 with a raw `image/<id>/<sha>.png` URL indicates replacement/materialization was skipped for that occurrence.
   - A 404 for an Astro-generated asset URL indicates the committed media blob was absent from the deploy, or the deploy being inspected is not the commit returned in the publish receipt.
   - No inline `<img>` in the HTML while the committed Markdown lacks an inline image points to the `articleBodyToMarkdown` placement/suppression rules rather than asset serving.

## Diagnostic conclusion

The artifact ref to public URL transform is not a runtime image proxy. For images, success requires all three of these to happen in the publish commit:

1. the artifact reference is present in `artifactReferences` or resolvable from an inline node pointer,
2. artifact bytes are read from the artifact blob store and committed to `src/assets/images/uploads/<slug>/<filename>`, and
3. every reader-facing image reference is rewritten from `image/<requestId>/<sha>.<ext>` to `~/assets/images/uploads/<slug>/<filename>` before the article Markdown is committed.

The likely 404 source is any gap between steps 2 and 3: the API can return success after writing an article, but the live page has no way to serve a raw image artifact reference. PDFs are less exposed to that exact gap because `/pdf/*` is routed to a blob-backed Netlify function.
