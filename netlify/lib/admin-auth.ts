import { createClerkClient, verifyToken } from '@clerk/backend';

type LambdaHeaders = Record<string, string | undefined> | undefined;

export type LambdaEventWithHeaders = {
  headers?: LambdaHeaders;
};

export type AdminAuthState = {
  authenticated: boolean;
  isAdmin: boolean;
  email?: string;
  userId?: string;
  error?: string;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toStringValue = (value: unknown) => {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const getHeader = (headers: LambdaHeaders, name: string) => {
  const normalizedName = name.toLowerCase();
  const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);

  return match?.[1] ?? '';
};

export const getBearerToken = (authorization: string) => {
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
};

export const parseAdminEmails = (value: string | undefined) =>
  (value ?? '').split(',').map(normalizeEmail).filter(Boolean);

export const isAdminEmail = (email: string | undefined, adminEmails: string[]) => {
  if (!email) return false;

  const normalizedEmail = normalizeEmail(email);
  return adminEmails.some((adminEmail) => normalizeEmail(adminEmail) === normalizedEmail);
};

const getClaimString = (claims: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = toStringValue(claims[key]);

    if (value) return value;
  }

  return undefined;
};

const getEmailFromClaims = (claims: Record<string, unknown>) => {
  const directEmail = getClaimString(claims, [
    'email',
    'email_address',
    'emailAddress',
    'primary_email_address',
    'primaryEmailAddress',
  ]);

  if (directEmail) return directEmail;

  const user = claims.user;
  if (user && typeof user === 'object') {
    return getClaimString(user as Record<string, unknown>, ['email', 'email_address', 'emailAddress']);
  }

  return undefined;
};

const getEmailFromClerkUser = async (userId: string, secretKey: string) => {
  const clerkClient = createClerkClient({ secretKey });
  const user = await clerkClient.users.getUser(userId);
  const primaryEmail = user.emailAddresses.find((emailAddress) => emailAddress.id === user.primaryEmailAddressId);

  return primaryEmail?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
};

export const getAdminStateFromEvent = async (event: LambdaEventWithHeaders): Promise<AdminAuthState> => {
  const token = getBearerToken(getHeader(event.headers, 'authorization'));

  if (!token) {
    return {
      authenticated: false,
      isAdmin: false,
      error: 'A valid Clerk session token is required.',
    };
  }

  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!secretKey) {
    return {
      authenticated: false,
      isAdmin: false,
      error: 'Clerk authentication is not configured.',
    };
  }

  try {
    const verifiedToken = await verifyToken(token, { secretKey });
    const claims = verifiedToken as Record<string, unknown>;
    const userId = toStringValue(verifiedToken.sub);

    if (!userId) {
      return {
        authenticated: false,
        isAdmin: false,
        error: 'Invalid Clerk session token.',
      };
    }

    const email = getEmailFromClaims(claims) ?? (await getEmailFromClerkUser(userId, secretKey));
    const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);

    return {
      authenticated: true,
      isAdmin: isAdminEmail(email, adminEmails),
      email,
      userId,
    };
  } catch (error) {
    console.warn('Rejected request with invalid Clerk token or user lookup failure.', error);

    return {
      authenticated: false,
      isAdmin: false,
      error: 'Invalid Clerk session token.',
    };
  }
};

export const verifyClerkAdmin = getAdminStateFromEvent;
