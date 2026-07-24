/**
 * Section materializer — 'section.v1' → `<exportRoot>/sections/{sec_id}.json`
 * (D§1; exportRoot parameterized W11 T11.6). Shared/global sections only
 * (D§2.5) — page-local sections embed in the Page record and are exported as
 * part of the page materializer's output, never as their own file.
 */
import { sectionBodySchema } from '../../../schema/bodies/section-v1.js';
import { exportPath, renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeSection = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = sectionBodySchema.parse(body);
  return {
    path: exportPath(meta, 'sections', `${objectId}.json`),
    content: renderExport('section', objectId, parsed, meta),
  };
};
