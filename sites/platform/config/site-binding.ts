/**
 * platform SiteBinding (T11.7 scaffold) — this client's instantiation
 * of the core server layer's per-site seam (packages/core/server/lib/
 * site-binding.ts). Carries the site id, the env-var NAMES the server
 * machinery reads (the shared `PLATFORM_ENV_NAMES` — every client reads the
 * same names, the platform supplies per-site values, OQ-W11-4), and this
 * site's committed-export root.
 */
import { PLATFORM_ENV_NAMES, type SiteBinding } from '../../../packages/core/server/lib/site-binding.js';
import { siteIdentityConfig } from './site-identity.js';

export const siteBinding: SiteBinding = {
  siteId: siteIdentityConfig.siteId,
  env: PLATFORM_ENV_NAMES,
  dataRoot: 'sites/platform/data/site',
};
