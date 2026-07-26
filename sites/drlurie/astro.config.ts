/**
 * Dr-Lurie's build entry (W14 T14.1) — a thin entry over the shared shell in
 * `packages/core/app`. Everything structural lives there; this file names only
 * this deployment's directory and the values `site.config.ts` already owns.
 *
 * `outDir` is pinned to the repo-root `dist` for now: the live Netlify project
 * publishes `dist` and T14.1 must not move the deploy's output path mid-wave.
 * T14.3 repoints the projects and this pin comes off (a new site scaffolded
 * after this gets the default `sites/<client>/dist`).
 *
 *   npx astro build --config sites/drlurie/astro.config.ts
 */
import { defineSiteAstroConfig } from '../../packages/core/app/site-astro-config';

import { siteConfig } from './site.config';

export default defineSiteAstroConfig({
  siteDir: 'sites/drlurie',
  site: siteConfig.canonicalHost,
  imageDomains: siteConfig.imageDomains,
  outDir: 'dist',
});
