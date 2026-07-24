/**
 * Canvas image upload intent — the pure core behind
 * netlify/functions/admin-artifact-upload-intent.ts.
 *
 * The edit-mode canvas stores images the same way the pdf-tool stores PDFs:
 * bytes go to the blobs `artifacts` store through the EXISTING tokened upload
 * path (/api/artifacts/upload), and the section's `src` points at the public
 * /img/* route (get-public-image.ts). This module only MINTS the short-lived
 * HMAC upload token for an already-authenticated admin — it never touches
 * bytes or blobs itself, and the upload endpoint re-verifies everything the
 * token claims (size, sha256, content type) against the actual bytes.
 *
 * Scope is deliberately narrow: artifactKind is always 'image', the content
 * type must be one the save-side sharp validation accepts (JPEG/PNG/WebP —
 * see image-validation.ts), and the requestId is minted server-side from the
 * object being edited, so canvas uploads are traceable per object and an
 * intent can never write outside `image/req_canvas_*` keys.
 */
import { normalizeMachineSafeId, validateRequestId } from '../../packages/core/lib/agents-naming.js';
import {
  createArtifactUploadToken,
  defaultArtifactUploadTokenTtlMs,
  getDirectArtifactUploadMaxBytes,
  type ArtifactUploadTokenClaims,
} from './artifact-upload.js';

/** Upload types the save-side image validation (sharp) accepts. */
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type CanvasUploadIntentRequest = {
  object_id: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
};

export type CanvasUploadIntentResult =
  | {
      ok: true;
      token: string;
      /** Echo of the signed claims — the upload call's X-Artifact-* headers MUST match these exactly. */
      claims: Omit<ArtifactUploadTokenClaims, 'expiresAt'>;
      maxBytes: number;
      /** Where the bytes will be publicly served once uploaded (root-relative, deploy-safe). */
      publicPath: string;
    }
  | { ok: false; statusCode: number; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const parseCanvasUploadIntentRequest = (value: unknown): CanvasUploadIntentRequest | undefined => {
  if (!isRecord(value)) return undefined;
  const { object_id, content_type, size_bytes, sha256 } = value;
  if (typeof object_id !== 'string' || !object_id.trim()) return undefined;
  if (typeof content_type !== 'string' || !content_type.trim()) return undefined;
  if (typeof size_bytes !== 'number' || !Number.isInteger(size_bytes)) return undefined;
  if (typeof sha256 !== 'string') return undefined;
  return { object_id, content_type, size_bytes, sha256 };
};

/**
 * Canvas requestId: `req_canvas_<object>_<yyyymmdd>_01` — the standard
 * req_<flow>_<topic>_<date>_<nn> shape (agents-naming). The counter is a
 * constant: blob keys are content-addressed per requestId, so re-uploads of
 * the same object's images dedupe instead of colliding.
 */
export const canvasUploadRequestId = (objectId: string, nowMs: number): string | undefined => {
  const topic = normalizeMachineSafeId(objectId);
  if (!topic) return undefined;
  const date = new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, '');
  const requestId = `req_canvas_${topic}_${date}_01`;
  const validation = validateRequestId(requestId);
  return validation.ok ? validation.value : undefined;
};

export const createCanvasUploadIntent = (
  request: CanvasUploadIntentRequest,
  options: { nowMs?: number; secret?: string } = {}
): CanvasUploadIntentResult => {
  const nowMs = options.nowMs ?? Date.now();
  const maxBytes = getDirectArtifactUploadMaxBytes();

  const contentType = request.content_type.toLowerCase().split(';')[0]?.trim() ?? '';
  const extension = CONTENT_TYPE_EXTENSIONS[contentType];
  if (!extension) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Unsupported image type — upload a JPEG, PNG, or WebP.',
    };
  }

  if (request.size_bytes <= 0) {
    return { ok: false, statusCode: 400, error: 'size_bytes must be a positive integer.' };
  }
  if (request.size_bytes > maxBytes) {
    return { ok: false, statusCode: 413, error: `Image is too large — the limit is ${maxBytes} bytes.` };
  }

  const sha256 = request.sha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    return { ok: false, statusCode: 400, error: 'sha256 must be a 64-character hex digest of the exact bytes.' };
  }

  const requestId = canvasUploadRequestId(request.object_id, nowMs);
  if (!requestId) {
    return { ok: false, statusCode: 400, error: 'object_id could not be normalized into a request id.' };
  }

  // The blobKey extension comes from the claims filename (createArtifactBlobKey),
  // so it is minted here from the content type — never from user input — and
  // always lands inside get-public-image's extension allowlist.
  const claims: Omit<ArtifactUploadTokenClaims, 'expiresAt'> = {
    requestId,
    artifactKind: 'image',
    contentType,
    filename: `canvas-upload.${extension}`,
    expectedSizeBytes: request.size_bytes,
    expectedSha256: sha256,
  };

  let token: string;
  try {
    token = createArtifactUploadToken({
      ...claims,
      nowMs,
      ttlMs: defaultArtifactUploadTokenTtlMs,
      ...(options.secret ? { secret: options.secret } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload token minting failed.';
    return { ok: false, statusCode: 500, error: message };
  }

  return {
    ok: true,
    token,
    claims,
    maxBytes,
    publicPath: `/img/${requestId}/${sha256}.${extension}`,
  };
};
