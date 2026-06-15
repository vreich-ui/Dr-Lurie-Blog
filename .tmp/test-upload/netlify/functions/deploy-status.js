import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getHeader } from '../lib/admin-auth.js';
import { getDeployReceiptByCommit, getDeployReceiptByDeployId, isNetlifyDeployLookupConfigured, } from '../lib/netlify-deploys.js';
const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};
const requestSchema = z
    .object({
    commit: z.string().trim().min(1).optional(),
    deployId: z.string().trim().min(1).optional(),
})
    .strict()
    .refine((value) => Boolean(value.commit || value.deployId), {
    message: 'At least one of commit or deployId is required.',
    path: ['commit'],
});
const jsonResponse = (status, body) => ({
    statusCode: status,
    headers: jsonHeaders,
    body: JSON.stringify({ ok: status >= 200 && status < 300, status, ...body }),
});
const safeJsonParse = (event) => {
    if (!event.body)
        return { ok: false };
    try {
        const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
        return { ok: true, value: JSON.parse(body) };
    }
    catch {
        return { ok: false };
    }
};
const secretsMatch = (provided, expected) => {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length)
        return false;
    return timingSafeEqual(providedBuffer, expectedBuffer);
};
const verifyPublishKey = (event) => {
    const provided = getHeader(event.headers, 'x-publish-key').trim();
    const expected = process.env.PUBLISH_SECRET || process.env.NETLIFY_PUBLISH_SECRET || '';
    if (!provided || !expected || !secretsMatch(provided, expected)) {
        return jsonResponse(401, { error: 'Unauthorized' });
    }
    return undefined;
};
const getQueuedReceipt = ({ commit, deployId, errorMessage, }) => ({
    ...(commit ? { commit } : {}),
    ...(deployId ? { deployId } : {}),
    deployStatus: 'queued',
    ...(errorMessage ? { errorMessage } : {}),
});
export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }
    const contentType = getHeader(event.headers, 'content-type').toLowerCase();
    if (!contentType.includes('application/json')) {
        return jsonResponse(415, { error: 'Content-Type must be application/json.' });
    }
    const authFailure = verifyPublishKey(event);
    if (authFailure)
        return authFailure;
    const parsedJson = safeJsonParse(event);
    if (!parsedJson.ok)
        return jsonResponse(400, { error: 'Invalid request body.' });
    const parsedBody = requestSchema.safeParse(parsedJson.value);
    if (!parsedBody.success) {
        return jsonResponse(400, { error: 'Invalid request fields.', issues: parsedBody.error.issues });
    }
    const { commit, deployId } = parsedBody.data;
    if (!isNetlifyDeployLookupConfigured()) {
        return jsonResponse(200, getQueuedReceipt({ commit, deployId, errorMessage: 'Netlify deploy lookup is not configured.' }));
    }
    try {
        const receipt = commit ? await getDeployReceiptByCommit(commit) : await getDeployReceiptByDeployId(deployId ?? '');
        return jsonResponse(200, receipt ?? getQueuedReceipt({ commit, deployId }));
    }
    catch (error) {
        console.warn('Netlify deploy status lookup failed.', { commit, deployId, error });
        return jsonResponse(200, getQueuedReceipt({ commit, deployId }));
    }
};
