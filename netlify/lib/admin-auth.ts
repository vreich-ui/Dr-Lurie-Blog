/**
 * Site-side re-export shim (W11 T11.3). The implementation moved to
 * packages/core/server/lib/admin-auth.ts; this shim exists so the OFF-LIMITS legacy
 * functions (publish-article.ts, admin-workflow-lock.ts, save-json-blob.ts,
 * verify-article-images.ts — byte-untouched by mandate) keep importing
 * '../lib/admin-auth.js' with identical wire behavior. New code imports core directly.
 */
import '../../src/config/policy-bindings.js'; // register site providers for the legacy path
export * from '../../packages/core/server/lib/admin-auth.js';
