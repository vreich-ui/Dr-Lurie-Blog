import type { ObjectType } from '../../schema/object-record-v1.js';

export type ObjectStageMode = 'document' | 'wide' | 'media';

const DOCUMENT_TYPES = new Set<ObjectType>(['content_item', 'editorial_voice', 'template', 'section_template']);
const MEDIA_TYPES = new Set<ObjectType>(['product']);

/**
 * Stable spatial contract for the center Object Stage. New renderers choose a
 * mode here instead of each workspace inventing its own frame.
 */
export const objectStageMode = (objectType: ObjectType): ObjectStageMode => {
  if (DOCUMENT_TYPES.has(objectType)) return 'document';
  if (MEDIA_TYPES.has(objectType)) return 'media';
  return 'wide';
};

export const objectStageModeClass = (mode: ObjectStageMode): string => {
  switch (mode) {
    case 'document':
      return 'mx-auto min-h-[36rem] w-full max-w-[48rem] bg-[var(--adm-surface)] shadow-[var(--adm-shadow-sm)]';
    case 'media':
      return 'mx-auto grid min-h-[28rem] w-full max-w-[56rem] place-items-center';
    case 'wide':
      return 'w-full';
  }
};
