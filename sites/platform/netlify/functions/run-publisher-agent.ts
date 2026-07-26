/**
 * Site shim for 'site_platform': instantiates the core `run-publisher-agent` handler with
 * this site's SiteBinding. The implementation is fleet law in
 * packages/core/server/functions/run-publisher-agent.ts; this file is the per-site wire.
 */
import '../../config/policy-bindings.js';
import { createHandler } from '../../../../packages/core/server/functions/run-publisher-agent.js';
import { siteBinding } from '../../config/site-binding.js';

export * from '../../../../packages/core/server/functions/run-publisher-agent.js';

export const handler = createHandler(siteBinding);
