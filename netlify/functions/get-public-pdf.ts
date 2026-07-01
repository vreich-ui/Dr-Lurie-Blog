import { getArtifactBlobStore } from '../lib/blob-store.js';
import { normalizeArtifactBlobKey } from '../lib/artifacts.js';

type LambdaEvent = {
  httpMethod?: string;
  path?: string;
  rawUrl?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const toText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const publicPdfPathPattern = /\/pdf\/([a-z0-9._-]+\/[a-f0-9]{64}\.pdf)$/i;
const allowedPdfBlobKeyPattern = /^pdf\/[a-z0-9._-]+\/[a-f0-9]{64}\.pdf$/i;

const getBlobKeyFromPublicPdfValue = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const directBlobKey = normalizeArtifactBlobKey(trimmed);
  if (allowedPdfBlobKeyPattern.test(directBlobKey)) return directBlobKey;

  const pathMatch = trimmed.match(publicPdfPathPattern);
  return pathMatch ? `pdf/${pathMatch[1]}` : '';
};

const getRequestedBlobKey = (event: LambdaEvent) =>
  getBlobKeyFromPublicPdfValue(toText(event.queryStringParameters?.blobKey)) ||
  getBlobKeyFromPublicPdfValue(toText(event.path)) ||
  getBlobKeyFromPublicPdfValue(toText(event.rawUrl));

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const blobKey = getRequestedBlobKey(event);

  if (!allowedPdfBlobKeyPattern.test(blobKey)) {
    return jsonResponse(400, { error: 'A valid PDF artifact blobKey is required.' });
  }

  try {
    const store = await getArtifactBlobStore(event);
    const result = (await (
      store as { get: (key: string, options: { type: 'arrayBuffer' }) => Promise<ArrayBuffer | null> }
    ).get(blobKey, { type: 'arrayBuffer' })) as ArrayBuffer | null;

    if (!result) {
      return jsonResponse(404, { error: 'PDF artifact not found.' });
    }

    const buffer = Buffer.from(result);
    const filename = blobKey.split('/').pop() || 'artifact.pdf';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: event.httpMethod === 'HEAD' ? '' : buffer.toString('base64'),
      isBase64Encoded: event.httpMethod !== 'HEAD',
    };
  } catch (error) {
    console.error('Failed to read public PDF artifact.', error);

    return jsonResponse(500, { error: 'PDF artifact could not be read.' });
  }
};
