/**
 * Function name: Save_Artifact_Upload_Chunk
 * Required method: PUT
 * Body: raw binary bytes (application/octet-stream)
 */
import { storeUploadSessionChunk } from '../lib/artifact-upload-sessions.js';
import { getHeader } from '../lib/admin-auth.js';

const jsonHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, content-type, x-upload-token, x-session-id, x-chunk-index, x-total-chunks, x-filename',
  'Access-Control-Allow-Methods': 'PUT, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

type LambdaEvent = {
  blobs?: string;
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

const decodeRawBody = (event: LambdaEvent) => {
  if (!event.body) return Buffer.alloc(0);
  if (event.isBase64Encoded) return Buffer.from(event.body, 'base64');
  return Buffer.from(event.body, 'binary');
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: jsonHeaders, body: '' };
  if (event.httpMethod !== 'PUT') return jsonResponse(405, { error: 'Method not allowed' });

  const sessionId = getHeader(event.headers, 'x-session-id');
  const uploadToken = getHeader(event.headers, 'x-upload-token');
  const chunkIndex = parseIntegerHeader(event.headers, 'x-chunk-index');
  const totalChunks = parseIntegerHeader(event.headers, 'x-total-chunks');

  if (!sessionId || !uploadToken || chunkIndex === undefined || totalChunks === undefined) {
    return jsonResponse(400, {
      error: 'x-upload-token, x-session-id, x-chunk-index, and x-total-chunks headers are required.',
    });
  }

  const bytes = decodeRawBody(event);
  const result = await storeUploadSessionChunk({ event, sessionId, uploadToken, chunkIndex, totalChunks, bytes });

  return jsonResponse(result.statusCode, result.body);
};
