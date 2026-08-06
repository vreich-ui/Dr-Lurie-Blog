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
 *
 * Perf: this used to call `callObjectVerb({action:'inventory'})` directly —
 * a THIRD independent full object-store sweep alongside ContentLibrary's and
 * AdminShell's, none of them sharing a result. It now goes through
 * `library-client`'s cached/in-flight-de-duped `fetchInventoryRows`, so a
 * bare deep link opened moments after the library page (or the palette)
 * loaded reuses that sweep instead of firing its own.
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

/**
 * The island binding: inventory via the shared, cached library-client
 * fetcher (not a raw `callObjectVerb` call) — a `force: false` read either
 * returns the already-cached/in-flight rows from ContentLibrary/AdminShell
 * or falls through to one fresh sweep of its own, exactly as before.
 */
export const resolveWorkspaceObjectType = (
  getToken: () => Promise<string>,
  objectId: string
): Promise<ObjectType | undefined> =>
  resolveObjectType(objectId, async () => {
    const { fetchInventoryRows } = await import('./library-client.js');
    return fetchInventoryRows(getToken);
  });
