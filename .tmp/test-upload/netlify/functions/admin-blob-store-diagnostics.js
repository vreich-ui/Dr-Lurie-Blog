import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { getCoreBlobStoreSourceDiagnostics } from '../lib/blob-store.js';
const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});
export const handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }
    const adminState = await getAdminStateFromEvent(event);
    if (!adminState.authenticated) {
        return jsonResponse(adminState.error === 'Clerk authentication is not configured.' ? 500 : 401, {
            error: adminState.error || 'A valid Clerk session token is required.',
        });
    }
    if (!adminState.isAdmin) {
        return jsonResponse(403, { error: 'This Clerk user is not authorized to inspect blob store diagnostics.' });
    }
    return jsonResponse(200, {
        diagnostics: getCoreBlobStoreSourceDiagnostics(event),
    });
};
