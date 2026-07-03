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
  matchedUrl?: string;
  matchedBy?: 'exact' | 'filename-stem';
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
  const srcsetPattern = /\bsrcset\s*=\s*(["'])(.*?)\1/i;

  const addSource = (value: string | undefined) => {
    const candidate = value?.trim();
    if (!candidate) return;
    try {
      sources.add(resolveUrl(candidate, pageUrl));
    } catch {
      // Ignore malformed image sources in the page being verified.
    }
  };

  for (const imgTag of html.matchAll(imgTagPattern)) {
    addSource(imgTag[0].match(srcPattern)?.[2]);

    // Astro's Image component emits optimized variants via srcset; each entry is
    // "<url> <descriptor>".
    const srcset = imgTag[0].match(srcsetPattern)?.[2];
    for (const entry of srcset?.split(',') ?? []) {
      addSource(entry.trim().split(/\s+/)[0]);
    }
  }

  return sources;
};

const getUrlBasename = (value: string) => {
  try {
    return new URL(value).pathname.split('/').pop() ?? '';
  } catch {
    return value.split('/').pop() ?? '';
  }
};

const getFilenameStem = (filename: string) => filename.replace(/\.[a-z0-9]+$/i, '');

/**
 * Match an expected image against the page's extracted <img> sources.
 *
 * Astro's asset pipeline rewrites committed upload paths
 * (~/assets/images/uploads/<slug>/<file>.<ext>) to hashed build URLs
 * (/_astro/<file>.<hash>.<ext>, possibly with a different extension after optimization), so
 * an exact URL match is impossible for the display paths a publish response reports. Exact
 * matching is tried first; otherwise a source whose filename starts with the expected
 * filename's stem is accepted.
 */
const matchExpectedImage = (
  resolvedUrl: string,
  expected: string,
  extractedSources: Set<string>
): { matchedUrl: string; matchedBy: 'exact' | 'filename-stem' } | undefined => {
  if (extractedSources.has(resolvedUrl)) return { matchedUrl: resolvedUrl, matchedBy: 'exact' };

  const expectedFilename = getUrlBasename(expected);
  const expectedStem = getFilenameStem(expectedFilename);
  if (!expectedStem) return undefined;

  for (const source of extractedSources) {
    const sourceFilename = getUrlBasename(source);
    if (sourceFilename === expectedFilename || sourceFilename.startsWith(`${expectedStem}.`)) {
      return { matchedUrl: source, matchedBy: 'filename-stem' };
    }
  }

  return undefined;
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

  const match = matchExpectedImage(resolvedUrl, expected, extractedSources);
  const present = Boolean(match);
  // Fetch the URL the page actually serves (the hashed build asset when stem-matched).
  const fetchUrl = match?.matchedUrl ?? resolvedUrl;

  try {
    const response = await fetch(fetchUrl, {
      cache: 'no-store',
      headers: noStoreFetchHeaders,
    });
    const contentType = response.headers.get('content-type') ?? undefined;
    const hasImageContentType = contentType?.toLowerCase().startsWith('image/') ?? false;
    const ok = present && response.status === 200 && hasImageContentType;

    return {
      expected,
      resolvedUrl,
      ...(match ? { matchedUrl: match.matchedUrl, matchedBy: match.matchedBy } : {}),
      present,
      status: response.status,
      contentType,
      ok,
      ...(!present
        ? { error: 'Expected image was not found in page <img> src/srcset sources (exact or filename-stem match).' }
        : {}),
      ...(response.status !== 200 ? { error: `Expected image returned status ${response.status}.` } : {}),
      ...(response.status === 200 && !hasImageContentType
        ? { error: 'Expected image did not return an image content-type.' }
        : {}),
    };
  } catch (error) {
    return {
      expected,
      resolvedUrl,
      ...(match ? { matchedUrl: match.matchedUrl, matchedBy: match.matchedBy } : {}),
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
    // A non-200 page usually means the deploy for the verified commit is not live yet
    // (Netlify deploys take 30–120s) — the result is INCONCLUSIVE, not a proven defect.
    const inconclusive = pageResponse.status !== 200;

    return jsonResponse(200, {
      verified,
      inconclusive,
      pageStatus: pageResponse.status,
      url: pageUrl.toString(),
      expectedImages,
      images,
      ...(pageResponse.status !== 200
        ? {
            errors: [
              `Page returned status ${pageResponse.status}. If this publish just completed, the deploy may not be live yet — poll deploy_status until deployStatus is "ready", then retry.`,
              ...errors,
            ],
          }
        : {}),
      ...(pageResponse.status === 200 && errors.length > 0 ? { errors } : {}),
    });
  } catch (error) {
    return jsonResponse(502, {
      verified: false,
      inconclusive: true,
      url: pageUrl.toString(),
      expectedImages,
      images: [],
      errors: [error instanceof Error ? error.message : 'Failed to fetch page HTML.'],
    });
  }
};
