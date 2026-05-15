import { verifyToken } from '@clerk/backend';

declare const process: {
  env: Record<string, string | undefined>;
};

type LambdaEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type ChatKitSessionResponse = {
  client_secret?: unknown;
};

type VerifiedChatkitUser = {
  userId: string;
};

type ChatkitSessionRequest = {
  widget?: unknown;
  widgetId?: unknown;
  widgetName?: unknown;
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

const getHeader = (headers: LambdaEvent['headers'], name: string) => {
  const normalizedName = name.toLowerCase();
  const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);

  return match?.[1] ?? '';
};

const getBearerToken = (authorization: string) => {
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
};

const parseJsonBody = (event: LambdaEvent): ChatkitSessionRequest => {
  if (!event.body) return {};

  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as ChatkitSessionRequest) : {};
  } catch (error) {
    console.warn('Ignoring invalid ChatKit session request JSON.', error);
    return {};
  }
};

const toStateVariable = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

const toWidgetPayload = (value: unknown) => {
  if (!value || typeof value !== 'object') return undefined;

  try {
    return JSON.stringify(value);
  } catch (error) {
    console.warn('Ignoring ChatKit widget payload that could not be serialized.', error);
    return undefined;
  }
};

const verifyClerkSession = async (
  event: LambdaEvent
): Promise<VerifiedChatkitUser | ReturnType<typeof jsonResponse>> => {
  const token = getBearerToken(getHeader(event.headers, 'authorization'));

  if (!token) {
    return jsonResponse(401, {
      error: 'A valid Clerk session token is required to create ChatKit sessions.',
    });
  }

  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!secretKey) {
    return jsonResponse(500, {
      error: 'ChatKit authentication is not configured.',
    });
  }

  try {
    const verifiedToken = await verifyToken(token, { secretKey });

    if (!verifiedToken.sub) {
      return jsonResponse(401, { error: 'Invalid Clerk session token.' });
    }

    return { userId: `clerk-${verifiedToken.sub}` };
  } catch (error) {
    console.warn('Rejected ChatKit session request with invalid Clerk token.', error);
    return jsonResponse(401, { error: 'Invalid Clerk session token.' });
  }
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const verifiedUser = await verifyClerkSession(event);

  if ('statusCode' in verifiedUser) {
    return verifiedUser;
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  const workflowId = process.env.OPENAI_CHATKIT_WORKFLOW_ID;

  if (!openaiApiKey || !workflowId) {
    return jsonResponse(500, {
      error: 'Chat session creation is not configured.',
    });
  }

  const requestBody = parseJsonBody(event);
  const widgetId = toStateVariable(requestBody.widgetId);
  const widgetName = toStateVariable(requestBody.widgetName);
  const widgetPayload = toWidgetPayload(requestBody.widget);

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
          state_variables: {
            ...(widgetId ? { chatkit_widget_id: widgetId } : {}),
            ...(widgetName ? { chatkit_widget_name: widgetName } : {}),
            ...(widgetPayload ? { chatkit_widget_payload: widgetPayload } : {}),
          },
        },
      }),
    });

    const session = (await response.json()) as ChatKitSessionResponse;

    if (!response.ok) {
      console.error('OpenAI ChatKit session creation failed.', {
        status: response.status,
        statusText: response.statusText,
      });

      return jsonResponse(502, { error: 'Chat session could not be created.' });
    }

    if (typeof session.client_secret !== 'string' || !session.client_secret) {
      console.error('OpenAI ChatKit session response did not include a client_secret.');

      return jsonResponse(502, { error: 'Chat session could not be created.' });
    }

    return jsonResponse(200, { client_secret: session.client_secret });
  } catch (error) {
    console.error('OpenAI ChatKit session creation failed.', error);

    return jsonResponse(502, { error: 'Chat session could not be created.' });
  }
};
