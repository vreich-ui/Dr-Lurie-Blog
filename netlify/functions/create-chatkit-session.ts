import { verifyToken } from '@clerk/backend';

type LambdaEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
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

type ClerkAuthResult =
  | { errorResponse: ReturnType<typeof jsonResponse>; userId?: never }
  | { errorResponse?: never; userId: string };

const getHeader = (headers: LambdaEvent['headers'], name: string) => {
  const normalizedName = name.toLowerCase();
  const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);

  return match?.[1] ?? '';
};

const getBearerToken = (authorization: string) => {
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
};

const verifyClerkSession = async (event: LambdaEvent): Promise<ClerkAuthResult> => {
  const token = getBearerToken(getHeader(event.headers, 'authorization'));

  if (!token) {
    return { errorResponse: jsonResponse(401, { error: 'A Clerk session token is required to start ChatKit.' }) };
  }

  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!secretKey) {
    return { errorResponse: jsonResponse(500, { error: 'ChatKit authentication is not configured.' }) };
  }

  try {
    const verifiedToken = await verifyToken(token, { secretKey });

    if (!verifiedToken.sub) {
      return { errorResponse: jsonResponse(401, { error: 'Invalid Clerk session token.' }) };
    }

    return { userId: verifiedToken.sub };
  } catch (error) {
    console.warn('Rejected ChatKit session request with invalid Clerk session token.', error);
    return { errorResponse: jsonResponse(401, { error: 'Invalid Clerk session token.' }) };
  }
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed. Use POST.' });
  }

  const auth = await verifyClerkSession(event);

  if ('errorResponse' in auth) {
    return auth.errorResponse;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const workflowId = process.env.OPENAI_CHATKIT_WORKFLOW_ID;

  if (!apiKey || !workflowId) {
    return jsonResponse(500, {
      error: 'ChatKit is not configured. Set OPENAI_API_KEY and OPENAI_CHATKIT_WORKFLOW_ID in Netlify.',
    });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chatkit/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'chatkit_beta=v1',
      },
      body: JSON.stringify({
        workflow: { id: workflowId },
        user: auth.userId,
      }),
    });
    const responseBody = await response.json().catch(() => ({}));

    if (!response.ok) {
      return jsonResponse(response.status, {
        error: 'OpenAI ChatKit session could not be created.',
        details: responseBody,
      });
    }

    const clientSecret =
      responseBody && typeof responseBody === 'object' && 'client_secret' in responseBody
        ? responseBody.client_secret
        : undefined;

    if (typeof clientSecret !== 'string' || !clientSecret) {
      return jsonResponse(502, { error: 'OpenAI ChatKit session response did not include a client secret.' });
    }

    return jsonResponse(200, { client_secret: clientSecret });
  } catch (error) {
    console.error('Failed to create ChatKit session.', error);
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'ChatKit session could not be created.' });
  }
};
