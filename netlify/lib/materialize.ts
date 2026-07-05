/**
 * Materializer registry (T1.1) — routes an object's body to its per-type
 * derived-export writer (D§1: publishing an object materializes a committed
 * file consumed by the Astro build, generalized from the article pattern).
 *
 * Each per-type materializer is a pure function: same (objectId, body, meta)
 * in, same {path, content} out, always — the property T1.3's retry logic
 * depends on (re-materializing an unchanged object must produce
 * byte-identical output). No git commit logic here (T1.2); this module only
 * produces the content to be committed.
 *
 * `content_item` is deliberately excluded: articles keep their existing
 * materializer (src/lib/article-content/to-markdown.ts → src/data/post/{slug}.md),
 * read for pattern here but not imported from or modified (non-goal).
 */
import type { ObjectType } from '../../src/schema/object-record-v1.js';
import { materializeNavigation } from './materializers/navigation.js';
import { materializePage } from './materializers/page.js';
import { materializeSection } from './materializers/section.js';
import { materializeSite } from './materializers/site.js';
import { materializeTaxonomy } from './materializers/taxonomy.js';
import { materializeTemplate } from './materializers/template.js';
import type { MaterializeMeta, MaterializedFile } from './materializers/shared.js';

export type { MaterializeMeta, MaterializedFile, GeneratedMarker } from './materializers/shared.js';
export type MaterializableObjectType = Exclude<ObjectType, 'content_item'>;

export function materialize(
  objectType: MaterializableObjectType,
  objectId: string,
  body: unknown,
  meta: MaterializeMeta
): MaterializedFile {
  switch (objectType) {
    case 'site':
      return materializeSite(objectId, body, meta);
    case 'page':
      return materializePage(objectId, body, meta);
    case 'navigation':
      return materializeNavigation(objectId, body, meta);
    case 'taxonomy':
      return materializeTaxonomy(objectId, body, meta);
    case 'template':
      return materializeTemplate(objectId, body, meta);
    case 'section':
      return materializeSection(objectId, body, meta);
    default: {
      const exhaustive: never = objectType;
      throw new Error(`No materializer registered for object type: ${String(exhaustive)}`);
    }
  }
}
