/**
 * Site-side re-export shim (W11 T11.3). The implementation lives in
 * packages/core/server/lib/admin-auth.ts; this shim exists so
 * verify-article-images.ts — the one function still at the repo root — keeps
 * importing '../lib/admin-auth.js' with identical wire behavior, and picks up
 * this site's policy bindings on the way. New code imports core directly.
 *
 * The other legacy functions this shim was written for (publish-article.ts,
 * admin-workflow-lock.ts, save-json-blob.ts) were retired on 2026-07-29.
 */
import '../../sites/drlurie/config/policy-bindings.js'; // register this site's providers
export * from '../../packages/core/server/lib/admin-auth.js';
