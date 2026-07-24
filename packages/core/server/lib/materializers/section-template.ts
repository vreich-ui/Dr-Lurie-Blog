/**
 * Section-template materializer — 'section_template.v1' →
 * `<exportRoot>/section-templates/{stpl_id}.json` (W8, 09-template-system-plan
 * §2.5; exportRoot parameterized W11 T11.6). One file per recipe. Recipes
 * resolve nothing (the template.ts precedent): the body is exported verbatim
 * — instantiation copies happen at the verb, and no build consumer reads
 * these exports yet (a future palette-derivation slice may).
 */
import { sectionTemplateBodySchema } from '../../../schema/bodies/section-template-v1.js';
import { exportPath, renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeSectionTemplate = (
  objectId: string,
  body: unknown,
  meta: MaterializeMeta
): MaterializedFile => {
  const parsed = sectionTemplateBodySchema.parse(body);
  return {
    path: exportPath(meta, 'section-templates', `${objectId}.json`),
    content: renderExport('section_template', objectId, parsed, meta),
  };
};
