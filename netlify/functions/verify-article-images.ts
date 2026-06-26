import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { getHeader } from '../lib/admin-auth.js';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

type LambdaEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type VerifiedImage = {
  expected: string;
  resolvedUrl: string;
  present: boolean;
  status?: number;
  contentType?: string;
  ok: boolean;
  error?: string;
};

const requestSchema = z
  .object({
    url: z.string().min(1),
    expectedImages: z.array(z.string().min(1)),
  })
  .strict();

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

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
    return jsonResponse(401, { verified: false, error: 'Unauthorized' });
  }

  return undefined;
};

const isHttpUrl = (url: URL) => url.protocol === 'http:' || url.protocol === 'https:';

const parseBody = (event: LambdaEvent) => {
  if (!event.body) return undefined;

  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(body) as unknown;
};

const resolveUrl = (value: string, baseUrl: URL) => new URL(value, baseUrl).toString();

const extractImageSources = (html: string, pageUrl: URL) => {
  const sources = new Set<string>();
  const imgTagPattern = /<img\b[^>]*>/gi;
  const srcPattern = /\bsrc\s*=\s*(["'])(.*?)\1/i;

  for (const imgTag of html.matchAll(imgTagPattern)) {
    const srcMatch = imgTag[0].match(srcPattern);
    const src = srcMatch?.[2]?.trim();

    if (!src) continue;

    try {
      sources.add(resolveUrl(src, pageUrl));
    } catch {
      // Ignore malformed image sources in the page being verified.
    }
  }

  return sources;
};

const noStoreFetchHeaders = {
  'Cache-Control': 'no-cache, no-store, max-age=0',
  Pragma: 'no-cache',
};

const verifyImage = async (expected: string, pageUrl: URL, extractedSources: Set<string>): Promise<VerifiedImage> => {
  let resolvedUrl: string;

  try {
    resolvedUrl = resolveUrl(expected, pageUrl);
  } catch (error) {
    return {
      expected,
      resolvedUrl: '',
      present: false,
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid expected image URL.',
    };
  }

  const present = extractedSources.has(resolvedUrl);

  try {
    const response = await fetch(resolvedUrl, {
      cache: 'no-store',
      headers: noStoreFetchHeaders,
    });
    const contentType = response.headers.get('content-type') ?? undefined;
    const hasImageContentType = contentType?.toLowerCase().startsWith('image/') ?? false;
    const ok = present && response.status === 200 && hasImageContentType;

    return {
      expected,
      resolvedUrl,
      present,
      status: response.status,
      contentType,
      ok,
      ...(!present ? { error: 'Expected image was not found in page <img> sources.' } : {}),
      ...(response.status !== 200 ? { error: `Expected image returned status ${response.status}.` } : {}),
      ...(response.status === 200 && !hasImageContentType
        ? { error: 'Expected image did not return an image content-type.' }
        : {}),
    };
  } catch (error) {
    return {
      expected,
      resolvedUrl,
      present,
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to fetch expected image.',
    };
  }
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { verified: false, error: 'Method not allowed. Use POST.' });
  }

  const contentType = getHeader(event.headers, 'content-type').toLowerCase();
  if (!contentType.includes('application/json')) {
    return jsonResponse(415, { verified: false, error: 'Content-Type must be application/json.' });
  }

  const authError = verifyPublishKey(event);
  if (authError) return authError;

  let parsedBody: unknown;
  try {
    parsedBody = parseBody(event);
  } catch {
    return jsonResponse(400, { verified: false, error: 'Invalid JSON body.' });
  }

  const validation = requestSchema.safeParse(parsedBody);
  if (!validation.success) {
    return jsonResponse(400, { verified: false, error: 'Invalid request body.', issues: validation.error.issues });
  }

  const { url, expectedImages } = validation.data;
  let pageUrl: URL;

  try {
    pageUrl = new URL(url);
  } catch {
    return jsonResponse(400, { verified: false, url, expectedImages, error: 'url must be a valid HTTP(S) URL.' });
  }

  if (!isHttpUrl(pageUrl)) {
    return jsonResponse(400, { verified: false, url, expectedImages, error: 'url must use http or https.' });
  }

  try {
    const pageResponse = await fetch(pageUrl.toString(), {
      cache: 'no-store',
      headers: noStoreFetchHeaders,
    });
    const html = await pageResponse.text();
    const extractedSources = extractImageSources(html, pageUrl);
    const images = await Promise.all(
      expectedImages.map((expected) => verifyImage(expected, pageUrl, extractedSources))
    );
    const errors = images
      .filter((image) => !image.ok)
      .map((image) => `${image.expected}: ${image.error ?? 'Verification failed.'}`);
    const verified = pageResponse.status === 200 && images.every((image) => image.ok);

    return jsonResponse(200, {
      verified,
      url: pageUrl.toString(),
      expectedImages,
      images,
      ...(pageResponse.status !== 200 ? { errors: [`Page returned status ${pageResponse.status}.`, ...errors] } : {}),
      ...(pageResponse.status === 200 && errors.length > 0 ? { errors } : {}),
    });
  } catch (error) {
    return jsonResponse(502, {
      verified: false,
      url: pageUrl.toString(),
      expectedImages,
      images: [],
      errors: [error instanceof Error ? error.message : 'Failed to fetch page HTML.'],
    });
  }
};
