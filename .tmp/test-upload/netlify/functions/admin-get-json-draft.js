import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { getWorkflowBlobStore } from '../lib/blob-store.js';
import { getContentSourceMarkdown } from '../../src/lib/contentSourceBody.js';
import { lazyImagesRehypePlugin, readingTimeRemarkPlugin, responsiveTablesRehypePlugin, } from '../../src/utils/frontmatter.js';
const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};
const recordKey = (requestId) => `workflows/by-id/${requestId}.json`;
const toText = (value) => (typeof value === 'string' ? value.trim() : '');
const processorPromise = createMarkdownProcessor({
    remarkPlugins: [readingTimeRemarkPlugin],
    rehypePlugins: [responsiveTablesRehypePlugin, lazyImagesRehypePlugin],
});
const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});
const isRecord = (value) => Boolean(value && typeof value === 'object');
const stripFrontmatter = (markdown) => markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, '').trim();
const getPayload = (input) => input.publication?.publish_payload;
const getMarkdown = (input) => getContentSourceMarkdown(input);
const getDraft = async (store, draftId) => {
    const raw = await store.get(recordKey(draftId));
    if (!raw)
        return undefined;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.request_id !== 'string' || !isRecord(parsed.input))
        return undefined;
    return parsed;
};
const renderMarkdown = async (markdown) => {
    const processor = await processorPromise;
    const rendered = await processor.render(stripFrontmatter(markdown));
    return {
        html: rendered.code,
        readingTime: rendered.metadata.frontmatter?.readingTime,
    };
};
const toDraftPreview = async (record) => {
    const payload = getPayload(record.input);
    const markdown = getMarkdown(record.input);
    const rendered = await renderMarkdown(markdown || '_No draft markdown has been saved yet._');
    const title = toText(payload?.title) || toText(record.input.content?.title) || 'Untitled draft';
    const excerpt = toText(payload?.excerpt) || toText(payload?.description) || toText(record.input.content?.deck);
    const publishDate = toText(payload?.publishDate) || record.updated_at;
    const image = toText(payload?.featuredImage) || toText(payload?.existingFeaturedImagePath);
    return {
        id: record.request_id,
        input: record.input,
        title,
        slug: toText(payload?.slug),
        author: toText(payload?.author),
        excerpt,
        publishDate,
        updatedAt: record.updated_at,
        image,
        video: toText(payload?.videoLink),
        ctaLink: toText(payload?.ctaLink),
        ctaText: toText(payload?.ctaText),
        readingTime: rendered.readingTime,
        html: rendered.html,
    };
};
export const handler = async (event) => {
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
        return jsonResponse(403, { error: 'This Clerk user is not authorized to review JSON drafts.' });
    }
    const draftId = toText(event.queryStringParameters?.draftId);
    if (!draftId)
        return jsonResponse(400, { error: 'draftId is required.' });
    try {
        const store = await getWorkflowBlobStore(event);
        const record = await getDraft(store, draftId);
        if (!record)
            return jsonResponse(404, { not_found: true, error: 'Draft was not found.' });
        const draft = await toDraftPreview(record);
        return jsonResponse(200, { draft, input: record.input });
    }
    catch (error) {
        console.error('Failed to load admin JSON draft.', error);
        return jsonResponse(500, { error: 'JSON draft could not be loaded.' });
    }
};
