import { getAdminStateFromEvent } from '../lib/admin-auth.js';

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

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const adminState = await getAdminStateFromEvent(event);
  const statusCode = adminState.error === 'Clerk authentication is not configured.' ? 500 : 200;

  return jsonResponse(statusCode, {
    authenticated: adminState.authenticated,
    isAdmin: adminState.isAdmin,
    email: adminState.email,
    userId: adminState.userId,
    error: adminState.error,
  });
};
