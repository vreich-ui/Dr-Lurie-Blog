/**
 * Site shim (W11 T11.4): instantiates the core `save-commerce-event` handler with the
 * Dr-Lurie SiteBinding. The implementation is fleet law in
 * packages/core/server/functions/save-commerce-event.ts; this file is the per-site wire.
 */
import '../../sites/drlurie/config/policy-bindings.js';
import { createHandler } from '../../packages/core/server/functions/save-commerce-event.js';
import { drlurieSiteBinding } from '../../sites/drlurie/config/site-binding.js';

export * from '../../packages/core/server/functions/save-commerce-event.js';

export const handler = createHandler(drlurieSiteBinding);
