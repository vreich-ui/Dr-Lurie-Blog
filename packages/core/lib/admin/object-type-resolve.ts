/**
 * Object-type resolution for bare workspace deep links (W15 S1).
 *
 * /admin/content/<id> is shareable, but the ObjectWorkspace island used to
 * resolve an object only when the library link supplied `?type=` — a pasted
 * or bookmarked link without it dead-ended on the "Couldn't open this object"
 * card. The id itself carries the type for eleven of the twelve governed
 * types (the minted prefixes in `object-ids.ts`); content_item ids (`req_*`)
 * and anything unprefixed resolve through one `inventory` lookup against the
 * live store instead of being guessed.
 *
 * Pure resolution lives in `resolveObjectType` (injectable inventory lister,
 * node-testable); `resolveWorkspaceObjectType` binds it to the admin-object
 * verb endpoint for the island.
 */
import { objectTypeFromId } from '../object-ids.js';
import type { ObjectType } from '../../schema/object-record-v1.js';

export type InventoryTypeRow = { object_id?: string; object_type?: string };

/**
 * Prefix map first; otherwise one inventory lookup. Returns undefined only
 * when the object genuinely is not in the inventory — a failing lister
 * REJECTS instead, so callers can tell "not found" from "couldn't look".
 */
export const resolveObjectType = async (
  objectId: string,
  listInventory: () => Promise<InventoryTypeRow[]>
): Promise<ObjectType | undefined> => {
  if (!objectId) return undefined;
  const fromPrefix = objectTypeFromId(objectId);
  if (fromPrefix) return fromPrefix;
  const rows = await listInventory();
  const row = rows.find((candidate) => candidate.object_id === objectId);
  return (row?.object_type as ObjectType | undefined) ?? undefined;
};

/** The island binding: inventory via the admin-object verb endpoint. */
export const resolveWorkspaceObjectType = (
  getToken: () => Promise<string>,
  objectId: string
): Promise<ObjectType | undefined> =>
  resolveObjectType(objectId, async () => {
    const { callObjectVerb } = await import('../edit-mode/verbs-client.js');
    const { status, body } = await callObjectVerb(getToken, { action: 'inventory' });
    if (status !== 200) {
      throw new Error(
        String((body as { error?: string }).error ?? '') || `The content inventory request failed (HTTP ${status}).`
      );
    }
    return (body.objects as InventoryTypeRow[] | undefined) ?? [];
  });
