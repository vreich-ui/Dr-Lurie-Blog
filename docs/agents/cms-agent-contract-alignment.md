# CMS-Agent ↔ Dr-Lurie ↔ pdf-tool — contract alignment (2026-07-19)

The cross-server contract for agent-produced artifact content (images, PDFs)
publishing to the live Dr. Lurie site. Dr-Lurie-side rules in this doc are
ENFORCED by this repo (validators cited); CMS-Agent/pdf-tool-side items are
RECOMMENDATIONS to those deployments — advisory until adopted there, so treat
any divergence as a bug report against this doc or that server.

Companion docs: `pdf-tool-artifacts.md` (generation contract),
`pdf-tool-storage-grant.md` (grant machinery + rotation),
`cms-agent-enablement-runbook.md` (the switch-flip checklist).

## 1. The canonical substrate (user-ratified 2026-07-19)

Artifact-bearing articles publish as **`content_item` OBJECTS** —
`object_create/patch` → `object_publish` (dark export commit) →
`release_to_production` (explicit go-live). The legacy `save_json_blob_*` →
`publish-article.ts` pipeline stays FROZEN for the committed posts; CMS-Agent's
current `workflow_publish_run` sequence (create_article_draft →
publish_by_time, "text-only bodies") targets that legacy pipeline and should be
superseded by a new object-path publish workflow mirroring the runbook — do
NOT allowlist `save_json_blob_*` for the dr-lurie project.

## 2. article_body.v1 → content_item body mapping

The schema seam is not 1:1. CMS-Agent composes `article_body.v1`; Dr-Lurie
stores `content_item.v1` (`src/schema/bodies/content-item-v1.ts`). Mapping:

| article_body.v1 (CMS-Agent) | content_item.v1 (Dr-Lurie) | Rule |
|---|---|---|
| `nodes[].id` (`n_*`) | same | Opaque ids; strategy/commercial vocabulary in ids is REJECTED (`article_node_ids`). |
| `nodes[].kind` | same | content / action / placement / interactive. |
| `public.media.artifactReference` (blobKey `image/{req}/{sha}.{ext}`) | `public.media.src` = **`/img/{req}/{sha}.{ext}`** | content_item has NO `artifactReference` field — the PUBLIC path IS the reference (`publicPathForArtifactRef`, `netlify/lib/artifact-trust.ts`). Raw blobKeys in renderable fields are write-blocked (check 5b). |
| `public.media {type:'image', src}` | same, src as `/img/` public path | data:/`src/assets/`/bare-relative BLOCK; remote https and site-static paths WARN (ungoverned; remote warn-vs-block is a pending Wolf policy call); existence + byte budget checked against the artifact index (`article_media`, `media_budget`). |
| PDF artifact | `public.media {type:'document', src:'/pdf/{req}/{sha}.pdf'}` **or** an action node `ctaLink:'/pdf/…'` | Renders as an honest download link (`render-nodes.ts`) served by `/pdf/*` → `get-public-pdf`. No materialization into git on the object path. |
| `featuredImage` | body-level `image {src:'/img/…', alt}` | **Never a PDF** — a PDF hero reaches Astro `getImage` and fails the whole build; write-blocked (`article_media`). |
| `public.media {type:'embed', src}` | same | Embed srcs are out of validation scope today. |
| taxonomy | `taxonomy {category, tags[]}` | Slugs must resolve in the `tax_drlurie` registry (merged_into aliases follow); unknown terms block. |
| `private.strategy/intent`, envelope claims/sources/scores | carried verbatim | Never rendered (leak-scanned); annotate freely. |
| rich text | node `body` as `rich_text.v1` document or plain-text string | ARTICLE_BODY grammar (p/h2/h3/lists/quotes, bold/italic, https links). `embedded-asset-block` is DEFINED but render-blocked (W7.2 unadopted) — inline images go through node `media`/`images[]`, not rich-text embeds. |

CMS-Agent's `publish_build_payload` image-src pattern (rejects absolute/
scheme-relative URLs, `data:`, `blob:`) is KEPT — both `/img/…` public paths
and raw `image/…` pointers pass it; map to the public-path form before any
object write.

## 3. Artifact production + verification loop (the triangle)

1. **Bridge**: call Dr-Lurie's Platform `create_agent_artifact_job` with
   `site_id` and the existing content-item `request_id`. Platform resolves the
   canonical pdf-tool project and injects a fresh grant server-side. The raw
   grant RPC has been removed; grants and tokens never enter agent context.
   Rotation + kill switch: `pdf-tool-storage-grant.md`.
2. **Generate**: poll Platform `get_agent_artifact_job_status`; bytes never
   transit MCP. RECOMMENDATION
   (pdf-tool): when a job carries no explicit `requirements`, default image
   generation to the grant `limits` (encode `preferredImageFormat`, stay under
   `maxImageBytes`). Until then, agents MUST pass
   `requirements.image.outputFormat:'webp'` and `requirements.maxBytes` at or
   under the budget — Dr-Lurie now surfaces over-budget images at validation
   (`media_budget`) and blocks them at publish if the committed policy flips to
   `block`.
3. **Verify**: Platform proves materialization server-side before returning a
   completed artifact (rejecting hand-authored keys, copied refs, remote URLs,
   and data URIs); cross-check Dr-Lurie `list_artifacts_for_request` when
   needed. RECOMMENDATION (CMS-Agent):
   `workflow_publish_readiness.verifiedMediaRefs` should be fed the UNION of
   those two sources; derive blobKeys from Blob-shaped srcs via the documented
   inverse `/img/{id}/{sha}.{ext}` ⇄ `image/{id}/{sha}.{ext}` (and `/pdf/` ⇄
   `pdf/`).
4. **Attach**: write the PUBLIC paths into the content_item body (mapping
   above). `object_validate` dry-runs the exact candidate patch — existence,
   media paths, budget, hero rules all report before anything persists.
5. **Publish + release**: `object_publish` (dark commit; response carries
   `production.article_path` + `verify_after_release`) → batch →
   `release_to_production` ONCE → poll `deploy_status {commit}` until
   `deployStatus:"ready"` AND `productionConfirmed:true` →
   `verify_article_images {url, expectedImages:['/img/…'], commit}`.

## 4. pdf-tool template provisioning (failure class 4)

Two June smoke runs died on "PDF template not found": Major-Key PDF jobs
require a PUBLISHED template in the `pdf-templates` store, and
`scripts/provision-pdf-tool-stores.mjs` proves store WRITABILITY, not template
existence. Before enabling PDF publishing: preflight `list_pdf_templates`
(grant-passed) and provision via `create_pdf_template` → `publish_pdf_template`.
The enablement runbook makes this a hard checklist item.

## 5. Quota / 429 etiquette (failure class 2)

A pdf-tool 429 during generation correctly resulted in PUBLISH NOT ATTEMPTED —
that fail-closed ordering (media before publish) must be preserved on every
client. RECOMMENDATIONS: honor Retry-After / exponential backoff on 429s;
resume interrupted jobs via `resume_agent_artifact_job` (operator approval
flow) rather than re-creating; never substitute an unverified ref to "get past"
a quota failure.

## 6. Cold starts / keepalive (observed 2026-07-19)

Both external MCP legs (CMS-Agent, pdf-tool) showed >60 s cold starts — first
tool calls timed out at the 60 s client budget and succeeded on retry.
RECOMMENDATION: replicate this repo's keepalive on both deployments
(`netlify/functions/mcp-keepalive.ts` + the `netlify.toml` scheduled-function
stanza, 5-minute cron warming the MCP endpoint). Until then, clients should
treat one timeout on a session's first call as warm-up: retry once.

## 7. Infrastructure budgets (design-governing)

The 15-minute Netlify limit applies only to BACKGROUND functions — none of
these MCP endpoints are background functions. Synchronous invocation budgets
are seconds-scale: the release wrapper caps in-call waits (~6 s fallback), so
`build_not_confirmed_live` on the first `release_to_production` is the EXPECTED
flow (then poll `deploy_status`); generation is job+poll; uploads cap at 5 MB
(direct) / 750 KB (base64 `save_artifact`, legacy); one release deploys ALL
accumulated dark commits — batch publishes, release once, poll after.
