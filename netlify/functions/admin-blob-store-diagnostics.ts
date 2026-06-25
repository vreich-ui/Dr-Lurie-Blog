import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
import { getCoreBlobStoreSourceDiagnostics } from '../lib/blob-store.js';

type LambdaEvent = {
  blobs?: unknown;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const adminState = await getAdminStateFromEvent(event, context);
  if (!adminState.authenticated) {
    return jsonResponse(401, {
      error: adminState.error || 'Authentication is required.',
    });
  }

  if (!adminState.isAdmin) {
    return jsonResponse(403, { error: 'This user is not authorized to inspect blob store diagnostics.' });
  }

  return jsonResponse(200, {
    diagnostics: getCoreBlobStoreSourceDiagnostics(event),
  });
};
