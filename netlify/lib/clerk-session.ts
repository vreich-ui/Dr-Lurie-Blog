import { verifyToken } from '@clerk/backend';

type LambdaEvent = {
  headers?: Record<string, string | undefined>;
};

export type ClerkSessionClaims = Awaited<ReturnType<typeof verifyToken>>;

export type ClerkSessionResult =
  | { ok: true; claims: ClerkSessionClaims; token: string }
  | { ok: false; statusCode: 401 | 500; error: string };

const getHeader = (headers: LambdaEvent['headers'], name: string) => {
  const normalizedName = name.toLowerCase();
  const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);

  return match?.[1];
};

const getSessionToken = (event: LambdaEvent) => {
  const authorization = getHeader(event.headers, 'authorization');
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);

  if (bearerMatch?.[1]) {
    return bearerMatch[1].trim();
  }

  const cookie = getHeader(event.headers, 'cookie');
  const sessionCookie = cookie
    ?.split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('__session='));

  return sessionCookie ? decodeURIComponent(sessionCookie.slice('__session='.length)) : undefined;
};

const getAuthorizedParties = () =>
  (process.env.CLERK_AUTHORIZED_PARTIES ?? process.env.URL ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const verifyClerkSession = async (event: LambdaEvent): Promise<ClerkSessionResult> => {
  const token = getSessionToken(event);

  if (!token) {
    return { ok: false, statusCode: 401, error: 'Missing Clerk session token.' };
  }

  try {
    const claims = await verifyToken(token, {
      authorizedParties: getAuthorizedParties(),
      jwtKey: process.env.CLERK_JWT_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    return { ok: true, claims, token };
  } catch (error) {
    console.error('Failed to verify Clerk session.', error);

    return { ok: false, statusCode: 401, error: 'Clerk session token could not be verified.' };
  }
};
