/**
 * Page materializer — 'page.v1' → src/data/site/pages/{page_id}.json (D§1).
 * One file per Page, inline sections included verbatim (D§3.3) — a Page owns
 * its sections the way an article owns its nodes: one record, one export.
 */
import { pageBodySchema } from '../../../schema/bodies/page-v1.js';
import { renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializePage = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = pageBodySchema.parse(body);
  return {
    path: `src/data/site/pages/${objectId}.json`,
    content: renderExport('page', objectId, parsed, meta),
  };
};
