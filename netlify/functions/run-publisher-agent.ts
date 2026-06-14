import { getAdminStateFromEvent, getHeader } from '../lib/admin-auth.js';
import { uploadImagesWithIntegrity, type UploadableImage } from '../lib/mcp-artifact-upload-client.js';
import { requireArtifactReferenceArray, type ArtifactReference } from '../lib/artifacts.js';
import { pollDeployReceipt, type DeployReceipt, type DeployStatus } from '../lib/netlify-deploys.js';
import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';

/**
 * Netlify environment required by this server-side Agent SDK runner:
 * - OPENAI_API_KEY: used by the OpenAI Agents SDK.
 * - NETLIFY_PUBLISH_ENDPOINT: absolute URL for /.netlify/functions/publish-article.
 * - NETLIFY_PUBLISH_SECRET: server-only key sent as x-publish-key to publish-article.
 *
 * Keep NETLIFY_PUBLISH_SECRET separate from publish-article's PUBLISH_SECRET name in
 * code. In Netlify, both values should be configured to the same secret string.
 */

type LambdaEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type PublisherRequest = {
  action?: unknown;
  articleIdea?: unknown;
  images?: unknown;
  artifactReferences?: unknown;
  requestId?: unknown;
  request_id?: unknown;
  markdown?: unknown;
  overwrite?: unknown;
  publishedDate?: unknown;
  publishSecret?: unknown;
  slug?: unknown;
  title?: unknown;
};

type NormalizedPublisherRequest = {
  images: UploadableImage[];
  artifactReferences: ArtifactReference[];
  requestId?: string;
  markdown: string;
  overwrite: boolean;
  slug: string;
  title: string;
};

type PublishEndpointResult = {
  articlePath?: unknown;
  deployId?: unknown;
  deployUrl?: unknown;
  productionUrl?: unknown;
  commit?: unknown;
  deployStatus?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  errorMessage?: unknown;
  imagePaths?: unknown;
  media?: unknown;
  message?: unknown;
  ok?: unknown;
  path?: unknown;
  success?: unknown;
  [key: string]: unknown;
};

type PublishToolResult = PublishEndpointResult & {
  error?: unknown;
  statusCode?: unknown;
  payload: {
    articlePath: string;
    commitMessage: string;
    imageCount: number;
    overwrite: boolean;
    slug: string;
  };
};

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
    waitForDeploy: z.boolean().optional(),
    deployWaitTimeoutSeconds: z.number().min(0).optional(),
    deployPollIntervalSeconds: z.number().min(1).optional(),
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
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'RunnerError';
    this.statusCode = statusCode;
  }
}

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

const verifyClerkAdminSession = async (event: LambdaEvent) => {
  const adminState = await getAdminStateFromEvent(event);

  if (!adminState.authenticated) {
    const statusCode = adminState.error === 'Clerk authentication is not configured.' ? 500 : 401;
    const error =
      adminState.error === 'A valid Clerk session token is required.'
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

const verifyRequestAuthorization = async (event: LambdaEvent, input?: PublisherRequest) => {
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

const toStringValue = (value: unknown) => {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toBooleanValue = (value: unknown) => value === true || value === 'true' || value === 'on';

const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const parseBody = (event: LambdaEvent): PublisherRequest | undefined => {
  if (!event.body) return undefined;

  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const contentType = getHeader(event.headers, 'content-type');

  if (!contentType.includes('application/json')) {
    throw new RunnerError(415, 'Send a POST request with Content-Type: application/json.');
  }

  const parsed = JSON.parse(body) as unknown;
  return parsed && typeof parsed === 'object' ? (parsed as PublisherRequest) : undefined;
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

const normalizeInlineAgentImages = (images: unknown) => {
  if (images === undefined || images === null) return [];
  if (!Array.isArray(images)) throw new RunnerError(400, 'images must be an array when provided.');

  return images.map((image, index) => {
    const parsed = publishImageSchema.safeParse(image);
    if (!parsed.success) {
      throw new RunnerError(400, `images[${index}] must include valid artifact upload fields.`);
    }

    return parsed.data;
  });
};

const normalizeArtifactReferences = (value: unknown) => {
  try {
    return requireArtifactReferenceArray(value);
  } catch (error) {
    throw new RunnerError(400, error instanceof Error ? error.message : 'Invalid artifactReferences.');
  }
};

const normalizeRequest = (input: PublisherRequest): NormalizedPublisherRequest => {
  const title = toStringValue(input.title);
  const rawSlug = toStringValue(input.slug) ?? title;
  const slug = rawSlug ? slugify(rawSlug) : undefined;
  const markdown = toStringValue(input.markdown);
  const missing = [!title ? 'title' : undefined, !slug ? 'slug' : undefined, !markdown ? 'markdown' : undefined].filter(
    Boolean
  );

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

const getActionName = (input: PublisherRequest) => toStringValue(input.action) ?? 'agent.publish_article';

const toStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const createMcpEndpoint = (publishEndpoint: string) => {
  const configured = toStringValue(process.env.NETLIFY_MCP_ENDPOINT);
  if (configured) return configured;

  return new URL('/mcp', publishEndpoint).toString();
};

const createMcpToolCaller = (endpoint: string) => async (name: string, args: Record<string, unknown>) => {
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
  const rpc = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    result?: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { text?: string }[] };
  };
  const result = rpc.result ?? {};

  if (!response.ok || rpc.error || result.isError) {
    const message =
      rpc.error?.message ||
      String(
        result.structuredContent?.error || result.content?.[0]?.text || `${name} failed with status ${response.status}.`
      );
    throw new Error(message);
  }

  return result.structuredContent ?? {};
};

type DeployReceiptLike = Partial<DeployReceipt> & {
  commit?: string;
  deployStatus?: DeployStatus | string;
};

type ImageVerificationResult = {
  verified: boolean;
  articleUrl: string;
  expectedImageUrls: string[];
  statusCode?: number;
  error?: string;
  [key: string]: unknown;
};

const terminalDeployStatuses = new Set(['ready', 'failed', 'canceled', 'timed_out']);

const createDeployReceipt = (result: PublishEndpointResult): DeployReceiptLike => ({
  deployId: toStringValue(result.deployId),
  deployUrl: toStringValue(result.deployUrl),
  productionUrl: toStringValue(result.productionUrl),
  commit: toStringValue(result.commit),
  deployStatus: toStringValue(result.deployStatus),
  startedAt: toStringValue(result.startedAt),
  finishedAt: toStringValue(result.finishedAt),
  errorMessage: toStringValue(result.errorMessage),
});

const normalizeDeployReceipt = async (result: PublishToolResult): Promise<DeployReceiptLike> => {
  const receipt = createDeployReceipt(result);
  const commit = receipt.commit || toStringValue(result.commit) || '';
  const deployId = receipt.deployId || toStringValue(result.deployId) || '';
  const deployStatus = receipt.deployStatus || '';
  const shouldPoll = Boolean(commit || deployId) && !terminalDeployStatuses.has(deployStatus);

  if (!shouldPoll && terminalDeployStatuses.has(deployStatus)) return receipt;
  if (!commit && !deployId) return receipt;

  try {
    const polledReceipt = await pollDeployReceipt({ commit, deployId });
    return { ...receipt, ...polledReceipt };
  } catch (error) {
    console.warn('Publisher deploy polling failed.', { commit, deployId, error });
    return {
      ...receipt,
      commit,
      deployId,
      deployStatus: receipt.deployStatus || 'queued',
      errorMessage: receipt.errorMessage || (error instanceof Error ? error.message : 'Deploy polling failed.'),
    };
  }
};

const asUrl = (baseUrl: string, path: string) => {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return '';
  }
};

const normalizeMediaPath = (value: unknown): string | undefined => {
  if (typeof value === 'string') return toStringValue(value);
  if (!value || typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  return (
    toStringValue(record.url) ??
    toStringValue(record.src) ??
    toStringValue(record.path) ??
    toStringValue(record.imagePath) ??
    toStringValue(record.repoPath)
  );
};

const collectMediaPaths = (...values: unknown[]) =>
  Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .map(normalizeMediaPath)
        .filter((value): value is string => Boolean(value))
    )
  );

const deriveArticleUrl = (productionUrl: string, result: PublishToolResult) => {
  const returnedUrl =
    toStringValue(result.articleUrl) ?? toStringValue(result.url) ?? toStringValue(result.permalink) ?? '';
  if (returnedUrl) return asUrl(productionUrl, returnedUrl);

  const slug = result.payload.slug;
  return asUrl(productionUrl, `/${slug}/`);
};

const verifyArticleImages = async ({
  endpoint,
  expectedImageUrls,
  articleUrl,
  publishSecret,
}: {
  endpoint: string;
  expectedImageUrls: string[];
  articleUrl: string;
  publishSecret: string;
}): Promise<ImageVerificationResult | undefined> => {
  if (!articleUrl || !expectedImageUrls.length) {
    return undefined;
  }

  const verifyEndpoint = new URL('/.netlify/functions/verify-article-images', endpoint).toString();
  const response = await fetch(verifyEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-publish-key': publishSecret,
    },
    body: JSON.stringify({ articleUrl, expectedImageUrls }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  return {
    ...body,
    verified: body.verified === true || body.success === true || body.ok === true,
    articleUrl,
    expectedImageUrls,
    statusCode: response.status,
    ...(response.ok
      ? {}
      : { error: toStringValue(body.error) ?? `Image verification failed with HTTP ${response.status}.` }),
  };
};

const createPublishTool = ({
  endpoint,
  defaultInput,
  publishSecret,
  onPublishResult,
}: {
  endpoint: string;
  defaultInput: NormalizedPublisherRequest;
  publishSecret: string;
  onPublishResult?: (result: PublishToolResult) => void;
}) =>
  tool({
    name: 'publish_approved_article',
    description: 'Publishes the already-approved article payload through the existing secure Netlify publish endpoint.',
    parameters: publishToolInputSchema,
    strict: true,
    async execute(rawInput): Promise<PublishToolResult> {
      const parsed = publishToolInputSchema.parse(rawInput);
      const slug = slugify(parsed.slug);
      const markdown = toStringValue(parsed.markdown) ?? defaultInput.markdown;
      const title = toStringValue(parsed.title) ?? defaultInput.title;
      const articlePath = `${repoContentRoot}/${slug}.md`;
      const normalizedImages = normalizeInlineAgentImages(parsed.images ?? defaultInput.images);
      if (normalizedImages.length) {
        throw new RunnerError(
          400,
          'Artifact upload failed integrity verification: publish tool received unverified inline images.'
        );
      }
      const artifactReferences = normalizeArtifactReferences(
        parsed.artifactReferences ?? defaultInput.artifactReferences
      );
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
        waitForDeploy: parsed.waitForDeploy,
        deployWaitTimeoutSeconds: parsed.deployWaitTimeoutSeconds,
        deployPollIntervalSeconds: parsed.deployPollIntervalSeconds,
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
      let responseBody: PublishEndpointResult = {};

      if (responseText) {
        try {
          responseBody = JSON.parse(responseText) as PublishEndpointResult;
        } catch {
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

export const createPublisherAgent = ({
  endpoint,
  defaultInput,
  publishSecret,
  onPublishResult,
}: {
  endpoint: string;
  defaultInput: NormalizedPublisherRequest;
  publishSecret: string;
  onPublishResult?: (result: PublishToolResult) => void;
}) =>
  new Agent({
    name: 'Dr. Lurie Server-Side Publisher',
    instructions: [
      'You run server-side publishing for already-approved Dr. Lurié article data.',
      'Do not rewrite, summarize, or otherwise alter the approved article content.',
      'Call publish_approved_article once with the approved fields exactly as provided, including artifactReferences when present.',
      'If image, pdf, video, doc, audio, data, attachment, or other artifact bytes are created upstream, they must be uploaded immediately with save_artifact or save_artifact_chunk and stored only as the returned ArtifactReference objects.',
      'Do not invent or store deterministic blob keys, URLs, repo paths, or inline base64 media; artifact references must already come from server-side artifact tools.',
      'If artifactReferences are present, pass them through unchanged so the publish endpoint can resolve them before committing media.',
      'Call publish_approved_article exactly once, then return a concise JSON-style status summary.',
      'Your final output must report commit SHA, deploy id, deploy URL, production URL, deploy status, and image verification result when available.',
      'Do not call publish_approved_article more than once; deploy polling and image verification are handled by deterministic server code after your tool call.',
    ].join('\n'),
    tools: [createPublishTool({ endpoint, defaultInput, publishSecret, onPublishResult })],
  });

const getAgentMetadata = (agentResult: unknown) => {
  const result = agentResult && typeof agentResult === 'object' ? (agentResult as Record<string, unknown>) : {};
  const finalOutput = result.finalOutput;
  const usage = result.usage;
  const state =
    result.state && typeof result.state === 'object' ? (result.state as Record<string, unknown>) : undefined;
  const history = Array.isArray(result.history) ? result.history : undefined;
  const currentAgent = state?.currentAgent;
  const currentAgentRecord =
    currentAgent && typeof currentAgent === 'object' ? (currentAgent as Record<string, unknown>) : undefined;

  return {
    finalOutput,
    usage,
    historyLength: history?.length,
    currentAgentName: typeof currentAgent === 'string' ? currentAgent : toStringValue(currentAgentRecord?.name),
  };
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, {
      status: 'error',
      success: false,
      error: 'Method not allowed. Use POST.',
    });
  }

  let input: NormalizedPublisherRequest;
  let env: { endpoint: string; publishSecret: string };
  let body: PublisherRequest | undefined;

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
  } catch (error) {
    const statusCode = error instanceof RunnerError ? error.statusCode : 400;
    return jsonResponse(statusCode, {
      status: 'error',
      success: false,
      error: error instanceof Error ? error.message : 'Invalid publisher agent request.',
    });
  }

  const articlePath = `${repoContentRoot}/${input.slug}.md`;
  let publishResult: PublishToolResult | undefined;

  try {
    console.info('Starting publisher agent run.', {
      articlePath,
      imageCount: input.images.length,
      overwrite: input.overwrite,
      slug: input.slug,
    });

    if (input.images.length) {
      if (!input.requestId) {
        throw new RunnerError(
          400,
          'Artifact upload failed integrity verification: requestId is required to upload article images.'
        );
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
    const agentResult = await run(
      agent,
      `Publish the approved article using this payload JSON exactly:\n${JSON.stringify(input)}\nArticle path: ${articlePath}.`,
      { maxTurns: 3 }
    );
    const metadata = getAgentMetadata(agentResult);

    if (!publishResult) {
      throw new RunnerError(500, 'Publisher agent completed without returning publish endpoint results.');
    }

    const deployReceipt = await normalizeDeployReceipt(publishResult);
    const imagePaths = toStringArray(publishResult.imagePaths ?? publishResult.media);
    const expectedImageUrls =
      deployReceipt.productionUrl && deployReceipt.deployStatus === 'ready'
        ? collectMediaPaths(
            publishResult.imagePaths,
            publishResult.media,
            (publishResult as Record<string, unknown>).mediaEntries,
            (publishResult as Record<string, unknown>).artifactReferences
          )
            .map((path) => asUrl(deployReceipt.productionUrl || '', path))
            .filter((url) => Boolean(url))
        : [];
    const articleUrl =
      deployReceipt.productionUrl && deployReceipt.deployStatus === 'ready'
        ? deriveArticleUrl(deployReceipt.productionUrl, publishResult)
        : '';
    const imageVerification =
      deployReceipt.deployStatus === 'ready'
        ? await verifyArticleImages({
            endpoint: env.endpoint,
            expectedImageUrls,
            articleUrl,
            publishSecret: env.publishSecret,
          })
        : undefined;
    const success = publishResult.success === true || publishResult.ok === true;
    const statusCode = success ? 200 : Number(publishResult.statusCode) || 502;

    return jsonResponse(statusCode, {
      status: success ? 'ok' : 'error',
      success,
      articlePath: toStringValue(publishResult.articlePath) ?? articlePath,
      imagePaths,
      deployId: deployReceipt.deployId,
      deployUrl: deployReceipt.deployUrl,
      productionUrl: deployReceipt.productionUrl,
      deployStatus: deployReceipt.deployStatus || 'unknown',
      startedAt: deployReceipt.startedAt,
      finishedAt: deployReceipt.finishedAt,
      errorMessage: deployReceipt.errorMessage,
      message:
        toStringValue(publishResult.error) ??
        toStringValue(publishResult.message) ??
        (success ? `Article publish queued for ${articlePath}.` : 'Publish endpoint failed.'),
      commit: deployReceipt.commit,
      deployReceipt,
      imageVerification,
      verified: imageVerification?.verified === true,
      agent: {
        ...metadata,
        normalizedSlug: input.slug,
        publishPayload: publishResult.payload,
      },
    });
  } catch (error) {
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
