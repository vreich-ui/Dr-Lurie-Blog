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
};

/** The current algorithm of a `related` content_grid, or undefined. */
const relatedAlgorithmOf = (type: string, data: unknown): string | undefined => {
  if (type !== 'content_grid') return undefined;
  const source = (data as { source?: { kind?: string; algorithm?: string } }).source;
  return source?.kind === 'related' ? source.algorithm : undefined;
};

export const sectionAnnotationAttrs = (
  pageObjectId: string,
  section: Pick<RenderableSection, 'id' | 'type' | 'sharedObjectId'> & Partial<Pick<RenderableSection, 'data'>>
): SectionAnnotationAttrs => {
  // A `related` grid announces its CURRENT algorithm so the canvas chip can
  // offer the selection dropdown without a record round-trip.
  const relatedAlgorithm = relatedAlgorithmOf(section.type, section.data);
  return {
    'data-cms-object-id': pageObjectId,
    'data-cms-section-id': section.id,
    'data-cms-section-type': section.type,
    ...(section.sharedObjectId ? { 'data-cms-shared-object': section.sharedObjectId } : {}),
    ...(relatedAlgorithm ? { 'data-cms-related-algorithm': relatedAlgorithm } : {}),
  };
};
