/**
 * Taxonomy materializer — 'taxonomy.v1' → src/data/site/taxonomy.json (D§1).
 * Singleton export: one Taxonomy registry per site, so the path carries no
 * object id.
 */
import { taxonomyBodySchema } from '../../../src/schema/bodies/taxonomy-v1.js';
import { renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeTaxonomy = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = taxonomyBodySchema.parse(body);
  return {
    path: 'src/data/site/taxonomy.json',
    content: renderExport('taxonomy', objectId, parsed, meta),
  };
};
