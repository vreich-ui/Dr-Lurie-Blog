/**
 * Section identity annotations for the edit-mode canvas (admin inline editing).
 *
 * The two dispatch sites (PageObjectRenderer / ObjectSections) wrap every
 * rendered section in a `display:contents` element carrying these data-*
 * attributes. `display:contents` generates no box, so layout and the audited
 * markup inside the section are untouched; the attributes are inert for
 * visitors and are read only by the admin edit-mode overlay
 * (src/lib/edit-mode/), which maps a hovered region back to the object the
 * MCP verbs edit.
 *
 * Routing rule encoded here: a section that arrived via `shared_ref` is
 * annotated with BOTH the page identity (object/section id — where it sits)
 * and `data-cms-shared-object` (the sec_* object that owns the content).
 * The overlay must patch the shared object, never the referencing page —
 * mirroring resolve.ts's dereference direction.
 */
import type { RenderableSection } from './resolve.js';

export type SectionAnnotationAttrs = {
  'data-cms-object-id': string;
  'data-cms-section-id': string;
  'data-cms-section-type': string;
  'data-cms-shared-object'?: string;
  'data-cms-related-algorithm'?: string;
  'data-cms-related-limit'?: string;
  'data-cms-related-columns'?: string;
};

/** The current `related` config of a content_grid — algorithm + layout knobs. */
const relatedConfigOf = (
  type: string,
  data: unknown
): { algorithm: string; limit?: number; columns?: number } | undefined => {
  if (type !== 'content_grid') return undefined;
  const grid = data as { source?: { kind?: string; algorithm?: string }; limit?: number; columns?: number };
  if (grid.source?.kind !== 'related' || !grid.source.algorithm) return undefined;
  return { algorithm: grid.source.algorithm, limit: grid.limit, columns: grid.columns };
};

export const sectionAnnotationAttrs = (
  pageObjectId: string,
  section: Pick<RenderableSection, 'id' | 'type' | 'sharedObjectId'> & Partial<Pick<RenderableSection, 'data'>>
): SectionAnnotationAttrs => {
  // A `related` grid announces its CURRENT algorithm + tile count + columns so
  // the canvas chip can offer the controls without a record round-trip.
  const related = relatedConfigOf(section.type, section.data);
  return {
    'data-cms-object-id': pageObjectId,
    'data-cms-section-id': section.id,
    'data-cms-section-type': section.type,
    ...(section.sharedObjectId ? { 'data-cms-shared-object': section.sharedObjectId } : {}),
    ...(related ? { 'data-cms-related-algorithm': related.algorithm } : {}),
    ...(related?.limit !== undefined ? { 'data-cms-related-limit': String(related.limit) } : {}),
    ...(related?.columns !== undefined ? { 'data-cms-related-columns': String(related.columns) } : {}),
  };
};
