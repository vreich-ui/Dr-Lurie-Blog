declare const process: {
  env: Record<string, string | undefined>;
};

type LambdaEvent = {
  httpMethod?: string;
};

type ChatKitSessionResponse = {
  client_secret?: unknown;
};

const chatKitSessionsUrl = 'https://api.openai.com/v1/chatkit/sessions';

const createAnonymousUserId = () => `anonymous-${globalThis.crypto.randomUUID()}`;

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
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  const workflowId = process.env.OPENAI_CHATKIT_WORKFLOW_ID;

  if (!openaiApiKey || !workflowId) {
    return jsonResponse(500, {
      error: 'Chat session creation is not configured.',
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
        user: createAnonymousUserId(),
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
