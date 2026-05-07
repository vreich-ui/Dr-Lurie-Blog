type LambdaEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  isBase64Encoded?: boolean;
};

export type OptInInput = {
  consent?: unknown;
  consentText?: unknown;
  consentType?: unknown;
  email?: unknown;
  formName?: unknown;
  'form-name'?: unknown;
  name?: unknown;
  pathname?: unknown;
  source?: unknown;
};

export type OptInRecord = {
  formName: string;
  submittedAt: string;
  userAgent?: string;
  email?: string;
  name?: string;
  source?: string;
  consent?: string;
};

export const getHeader = (headers: LambdaEvent['headers'], name: string) => {
  const normalizedName = name.toLowerCase();
  const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);

  return match?.[1];
};

const toStringValue = (value: unknown) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
};

export const parseBody = (event: LambdaEvent): OptInInput | undefined => {
  if (!event.body) {
    return undefined;
  }

  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const contentType = getHeader(event.headers, 'content-type') ?? '';

  if (contentType.includes('application/json')) {
    const parsed = JSON.parse(body) as unknown;

    return parsed && typeof parsed === 'object' ? (parsed as OptInInput) : undefined;
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(body);

    return Object.fromEntries(params.entries());
  }

  return undefined;
};

export const buildRecord = (input: OptInInput, userAgent?: string): OptInRecord | undefined => {
  const formName = toStringValue(input.formName) ?? toStringValue(input['form-name']);

  if (!formName) {
    return undefined;
  }

  const consent = toStringValue(input.consentText) ?? toStringValue(input.consentType) ?? toStringValue(input.consent);
  const source = toStringValue(input.source) ?? toStringValue(input.pathname);
  const record: OptInRecord = {
    formName,
    submittedAt: new Date().toISOString(),
  };

  const email = toStringValue(input.email);
  const name = toStringValue(input.name);

  if (email) {
    record.email = email;
  }

  if (name) {
    record.name = name;
  }

  if (source) {
    record.source = source;
  }

  if (consent) {
    record.consent = consent;
  }

  if (userAgent) {
    record.userAgent = userAgent;
  }

  return record;
};
