import type { SiteBinding } from '../lib/site-binding.js';
import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
import { resolveRolesFromEvent } from '../lib/request-roles.js';
import { isOwner } from '../lib/roles.js';

type LambdaEvent = {
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

const handlerImpl = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const adminState = await getAdminStateFromEvent(event, context);

  // T9.4: resolve the full workspace tier via the async resolver (users store +
  // ADMIN_EMAILS bootstrap owners). `isAdmin` now reflects the resolved roles —
  // a superset of the old ADMIN_EMAILS check (store admins gain access; no one
  // who had access loses it). Still read-only display info; publish-gate.ts is
  // the sole enforcement point for publishing.
  const roles =
    adminState.authenticated && adminState.email
      ? await resolveRolesFromEvent(event, {
          kind: 'human',
          id: adminState.userId ?? '',
          email: adminState.email,
        })
      : [];
  const tier = isOwner(roles) ? 'owner' : roles.includes('admin') ? 'admin' : null;

  return jsonResponse(200, {
    authenticated: adminState.authenticated,
    isAdmin: roles.includes('admin'),
    tier,
    email: adminState.email,
    userId: adminState.userId,
    error: adminState.error,
    roles,
  });
};

/** W11 T11.4: per-site factory — the site shim instantiates this with its binding. */
export const createHandler = (_binding: SiteBinding) => handlerImpl;
