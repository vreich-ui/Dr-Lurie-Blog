/**
 * Site materializer — 'site.v1' → `<exportRoot>/site.json` (D§1; exportRoot
 * parameterized W11 T11.6). Singleton export: one Site per site, so the path
 * carries no object id.
 */
import { siteBodySchema } from '../../../schema/bodies/site-v1.js';
import { exportPath, renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeSite = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = siteBodySchema.parse(body);
  return {
    path: exportPath(meta, 'site.json'),
    content: renderExport('site', objectId, parsed, meta),
  };
};
