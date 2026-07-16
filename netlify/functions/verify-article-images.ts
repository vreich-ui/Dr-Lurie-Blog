import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { getHeader } from '../lib/admin-auth.js';
import {
  getDeployReceiptByCommit,
  isNetlifyDeployLookupConfigured,
  pollDeployReceipt,
  type DeployReceipt,
} from '../lib/netlify-deploys.js';

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
    // Deploy-aware verification (opt-in). When `commit` is supplied, image
    // assertions run ONLY once that commit's Netlify deploy is confirmed ready —
    // a page served by a stale/previous deploy is reported as INCONCLUSIVE
    // (deploy timing), never as a false missing-image defect. Omit it to keep
    // the legacy best-effort behavior (page-status heuristic only).
    commit: z.string().trim().min(1).optional(),
    // Bounded in-function wait for the target commit's deploy to reach a
    // terminal state. Default 0 = single-shot correlation (agents are expected
    // to have polled deploy_status until ready first); raise it to let verify
    // itself wait a little. Always capped so the serverless call returns.
    deployTimeoutSeconds: z.number().int().min(0).max(120).optional(),
    deployPollIntervalSeconds: z.number().int().min(1).max(30).optional(),
  })
  .strict();

type TargetDeployEvaluation = {
  /** Whether Netlify deploy lookup was configured and consulted at all. */
  deployAware: boolean;
  /** True only when the target commit's deploy is ready and reflects it. */
  reflectsTarget: boolean;
  deploy?: DeployReceipt;
  /** Present when the target deploy is not confirmed live (or lookup skipped). */
  reason?: string;
};

const describeUnreadyDeploy = (commit: string, deploy: DeployReceipt | undefined): string => {
  if (!deploy) {
    return (
      `No Netlify deploy has appeared yet for commit ${commit}. The publish build is probably still ` +
      `queued or building — poll deploy_status until deployStatus is "ready", then retry. This is deploy ` +
      `timing, not a missing-image defect.`
    );
  }
  if (deploy.deployStatus === 'failed' || deploy.deployStatus === 'canceled') {
    return (
      `The deploy for commit ${commit} did not succeed (deployStatus: ${deploy.deployStatus}` +
      `${deploy.errorMessage ? `: ${deploy.errorMessage}` : ''}). This is a build/deploy problem, not a ` +
      `missing-image defect — check the build logs and re-release.`
    );
  }
  return (
    `The deploy for commit ${commit} is not live yet (deployStatus: ${deploy.deployStatus}). Netlify deploys ` +
    `take 30-120s — poll deploy_status until deployStatus is "ready", then retry. This is deploy timing, not a ` +
    `missing-image defect.`
  );
};

/**
 * Correlate the verification to a specific publish commit's deploy so that
 * "the deploy is still building" is never mistaken for "the image is missing".
 * Degrades gracefully (deployAware:false, still proceeds) when deploy lookup is
 * not configured on this server.
 */
const evaluateTargetDeploy = async (
  commit: string,
  deployTimeoutSeconds: number,
  deployPollIntervalSeconds: number
): Promise<TargetDeployEvaluation> => {
  if (!isNetlifyDeployLookupConfigured()) {
    return {
      deployAware: false,
      reflectsTarget: false,
      reason:
        'Netlify deploy lookup is not configured on this server; deploy correlation was skipped and this result is ' +
        'best-effort against whatever the live URL currently serves.',
    };
  }

  let deploy: DeployReceipt | undefined;
  try {
    deploy =
      deployTimeoutSeconds > 0
        ? await pollDeployReceipt({
            commit,
            timeoutSeconds: deployTimeoutSeconds,
            intervalSeconds: deployPollIntervalSeconds,
          })
        : await getDeployReceiptByCommit(commit);
  } catch {
    return {
      deployAware: true,
      reflectsTarget: false,
      reason: `Could not read the Netlify deploy for commit ${commit}; retry after the deploy is ready.`,
    };
  }

  const reflectsTarget = Boolean(deploy && deploy.deployStatus === 'ready' && deploy.commit === commit);
  return {
    deployAware: true,
    reflectsTarget,
    ...(deploy ? { deploy } : {}),
    ...(reflectsTarget ? {} : { reason: describeUnreadyDeploy(commit, deploy) }),
  };
};

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

  const { url, expectedImages, commit, deployTimeoutSeconds, deployPollIntervalSeconds } = validation.data;
  let pageUrl: URL;

  try {
    pageUrl = new URL(url);
  } catch {
    return jsonResponse(400, { verified: false, url, expectedImages, error: 'url must be a valid HTTP(S) URL.' });
  }

  if (!isHttpUrl(pageUrl)) {
    return jsonResponse(400, { verified: false, url, expectedImages, error: 'url must use http or https.' });
  }

  // Deploy-aware gate: when a target commit is supplied, do not run image
  // assertions until that commit's deploy is confirmed live. A page served by a
  // stale/previous deploy is deploy TIMING (inconclusive), not a missing image.
  let deployEval: TargetDeployEvaluation | undefined;
  if (commit) {
    deployEval = await evaluateTargetDeploy(commit, deployTimeoutSeconds ?? 0, deployPollIntervalSeconds ?? 5);
    if (deployEval.deployAware && !deployEval.reflectsTarget) {
      return jsonResponse(200, {
        verified: false,
        inconclusive: true,
        deployAware: true,
        deployReady: false,
        commit,
        ...(deployEval.deploy ? { deploy: deployEval.deploy } : {}),
        url: pageUrl.toString(),
        expectedImages,
        images: [],
        errors: [deployEval.reason ?? `The deploy for commit ${commit} is not live yet; retry after it is ready.`],
      });
    }
  }

  // The target commit's deploy is confirmed live (or no commit was supplied /
  // deploy lookup is unavailable): from here a non-200 page or an absent image
  // is a real defect, not deploy timing.
  const deployConfirmedLive = Boolean(commit) && (deployEval?.reflectsTarget ?? false);
  const deployFields = commit
    ? {
        commit,
        deployAware: deployEval?.deployAware ?? false,
        deployReady: deployConfirmedLive,
        ...(deployEval?.deploy ? { deploy: deployEval.deploy } : {}),
        ...(deployEval && !deployEval.deployAware && deployEval.reason ? { deployNote: deployEval.reason } : {}),
      }
    : {};

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
    // With the target deploy confirmed live, nothing is inconclusive — a non-200
    // page is a real defect. Only when we could NOT confirm the deploy does a
    // non-200 page stay inconclusive (the deploy is probably not live yet).
    const inconclusive = deployConfirmedLive ? false : pageResponse.status !== 200;
    const nonLivePageError = deployConfirmedLive
      ? `Page returned status ${pageResponse.status} even though the deploy for commit ${commit} is live — the article page is missing or not routed (a real defect, not deploy timing).`
      : `Page returned status ${pageResponse.status}. If this publish just completed, the deploy may not be live yet — poll deploy_status until deployStatus is "ready", then retry.`;

    return jsonResponse(200, {
      verified,
      inconclusive,
      pageStatus: pageResponse.status,
      url: pageUrl.toString(),
      expectedImages,
      ...deployFields,
      images,
      ...(pageResponse.status !== 200 ? { errors: [nonLivePageError, ...errors] } : {}),
      ...(pageResponse.status === 200 && errors.length > 0 ? { errors } : {}),
    });
  } catch (error) {
    return jsonResponse(502, {
      verified: false,
      inconclusive: true,
      url: pageUrl.toString(),
      expectedImages,
      ...deployFields,
      images: [],
      errors: [error instanceof Error ? error.message : 'Failed to fetch page HTML.'],
    });
  }
};
