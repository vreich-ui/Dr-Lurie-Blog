/**
 * Clerk-authenticated wrapper around the workflow lock operations.
 * Agents use save-json-blob directly (x-publish-key). Human editors use this
 * endpoint (Clerk session token) so the frontend never sees the publish secret.
 *
 * Supported actions:
 *   checkout   – acquire lock; 423 if already held by agent
 *   checkin    – release lock (must hold token)
 *   refresh    – extend lease (must hold token)
 *   status     – read current lock state without mutating
 *   force_release – admin override; records history, breaks any active lock
 */
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { getWorkflowBlobStore } from '../lib/blob-store.js';
import type { WorkflowRecord } from '../../src/schema/schema-v1.js';

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const bodySchema = z
  .object({
    action: z.enum(['checkout', 'checkin', 'refresh', 'status', 'force_release']),
    requestId: z.string().min(1),
    lockToken: z.string().min(1).optional(),
    leaseSeconds: z.number().int().positive().max(3600).optional(),
  })
  .strict();

type LambdaEvent = {
  blobs?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

const DEFAULT_LEASE_SECONDS = 900; // 15 min, matches save-json-blob default

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const recordKey = (requestId: string) => `workflows/by-id/${requestId}.json`;
const nowMs = () => Date.now();
const nowIso = (ms = nowMs()) => new Date(ms).toISOString();
const addSecondsIso = (fromMs: number, seconds: number) => new Date(fromMs + seconds * 1000).toISOString();

const isLockActive = (lock: WorkflowRecord['lock'], atMs = nowMs()) =>
  Boolean(lock && Date.parse(lock.expires_at) > atMs);

const sanitizeLock = (lock: WorkflowRecord['lock']) =>
  lock
    ? {
        owner_id: lock.owner_id,
        owner_label: lock.owner_label,
        acquired_at: lock.acquired_at,
        expires_at: lock.expires_at,
      }
    : undefined;

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const adminState = await getAdminStateFromEvent(event);
  if (!adminState.authenticated) return jsonResponse(401, { error: adminState.error ?? 'Unauthorized' });
  if (!adminState.isAdmin) return jsonResponse(403, { error: 'Admin access required' });

  let rawBody: unknown;
  try {
    const text =
      event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body ?? '');
    rawBody = JSON.parse(text);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return jsonResponse(400, { error: 'Invalid request', issues: parsed.error.issues });

  const { action, requestId, lockToken, leaseSeconds } = parsed.data;
  const ownerId = adminState.userId ?? 'unknown';
  const ownerLabel = adminState.email ?? 'admin';

  try {
    const store = await getWorkflowBlobStore(event);
    const raw = await store.get(recordKey(requestId));
    if (!raw) return jsonResponse(404, { error: 'Workflow record not found', not_found: true });

    const record = JSON.parse(raw) as WorkflowRecord;
    const ts = nowMs();
    const timestamp = nowIso(ts);

    if (action === 'status') {
      return jsonResponse(200, {
        action,
        locked: isLockActive(record.lock, ts),
        lock: sanitizeLock(record.lock),
        version: record.version,
      });
    }

    if (action === 'checkout') {
      if (isLockActive(record.lock, ts)) {
        return jsonResponse(423, {
          action,
          locked: true,
          lock: sanitizeLock(record.lock),
        });
      }

      const lease = leaseSeconds ?? DEFAULT_LEASE_SECONDS;
      const nextRecord: WorkflowRecord = {
        ...record,
        updated_at: timestamp,
        lock: {
          token: randomUUID(),
          owner_id: ownerId,
          owner_label: ownerLabel,
          acquired_at: timestamp,
          expires_at: addSecondsIso(ts, lease),
        },
        history: [
          ...record.history,
          {
            at: timestamp,
            action: 'admin_checkout',
            details: { owner_id: ownerId, owner_label: ownerLabel, lease_seconds: lease },
          },
        ],
        version: record.version + 1,
      };

      await store.setJSON(recordKey(requestId), nextRecord);
      return jsonResponse(200, { action, lockToken: nextRecord.lock!.token, lock: sanitizeLock(nextRecord.lock) });
    }

    if (action === 'checkin' || action === 'refresh') {
      if (!lockToken) return jsonResponse(400, { error: 'lockToken is required for this action' });
      if (!record.lock) return jsonResponse(200, { action, idempotent: true });
      if (record.lock.token !== lockToken)
        return jsonResponse(423, { action, locked: true, lock: sanitizeLock(record.lock) });
      if (!isLockActive(record.lock, ts))
        return jsonResponse(423, { action, error: 'lock_expired', lock_expired: true });

      if (action === 'checkin') {
        const nextRecord: WorkflowRecord = {
          ...record,
          updated_at: timestamp,
          lock: undefined,
          history: [
            ...record.history,
            {
              at: timestamp,
              action: 'admin_checkin',
              details: { owner_id: record.lock.owner_id, owner_label: record.lock.owner_label },
            },
          ],
          version: record.version + 1,
        };
        await store.setJSON(recordKey(requestId), nextRecord);
        return jsonResponse(200, { action, checked_in: true });
      }

      // refresh
      const lease = leaseSeconds ?? DEFAULT_LEASE_SECONDS;
      const nextExpiry = addSecondsIso(Date.parse(record.lock.expires_at), lease);
      const nextRecord: WorkflowRecord = {
        ...record,
        updated_at: timestamp,
        lock: { ...record.lock, expires_at: nextExpiry },
        history: [
          ...record.history,
          {
            at: timestamp,
            action: 'admin_refresh_lock',
            details: { owner_id: record.lock.owner_id, lease_seconds: lease },
          },
        ],
        version: record.version + 1,
      };
      await store.setJSON(recordKey(requestId), nextRecord);
      return jsonResponse(200, { action, lock: sanitizeLock(nextRecord.lock) });
    }

    if (action === 'force_release') {
      if (!record.lock) return jsonResponse(200, { action, idempotent: true, message: 'No lock was held' });

      const nextRecord: WorkflowRecord = {
        ...record,
        updated_at: timestamp,
        lock: undefined,
        history: [
          ...record.history,
          {
            at: timestamp,
            action: 'admin_force_release',
            details: {
              forced_by: ownerId,
              previous_owner_id: record.lock.owner_id,
              previous_owner_label: record.lock.owner_label,
            },
          },
        ],
        version: record.version + 1,
      };
      await store.setJSON(recordKey(requestId), nextRecord);
      return jsonResponse(200, { action, released: true });
    }

    return jsonResponse(400, { error: 'Unknown action' });
  } catch (error) {
    console.error('admin-workflow-lock failed', { action, requestId, error });
    return jsonResponse(500, { error: 'Lock operation failed' });
  }
};
