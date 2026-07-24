/**
 * Template materializer — 'template.v1' → `<exportRoot>/templates/{tpl_id}.json`
 * (D§1; exportRoot parameterized W11 T11.6). One file per Template. Templates
 * only record slot blueprints; instantiation copies them into a Page (D§3.6)
 * — this materializer does not resolve or expand anything, it exports the
 * record's body verbatim.
 */
import { templateBodySchema } from '../../../schema/bodies/template-v1.js';
import { exportPath, renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeTemplate = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = templateBodySchema.parse(body);
  return {
    path: exportPath(meta, 'templates', `${objectId}.json`),
    content: renderExport('template', objectId, parsed, meta),
  };
};
