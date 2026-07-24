/**
 * Page materializer — 'page.v1' → `<exportRoot>/pages/{page_id}.json`
 * (D§1; exportRoot parameterized W11 T11.6). One file per Page, inline
 * sections included verbatim (D§3.3) — a Page owns its sections the way an
 * article owns its nodes: one record, one export.
 */
import { pageBodySchema } from '../../../schema/bodies/page-v1.js';
import { exportPath, renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializePage = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = pageBodySchema.parse(body);
  return {
    path: exportPath(meta, 'pages', `${objectId}.json`),
    content: renderExport('page', objectId, parsed, meta),
  };
};
