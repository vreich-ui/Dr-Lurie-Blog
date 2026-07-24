/**
 * Template materializer — 'template.v1' → src/data/site/templates/{tpl_id}.json (D§1).
 * One file per Template. Templates only record slot blueprints; instantiation
 * copies them into a Page (D§3.6) — this materializer does not resolve or
 * expand anything, it exports the record's body verbatim.
 */
import { templateBodySchema } from '../../../schema/bodies/template-v1.js';
import { renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeTemplate = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = templateBodySchema.parse(body);
  return {
    path: `src/data/site/templates/${objectId}.json`,
    content: renderExport('template', objectId, parsed, meta),
  };
};
