import { artifactKindSet, type ArtifactKind } from '../lib/artifacts.js';
import { validateFilename, validateRequestId } from '../../src/lib/agents-naming.js';
import {
  getDirectArtifactUploadMaxBytes,
  normalizeArtifactContentType,
  saveArtifactBytes,
  verifyArtifactUploadToken,
  type ArtifactUploadTokenClaims,
} from '../lib/artifact-upload.js';

export const config = {
  path: '/api/artifacts/upload',
};

const requiredHeaderNames = [
  'X-Artifact-Request-Id',
  'X-Artifact-Kind',
  'X-Artifact-Content-Type',
  'X-Artifact-Size',
  'X-Artifact-Sha256',
] as const;

const jsonHeaders = {
  'Access-Control-Allow-Headers': [
    'authorization',
    'content-length',
    'content-type',
    'x-artifact-content-type',
    'x-artifact-filename',
    'x-artifact-kind',
    'x-artifact-request-id',
    'x-artifact-sha256',
    'x-artifact-size',
    'x-artifact-tags',
  ].join(', '),
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

type ParsedHeaders = {
  requestId: string;
  artifactKind: ArtifactKind;
  contentType: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  filename?: string;
  tags?: string[];
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const getMaxBytes = () => getDirectArtifactUploadMaxBytes();

const normalizeTransportContentType = (contentType: string | null) => contentType?.toLowerCase().split(';')[0]?.trim();

const parseBearerToken = (authorization: string | null) => {
  if (!authorization) return undefined;

  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || undefined;
};

const parseContentLength = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseTags = (raw: string | null) => {
  if (!raw?.trim()) return undefined;
  const tags = raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length ? tags : undefined;
};

const parseRequiredHeaders = (
  headers: Headers
): { ok: true; value: ParsedHeaders } | { ok: false; response: Response } => {
  const missingHeaders = requiredHeaderNames.filter((name) => !headers.get(name)?.trim());
  if (missingHeaders.length) {
    return {
      ok: false,
      response: jsonResponse(400, { ok: false, error: `Missing required headers: ${missingHeaders.join(', ')}.` }),
    };
  }

  const requestId = headers.get('X-Artifact-Request-Id')?.trim() ?? '';
  const artifactKind = headers.get('X-Artifact-Kind')?.trim() ?? '';
  const contentType = normalizeArtifactContentType(headers.get('X-Artifact-Content-Type')?.trim() ?? '');
  const sizeRaw = headers.get('X-Artifact-Size')?.trim() ?? '';
  const expectedSha256 = headers.get('X-Artifact-Sha256')?.trim().toLowerCase() ?? '';
  const filename = headers.get('X-Artifact-Filename')?.trim() || undefined;
  const tags = parseTags(headers.get('X-Artifact-Tags'));

  const requestIdValidation = validateRequestId(requestId);
  if (!requestIdValidation.ok) {
    return { ok: false, response: jsonResponse(400, { ok: false, error: requestIdValidation.error }) };
  }

  const filenameValidation = filename ? validateFilename(filename) : undefined;
  if (filename && !filenameValidation?.ok) {
    return {
      ok: false,
      response: jsonResponse(400, { ok: false, error: filenameValidation?.error ?? 'Invalid filename.' }),
    };
  }

  if (!artifactKindSet.has(artifactKind as ArtifactKind)) {
    return { ok: false, response: jsonResponse(400, { ok: false, error: 'Invalid artifact kind.' }) };
  }

  const expectedSizeBytes = Number(sizeRaw);
  if (!Number.isInteger(expectedSizeBytes) || expectedSizeBytes < 0) {
    return { ok: false, response: jsonResponse(400, { ok: false, error: 'Invalid expected artifact size.' }) };
  }

  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    return { ok: false, response: jsonResponse(400, { ok: false, error: 'Invalid expected artifact sha256.' }) };
  }

  return {
    ok: true,
    value: {
      requestId: requestIdValidation.value,
      artifactKind: artifactKind as ArtifactKind,
      contentType,
      expectedSizeBytes,
      expectedSha256,
      ...(filenameValidation?.ok ? { filename: filenameValidation.value } : {}),
      ...(tags ? { tags } : {}),
    },
  };
};

const sortedTags = (tags: string[] | undefined) => [...(tags ?? [])].sort();

const tagsMatch = (left: string[] | undefined, right: string[] | undefined) =>
  sortedTags(left).join('\0') === sortedTags(right).join('\0');

const headersMatchClaims = (headers: ParsedHeaders, claims: ArtifactUploadTokenClaims) =>
  headers.requestId === claims.requestId &&
  headers.artifactKind === claims.artifactKind &&
  headers.contentType === normalizeArtifactContentType(claims.contentType) &&
  headers.expectedSizeBytes === claims.expectedSizeBytes &&
  headers.expectedSha256.toLowerCase() === claims.expectedSha256.toLowerCase() &&
  (headers.filename ?? '') === (claims.filename ?? '') &&
  tagsMatch(headers.tags, claims.tags);

export default async function handler(req: Request) {
  const maxBytes = getMaxBytes();

  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: jsonHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'Unsupported method.', maxBytes });

  if (normalizeTransportContentType(req.headers.get('content-type')) !== 'application/octet-stream') {
    return jsonResponse(415, {
      ok: false,
      error: 'Wrong transport content type; use application/octet-stream.',
      maxBytes,
    });
  }

  const token = parseBearerToken(req.headers.get('authorization'));
  if (!token) return jsonResponse(401, { ok: false, error: 'Missing bearer upload token.', maxBytes });

  const validation = verifyArtifactUploadToken({ token });
  if (!validation.ok) return jsonResponse(validation.statusCode, { ok: false, error: validation.error, maxBytes });

  const parsedHeaders = parseRequiredHeaders(req.headers);
  if (!parsedHeaders.ok) return parsedHeaders.response;

  if (!headersMatchClaims(parsedHeaders.value, validation.claims)) {
    return jsonResponse(403, { ok: false, error: 'Upload token does not match artifact headers.', maxBytes });
  }

  const contentLength = parseContentLength(req.headers.get('content-length'));
  if (contentLength === undefined && req.headers.get('content-length')) {
    return jsonResponse(400, { ok: false, error: 'Invalid Content-Length header.', maxBytes });
  }
  if (contentLength !== undefined && contentLength > maxBytes) {
    return jsonResponse(413, { ok: false, error: 'Payload too large.', maxBytes });
  }
  if (contentLength !== undefined && contentLength !== parsedHeaders.value.expectedSizeBytes) {
    return jsonResponse(400, {
      ok: false,
      error: `Content-Length ${contentLength} does not match expected artifact size ${parsedHeaders.value.expectedSizeBytes}.`,
      maxBytes,
    });
  }

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    return jsonResponse(413, { ok: false, error: 'Payload too large.', maxBytes });
  }

  const result = await saveArtifactBytes({
    ...parsedHeaders.value,
    label: validation.claims.label,
    bytes,
  });

  if (!result.ok) return jsonResponse(result.statusCode, { ok: false, error: result.error, maxBytes });

  return jsonResponse(200, {
    ok: true,
    artifact: result.artifact,
    deduped: result.deduped,
    maxBytes,
  });
}
