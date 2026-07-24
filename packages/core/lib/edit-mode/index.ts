/**
 * Edit-mode canvas — boot gate.
 *
 * Loaded on demand by the tiny loader in EditMode.astro (which fires only
 * when a GoTrue session exists in localStorage). This module re-verifies that
 * hint properly: a real token via goTrueClient, then the server-side
 * admin-auth-state check. Only a confirmed admin gets the overlay mounted;
 * everyone else pays nothing beyond this one dynamic import. Admin pages keep
 * their own tooling — the canvas never mounts under /admin.
 */
import { getAccessToken } from '../admin/goTrueClient.js';
import { fetchAdminAuthState } from './verbs-client.js';
import { mountEditMode, type MountOptions } from './ui.js';

let checked = false;
let mountOptions: MountOptions | undefined;

export const bootEditMode = async (): Promise<void> => {
  if (window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')) return;

  // Remount after an Astro view transition swapped our chrome out.
  if (mountOptions) {
    mountEditMode(mountOptions);
    return;
  }
  if (checked) return; // already verified this session: not an admin

  // getAccessToken() refreshes a merely-lapsed access token (they expire
  // ~hourly) via the stored refresh token, so an admin whose token expired
  // between page loads is not mistaken for a signed-out visitor — currentUser()
  // alone returns null on any expired token and would skip them. Only once we
  // hold a live token do we spend the `checked` gate on the admin decision; a
  // transient no-token simply retries on the next page-load.
  const getToken = async (): Promise<string> => (await getAccessToken()) ?? '';
  if (!(await getToken())) return;
  checked = true;

  const state = await fetchAdminAuthState(getToken);
  if (!state.authenticated || !state.isAdmin) return;

  mountOptions = { email: state.email ?? 'admin', roles: state.roles ?? [], getToken };
  mountEditMode(mountOptions);
};
