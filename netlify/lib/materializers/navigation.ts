/**
 * Navigation materializer — 'navigation.v1' → src/data/site/navigation/{nav_id}.json (D§1).
 * One file per Navigation instance (header, footer, secondary, social, …).
 */
import { navigationBodySchema } from '../../../src/schema/bodies/navigation-v1.js';
import { renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeNavigation = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = navigationBodySchema.parse(body);
  return {
    path: `src/data/site/navigation/${objectId}.json`,
    content: renderExport('navigation', objectId, parsed, meta),
  };
};
