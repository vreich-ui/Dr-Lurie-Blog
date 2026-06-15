import { getAdminStateFromEvent } from '../lib/admin-auth.js';
const WORKFLOW_ID_PATTERN = /^wf_[a-zA-Z0-9]+$/;
const chatKitSessionsUrl = 'https://api.openai.com/v1/chatkit/sessions';
const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};
const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body),
});
const verifyClerkAdminSession = async (event) => {
    const adminState = await getAdminStateFromEvent(event);
    if (!adminState.authenticated) {
        const statusCode = adminState.error === 'Clerk authentication is not configured.' ? 500 : 401;
        const error = adminState.error === 'A valid Clerk session token is required.'
            ? 'A valid Clerk session token is required to create ChatKit sessions.'
            : adminState.error || 'A valid Clerk session token is required to create ChatKit sessions.';
        return jsonResponse(statusCode, { status: 'error', error });
    }
    if (!adminState.isAdmin) {
        return jsonResponse(403, { status: 'error', error: 'This Clerk user is not authorized to create ChatKit sessions.' });
    }
    if (!adminState.userId) {
        return jsonResponse(401, { status: 'error', error: 'Invalid Clerk session token.' });
    }
    return { userId: `clerk-${adminState.userId}` };
};
export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, { status: 'error', error: 'Method not allowed' });
    }
    const verifiedUser = await verifyClerkAdminSession(event);
    if ('statusCode' in verifiedUser) {
        return verifiedUser;
    }
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const workflowId = process.env.OPENAI_CHATKIT_WORKFLOW_ID?.trim();
    if (!openaiApiKey || !workflowId) {
        return jsonResponse(500, {
            status: 'error',
            error: 'Chat session creation is not configured.',
        });
    }
    if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
        return jsonResponse(500, {
            status: 'error',
            error: 'Chat session workflow configuration is invalid.',
        });
    }
    try {
        const response = await fetch(chatKitSessionsUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'chatkit_beta=v1',
            },
            body: JSON.stringify({
                user: verifiedUser.userId,
                workflow: {
                    id: workflowId,
                },
            }),
        });
        const session = (await response.json());
        if (!response.ok) {
            console.error('OpenAI ChatKit session creation failed.', {
                status: response.status,
                statusText: response.statusText,
            });
            return jsonResponse(502, { status: 'error', error: 'Chat session could not be created.' });
        }
        if (typeof session.client_secret !== 'string' || !session.client_secret) {
            console.error('OpenAI ChatKit session response did not include a client_secret.');
            return jsonResponse(502, { status: 'error', error: 'Chat session could not be created.' });
        }
        return jsonResponse(200, {
            client_secret: session.client_secret,
            workflow_id: workflowId,
        });
    }
    catch (error) {
        console.error('OpenAI ChatKit session creation failed.', error);
        return jsonResponse(502, { status: 'error', error: 'Chat session could not be created.' });
    }
};
