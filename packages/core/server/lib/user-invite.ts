/**
 * Invite + first-login activation (T9.5). Extracted from the admin-users
 * function so the GoTrue admin call is injectable and the store transitions
 * are unit-tested. The store record is the source of truth; the GoTrue admin
 * invite (which sends the Netlify Identity invitation email) is best-effort —
 * a failure there does not lose the invited record.
 *
 * No new secrets: the caller passes the short-lived admin identity Netlify
 * injects at `context.clientContext.identity` ({ url, token }).
 */
import {
  getUserRecord,
  putUserRecord,
  normalizeUserEmail,
  type UserRecord,
  type UserRole,
  type UsersBlobStore,
} from './users-store.js';
import { friendlyNameFromEmail } from '../../lib/admin/display-name.js';

export interface GoTrueIdentity {
  url: string;
  token: string;
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number }>;

export interface InviteResult {
  record: UserRecord;
  invite: { sent: boolean; error?: string };
}

export const inviteUser = async (opts: {
  store: UsersBlobStore;
  email: string;
  role: UserRole;
  invitedBy: string;
  at: string;
  identity?: GoTrueIdentity;
  fetchImpl?: FetchLike;
}): Promise<InviteResult> => {
  const email = normalizeUserEmail(opts.email);
  const existing = await getUserRecord(opts.store, email);

  // Idempotent: re-inviting an existing member updates the role and audits it,
  // never duplicates the record; a first invite creates an `invited` record.
  const record: UserRecord = existing
    ? {
        ...existing,
        role: opts.role,
        updated_at: opts.at,
        audit: [
          ...existing.audit,
          { at: opts.at, actor_email: opts.invitedBy, action: 'reinvite', detail: `role → ${opts.role}` },
        ],
      }
    : {
        schema_version: 1,
        email,
        // D3 (2026-08-06): a friendly default, not the raw email — the
        // `existing` branch above is taken whenever a record (with whatever
        // display_name it carries) already exists, so this only ever runs on
        // a genuinely NEW invite and never overwrites one a user set.
        display_name: friendlyNameFromEmail(email),
        role: opts.role,
        status: 'invited',
        invited_by: opts.invitedBy,
        created_at: opts.at,
        updated_at: opts.at,
        audit: [{ at: opts.at, actor_email: opts.invitedBy, action: 'invite', detail: `role ${opts.role}` }],
      };
  await putUserRecord(opts.store, record);

  let sent = false;
  let error: string | undefined;
  if (opts.identity && opts.fetchImpl) {
    try {
      const res = await opts.fetchImpl(`${opts.identity.url}/admin/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.identity.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, app_metadata: { roles: [opts.role] } }),
      });
      sent = res.ok;
      if (!res.ok) error = `GoTrue admin invite failed (${res.status}).`;
    } catch (e) {
      error = e instanceof Error ? e.message : 'GoTrue admin invite failed.';
    }
  } else {
    error = 'Identity admin token unavailable; store record created, invite email not sent.';
  }

  return { record, invite: { sent, ...(error ? { error } : {}) } };
};

/**
 * First-login activation: flip an `invited` record to `active` and stamp the
 * GoTrue user_id + last_seen. Active/disabled records only get last_seen; a
 * non-existent record returns null (bootstrap owners have no stored record).
 */
export const activateOnLogin = async (
  store: UsersBlobStore,
  email: string,
  userId: string | undefined,
  at: string
): Promise<UserRecord | null> => {
  const record = await getUserRecord(store, normalizeUserEmail(email));
  if (!record) return null;
  if (record.status === 'invited') {
    const activated: UserRecord = {
      ...record,
      status: 'active',
      user_id: record.user_id ?? userId,
      updated_at: at,
      last_seen_at: at,
      audit: [...record.audit, { at, actor_email: record.email, action: 'activate' }],
    };
    await putUserRecord(store, activated);
    return activated;
  }
  const seen: UserRecord = { ...record, last_seen_at: at };
  await putUserRecord(store, seen);
  return seen;
};
