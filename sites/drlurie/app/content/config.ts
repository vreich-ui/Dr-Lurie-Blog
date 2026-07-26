/**
 * Dr-Lurie's content collections — the site half of Astro's content config
 * (W14 T14.1). The collection SHAPES are fleet law and live in the shell
 * (`packages/core/app/content/collections.ts`); this file supplies only the one
 * thing that is this deployment's: where its committed exports live.
 *
 * Astro requires this file at `<srcDir>/content/config.ts`, which is why every
 * site has its own three-line copy rather than sharing one.
 */
import { buildSiteCollections } from '@core/app/content/collections';

export const collections = buildSiteCollections({ dataRoot: 'sites/drlurie/data/site' });
