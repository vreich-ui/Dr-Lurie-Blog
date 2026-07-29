/**
 * Site shim for Dr-Lurie's MCP endpoint (W14 T14.3).
 *
 * The server itself is fleet law in packages/core/server/functions/mcp.ts.
 * This file is the per-site wire: it registers this site's policy bindings and
 * builds the core handlers with THIS site's SiteBinding — the same pattern as
 * the other 32 shims.
 *
 * The legacy `save_json_blob` / `publish-article` pipeline this shim used to
 * inject was RETIRED on 2026-07-29 (ruling OQ-W11-6), together with its
 * `save_json_blob_*` and per-stage workflow tools. Dr-Lurie's articles are
 * `content_item` objects like every other site's; the committed legacy posts
 * under `src/data/post/` still render, because only the WRITE path was retired.
 *
 * `verify-article-images` stays at the repo root and is still INJECTED rather
 * than imported by core: it is a per-site function, and it serves the object
 * path (post-release image verification), not just the retired legacy one.
 */
import '../../sites/drlurie/config/policy-bindings.js';

import { configureMcp } from '../../packages/core/server/functions/mcp.js';
import { createHandler as createSaveArtifactHandler } from '../../packages/core/server/functions/save-artifact.js';
import { createHandler as createObjectStoreHandler } from '../../packages/core/server/functions/object-store.js';
import { createHandler as createDeployStatusHandler } from '../../packages/core/server/functions/deploy-status.js';
import { drlurieSiteBinding } from '../../sites/drlurie/config/site-binding.js';

import { handler as verifyArticleImagesHandler } from './verify-article-images.js';

configureMcp({
  saveArtifactHandler: createSaveArtifactHandler(drlurieSiteBinding),
  objectStoreHandler: createObjectStoreHandler(drlurieSiteBinding),
  deployStatusHandler: createDeployStatusHandler(drlurieSiteBinding),
  verifyArticleImagesHandler,
});

export * from '../../packages/core/server/functions/mcp.js';
