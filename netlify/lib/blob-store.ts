import { createLocalBlobStore, type LocalBlobStore, type LocalBlobValue } from './local-blobs.js';

type BlobMetadata = Record<string, string>;

type BlobStore = Omit<LocalBlobStore, 'set'> & {
  set: (key: string, value: LocalBlobValue, options?: { metadata?: BlobMetadata }) => Promise<void>;
  setJSON: (key: string, value: unknown, options?: { metadata?: BlobMetadata }) => Promise<void>;
};

type BlobsModule = {
  connectLambda: (event: unknown) => void;
  getStore: (name: string) => BlobStore;
};

type NetlifyLambdaEvent = {
  blobs?: unknown;
};

const hasNetlifyBlobContext = (event: unknown) => {
  return Boolean(event && typeof event === 'object' && 'blobs' in event && (event as NetlifyLambdaEvent).blobs);
};

const isNetlifyRuntime = (event: unknown) =>
  process.env.NETLIFY === 'true' || Boolean(process.env.NETLIFY_SITE_ID) || hasNetlifyBlobContext(event);

const loadNetlifyBlobs = async (event: unknown) => {
  if (!isNetlifyRuntime(event)) return undefined;

  return import('@netlify/blobs').then(
    (mod) => mod as BlobsModule,
    (error: unknown) => {
      if (isNetlifyRuntime(event)) {
        throw new Error(
          'Netlify Blobs is required in production. Configure npm auth/registry access for @netlify/blobs in Netlify environment variables; do not commit tokens.',
          { cause: error }
        );
      }

      return undefined;
    }
  );
};

export const getNetlifyBlobStore = async (storeName: string, event: unknown): Promise<BlobStore> => {
  const netlifyBlobs = await loadNetlifyBlobs(event);

  if (netlifyBlobs) {
    if (hasNetlifyBlobContext(event)) netlifyBlobs.connectLambda(event);

    return netlifyBlobs.getStore(storeName);
  }

  console.warn(`Using local file-backed ${storeName} blob store because @netlify/blobs is unavailable.`);

  return createLocalBlobStore(storeName);
};

export const getWorkflowBlobStore = async (event: unknown): Promise<BlobStore> => {
  return getNetlifyBlobStore('workflows', event);
};

export const getOptInBlobStore = async (event: unknown): Promise<BlobStore> => {
  return getNetlifyBlobStore('opt-ins', event);
};

export const getArtifactBlobStore = async (event: unknown): Promise<BlobStore> => {
  return getNetlifyBlobStore('artifacts', event);
};

export const getArtifactIndexBlobStore = async (event: unknown): Promise<BlobStore> => {
  return getNetlifyBlobStore('artifact-index', event);
};
