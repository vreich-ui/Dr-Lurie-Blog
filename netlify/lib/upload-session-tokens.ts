import { createHmac, timingSafeEqual } from 'node:crypto';

export type UploadSessionTokenPayload = {
  sessionId: string;
  requestId: string;
  expectedSizeBytes: number;
  expiresAt: number;
  totalChunks?: number;
  chunkSizeBytes?: number;
};

type UploadSessionTokenValidationInput = {
  token: string;
  expected: Omit<UploadSessionTokenPayload, 'expiresAt'>;
  nowMs?: number;
  secret?: string;
};

const tokenVersion = 'v1';

export const getUploadSessionTokenSecret = () => process.env.NETLIFY_PUBLISH_SECRET || process.env.PUBLISH_SECRET || '';

const base64UrlEncode = (value: string) => Buffer.from(value).toString('base64url');

const base64UrlJson = (value: unknown) => base64UrlEncode(JSON.stringify(value));

const signPayload = (encodedPayload: string, secret: string) =>
  createHmac('sha256', secret).update(`${tokenVersion}.${encodedPayload}`).digest('base64url');

const signaturesMatch = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object');

const parsePayload = (encodedPayload: string): UploadSessionTokenPayload | undefined => {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as unknown;
    if (!isRecord(parsed)) return undefined;

    const sessionId = parsed.sessionId;
    const requestId = parsed.requestId;
    const expectedSizeBytes = parsed.expectedSizeBytes;
    const expiresAt = parsed.expiresAt;
    const totalChunks = parsed.totalChunks;
    const chunkSizeBytes = parsed.chunkSizeBytes;
    if (typeof sessionId !== 'string' || !sessionId) return undefined;
    if (typeof requestId !== 'string' || !requestId) return undefined;
    if (typeof expectedSizeBytes !== 'number' || !Number.isInteger(expectedSizeBytes) || expectedSizeBytes < 0)
      return undefined;
    if (typeof expiresAt !== 'number' || !Number.isInteger(expiresAt) || expiresAt <= 0) return undefined;
    if (
      totalChunks !== undefined &&
      (typeof totalChunks !== 'number' || !Number.isInteger(totalChunks) || totalChunks < 1)
    )
      return undefined;
    if (
      chunkSizeBytes !== undefined &&
      (typeof chunkSizeBytes !== 'number' || !Number.isInteger(chunkSizeBytes) || chunkSizeBytes < 1)
    )
      return undefined;

    return {
      sessionId,
      requestId,
      expectedSizeBytes,
      expiresAt,
      ...(typeof totalChunks === 'number' ? { totalChunks } : {}),
      ...(typeof chunkSizeBytes === 'number' ? { chunkSizeBytes } : {}),
    };
  } catch {
    return undefined;
  }
};

export const signUploadSessionToken = (payload: UploadSessionTokenPayload, secret = getUploadSessionTokenSecret()) => {
  if (!secret) throw new Error('Upload session token signing is not configured.');

  const encodedPayload = base64UrlJson(payload);
  const signature = signPayload(encodedPayload, secret);
  return `${tokenVersion}.${encodedPayload}.${signature}`;
};

export const validateUploadSessionToken = ({
  token,
  expected,
  nowMs = Date.now(),
  secret = getUploadSessionTokenSecret(),
}: UploadSessionTokenValidationInput) => {
  if (!secret)
    return { ok: false as const, statusCode: 500, error: 'Upload session token validation is not configured.' };

  const [version, encodedPayload, signature, extra] = token.split('.');
  if (version !== tokenVersion || !encodedPayload || !signature || extra !== undefined) {
    return { ok: false as const, statusCode: 401, error: 'Invalid upload token.' };
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  if (!signaturesMatch(signature, expectedSignature)) {
    return { ok: false as const, statusCode: 401, error: 'Invalid upload token.' };
  }

  const payload = parsePayload(encodedPayload);
  if (!payload) return { ok: false as const, statusCode: 401, error: 'Invalid upload token.' };
  if (payload.expiresAt <= nowMs) return { ok: false as const, statusCode: 401, error: 'Upload token has expired.' };

  if (
    payload.sessionId !== expected.sessionId ||
    payload.requestId !== expected.requestId ||
    payload.expectedSizeBytes !== expected.expectedSizeBytes ||
    (expected.totalChunks !== undefined && payload.totalChunks !== expected.totalChunks) ||
    (expected.chunkSizeBytes !== undefined && payload.chunkSizeBytes !== expected.chunkSizeBytes)
  ) {
    return { ok: false as const, statusCode: 401, error: 'Upload token does not match this upload session.' };
  }

  return { ok: true as const, payload };
};
