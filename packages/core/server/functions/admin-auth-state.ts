import type { SiteBinding } from '../lib/site-binding.js';
import type { LambdaContext } from '../lib/admin-auth.js';
import { resolveAdminAccessFromEvent } from '../lib/request-roles.js';
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

  // T9.4/S1: resolve the full workspace tier via the shared admin-access
  // resolver (users store + ADMIN_EMAILS bootstrap owners) — the SAME
  // resolver every admin function now gates on (request-roles.ts), so this
  // display endpoint can never disagree with what the functions underneath
  // it actually enforce. Still read-only display info; publish-gate.ts is
  // the sole enforcement point for publishing.
  const adminState = await resolveAdminAccessFromEvent(event, context);
  const tier = isOwner(adminState.roles) ? 'owner' : adminState.roles.includes('admin') ? 'admin' : null;

  return jsonResponse(200, {
    authenticated: adminState.authenticated,
    isAdmin: adminState.isAdmin,
    tier,
    email: adminState.email,
    userId: adminState.userId,
    error: adminState.error,
    roles: adminState.roles,
  });
};

/** W11 T11.4: per-site factory — the site shim instantiates this with its binding. */
export const createHandler = (_binding: SiteBinding) => handlerImpl;
