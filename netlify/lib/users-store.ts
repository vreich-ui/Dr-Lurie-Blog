/**
 * Users store (T9.4) — the project's first persistent identity store.
 *
 * A `users` blob store keyed by normalized email holds one record per admin,
 * carrying the workspace tier (owner/admin), lifecycle status, and an audit
 * trail. The async role resolver (roles.ts) reads this store; `ADMIN_EMAILS`
 * members remain bootstrap Owners via env so a wiped/corrupt store can never
 * lock anyone out (see roles.ts).
 *
 * Records are validated on read; a corrupt record parses to `null` so the
 * resolver degrades to the env fallback rather than throwing.
 */
import { z } from 'zod';

import { getNetlifyBlobStore } from './blob-store.js';

export const USERS_SCHEMA_VERSION = 1;

/** The two workspace tiers the UI assigns (plan §8). publisher/editor stay env-only. */
export const userRoleSchema = z.enum(['owner', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(['invited', 'active', 'disabled']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const userAuditEntrySchema = z.object({
  at: z.string(),
  actor_email: z.string(),
  action: z.string(),
  detail: z.string().optional(),
});
export type UserAuditEntry = z.infer<typeof userAuditEntrySchema>;

export const userRecordSchema = z.object({
  schema_version: z.literal(USERS_SCHEMA_VERSION),
  email: z.string(),
  user_id: z.string().optional(),
  display_name: z.string(),
  avatar_artifact: z.string().optional(),
  role: userRoleSchema,
  status: userStatusSchema,
  invited_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  last_seen_at: z.string().optional(),
  audit: z.array(userAuditEntrySchema),
});
export type UserRecord = z.infer<typeof userRecordSchema>;

/** Minimal blob-store surface the store helpers need (injectable for tests). */
export interface UsersBlobStore {
  get(key: string): Promise<string | null>;
  setJSON(key: string, value: unknown): Promise<void | { modified: boolean; etag?: string }>;
  list(options: { prefix: string; directories?: boolean; paginate?: boolean }): Promise<{
    blobs: { key: string }[];
    directories?: string[];
  }>;
}

export const normalizeUserEmail = (email: string): string => email.trim().toLowerCase();

const KEY_PREFIX = 'by-email/';
export const userRecordKey = (email: string): string => `${KEY_PREFIX}${normalizeUserEmail(email)}`;

/** Read + validate a user record. Missing OR corrupt → null (resolver degrades to env). */
export const getUserRecord = async (store: UsersBlobStore, email: string): Promise<UserRecord | null> => {
  const raw = await store.get(userRecordKey(email));
  if (!raw) return null;
  try {
    return userRecordSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const putUserRecord = async (store: UsersBlobStore, record: UserRecord): Promise<void> => {
  const validated = userRecordSchema.parse({ ...record, email: normalizeUserEmail(record.email) });
  await store.setJSON(userRecordKey(validated.email), validated);
};

/** All valid user records (corrupt entries skipped). */
export const listUserRecords = async (store: UsersBlobStore): Promise<UserRecord[]> => {
  const listed = await store.list({ prefix: KEY_PREFIX, directories: false, paginate: true });
  const records: UserRecord[] = [];
  for (const blob of listed.blobs ?? []) {
    const raw = await store.get(blob.key);
    if (!raw) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue; // skip unparseable blobs
    }
    const parsed = userRecordSchema.safeParse(value);
    if (parsed.success) records.push(parsed.data);
  }
  return records.sort((a, b) => a.email.localeCompare(b.email));
};

/** Append an audit entry (returns a new record; does not persist). */
export const withAuditEntry = (record: UserRecord, entry: UserAuditEntry): UserRecord => ({
  ...record,
  audit: [...record.audit, entry],
});

export const getUsersBlobStore = (event: unknown): Promise<UsersBlobStore> =>
  getNetlifyBlobStore({ name: 'users', consistency: 'strong' }, event) as unknown as Promise<UsersBlobStore>;
