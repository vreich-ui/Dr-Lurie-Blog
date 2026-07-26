/**
 * platform's content collections. The collection SHAPES are fleet law
 * and live in the shell; this file supplies only this deployment's export root.
 * Astro requires the file at `<srcDir>/content/config.ts`, which is why every
 * site carries its own three-line copy.
 */
import { buildSiteCollections } from '@core/app/content/collections';

export const collections = buildSiteCollections({ dataRoot: 'sites/platform/data/site' });
