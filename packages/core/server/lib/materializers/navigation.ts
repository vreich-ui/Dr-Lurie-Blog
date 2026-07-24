/**
 * Navigation materializer — 'navigation.v1' → `<exportRoot>/navigation/{nav_id}.json`
 * (D§1; exportRoot parameterized W11 T11.6). One file per Navigation instance
 * (header, footer, secondary, social, …).
 */
import { navigationBodySchema } from '../../../schema/bodies/navigation-v1.js';
import { exportPath, renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeNavigation = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = navigationBodySchema.parse(body);
  return {
    path: exportPath(meta, 'navigation', `${objectId}.json`),
    content: renderExport('navigation', objectId, parsed, meta),
  };
};
