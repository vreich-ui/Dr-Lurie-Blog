/**
 * Theme materializer — 'theme.v1' → src/data/site/themes/{thm_id}.json
 * (W8.3, 09-template-system-plan §6). One file per preset. Recipes resolve
 * nothing (the template.ts precedent): the body is exported verbatim, and no
 * build consumer reads these exports — what renders is the SITE object a
 * theme was applied to (site_apply_theme copies the tokens; nothing
 * live-binds to a theme).
 */
import { themeBodySchema } from '../../../packages/core/schema/bodies/theme-v1.js';
import { renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeTheme = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = themeBodySchema.parse(body);
  return {
    path: `src/data/site/themes/${objectId}.json`,
    content: renderExport('theme', objectId, parsed, meta),
  };
};
