/**
 * Marginalia (W15 S4, MVP) — blob-store key scheme, mirroring the
 * object-store-keys.ts style: pure string builders, no I/O.
 *
 * marginalia/<objectType>/<objectId>/threads/<threadId>.json                      — thread header
 * marginalia/<objectType>/<objectId>/threads/<threadId>/comments/<commentId>.json — one comment per key
 * marginalia/<objectType>/<objectId>/index/<threadId>                             — empty marker key, listable by prefix
 *
 * "All threads for object X" = list({prefix: marginaliaThreadIndexPrefix(type, id)}),
 * then read each thread header + its comments — the same collectBlobListItems
 * pattern object-inventory.ts already uses over object-store-keys.ts's index.
 */
import type { ObjectType } from '../../schema/object-record-v1.js';

export const MARGINALIA_INDEX_MARKER_VALUE = '';

export const marginaliaThreadKey = (objectType: ObjectType, objectId: string, threadId: string): string =>
  `marginalia/${objectType}/${objectId}/threads/${threadId}.json`;

export const marginaliaCommentKey = (
  objectType: ObjectType,
  objectId: string,
  threadId: string,
  commentId: string
): string => `marginalia/${objectType}/${objectId}/threads/${threadId}/comments/${commentId}.json`;

export const marginaliaCommentsPrefix = (objectType: ObjectType, objectId: string, threadId: string): string =>
  `marginalia/${objectType}/${objectId}/threads/${threadId}/comments/`;

export const marginaliaThreadIndexKey = (objectType: ObjectType, objectId: string, threadId: string): string =>
  `marginalia/${objectType}/${objectId}/index/${threadId}`;

export const marginaliaThreadIndexPrefix = (objectType: ObjectType, objectId: string): string =>
  `marginalia/${objectType}/${objectId}/index/`;
