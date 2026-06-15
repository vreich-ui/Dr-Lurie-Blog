/**
 * Function name: Upload_Session_Chunk
 * Required method: PUT
 * Body: raw binary chunk bytes (application/octet-stream)
 */
import { storeUploadSessionChunk } from '../lib/artifact-upload-sessions.js';
import { getHeader } from '../lib/admin-auth.js';

const jsonHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, content-type, x-upload-token, x-session-id, x-chunk-index, x-total-chunks, x-chunk-sha256',
  'Access-Control-Allow-Methods': 'PUT, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

type LambdaEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

const parseIntegerHeader = (headers: Record<string, string | undefined> | undefined, name: string) => {
  const raw = getHeader(headers, name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
};

const parseSha256Header = (headers: Record<string, string | undefined> | undefined) => {
  const raw = getHeader(headers, 'x-chunk-sha256')?.trim();
  if (!raw) return undefined;
  return /^[a-f0-9]{64}$/i.test(raw) ? raw.toLowerCase() : undefined;
};

const decodeRawBody = (event: LambdaEvent) => {
  if (!event.body) return Buffer.alloc(0);

  if (event.isBase64Encoded) {
    try {
      return Buffer.from(event.body, 'base64');
    } catch (e) {
      console.warn('Failed to decode base64 body:', e);
    }
  }

  // Netlify often passes binary as base64-encoded string even if isBase64Encoded is false in some environments,
  // or it might be raw binary. Buffer.from(body, 'binary') handles "latin1" encoding.
  return Buffer.from(event.body, 'binary');
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: jsonHeaders, body: '' };
  if (event.httpMethod !== 'PUT' && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const sessionId = getHeader(event.headers, 'x-session-id');
  const uploadToken = getHeader(event.headers, 'x-upload-token');
  const chunkIndex = parseIntegerHeader(event.headers, 'x-chunk-index');
  const totalChunks = parseIntegerHeader(event.headers, 'x-total-chunks');
  const chunkSha256 = parseSha256Header(event.headers);

  if (!sessionId || !uploadToken || chunkIndex === undefined || totalChunks === undefined) {
    return jsonResponse(400, {
      error: 'x-upload-token, x-session-id, x-chunk-index, and x-total-chunks headers are required.',
    });
  }

  if (getHeader(event.headers, 'x-chunk-sha256') && !chunkSha256) {
    return jsonResponse(400, { error: 'x-chunk-sha256 must be a 64-character hex SHA-256 digest.' });
  }

  const bytes = decodeRawBody(event);

  console.log('Upload session chunk received:', {
    sessionId,
    chunkIndex,
    receivedBytes: bytes.byteLength,
    isBase64Encoded: event.isBase64Encoded,
    contentType: getHeader(event.headers, 'content-type'),
  });

  const result = await storeUploadSessionChunk({
    event,
    sessionId,
    uploadToken,
    chunkIndex,
    totalChunks,
    bytes,
    chunkSha256,
  });

  return jsonResponse(result.statusCode, result.body);
};
