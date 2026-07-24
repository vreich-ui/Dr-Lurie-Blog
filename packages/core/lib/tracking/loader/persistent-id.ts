/**
 * Consented persistent-id upgrade (W13 T13.6, 12-plan §8) — the ONLY device
 * storage the tracking stack ever writes, and only after an analytics grant
 * with GPC off (the cookieless default stores NOTHING — §5.1). Pure and
 * dependency-injected so the mint/expiry law is unit-testable:
 *
 * - `_dlid` holds `{vid, exp}`; `exp` is FIXED at mint (13-month cap, the
 *   CNIL-style ceiling) and never slid on later visits — an expired id is
 *   removed and a fresh one minted only if the grant still stands.
 * - No grant (or GPC, or revocation) → no read, no mint; revocation clears
 *   the stored id entirely.
 */

export type PersistentIdStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const PERSISTENT_ID_KEY = '_dlid';
/** 13 months (the mint-time cap; never extended). */
export const PERSISTENT_ID_TTL_MS = 396 * 24 * 60 * 60 * 1000;

/** Read the standing id, minting one when permitted; null when not granted. */
export const readOrMintPersistentId = (
  store: PersistentIdStore,
  nowMs: number,
  mintUuid: () => string
): string | null => {
  try {
    const raw = store.getItem(PERSISTENT_ID_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { vid?: unknown; exp?: unknown };
      if (typeof parsed.vid === 'string' && typeof parsed.exp === 'number' && parsed.exp > nowMs) {
        return parsed.vid;
      }
      store.removeItem(PERSISTENT_ID_KEY); // expired or malformed — never reuse
    }
    const vid = mintUuid();
    store.setItem(PERSISTENT_ID_KEY, JSON.stringify({ vid, exp: nowMs + PERSISTENT_ID_TTL_MS }));
    return vid;
  } catch {
    return null; // storage unavailable — stay cookieless
  }
};

export const clearPersistentId = (store: PersistentIdStore): void => {
  try {
    store.removeItem(PERSISTENT_ID_KEY);
  } catch {
    /* nothing stored anywhere we can reach */
  }
};
