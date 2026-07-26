/**
 * Site shim (W11 T11.4): instantiates the core `save-opt-in` handler with the
 * Dr-Lurie SiteBinding. The implementation is fleet law in
 * packages/core/server/functions/save-opt-in.ts; this file is the per-site wire.
 */
import '../../sites/drlurie/config/policy-bindings.js';
import { createHandler } from '../../packages/core/server/functions/save-opt-in.js';
import { drlurieSiteBinding } from '../../sites/drlurie/config/site-binding.js';

export * from '../../packages/core/server/functions/save-opt-in.js';

export const handler = createHandler(drlurieSiteBinding);
