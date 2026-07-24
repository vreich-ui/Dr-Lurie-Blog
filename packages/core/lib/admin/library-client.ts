/**
 * Content library data client (T9.8). One `inventory` fetch over the existing
 * admin-object verb endpoint returns every object's row (including the T9.2
 * display_name and updated_at added to the row); the browse surface filters
 * and sorts client-side.
 */
import { callObjectVerb, type GetToken } from '../edit-mode/verbs-client.js';
import type { LibraryRow } from './library-logic.js';

export type { GetToken };

export async function fetchInventoryRows(getToken: GetToken): Promise<LibraryRow[]> {
  const { status, body } = await callObjectVerb(getToken, { action: 'inventory' });
  if (status !== 200) {
    throw new Error((body?.error as string) || `Inventory request failed (${status}).`);
  }
  return (body.objects as LibraryRow[] | undefined) ?? [];
}
