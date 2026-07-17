/**
 * Admin users client (T9.5/T9.6) — browser wrappers over the admin-users
 * verb endpoint. me/update_me are self-service (any admin); list / invite /
 * set_role / disable are Owner-only (the server 403s a non-owner).
 */
import type { GetToken } from '../edit-mode/verbs-client.js';

const ENDPOINT = '/.netlify/functions/admin-users';

export type UserRole = 'owner' | 'admin';
export type UserStatus = 'invited' | 'active' | 'disabled';

export interface UserAuditEntry {
  at: string;
  actor_email: string;
  action: string;
  detail?: string;
}

export interface UserView {
  email: string;
  display_name: string;
  avatar_artifact?: string;
  role: UserRole;
  status: UserStatus;
  invited_by?: string;
  created_at?: string;
  updated_at?: string;
  last_seen_at?: string;
  audit?: UserAuditEntry[];
}

async function post<T>(getToken: GetToken, body: Record<string, unknown>): Promise<T> {
  const token = await getToken();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((json.error as string) || `Request failed (${res.status}).`);
  return json as T;
}

export const fetchMe = (getToken: GetToken) =>
  post<{ user: UserView; bootstrap: boolean; roles: string[] }>(getToken, { verb: 'me' });

export const updateMe = (getToken: GetToken, fields: { display_name?: string; avatar_artifact?: string }) =>
  post<{ user: UserView }>(getToken, { verb: 'update_me', ...fields });

export const listUsers = (getToken: GetToken) => post<{ users: UserView[] }>(getToken, { verb: 'list' });

export const inviteUser = (getToken: GetToken, email: string, role: UserRole) =>
  post<{ user: UserView; invite: { sent: boolean } }>(getToken, { verb: 'invite', email, role });

export const setUserRole = (getToken: GetToken, email: string, role: UserRole) =>
  post<{ user: UserView }>(getToken, { verb: 'set_role', email, role });

export const disableUser = (getToken: GetToken, email: string) =>
  post<{ user: UserView }>(getToken, { verb: 'disable', email });

/** Resolve an image artifact reference (image/<id>/<sha>.<ext>) to its servable path. */
export const avatarSrc = (ref: string | undefined): string | undefined =>
  ref && ref.startsWith('image/') ? `/img/${ref.slice('image/'.length)}` : undefined;
