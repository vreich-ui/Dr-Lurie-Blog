import { createLocalBlobStore } from './local-blobs.js';
let netlifyBlobsModuleForTesting;
export const setNetlifyBlobsModuleForTesting = (netlifyBlobs) => {
    netlifyBlobsModuleForTesting = netlifyBlobs;
};
const hasNetlifyBlobContext = (event) => {
    return Boolean(event && typeof event === 'object' && 'blobs' in event && event.blobs);
};
const isNetlifyEnvEnabled = (value) => {
    if (!value)
        return false;
    return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
};
const isNetlifyRuntime = (event) => isNetlifyEnvEnabled(process.env.NETLIFY) || Boolean(process.env.NETLIFY_SITE_ID) || hasNetlifyBlobContext(event);
const getSiteIdDiagnostic = () => {
    const envVar = process.env.NETLIFY_SITE_ID ? 'NETLIFY_SITE_ID' : process.env.SITE_ID ? 'SITE_ID' : undefined;
    const value = envVar ? process.env[envVar] || '' : '';
    return {
        envVar,
        present: Boolean(value),
        redacted: value ? `…${value.slice(-4)}` : '',
    };
};
export const getBlobStoreSourceDiagnostics = (storeName, event) => {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
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
        siteId: getSiteIdDiagnostic(),
    };
};
export const getCoreBlobStoreSourceDiagnostics = (event) => ({
    workflows: getBlobStoreSourceDiagnostics('workflows', event),
    artifactIndex: getBlobStoreSourceDiagnostics('artifact-index', event),
    artifacts: getBlobStoreSourceDiagnostics('artifacts', event),
});
// Build an explicit Netlify Blobs API configuration (siteID + token) for a named store.
// Returns undefined when credentials are absent, signalling that the caller should fall
// back to the Lambda-injected blob context instead.
const getApiStoreConfig = (name, consistency) => {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
    if (!siteID || !token)
        return undefined;
    return {
        ...(process.env.NETLIFY_BLOBS_API_URL ? { apiURL: process.env.NETLIFY_BLOBS_API_URL } : {}),
        ...(consistency ? { consistency } : {}),
        name,
        siteID,
        token,
    };
};
const loadNetlifyBlobs = async (event) => {
    if (!isNetlifyRuntime(event))
        return undefined;
    // @netlify/blobs must be installed in production; production fallback to local filesystem is disabled.
    if (netlifyBlobsModuleForTesting)
        return netlifyBlobsModuleForTesting;
    return import('@netlify/blobs').then((mod) => mod, (error) => {
        if (isNetlifyRuntime(event)) {
            throw new Error('Netlify Blobs is required in production. Configure npm auth/registry access for @netlify/blobs in Netlify environment variables; do not commit tokens.', { cause: error });
        }
        return undefined;
    });
};
export const getNetlifyBlobStore = async (storeNameOrOptions, event) => {
    const netlifyBlobs = await loadNetlifyBlobs(event);
    const storeName = typeof storeNameOrOptions === 'string' ? storeNameOrOptions : storeNameOrOptions.name;
    const consistency = typeof storeNameOrOptions === 'string' ? undefined : storeNameOrOptions.consistency;
    if (netlifyBlobs) {
        const apiStoreConfig = getApiStoreConfig(storeName, consistency);
        // Prefer explicit API credentials. Otherwise connect the Lambda blob context and look the
        // store up by name: a string lookup uses that injected context, whereas an options object
        // without siteID/token does not, which previously made artifact reads/writes fail with 502.
        if (apiStoreConfig)
            return netlifyBlobs.getStore(apiStoreConfig);
        if (hasNetlifyBlobContext(event))
            netlifyBlobs.connectLambda(event);
        return netlifyBlobs.getStore(storeName);
    }
    console.warn(`Using local file-backed ${storeName} blob store because @netlify/blobs is unavailable.`);
    return createLocalBlobStore(storeName);
};
export const getWorkflowBlobStore = async (event) => {
    return getNetlifyBlobStore({ name: 'workflows', consistency: 'strong' }, event);
};
export const getOptInBlobStore = async (event) => {
    return getNetlifyBlobStore('opt-ins', event);
};
export const getArtifactBlobStore = async (event) => {
    return getNetlifyBlobStore({ name: 'artifacts', consistency: 'strong' }, event);
};
export const getArtifactIndexBlobStore = async (event) => {
    return getNetlifyBlobStore({ name: 'artifact-index', consistency: 'strong' }, event);
};
