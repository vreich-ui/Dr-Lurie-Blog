import { connectLambda, getStore, listStores, type Store } from '@netlify/blobs';

// Centralized access to Netlify Blobs for the admin blob-manager tooling.
//
// Credential resolution mirrors netlify/lib/blob-store.ts: prefer explicit
// siteID + token from environment variables, otherwise fall back to the
// Lambda-injected blob context (event.blobs) that production functions receive.

type ExplicitBlobsCredentials = {
  siteID: string;
  token: string;
  apiURL?: string;
};

type NetlifyLambdaEvent = {
  blobs?: unknown;
};

const hasNetlifyBlobContext = (event: unknown): event is NetlifyLambdaEvent =>
  Boolean(event && typeof event === 'object' && 'blobs' in event && (event as NetlifyLambdaEvent).blobs);

const getExplicitCredentials = (): ExplicitBlobsCredentials | undefined => {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

  if (!siteID || !token) return undefined;

  return {
    siteID,
    token,
    ...(process.env.NETLIFY_BLOBS_API_URL ? { apiURL: process.env.NETLIFY_BLOBS_API_URL } : {}),
  };
};

let lambdaContextConnected = false;

const ensureLambdaContext = (event: unknown) => {
  if (lambdaContextConnected) return;
  if (!hasNetlifyBlobContext(event)) return;

  connectLambda(event);
  lambdaContextConnected = true;
};

// Returns a strongly-consistent store handle so management operations (delete,
// rename, wipe) are reflected immediately on subsequent reads.
export const getManagedBlobStore = (storeName: string, event: unknown): Store => {
  const credentials = getExplicitCredentials();

  if (credentials) {
    return getStore({ name: storeName, consistency: 'strong', ...credentials });
  }

  ensureLambdaContext(event);

  return getStore(storeName);
};

// Lists every site-level blob store name. Used to populate the store picker and
// to drive the "wipe all" operation.
export const listManagedBlobStores = async (event: unknown): Promise<string[]> => {
  const credentials = getExplicitCredentials();

  if (credentials) {
    const { stores } = await listStores(credentials);
    return stores;
  }

  ensureLambdaContext(event);

  const { stores } = await listStores();
  return stores;
};
