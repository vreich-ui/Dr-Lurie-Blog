import { getAdminStateFromEvent } from '../lib/admin-auth.js';

declare const process: {
  env: Record<string, string | undefined>;
};

type LambdaEvent = {
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
};

type ChatKitSessionResponse = {
  id?: unknown;
  client_secret?: unknown;
  expires_at?: unknown;
  config?: unknown;
  max_requests?: unknown;
};

const WORKFLOW_ID_PATTERN = /^wf_[a-zA-Z0-9]+$/;

type VerifiedChatkitUser = {
  userId: string;
};

const chatKitSessionsUrl = 'https://api.openai.com/v1/chatkit/sessions';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

const isDebugSessionMetadataEnabled = () => {
  if (process.env.CHATKIT_DEBUG === 'true') return true;
  const netlifyContext = process.env.CONTEXT?.toLowerCase();
  return netlifyContext === 'deploy-preview';
};

const verifyClerkAdminSession = async (
  event: LambdaEvent
): Promise<VerifiedChatkitUser | ReturnType<typeof jsonResponse>> => {
  const adminState = await getAdminStateFromEvent(event);

  if (!adminState.authenticated) {
    const statusCode = adminState.error === 'Clerk authentication is not configured.' ? 500 : 401;
    const error =
      adminState.error === 'A valid Clerk session token is required.'
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

export const handler = async (event: LambdaEvent) => {
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

    const session = (await response.json()) as ChatKitSessionResponse;

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

    const debugMetadata = isDebugSessionMetadataEnabled()
      ? {
          session_id: typeof session.id === 'string' ? session.id : undefined,
          expires_at: typeof session.expires_at === 'number' ? session.expires_at : undefined,
          max_requests: typeof session.max_requests === 'number' ? session.max_requests : undefined,
          config_keys: session.config && typeof session.config === 'object' ? Object.keys(session.config as object) : [],
          has_client_secret: true,
        }
      : {};

    return jsonResponse(200, {
      client_secret: session.client_secret,
      workflow_id: workflowId,
      ...debugMetadata,
    });
  } catch (error) {
    console.error('OpenAI ChatKit session creation failed.', error);

    return jsonResponse(502, { status: 'error', error: 'Chat session could not be created.' });
  }
};
