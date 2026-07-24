/**
 * Content-item materializer — 'content_item.v1' → src/data/site/articles/{req_id}.json
 * (W7.3, 08-articles-plan §2.3). One export per article object, consumed at
 * build time by the article render path the same way page/product exports are.
 *
 * The FULL body — annotation layer included — is exported: the export is the
 * derived mirror of the record (D§1), and the build needs the node envelope
 * to render (visibility, kinds, rendering hints). The leak rule lives at the
 * RENDERER (node.private/commercial internals never reach HTML), not here.
 * Committed legacy posts (src/data/post/*.md) are untouched by this path.
 */
import { contentItemBodySchema } from '../../../packages/core/schema/bodies/content-item-v1.js';
import { renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeContentItem = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = contentItemBodySchema.parse(body);
  return {
    path: `src/data/site/articles/${objectId}.json`,
    content: renderExport('content_item', objectId, parsed, meta),
  };
};
