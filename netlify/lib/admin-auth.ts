type LambdaHeaders = Record<string, string | undefined> | undefined;

export type LambdaEventWithHeaders = {
  headers?: LambdaHeaders;
};

export type LambdaContext = {
  clientContext?: {
    user?: {
      sub?: string;
      email?: string;
      user_metadata?: Record<string, unknown>;
      app_metadata?: Record<string, unknown>;
    };
  };
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

export const getAdminStateFromEvent = async (
  event: LambdaEventWithHeaders,
  context?: LambdaContext
): Promise<AdminAuthState> => {
  const netlifyUser = context?.clientContext?.user;

  if (netlifyUser) {
    const userId = toStringValue(netlifyUser.sub);
    const email = toStringValue(netlifyUser.email);

    if (!userId) {
      return { authenticated: false, isAdmin: false, error: 'Invalid identity token.' };
    }

    const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);

    return {
      authenticated: true,
      isAdmin: isAdminEmail(email, adminEmails),
      email,
      userId,
    };
  }

  const token = getBearerToken(getHeader(event.headers, 'authorization'));

  if (!token) {
    return { authenticated: false, isAdmin: false, error: 'Authentication is required.' };
  }

  // Fallback: verify token via GoTrue user endpoint (used when Netlify does not inject clientContext).
  const siteUrl = process.env.URL ?? '';
  const identityBase = process.env.IDENTITY_URL ?? (siteUrl ? `${siteUrl}/.netlify/identity` : '');
  if (!identityBase) {
    return { authenticated: false, isAdmin: false, error: 'Identity service is not configured.' };
  }

  try {
    const userRes = await fetch(`${identityBase}/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) {
      return { authenticated: false, isAdmin: false, error: 'Authentication token could not be verified.' };
    }
    const userJson = (await userRes.json()) as {
      id?: string;
      email?: string;
      user_metadata?: Record<string, unknown>;
      app_metadata?: Record<string, unknown>;
    };
    const userId = toStringValue(userJson.id);
    const email = toStringValue(userJson.email);
    if (!userId) {
      return { authenticated: false, isAdmin: false, error: 'Invalid identity token.' };
    }
    const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);
    return { authenticated: true, isAdmin: isAdminEmail(email, adminEmails), email, userId };
  } catch {
    return { authenticated: false, isAdmin: false, error: 'Authentication could not be completed.' };
  }
};
