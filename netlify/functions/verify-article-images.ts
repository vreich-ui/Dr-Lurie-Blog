import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { getHeader } from '../lib/admin-auth.js';

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

const requestSchema = z
  .object({
    articleUrl: z.string().trim().url(),
    expectedImageUrls: z.array(z.string().trim().url()).min(1),
  })
  .strict();

const jsonResponse = (status: number, body: Record<string, unknown>) => ({
  statusCode: status,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: status >= 200 && status < 300, status, ...body }),
});

const safeJsonParse = (event: LambdaEvent) => {
  if (!event.body) return { ok: false as const };

  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return { ok: true as const, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false as const };
  }
};

const secretsMatch = (provided: string, expected: string) => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
};

const verifyPublishKey = (event: LambdaEvent) => {
  const provided = getHeader(event.headers, 'x-publish-key').trim();
  const expected = process.env.PUBLISH_SECRET || process.env.NETLIFY_PUBLISH_SECRET || '';

  if (!provided || !expected || !secretsMatch(provided, expected)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  return undefined;
};

const normalizeUrl = (value: string) => {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
};

const pageReferencesImage = (html: string, imageUrl: string) => {
  const normalized = normalizeUrl(imageUrl);
  const pathname = new URL(normalized).pathname;
  return html.includes(imageUrl) || html.includes(normalized) || html.includes(pathname);
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const contentType = getHeader(event.headers, 'content-type').toLowerCase();
  if (!contentType.includes('application/json')) {
    return jsonResponse(415, { error: 'Content-Type must be application/json.' });
  }

  const authFailure = verifyPublishKey(event);
  if (authFailure) return authFailure;

  const parsedJson = safeJsonParse(event);
  if (!parsedJson.ok) return jsonResponse(400, { error: 'Invalid request body.' });

  const parsedBody = requestSchema.safeParse(parsedJson.value);
  if (!parsedBody.success) {
    return jsonResponse(400, { error: 'Invalid request fields.', issues: parsedBody.error.issues });
  }

  const { articleUrl, expectedImageUrls } = parsedBody.data;
  const checks: Array<Record<string, unknown>> = [];

  try {
    const articleResponse = await fetch(articleUrl);
    const articleHtml = await articleResponse.text();

    for (const imageUrl of expectedImageUrls) {
      const present = articleResponse.ok && pageReferencesImage(articleHtml, imageUrl);
      let imageStatus = 0;
      let contentType = '';
      let imageOk = false;

      if (present) {
        const imageResponse = await fetch(imageUrl);
        imageStatus = imageResponse.status;
        contentType = imageResponse.headers.get('content-type') || '';
        imageOk = imageResponse.ok && contentType.toLowerCase().startsWith('image/');
      }

      checks.push({ imageUrl, present, imageStatus, contentType, verified: present && imageOk });
    }
  } catch (error) {
    return jsonResponse(200, {
      verified: false,
      articleUrl,
      expectedImageUrls,
      checks,
      error: error instanceof Error ? error.message : 'Image verification failed.',
    });
  }

  return jsonResponse(200, {
    verified: checks.every((check) => check.verified === true),
    articleUrl,
    expectedImageUrls,
    checks,
  });
};
