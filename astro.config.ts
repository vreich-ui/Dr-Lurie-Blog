/**
 * Root build entry — Dr-Lurie (W14 T14.1).
 *
 * The application shell moved to `packages/core/app` and every site now owns a
 * thin entry (`sites/<client>/astro.config.ts`). This file stays as the repo's
 * default build so `npm run build`, `astro check`, and the live Netlify project
 * keep working unchanged until T14.3 points each Netlify project at its own
 * site entry.
 *
 * Build a specific site with:  npx astro build --config sites/<client>/astro.config.ts
 */
export { default } from './sites/drlurie/astro.config';
