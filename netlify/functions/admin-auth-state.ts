import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
import { resolveHumanRoles } from '../lib/roles.js';

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

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const adminState = await getAdminStateFromEvent(event, context);

  return jsonResponse(200, {
    authenticated: adminState.authenticated,
    isAdmin: adminState.isAdmin,
    email: adminState.email,
    userId: adminState.userId,
    error: adminState.error,
    // T1.4/T1.5: the generic objects review surface needs to know which of
    // ROLE_EMAILS_ADMIN/PUBLISHER/EDITOR this identity holds so it can show
    // the Approve/Request-changes/Publish controls the tier gate would
    // actually allow. This is read-only display info — the server-side
    // gate (tier-gate.ts) is the sole enforcement point regardless.
    roles: adminState.authenticated && adminState.email ? resolveHumanRoles(adminState.email) : [],
  });
};
