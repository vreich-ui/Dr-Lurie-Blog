import { getArtifactBlobStore } from '../lib/blob-store.js';
import { normalizeArtifactBlobKey } from '../lib/artifacts.js';

type LambdaEvent = {
  httpMethod?: string;
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
const allowedPdfBlobKeyPattern = /^pdf\/[a-z0-9._-]+\/[a-f0-9]{64}\.pdf$/i;

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const rawBlobKey = toText(event.queryStringParameters?.blobKey);
  const blobKey = normalizeArtifactBlobKey(rawBlobKey);

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
        'Content-Disposition': `inline; filename="${filename}"`,
      },
      body: event.httpMethod === 'HEAD' ? '' : buffer.toString('base64'),
      isBase64Encoded: event.httpMethod !== 'HEAD',
    };
  } catch (error) {
    console.error('Failed to read public PDF artifact.', error);

    return jsonResponse(500, { error: 'PDF artifact could not be read.' });
  }
};
