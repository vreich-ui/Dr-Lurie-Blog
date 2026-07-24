/**
 * Section materializer — 'section.v1' → src/data/site/sections/{sec_id}.json (D§1).
 * Shared/global sections only (D§2.5) — page-local sections embed in the
 * Page record and are exported as part of the page materializer's output,
 * never as their own file.
 */
import { sectionBodySchema } from '../../../packages/core/schema/bodies/section-v1.js';
import { renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeSection = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = sectionBodySchema.parse(body);
  return {
    path: `src/data/site/sections/${objectId}.json`,
    content: renderExport('section', objectId, parsed, meta),
  };
};
