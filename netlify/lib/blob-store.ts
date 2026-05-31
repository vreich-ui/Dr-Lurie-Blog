import { createLocalBlobStore, type LocalBlobStore } from './local-blobs.js';

type BlobMetadata = Record<string, string>;

type BlobStore = LocalBlobStore & {
  setJSON: (key: string, value: unknown, options?: { metadata?: BlobMetadata }) => Promise<void>;
};

type BlobsModule = {
  connectLambda: (event: unknown) => void;
  getStore: (name: string) => BlobStore;
};

const isNetlifyRuntime = () => process.env.NETLIFY === 'true' || Boolean(process.env.NETLIFY_SITE_ID);

const loadNetlifyBlobs = async () => {
  return import('@netlify/blobs').then(
    (mod) => mod as BlobsModule,
    (error: unknown) => {
      if (isNetlifyRuntime()) {
        throw new Error(
          'Netlify Blobs is required in production. Configure npm auth/registry access for @netlify/blobs in Netlify environment variables; do not commit tokens.',
          { cause: error }
        );
      }

      return undefined;
    }
  );
};

export const getWorkflowBlobStore = async (event: unknown): Promise<BlobStore> => {
  const netlifyBlobs = await loadNetlifyBlobs();

  if (netlifyBlobs) {
    netlifyBlobs.connectLambda(event);

    return netlifyBlobs.getStore('workflows');
  }

  console.warn('Using local file-backed workflow blob store because @netlify/blobs is unavailable.');

  return createLocalBlobStore('workflows');
};

export const getOptInBlobStore = async (event: unknown): Promise<BlobStore> => {
  const netlifyBlobs = await loadNetlifyBlobs();

  if (netlifyBlobs) {
    netlifyBlobs.connectLambda(event);

    return netlifyBlobs.getStore('opt-ins');
  }

  console.warn('Using local file-backed opt-in blob store because @netlify/blobs is unavailable.');

  return createLocalBlobStore('opt-ins');
};
