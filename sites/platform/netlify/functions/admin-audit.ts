/**
 * Site shim for 'site_platform': instantiates the core `admin-audit` handler with
 * this site's SiteBinding. The implementation is fleet law in
 * packages/core/server/functions/admin-audit.ts; this file is the per-site wire.
 */
import '../../config/policy-bindings.js';
import { createHandler } from '../../../../packages/core/server/functions/admin-audit.js';
import { siteBinding } from '../../config/site-binding.js';

export * from '../../../../packages/core/server/functions/admin-audit.js';

export const handler = createHandler(siteBinding);
