/**
 * Taxonomy materializer — 'taxonomy.v1' → `<exportRoot>/taxonomy.json` (D§1;
 * exportRoot parameterized W11 T11.6). Singleton export: one Taxonomy
 * registry per site, so the path carries no object id.
 */
import { taxonomyBodySchema } from '../../../schema/bodies/taxonomy-v1.js';
import { exportPath, renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeTaxonomy = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = taxonomyBodySchema.parse(body);
  return {
    path: exportPath(meta, 'taxonomy.json'),
    content: renderExport('taxonomy', objectId, parsed, meta),
  };
};
