import { PLATFORM_ENV_NAMES, readBoundEnv, type SiteBinding, type SiteBindingEnvNames } from './site-binding.js';
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

const isNetlifyEnvEnabled = (value: string | undefined) => {
  if (!value) return false;

  return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
};

const isNetlifyRuntime = (event: unknown) =>
  isNetlifyEnvEnabled(process.env.NETLIFY) || Boolean(process.env.NETLIFY_SITE_ID) || hasNetlifyBlobContext(event);

type BlobStoreSource = 'explicit-api-config' | 'lambda-context' | 'netlify-name-lookup' | 'local-file-backed';

export type BlobStoreSourceDiagnostics = {
  storeName: string;
  source: BlobStoreSource;
  explicitApiConfigUsed: boolean;
  lambdaBlobContextUsed: boolean;
  siteId: {
    envVar: 'NETLIFY_SITE_ID' | 'SITE_ID' | undefined;
    present: boolean;
    redacted: string;
  };
};

const getSiteIdDiagnostic = (envNames: SiteBindingEnvNames = PLATFORM_ENV_NAMES): BlobStoreSourceDiagnostics['siteId'] => {
  const envVar = envNames.blobSiteId.find((name) => process.env[name]) as BlobStoreSourceDiagnostics['siteId']['envVar'];
  const value = envVar ? process.env[envVar] || '' : '';

  return {
    envVar,
    present: Boolean(value),
    redacted: value ? `…${value.slice(-4)}` : '',
  };
};

export const getBlobStoreSourceDiagnostics = (
  storeName: string,
  event: unknown,
  binding?: SiteBinding
): BlobStoreSourceDiagnostics => {
  const envNames = binding?.env ?? PLATFORM_ENV_NAMES;
  const siteID = readBoundEnv(envNames.blobSiteId);
  const token = readBoundEnv(envNames.blobToken);
  const explicitApiConfigUsed = Boolean(siteID && token);
  const lambdaBlobContextUsed = !explicitApiConfigUsed && hasNetlifyBlobContext(event);
  const source = explicitApiConfigUsed
    ? 'explicit-api-config'
    : lambdaBlobContextUsed
      ? 'lambda-context'
      : isNetlifyRuntime(event)
        ? 'netlify-name-lookup'
        : 'local-file-backed';

  return {
    storeName,
    source,
    explicitApiConfigUsed,
    lambdaBlobContextUsed,
    siteId: getSiteIdDiagnostic(envNames),
  };
};

export const getCoreBlobStoreSourceDiagnostics = (event: unknown) => ({
  workflows: getBlobStoreSourceDiagnostics('workflows', event),
  siteObjects: getBlobStoreSourceDiagnostics('site-objects', event),
  artifactIndex: getBlobStoreSourceDiagnostics('artifact-index', event),
  artifacts: getBlobStoreSourceDiagnostics('artifacts', event),
});

// Build an explicit Netlify Blobs API configuration (siteID + token) for a named store.
// Returns undefined when credentials are absent, signalling that the caller should fall
// back to the Lambda-injected blob context instead.
const getApiStoreConfig = (
  name: string,
  consistency?: 'eventual' | 'strong',
  envNames: SiteBindingEnvNames = PLATFORM_ENV_NAMES
) => {
  const siteID = readBoundEnv(envNames.blobSiteId);
  const token = readBoundEnv(envNames.blobToken);

  if (!siteID || !token) return undefined;

  const apiURL = readBoundEnv(envNames.blobApiUrl);

  return {
    ...(apiURL ? { apiURL } : {}),
    ...(consistency ? { consistency } : {}),
    name,
    siteID,
    token,
  };
};

const loadNetlifyBlobs = async (event: unknown) => {
  if (!isNetlifyRuntime(event)) return undefined;

  // @netlify/blobs must be installed in production; production fallback to local filesystem is disabled.

  if (netlifyBlobsModuleForTesting) return netlifyBlobsModuleForTesting;

  return import('@netlify/blobs').then(
    (mod) => mod as unknown as BlobsModule,
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
  event: unknown,
  binding?: SiteBinding
): Promise<BlobStore> => {
  const netlifyBlobs = await loadNetlifyBlobs(event);
  const storeName = typeof storeNameOrOptions === 'string' ? storeNameOrOptions : storeNameOrOptions.name;
  const consistency = typeof storeNameOrOptions === 'string' ? undefined : storeNameOrOptions.consistency;

  if (netlifyBlobs) {
    const apiStoreConfig = getApiStoreConfig(storeName, consistency, binding?.env ?? PLATFORM_ENV_NAMES);

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

export const getWorkflowBlobStore = async (event: unknown, binding?: SiteBinding): Promise<BlobStore> => {
  return getNetlifyBlobStore({ name: 'workflows', consistency: 'strong' }, event, binding);
};

export const getOptInBlobStore = async (event: unknown, binding?: SiteBinding): Promise<BlobStore> => {
  return getNetlifyBlobStore('opt-ins', event, binding);
};

export const getSiteObjectsBlobStore = async (event: unknown, binding?: SiteBinding): Promise<BlobStore> => {
  return getNetlifyBlobStore({ name: 'site-objects', consistency: 'strong' }, event, binding);
};

export const getArtifactBlobStore = async (event: unknown, binding?: SiteBinding): Promise<BlobStore> => {
  return getNetlifyBlobStore({ name: 'artifacts', consistency: 'strong' }, event, binding);
};

export const getArtifactIndexBlobStore = async (event: unknown, binding?: SiteBinding): Promise<BlobStore> => {
  return getNetlifyBlobStore({ name: 'artifact-index', consistency: 'strong' }, event, binding);
};

/**
 * Orders (06-shop-module-plan §5): orders/<idempotency-key>.json, written
 * create-if-absent by the Stripe webhook. Strong consistency — the success
 * page polls for the order the webhook just wrote, and fulfillment reissue
 * reads must see the latest reissue entries.
 */
export const getCommerceBlobStore = async (event: unknown, binding?: SiteBinding): Promise<BlobStore> => {
  return getNetlifyBlobStore({ name: 'commerce', consistency: 'strong' }, event, binding);
};

/**
 * Append-only commerce event log (06-shop-module-plan §6): one JSON per
 * event, never mutated or deleted. Eventual consistency is fine — nothing
 * reads it in v1; a future consumer ETLs the store.
 */
export const getCommerceEventsBlobStore = async (event: unknown, binding?: SiteBinding): Promise<BlobStore> => {
  return getNetlifyBlobStore('commerce-events', event, binding);
};

/** W13 (12-plan §5.3): the tracking-event mirror — replay substrate ONLY,
 *  never a reporting surface. */
export const getTrackingEventsBlobStore = async (event: unknown, binding?: SiteBinding): Promise<BlobStore> => {
  return getNetlifyBlobStore('tracking-events', event, binding);
};
