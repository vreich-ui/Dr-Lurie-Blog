/**
 * Site shim (W11 T11.4): instantiates the core `stripe-webhook` handler with the
 * Dr-Lurie SiteBinding. The implementation is fleet law in
 * packages/core/server/functions/stripe-webhook.ts; this file is the per-site wire.
 */
import '../../src/config/policy-bindings.js';
import { createHandler } from '../../packages/core/server/functions/stripe-webhook.js';
import { drlurieSiteBinding } from '../../src/config/site-binding.js';

export * from '../../packages/core/server/functions/stripe-webhook.js';

export const handler = createHandler(drlurieSiteBinding);
