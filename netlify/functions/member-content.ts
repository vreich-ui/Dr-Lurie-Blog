import { verifyClerkSession } from '../lib/clerk-session';

type LambdaEvent = {
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const session = await verifyClerkSession(event);

  if (!session.ok) {
    return {
      statusCode: session.statusCode,
      headers: jsonHeaders,
      body: JSON.stringify({ error: session.error }),
    };
  }

  // Future Stripe paywall boundary:
  // 1. Use session.claims.sub as the Clerk user ID.
  // 2. Look up the Stripe customer/subscription or entitlement for that user on the server.
  // 3. Return paid/private content only after both the Clerk session and Stripe entitlement are valid.
  // Never ship complete premium content in frontend JavaScript and hide it with CSS.
  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({
      ok: true,
      userId: session.claims.sub,
      items: [
        {
          title: 'Member content API is ready',
          description: 'Replace this placeholder with server-validated member or paid content.',
        },
      ],
    }),
  };
};
