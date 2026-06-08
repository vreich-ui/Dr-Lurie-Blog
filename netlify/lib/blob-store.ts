import { createLocalBlobStore, type LocalBlobStore } from './local-blobs.js';

type BlobMetadata = Record<string, string>;
type BlobSetOptions = { metadata?: BlobMetadata; onlyIfNew?: boolean };

type BlobStoreValue = string | Buffer | Uint8Array;

type BlobStore = Omit<LocalBlobStore, 'set' | 'setJSON'> & {
  set(
    key: string,
    value: BlobStoreValue,
    options?: BlobSetOptions
  ): Promise<void | { modified: boolean; etag?: string }>;
  setJSON(key: string, value: unknown, options?: BlobSetOptions): Promise<void | { modified: boolean; etag?: string }>;
};

type NetlifyBlobStoreOptions = {
  apiURL?: string;
  consistency?: 'eventual' | 'strong';
  name: string;
  siteID?: string;
  token?: string;
};

type BlobsModule = {
  connectLambda: (event: unknown) => void;
  getStore: (input: string | NetlifyBlobStoreOptions) => BlobStore;
};

let netlifyBlobsModuleForTesting: BlobsModule | undefined;

export const setNetlifyBlobsModuleForTesting = (netlifyBlobs?: BlobsModule) => {
  netlifyBlobsModuleForTesting = netlifyBlobs;
};

type NetlifyLambdaEvent = {
  blobs?: unknown;
};

const hasNetlifyBlobContext = (event: unknown) => {
  return Boolean(event && typeof event === 'object' && 'blobs' in event && (event as NetlifyLambdaEvent).blobs);
};

const isNetlifyRuntime = (event: unknown) =>
  process.env.NETLIFY === 'true' || Boolean(process.env.NETLIFY_SITE_ID) || hasNetlifyBlobContext(event);

const getWorkflowApiStoreConfig = () => {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

  if (!siteID || !token) return undefined;

  return {
    ...(process.env.NETLIFY_BLOBS_API_URL ? { apiURL: process.env.NETLIFY_BLOBS_API_URL } : {}),
    consistency: 'strong' as const,
    name: 'workflows',
    siteID,
    token,
  };
};

const loadNetlifyBlobs = async (event: unknown) => {
  if (!isNetlifyRuntime(event)) return undefined;

  if (netlifyBlobsModuleForTesting) return netlifyBlobsModuleForTesting;

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

export const getNetlifyBlobStore = async (
  storeNameOrOptions: string | NetlifyBlobStoreOptions,
  event: unknown
): Promise<BlobStore> => {
  const netlifyBlobs = await loadNetlifyBlobs(event);
  const storeName = typeof storeNameOrOptions === 'string' ? storeNameOrOptions : storeNameOrOptions.name;

  if (netlifyBlobs) {
    if (hasNetlifyBlobContext(event)) netlifyBlobs.connectLambda(event);

    return netlifyBlobs.getStore(storeNameOrOptions);
  }

  console.warn(`Using local file-backed ${storeName} blob store because @netlify/blobs is unavailable.`);

  return createLocalBlobStore(storeName);
};

export const getWorkflowBlobStore = async (event: unknown): Promise<BlobStore> => {
  const netlifyBlobs = await loadNetlifyBlobs(event);

  if (netlifyBlobs) {
    const workflowApiStoreConfig = getWorkflowApiStoreConfig();

    if (workflowApiStoreConfig) {
      return netlifyBlobs.getStore(workflowApiStoreConfig);
    }

    if (hasNetlifyBlobContext(event)) netlifyBlobs.connectLambda(event);

    return netlifyBlobs.getStore('workflows');
  }

  console.warn('Using local file-backed workflows blob store because @netlify/blobs is unavailable.');

  return createLocalBlobStore('workflows');
};

export const getOptInBlobStore = async (event: unknown): Promise<BlobStore> => {
  return getNetlifyBlobStore('opt-ins', event);
};

export const getArtifactBlobStore = async (event: unknown): Promise<BlobStore> => {
  return getNetlifyBlobStore({ name: 'artifacts', consistency: 'strong' }, event);
};

export const getArtifactIndexBlobStore = async (event: unknown): Promise<BlobStore> => {
  return getNetlifyBlobStore({ name: 'artifact-index', consistency: 'strong' }, event);
};
