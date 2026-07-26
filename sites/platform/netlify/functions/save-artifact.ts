/**
 * Site shim for 'site_platform': instantiates the core `save-artifact` handler with
 * this site's SiteBinding. The implementation is fleet law in
 * packages/core/server/functions/save-artifact.ts; this file is the per-site wire.
 */
import '../../config/policy-bindings.js';
import { createHandler } from '../../../../packages/core/server/functions/save-artifact.js';
import { siteBinding } from '../../config/site-binding.js';

export * from '../../../../packages/core/server/functions/save-artifact.js';

export const handler = createHandler(siteBinding);
