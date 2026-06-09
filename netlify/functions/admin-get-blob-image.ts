import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { getArtifactBlobStore } from '../lib/blob-store.js';

const allowedImageBlobKeyPattern = /^image\/[a-z0-9._-]+\/[a-f0-9]{64}(?:\.[a-z0-9]+)?$/i;
const contentTypeByExtension: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

type LambdaEvent = {
  blobs?: string;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
};

type BinaryReadableArtifactBlobStore = Awaited<ReturnType<typeof getArtifactBlobStore>> & {
  get(key: string, options: { type: 'buffer' }): Promise<Buffer | ArrayBuffer | string | null>;
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

const getContentType = (blobKey: string) => {
  const extension = blobKey.split('.').pop()?.toLowerCase() || '';
  return contentTypeByExtension[extension] || 'image/*';
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const adminState = await getAdminStateFromEvent(event);
  if (!adminState.authenticated) {
    return jsonResponse(adminState.error === 'Clerk authentication is not configured.' ? 500 : 401, {
      error: adminState.error || 'A valid Clerk session token is required.',
    });
  }

  if (!adminState.isAdmin) {
    return jsonResponse(403, { error: 'This Clerk user is not authorized to read saved image artifacts.' });
  }

  const blobKey = toText(event.queryStringParameters?.blobKey);
  if (!allowedImageBlobKeyPattern.test(blobKey)) {
    return jsonResponse(400, { error: 'A valid image artifact blobKey is required.' });
  }

  try {
    const store = (await getArtifactBlobStore(event)) as BinaryReadableArtifactBlobStore;
    const bytes = await store.get(blobKey, { type: 'buffer' });

    if (!bytes) return jsonResponse(404, { error: 'Image artifact was not found.' });
    if (typeof bytes === 'string')
      return jsonResponse(500, { error: 'Image artifact returned text instead of bytes.' });

    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': getContentType(blobKey),
        'Cache-Control': 'private, max-age=300',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error('Failed to read saved image artifact.', error);

    return jsonResponse(500, { error: 'Saved image artifact could not be read.' });
  }
};
