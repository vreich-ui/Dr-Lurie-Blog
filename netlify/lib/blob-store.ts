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

// Build an explicit Netlify Blobs API configuration (siteID + token) for a named store.
// Returns undefined when credentials are absent, signalling that the caller should fall
// back to the Lambda-injected blob context instead.
const getApiStoreConfig = (name: string, consistency?: 'eventual' | 'strong') => {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

  if (!siteID || !token) return undefined;

  return {
    ...(process.env.NETLIFY_BLOBS_API_URL ? { apiURL: process.env.NETLIFY_BLOBS_API_URL } : {}),
    ...(consistency ? { consistency } : {}),
    name,
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
  const consistency = typeof storeNameOrOptions === 'string' ? undefined : storeNameOrOptions.consistency;

  if (netlifyBlobs) {
    const apiStoreConfig = getApiStoreConfig(storeName, consistency);

    // Prefer explicit API credentials. Otherwise connect the Lambda blob context and look the
    // store up by name: a string lookup uses that injected context, whereas an options object
    // without siteID/token does not, which previously made artifact reads/writes fail with 502.
    if (apiStoreConfig) return netlifyBlobs.getStore(apiStoreConfig);

    if (hasNetlifyBlobContext(event)) netlifyBlobs.connectLambda(event);

    return netlifyBlobs.getStore(storeName);
  }

  console.warn(`Using local file-backed ${storeName} blob store because @netlify/blobs is unavailable.`);

  return createLocalBlobStore(storeName);
};

export const getWorkflowBlobStore = async (event: unknown): Promise<BlobStore> => {
  return getNetlifyBlobStore({ name: 'workflows', consistency: 'strong' }, event);
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
