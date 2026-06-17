import { getAdminStateFromEvent, getHeader } from '../lib/admin-auth.js';
import { uploadImagesWithIntegrity } from '../lib/mcp-artifact-upload-client.js';
import { requireArtifactReferenceArray } from '../lib/artifacts.js';
import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
const publishImageSchema = z
    .object({
    name: z.string().trim().min(1).optional(),
    repoPath: z.string().trim().min(1).optional(),
    type: z.string().trim().min(1).optional(),
    encoding: z.string().trim().min(1).optional(),
    base64: z.string().trim().min(1).optional(),
    content: z.string().trim().min(1).optional(),
})
    .strict();
const publishToolInputSchema = z
    .object({
    slug: z.string().trim().min(1),
    title: z.string().trim().min(1),
    markdown: z.string().trim().min(1).optional(),
    content: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    publishDate: z.string().trim().min(1).optional(),
    author: z.string().trim().min(1).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    images: z.array(publishImageSchema).optional(),
    artifactReferences: z.array(z.unknown()).optional(),
    overwrite: z.boolean().optional(),
})
    .superRefine((value, ctx) => {
    if (!value.markdown && !value.content) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Either markdown or content is required.',
            path: ['markdown'],
        });
    }
});
const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};
const repoContentRoot = 'src/data/post';
class RunnerError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.name = 'RunnerError';
        this.statusCode = statusCode;
    }
}
const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body),
});
const verifyClerkAdminSession = async (event) => {
    const adminState = await getAdminStateFromEvent(event);
    if (!adminState.authenticated) {
        const statusCode = adminState.error === 'Clerk authentication is not configured.' ? 500 : 401;
        const error = adminState.error === 'A valid Clerk session token is required.'
            ? 'A valid Clerk session token is required to run the publisher agent.'
            : adminState.error || 'A valid Clerk session token is required to run the publisher agent.';
        return jsonResponse(statusCode, {
            status: 'error',
            success: false,
            error,
        });
    }
    if (!adminState.isAdmin) {
        return jsonResponse(403, {
            status: 'error',
            success: false,
            error: 'This Clerk user is not authorized to run the publisher agent.',
        });
    }
    return undefined;
};
const verifyRequestAuthorization = async (event, input) => {
    const publishKey = getHeader(event.headers, 'x-publish-key').trim();
    const publishSecretFromBody = toStringValue(input?.publishSecret) ?? '';
    const providedSecret = publishKey || publishSecretFromBody;
    if (providedSecret) {
        const publishSecret = process.env.PUBLISH_SECRET;
        if (publishSecret && providedSecret === publishSecret) {
            return undefined;
        }
        return jsonResponse(403, {
            status: 'error',
            success: false,
            error: 'Invalid publish key.',
        });
    }
    return verifyClerkAdminSession(event);
};
const toStringValue = (value) => {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};
const toBooleanValue = (value) => value === true || value === 'true' || value === 'on';
const slugify = (value) => value
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const parseBody = (event) => {
    if (!event.body)
        return undefined;
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const contentType = getHeader(event.headers, 'content-type');
    if (!contentType.includes('application/json')) {
        throw new RunnerError(415, 'Send a POST request with Content-Type: application/json.');
    }
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
};
const validateEnvironment = () => {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const endpoint = process.env.NETLIFY_PUBLISH_ENDPOINT;
    const publishSecret = process.env.NETLIFY_PUBLISH_SECRET;
    if (!openaiApiKey || !endpoint || !publishSecret) {
        throw new RunnerError(500, 'Server-side publisher agent is not configured.');
    }
    return {
        endpoint,
        publishSecret,
    };
};
const normalizeInlineAgentImages = (images) => {
    if (images === undefined || images === null)
        return [];
    if (!Array.isArray(images))
        throw new RunnerError(400, 'images must be an array when provided.');
    return images.map((image, index) => {
        const parsed = publishImageSchema.safeParse(image);
        if (!parsed.success) {
            throw new RunnerError(400, `images[${index}] must include valid artifact upload fields.`);
        }
        return parsed.data;
    });
};
const normalizeArtifactReferences = (value) => {
    try {
        return requireArtifactReferenceArray(value);
    }
    catch (error) {
        throw new RunnerError(400, error instanceof Error ? error.message : 'Invalid artifactReferences.');
    }
};
const normalizeRequest = (input) => {
    const title = toStringValue(input.title);
    const rawSlug = toStringValue(input.slug) ?? title;
    const slug = rawSlug ? slugify(rawSlug) : undefined;
    const markdown = toStringValue(input.markdown);
    const missing = [!title ? 'title' : undefined, !slug ? 'slug' : undefined, !markdown ? 'markdown' : undefined].filter(Boolean);
    if (missing.length) {
        throw new RunnerError(400, `Missing required field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`);
    }
    return {
        images: normalizeInlineAgentImages(input.images),
        artifactReferences: normalizeArtifactReferences(input.artifactReferences),
        requestId: toStringValue(input.requestId) ?? toStringValue(input.request_id),
        markdown: markdown ?? '',
        overwrite: toBooleanValue(input.overwrite),
        slug: slug ?? '',
        title: title ?? '',
    };
};
const getActionName = (input) => toStringValue(input.action) ?? 'agent.publish_article';
const toStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
const createMcpEndpoint = (publishEndpoint) => {
    const configured = toStringValue(process.env.NETLIFY_MCP_ENDPOINT);
    if (configured)
        return configured;
    return new URL('/mcp', publishEndpoint).toString();
};
const createMcpToolCaller = (endpoint) => async (name, args) => {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `publisher-agent-${name}-${Date.now()}`,
            method: 'tools/call',
            params: { name, arguments: args },
        }),
    });
    const rpc = (await response.json().catch(() => ({})));
    const result = rpc.result ?? {};
    if (!response.ok || rpc.error || result.isError) {
        const message = rpc.error?.message ||
            String(result.structuredContent?.error || result.content?.[0]?.text || `${name} failed with status ${response.status}.`);
        throw new Error(message);
    }
    return result.structuredContent ?? {};
};
const createPublishTool = ({ endpoint, defaultInput, publishSecret, onPublishResult, }) => tool({
    name: 'publish_approved_article',
    description: 'Publishes the already-approved article payload through the existing secure Netlify publish endpoint.',
    parameters: publishToolInputSchema,
    strict: true,
    async execute(rawInput) {
        const parsed = publishToolInputSchema.parse(rawInput);
        const slug = slugify(parsed.slug);
        const markdown = toStringValue(parsed.markdown) ?? defaultInput.markdown;
        const title = toStringValue(parsed.title) ?? defaultInput.title;
        const articlePath = `${repoContentRoot}/${slug}.md`;
        const normalizedImages = normalizeInlineAgentImages(parsed.images ?? defaultInput.images);
        if (normalizedImages.length) {
            throw new RunnerError(400, 'Artifact upload failed integrity verification: publish tool received unverified inline images.');
        }
        const artifactReferences = normalizeArtifactReferences(parsed.artifactReferences ?? defaultInput.artifactReferences);
        const payload = {
            slug,
            articlePath,
            markdown,
            content: parsed.content,
            description: parsed.description,
            publishDate: parsed.publishDate,
            author: parsed.author,
            tags: parsed.tags,
            title,
            images: normalizedImages.length ? normalizedImages : [],
            artifactReferences,
            commitMessage: `Publish article: ${title}`,
            overwrite: parsed.overwrite ?? defaultInput.overwrite,
        };
        console.info('Publisher agent posting approved article.', {
            articlePath,
            imageCount: payload.images.length,
            overwrite: payload.overwrite,
            slug,
        });
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-publish-key': publishSecret,
            },
            body: JSON.stringify(payload),
        });
        const responseText = await response.text();
        let responseBody = {};
        if (responseText) {
            try {
                responseBody = JSON.parse(responseText);
            }
            catch {
                responseBody = { message: responseText };
            }
        }
        const result = {
            ...responseBody,
            ...(response.ok ? {} : { statusCode: response.status }),
            payload: {
                articlePath,
                commitMessage: payload.commitMessage,
                imageCount: payload.images.length,
                overwrite: payload.overwrite,
                slug,
            },
        };
        onPublishResult?.(result);
        return result;
    },
});
export const createPublisherAgent = ({ endpoint, defaultInput, publishSecret, onPublishResult, }) => new Agent({
    name: 'Dr. Lurie Server-Side Publisher',
    instructions: [
        'You run server-side publishing for already-approved Dr. Lurié article data.',
        'Do not rewrite, summarize, or otherwise alter the approved article content.',
        'Call publish_approved_article once with the approved fields exactly as provided, including artifactReferences when present.',
        'If image, pdf, video, doc, audio, data, attachment, or other artifact bytes are created upstream, they must be uploaded immediately with save_artifact_chunk (using 48 KiB chunks) and stored only as the returned ArtifactReference objects.',
        'Do not invent or store deterministic blob keys, URLs, repo paths, or inline base64 media; artifact references must already come from server-side artifact tools.',
        'If artifactReferences are present, pass them through unchanged so the publish endpoint can resolve them before committing media.',
        'Call publish_approved_article exactly once, then return a concise JSON-style status summary.',
    ].join('\n'),
    tools: [createPublishTool({ endpoint, defaultInput, publishSecret, onPublishResult })],
});
const getAgentMetadata = (agentResult) => {
    const result = agentResult && typeof agentResult === 'object' ? agentResult : {};
    const finalOutput = result.finalOutput;
    const usage = result.usage;
    const state = result.state && typeof result.state === 'object' ? result.state : undefined;
    const history = Array.isArray(result.history) ? result.history : undefined;
    const currentAgent = state?.currentAgent;
    const currentAgentRecord = currentAgent && typeof currentAgent === 'object' ? currentAgent : undefined;
    return {
        finalOutput,
        usage,
        historyLength: history?.length,
        currentAgentName: typeof currentAgent === 'string' ? currentAgent : toStringValue(currentAgentRecord?.name),
    };
};
export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, {
            status: 'error',
            success: false,
            error: 'Method not allowed. Use POST.',
        });
    }
    let input;
    let env;
    let body;
    try {
        body = parseBody(event);
        if (!body) {
            return jsonResponse(400, {
                status: 'error',
                success: false,
                error: 'Missing request body.',
            });
        }
        const authError = await verifyRequestAuthorization(event, body);
        if (authError) {
            return authError;
        }
        const action = getActionName(body);
        if (action === 'agent.fill_test_payload') {
            return jsonResponse(200, {
                status: 'ok',
                success: true,
                action,
                message: 'Test payload action acknowledged.',
            });
        }
        if (action === 'agent.start_workflow') {
            return jsonResponse(200, {
                status: 'ok',
                success: true,
                action,
                articleIdea: toStringValue(body.articleIdea) ?? '',
                message: 'Workflow start action acknowledged.',
            });
        }
        if (Object.hasOwn(body, 'publishedDate')) {
            throw new RunnerError(400, 'publishedDate is not supported. Use publishDate in PublishPayload.');
        }
        input = normalizeRequest(body);
        env = validateEnvironment();
    }
    catch (error) {
        const statusCode = error instanceof RunnerError ? error.statusCode : 400;
        return jsonResponse(statusCode, {
            status: 'error',
            success: false,
            error: error instanceof Error ? error.message : 'Invalid publisher agent request.',
        });
    }
    const articlePath = `${repoContentRoot}/${input.slug}.md`;
    let publishResult;
    try {
        console.info('Starting publisher agent run.', {
            articlePath,
            imageCount: input.images.length,
            overwrite: input.overwrite,
            slug: input.slug,
        });
        if (input.images.length) {
            if (!input.requestId) {
                throw new RunnerError(400, 'Artifact upload failed integrity verification: requestId is required to upload article images.');
            }
            const uploadedReferences = await uploadImagesWithIntegrity({
                images: input.images,
                requestId: input.requestId,
                mcpToolCall: createMcpToolCaller(createMcpEndpoint(env.endpoint)),
                onWorkflowError: (message) => {
                    console.error('Publisher artifact workflow error.', { articlePath, message, slug: input.slug });
                },
            });
            input = { ...input, images: [], artifactReferences: [...input.artifactReferences, ...uploadedReferences] };
        }
        const agent = createPublisherAgent({
            endpoint: env.endpoint,
            defaultInput: input,
            publishSecret: env.publishSecret,
            onPublishResult: (result) => {
                publishResult = result;
            },
        });
        const agentResult = await run(agent, `Publish the approved article using this payload JSON exactly:\n${JSON.stringify(input)}\nArticle path: ${articlePath}.`, { maxTurns: 3 });
        const metadata = getAgentMetadata(agentResult);
        if (!publishResult) {
            throw new RunnerError(500, 'Publisher agent completed without returning publish endpoint results.');
        }
        const imagePaths = toStringArray(publishResult.imagePaths ?? publishResult.media);
        const success = publishResult.success === true || publishResult.ok === true;
        const statusCode = success ? 200 : Number(publishResult.statusCode) || 502;
        return jsonResponse(statusCode, {
            status: success ? 'ok' : 'error',
            success,
            articlePath: toStringValue(publishResult.articlePath) ?? articlePath,
            imagePaths,
            deployStatus: toStringValue(publishResult.deployStatus) ?? 'unknown',
            message: toStringValue(publishResult.error) ??
                toStringValue(publishResult.message) ??
                (success ? `Article publish queued for ${articlePath}.` : 'Publish endpoint failed.'),
            commit: toStringValue(publishResult.commit),
            agent: {
                ...metadata,
                normalizedSlug: input.slug,
                publishPayload: publishResult.payload,
            },
        });
    }
    catch (error) {
        console.error('Publisher agent failed.', {
            articlePath,
            slug: input.slug,
            error: error instanceof Error ? error.message : error,
        });
        const statusCode = error instanceof RunnerError ? error.statusCode : 500;
        return jsonResponse(statusCode, {
            status: 'error',
            success: false,
            articlePath,
            imagePaths: [],
            deployStatus: 'failed',
            message: error instanceof Error ? error.message : 'Publisher agent failed.',
            error: error instanceof Error ? error.message : 'Publisher agent failed.',
            commit: undefined,
        });
    }
};
