/**
 * Site materializer — 'site.v1' → src/data/site/site.json (D§1). Singleton
 * export: one Site per site, so the path carries no object id.
 */
import { siteBodySchema } from '../../../src/schema/bodies/site-v1.js';
import { renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeSite = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = siteBodySchema.parse(body);
  return {
    path: 'src/data/site/site.json',
    content: renderExport('site', objectId, parsed, meta),
  };
};
