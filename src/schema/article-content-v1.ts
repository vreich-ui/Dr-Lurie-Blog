/**
 * FROZEN-PATH RE-EXPORT STUB (W11 T11.3). The implementation moved to
 * packages/core in T11.2, but the HARD-STOP files (publish-article.ts,
 * admin-workflow-lock.ts, save-json-blob.ts — byte-untouched by mandate)
 * import this exact path. This stub keeps their imports resolving to the
 * SAME module instance in core. Nothing else may import it — everything
 * non-frozen was rewritten to core paths; the zero-drlurie/core lint and
 * this header keep it single-purpose. Delete when the legacy article path
 * retires (plan §2.3 / OQ-W11-6 line).
 */
export * from '../../packages/core/schema/article-content-v1.js';
