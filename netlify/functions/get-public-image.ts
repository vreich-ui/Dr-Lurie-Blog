/**
 * Site shim (W11 T11.4): instantiates the core `get-public-image` handler with the
 * Dr-Lurie SiteBinding. The implementation is fleet law in
 * packages/core/server/functions/get-public-image.ts; this file is the per-site wire.
 */
import '../../sites/drlurie/config/policy-bindings.js';
import { createHandler } from '../../packages/core/server/functions/get-public-image.js';
import { drlurieSiteBinding } from '../../sites/drlurie/config/site-binding.js';

export * from '../../packages/core/server/functions/get-public-image.js';

export const handler = createHandler(drlurieSiteBinding);
