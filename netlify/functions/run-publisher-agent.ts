/**
 * Site shim (W11 T11.4): instantiates the core `run-publisher-agent` handler with the
 * Dr-Lurie SiteBinding. The implementation is fleet law in
 * packages/core/server/functions/run-publisher-agent.ts; this file is the per-site wire.
 */
import '../../src/config/policy-bindings.js';
import { createHandler } from '../../packages/core/server/functions/run-publisher-agent.js';
import { drlurieSiteBinding } from '../../src/config/site-binding.js';

export * from '../../packages/core/server/functions/run-publisher-agent.js';

export const handler = createHandler(drlurieSiteBinding);
