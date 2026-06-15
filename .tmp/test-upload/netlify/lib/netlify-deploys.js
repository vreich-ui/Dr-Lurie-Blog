const NETLIFY_API_BASE_URL = 'https://api.netlify.com/api/v1';
const RECENT_DEPLOYS_PAGE_SIZE = 20;
const DEFAULT_POLL_TIMEOUT_SECONDS = 120;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const TERMINAL_DEPLOY_STATUSES = new Set(['ready', 'failed', 'canceled']);
const getNetlifyDeployConfig = () => {
    const siteId = process.env.NETLIFY_SITE_ID || process.env.SITE_ID || '';
    const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || '';
    return { siteId, token };
};
export const isNetlifyDeployLookupConfigured = () => {
    const { siteId, token } = getNetlifyDeployConfig();
    return Boolean(siteId && token);
};
const toStringValue = (value) => (typeof value === 'string' ? value : '');
const firstStringValue = (...values) => {
    for (const value of values) {
        const stringValue = toStringValue(value);
        if (stringValue)
            return stringValue;
    }
    return '';
};
const normalizeDeployStatus = (deploy) => {
    const rawStatus = firstStringValue(deploy.state, deploy.status, deploy.deploy_status).toLowerCase();
    const rawErrorMessage = getDeployErrorMessage(deploy);
    if (rawStatus === 'ready')
        return 'ready';
    if (rawStatus === 'canceled' || rawStatus === 'cancelled')
        return 'canceled';
    if (rawStatus === 'error' || rawStatus === 'failed' || rawStatus === 'failure' || rawStatus === 'deploy_failed') {
        return 'failed';
    }
    if (rawErrorMessage)
        return 'failed';
    if (rawStatus === 'enqueued' || rawStatus === 'queued' || rawStatus === 'new' || rawStatus === 'pending')
        return 'queued';
    return 'building';
};
const getDeployErrorMessage = (deploy) => firstStringValue(deploy.error_message, deploy.errorMessage, deploy.error, deploy.summary, deploy.deploy_error, deploy.failure_reason, deploy.reason);
const mapNetlifyDeployToReceipt = (deploy) => {
    const deployStatus = normalizeDeployStatus(deploy);
    const finishedAt = deployStatus === 'ready' || deployStatus === 'failed' || deployStatus === 'canceled'
        ? firstStringValue(deploy.published_at, deploy.finished_at, deploy.done_at, deploy.updated_at, deploy.created_at)
        : '';
    return {
        deployId: firstStringValue(deploy.id, deploy.deploy_id),
        deployUrl: firstStringValue(deploy.deploy_ssl_url, deploy.deploy_url, deploy.url),
        productionUrl: firstStringValue(deploy.ssl_url),
        commit: firstStringValue(deploy.commit_ref),
        deployStatus,
        startedAt: firstStringValue(deploy.created_at, deploy.started_at, deploy.deploy_started_at, deploy.updated_at),
        finishedAt,
        errorMessage: getDeployErrorMessage(deploy),
    };
};
const fetchNetlifyApi = async (path) => {
    const { siteId, token } = getNetlifyDeployConfig();
    if (!siteId || !token) {
        throw new Error('Netlify deploy lookup is not configured.');
    }
    const response = await fetch(`${NETLIFY_API_BASE_URL}${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
        },
    });
    if (!response.ok) {
        throw new Error(`Netlify deploy lookup failed with HTTP ${response.status}.`);
    }
    return response.json();
};
export const fetchRecentDeploys = async () => {
    const { siteId } = getNetlifyDeployConfig();
    const deploys = await fetchNetlifyApi(`/sites/${encodeURIComponent(siteId)}/deploys?per_page=${RECENT_DEPLOYS_PAGE_SIZE}&page=1`);
    if (!Array.isArray(deploys))
        return [];
    return deploys
        .filter((deploy) => Boolean(deploy && typeof deploy === 'object'))
        .map(mapNetlifyDeployToReceipt);
};
export const getDeployReceiptByCommit = async (commit) => {
    const normalizedCommit = commit.trim();
    if (!normalizedCommit)
        return undefined;
    const deploys = await fetchRecentDeploys();
    return deploys.find((deploy) => deploy.commit === normalizedCommit);
};
export const getDeployReceiptByDeployId = async (deployId) => {
    const normalizedDeployId = deployId.trim();
    if (!normalizedDeployId)
        return undefined;
    const deploy = await fetchNetlifyApi(`/deploys/${encodeURIComponent(normalizedDeployId)}`);
    if (deploy && typeof deploy === 'object')
        return mapNetlifyDeployToReceipt(deploy);
    return undefined;
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const getTimedOutReceipt = (receipt, commit, deployId) => ({
    deployId: receipt?.deployId || deployId,
    deployUrl: receipt?.deployUrl || '',
    productionUrl: receipt?.productionUrl || '',
    commit: receipt?.commit || commit,
    deployStatus: 'timed_out',
    startedAt: receipt?.startedAt || '',
    finishedAt: receipt?.finishedAt || '',
    errorMessage: receipt?.errorMessage || '',
});
export const pollDeployReceipt = async ({ commit = '', deployId = '', timeoutSeconds = DEFAULT_POLL_TIMEOUT_SECONDS, intervalSeconds = DEFAULT_POLL_INTERVAL_SECONDS, }) => {
    const normalizedCommit = commit.trim();
    const normalizedDeployId = deployId.trim();
    const timeoutMs = Math.max(0, timeoutSeconds) * 1000;
    const intervalMs = Math.max(1, intervalSeconds) * 1000;
    const deadline = Date.now() + timeoutMs;
    let latestReceipt;
    do {
        latestReceipt = normalizedDeployId
            ? await getDeployReceiptByDeployId(normalizedDeployId)
            : await getDeployReceiptByCommit(normalizedCommit);
        if (latestReceipt && TERMINAL_DEPLOY_STATUSES.has(latestReceipt.deployStatus))
            return latestReceipt;
        if (Date.now() >= deadline)
            break;
        await wait(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    } while (Date.now() <= deadline);
    return getTimedOutReceipt(latestReceipt, normalizedCommit, normalizedDeployId);
};
