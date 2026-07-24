/**
 * Section-template materializer — 'section_template.v1' →
 * src/data/site/section-templates/{stpl_id}.json (W8, 09-template-system-plan
 * §2.5). One file per recipe. Recipes resolve nothing (the template.ts
 * precedent): the body is exported verbatim — instantiation copies happen at
 * the verb, and no build consumer reads these exports yet (a future
 * palette-derivation slice may).
 */
import { sectionTemplateBodySchema } from '../../../schema/bodies/section-template-v1.js';
import { renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeSectionTemplate = (
  objectId: string,
  body: unknown,
  meta: MaterializeMeta
): MaterializedFile => {
  const parsed = sectionTemplateBodySchema.parse(body);
  return {
    path: `src/data/site/section-templates/${objectId}.json`,
    content: renderExport('section_template', objectId, parsed, meta),
  };
};
