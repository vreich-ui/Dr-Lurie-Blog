/**
 * Site shim for Dr-Lurie's MCP endpoint (W14 T14.3).
 *
 * The server itself is fleet law in packages/core/server/functions/mcp.ts.
 * This file is the per-site wire, and it carries the one thing that is
 * genuinely this client's: the LEGACY ARTICLE PATH.
 *
 * `save-json-blob.ts`, `publish-article.ts`, and `verify-article-images.ts`
 * stay at the repo root, frozen and untouched, because they are Dr-Lurie's
 * pre-object-substrate article pipeline. Injecting them here is what keeps
 * them out of core: a client born after the object substrate omits them, and
 * the tools that need them are simply absent from that site's tool list
 * (Wolf's 2026-07-13 ruling — reverse support is not required, and the legacy
 * dialect must not propagate across the fleet).
 *
 * The three governed handlers come from the core factories, built with THIS
 * site's SiteBinding — the same pattern as the other 32 shims.
 */
import '../../sites/drlurie/config/policy-bindings.js';

import { configureMcp } from '../../packages/core/server/functions/mcp.js';
import { createHandler as createSaveArtifactHandler } from '../../packages/core/server/functions/save-artifact.js';
import { createHandler as createObjectStoreHandler } from '../../packages/core/server/functions/object-store.js';
import { createHandler as createDeployStatusHandler } from '../../packages/core/server/functions/deploy-status.js';
import { drlurieSiteBinding } from '../../sites/drlurie/config/site-binding.js';

import { handler as saveJsonBlobHandler } from './save-json-blob.js';
import { handler as publishArticleHandler } from './publish-article.js';
import { handler as verifyArticleImagesHandler } from './verify-article-images.js';

configureMcp({
  saveArtifactHandler: createSaveArtifactHandler(drlurieSiteBinding),
  objectStoreHandler: createObjectStoreHandler(drlurieSiteBinding),
  deployStatusHandler: createDeployStatusHandler(drlurieSiteBinding),
  saveJsonBlobHandler,
  publishArticleHandler,
  verifyArticleImagesHandler,
});

export * from '../../packages/core/server/functions/mcp.js';
