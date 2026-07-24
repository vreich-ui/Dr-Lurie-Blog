/**
 * Function name: Admin_Users
 * Required method: POST
 * Auth: Netlify Identity. Verbs: me / update_me (self, any admin);
 *       list / set_role / disable (Owner). Invite is T9.5.
 *
 * The workspace identity surface (T9.4). Roles are resolved server-side via
 * the async resolver (users store + ADMIN_EMAILS bootstrap owners); owner-only
 * verbs 403 for a non-owner. Every mutation appends to the member's audit array.
 */
import { z } from 'zod';

import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
import { resolveRolesForPrincipalAsync, isOwner } from '../lib/roles.js';
import {
  getUsersBlobStore,
  getUserRecord,
  putUserRecord,
  listUserRecords,
  normalizeUserEmail,
  userRoleSchema,
  type UserRecord,
  type UsersBlobStore,
} from '../lib/users-store.js';
import { MAJOR_KEY_ARTIFACT_REF_RE } from '../lib/artifact-trust.js';
import { inviteUser, activateOnLogin, type GoTrueIdentity } from '../lib/user-invite.js';
import type { Principal } from '../../packages/core/schema/object-record-v1.js';

/** An avatar must be an uploaded IMAGE artifact reference, not a URL/data URI. */
export const isTrustedAvatarRef = (ref: string): boolean =>
  ref.startsWith('image/') && MAJOR_KEY_ARTIFACT_REF_RE.test(ref);

type LambdaEvent = {
  httpMethod?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
};

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const jsonResponse = (status: number, body: Record<string, unknown>) => ({
  statusCode: status,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: status >= 200 && status < 300, status, ...body }),
});

const requestSchema = z.discriminatedUnion('verb', [
  z.object({ verb: z.literal('me') }),
  z.object({
    verb: z.literal('update_me'),
    display_name: z.string().min(1).max(200).optional(),
    avatar_artifact: z.string().min(1).optional(),
  }),
  z.object({ verb: z.literal('list') }),
  z.object({ verb: z.literal('invite'), email: z.string().min(3), role: userRoleSchema }),
  z.object({ verb: z.literal('set_role'), email: z.string().min(3), role: userRoleSchema }),
  z.object({ verb: z.literal('disable'), email: z.string().min(3) }),
]);

const safeJsonParse = (event: LambdaEvent): { ok: true; value: unknown } | { ok: false } => {
  if (!event.body) return { ok: false };
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
};

const nowIso = () => new Date().toISOString();

/** A read-only view for a caller with no stored record yet (e.g. a bootstrap owner's first login). */
const synthesizedRecord = (email: string, owner: boolean): UserRecord => {
  const ts = nowIso();
  return {
    schema_version: 1,
    email,
    display_name: email,
    role: owner ? 'owner' : 'admin',
    status: 'active',
    invited_by: 'bootstrap',
    created_at: ts,
    updated_at: ts,
    audit: [],
  };
};

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const adminState = await getAdminStateFromEvent(event, context);
  if (!adminState.authenticated) return jsonResponse(401, { error: adminState.error ?? 'Unauthorized' });

  const email = normalizeUserEmail(adminState.email ?? '');
  if (!email) return jsonResponse(403, { error: 'A verified email is required.' });
  const principal: Principal = { kind: 'human', id: adminState.userId ?? '', email };

  const parsed = safeJsonParse(event);
  if (!parsed.ok) return jsonResponse(400, { error: 'Invalid request body.' });
  const request = requestSchema.safeParse(parsed.value);
  if (!request.success) return jsonResponse(400, { error: 'Invalid request fields.', issues: request.error.issues });

  try {
    const store = await getUsersBlobStore(event);
    const roles = await resolveRolesForPrincipalAsync(principal, {
      getUserRecord: (e) => getUserRecord(store, e),
    });
    if (!roles.includes('admin')) return jsonResponse(403, { error: 'Admin access required' });
    const owner = isOwner(roles);

    const req = request.data;
    switch (req.verb) {
      case 'me': {
        // T9.5/T9.6: first-login activation (invited → active + stamp user_id)
        // and last_seen on every self-read. Bootstrap owners have no record.
        const activated = await activateOnLogin(store, email, adminState.userId, nowIso());
        return jsonResponse(200, {
          user: activated ?? synthesizedRecord(email, owner),
          bootstrap: !activated,
          roles,
        });
      }

      case 'update_me': {
        // T9.6: an avatar must be an uploaded image artifact reference
        // (image/<id>/<sha256>.<ext>) — never an arbitrary URL or data URI.
        if (req.avatar_artifact !== undefined && !isTrustedAvatarRef(req.avatar_artifact)) {
          return jsonResponse(400, {
            error: 'Avatar must be an uploaded image artifact reference, not a URL.',
          });
        }
        const base = (await getUserRecord(store, email)) ?? synthesizedRecord(email, owner);
        const updated: UserRecord = {
          ...base,
          display_name: req.display_name ?? base.display_name,
          avatar_artifact: req.avatar_artifact ?? base.avatar_artifact,
          updated_at: nowIso(),
          last_seen_at: nowIso(),
          audit: [...base.audit, { at: nowIso(), actor_email: email, action: 'update_profile' }],
        };
        await putUserRecord(store, updated);
        return jsonResponse(200, { user: updated });
      }

      case 'list': {
        if (!owner) return jsonResponse(403, { error: 'Owner access required' });
        return jsonResponse(200, { users: await listUserRecords(store) });
      }

      case 'invite': {
        if (!owner) return jsonResponse(403, { error: 'Owner access required' });
        const identity = (context as { clientContext?: { identity?: GoTrueIdentity } } | undefined)?.clientContext
          ?.identity;
        const result = await inviteUser({
          store,
          email: req.email,
          role: req.role,
          invitedBy: email,
          at: nowIso(),
          identity,
          fetchImpl: (url, init) => fetch(url, init),
        });
        return jsonResponse(200, { user: result.record, invite: result.invite });
      }

      case 'set_role':
      case 'disable': {
        if (!owner) return jsonResponse(403, { error: 'Owner access required' });
        const target = normalizeUserEmail(req.email);
        if (target === email) {
          return jsonResponse(409, { error: 'You cannot change your own role or status.' });
        }
        const stored = await getUserRecord(store, target);
        if (!stored) {
          return jsonResponse(404, { error: 'No such member. Invite them first.' });
        }
        const updated: UserRecord =
          req.verb === 'set_role'
            ? {
                ...stored,
                role: req.role,
                updated_at: nowIso(),
                audit: [
                  ...stored.audit,
                  { at: nowIso(), actor_email: email, action: 'set_role', detail: `${stored.role} → ${req.role}` },
                ],
              }
            : {
                ...stored,
                status: 'disabled',
                updated_at: nowIso(),
                audit: [...stored.audit, { at: nowIso(), actor_email: email, action: 'disable' }],
              };
        await putUserRecord(store, updated);
        return jsonResponse(200, { user: updated });
      }
    }
  } catch (error) {
    console.error('Admin_Users request failed.', error);
    return jsonResponse(500, { error: 'User request could not be processed.' });
  }
};

// Re-export for tests that exercise the store surface directly.
export type { UsersBlobStore };
