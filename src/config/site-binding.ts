/**
 * The Dr-Lurie SiteBinding (W11 T11.3, dataRoot added T11.6) — this site's
 * instantiation of the core server layer's per-site seam.
 *
 * Carries the site id, the env-var NAMES (never values) the server machinery
 * reads, and this site's committed-export root (`dataRoot`) — where the
 * publish-time materializers write. Dr-Lurie uses the Netlify-platform-
 * standard names — the per-site VALUES come from this Netlify site's own
 * environment (the tenant boundary, OQ-W11-4). A future client gets its own
 * copy of this module with its own site id + dataRoot (T11.7 provisioning
 * emits it).
 *
 * `sites/drlurie/site.config.ts` re-exports this binding (single source —
 * do not construct a second SiteBinding there).
 */
import { PLATFORM_ENV_NAMES, type SiteBinding } from '../../packages/core/server/lib/site-binding.js';
import { siteIdentityConfig } from './site-identity.js';

export const drlurieSiteBinding: SiteBinding = {
  siteId: siteIdentityConfig.siteId,
  env: PLATFORM_ENV_NAMES,
  dataRoot: 'sites/drlurie/data/site',
};
