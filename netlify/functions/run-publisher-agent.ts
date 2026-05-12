import { Agent, run, tool } from "@openai/agents";

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

type PublishImageInput = {
  base64?: unknown;
  content?: unknown;
  encoding?: unknown;
  name?: unknown;
  repoPath?: unknown;
  type?: unknown;
};

type PublisherRequest = {
  images?: unknown;
  markdown?: unknown;
  overwrite?: unknown;
  slug?: unknown;
  title?: unknown;
};

type NormalizedPublisherRequest = {
  images: PublishImageInput[];
  markdown: string;
  overwrite: boolean;
  slug: string;
  title: string;
};

type PublishEndpointResult = {
  articlePath?: unknown;
  commit?: unknown;
  deployStatus?: unknown;
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

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const repoContentRoot = "src/data/post";

class RunnerError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "RunnerError";
    this.statusCode = statusCode;
  }
}

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

const getHeader = (headers: LambdaEvent["headers"], name: string) => {
  const normalizedName = name.toLowerCase();
  const match = Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === normalizedName,
  );

  return match?.[1] ?? "";
};

const toStringValue = (value: unknown) => {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toBooleanValue = (value: unknown) =>
  value === true || value === "true" || value === "on";

const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const parseBody = (event: LambdaEvent): PublisherRequest | undefined => {
  if (!event.body) return undefined;

  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  const contentType = getHeader(event.headers, "content-type");

  if (!contentType.includes("application/json")) {
    throw new RunnerError(
      415,
      "Send a POST request with Content-Type: application/json.",
    );
  }

  const parsed = JSON.parse(body) as unknown;
  return parsed && typeof parsed === "object"
    ? (parsed as PublisherRequest)
    : undefined;
};

const validateEnvironment = () => {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const endpoint = process.env.NETLIFY_PUBLISH_ENDPOINT;
  const publishSecret = process.env.NETLIFY_PUBLISH_SECRET;
  const missing = [
    !openaiApiKey ? "OPENAI_API_KEY" : undefined,
    !endpoint ? "NETLIFY_PUBLISH_ENDPOINT" : undefined,
    !publishSecret ? "NETLIFY_PUBLISH_SECRET" : undefined,
  ].filter(Boolean);

  if (!openaiApiKey || !endpoint || !publishSecret) {
    throw new RunnerError(
      500,
      `Server-side publisher agent is not configured. Missing Netlify environment variable${
        missing.length === 1 ? "" : "s"
      }: ${missing.join(", ")}.`,
    );
  }

  return {
    endpoint,
    publishSecret,
  };
};

const hasRealBase64Image = (image: PublishImageInput) => {
  const base64 = toStringValue(image.base64) ?? toStringValue(image.content);

  if (!base64) return false;

  const compact = base64.replace(/^data:[^;]+;base64,/i, "").replace(/\s/g, "");
  if (compact.length < 16) return false;

  return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
};

const normalizeImages = (images: unknown) => {
  if (!Array.isArray(images)) return [];

  return images.filter((image): image is PublishImageInput => {
    if (!image || typeof image !== "object") return false;
    return hasRealBase64Image(image as PublishImageInput);
  });
};

const normalizeRequest = (
  input: PublisherRequest,
): NormalizedPublisherRequest => {
  const title = toStringValue(input.title);
  const rawSlug = toStringValue(input.slug) ?? title;
  const slug = rawSlug ? slugify(rawSlug) : undefined;
  const markdown = toStringValue(input.markdown);
  const missing = [
    !title ? "title" : undefined,
    !slug ? "slug" : undefined,
    !markdown ? "markdown" : undefined,
  ].filter(Boolean);

  if (missing.length) {
    throw new RunnerError(
      400,
      `Missing required field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
    );
  }

  return {
    images: normalizeImages(input.images),
    markdown: markdown ?? "",
    overwrite: toBooleanValue(input.overwrite),
    slug: slug ?? "",
    title: title ?? "",
  };
};

const toStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const createPublishTool = ({
  endpoint,
  input,
  publishSecret,
  onPublishResult,
}: {
  endpoint: string;
  input: NormalizedPublisherRequest;
  publishSecret: string;
  onPublishResult?: (result: PublishToolResult) => void;
}) =>
  tool({
    name: "publish_approved_article",
    description:
      "Publishes the already-approved article payload through the existing secure Netlify publish endpoint.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    strict: true,
    async execute(): Promise<PublishToolResult> {
      const articlePath = `${repoContentRoot}/${input.slug}.md`;
      const payload = {
        slug: input.slug,
        articlePath,
        markdown: input.markdown,
        images: input.images.length ? input.images : [],
        commitMessage: `Publish article: ${input.title}`,
        overwrite: input.overwrite,
      };

      console.info("Publisher agent posting approved article.", {
        articlePath,
        imageCount: payload.images.length,
        overwrite: input.overwrite,
        slug: input.slug,
      });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-publish-key": publishSecret,
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
          overwrite: input.overwrite,
          slug: input.slug,
        },
      };

      onPublishResult?.(result);

      return result;
    },
  });

export const createPublisherAgent = ({
  endpoint,
  input,
  publishSecret,
  onPublishResult,
}: {
  endpoint: string;
  input: NormalizedPublisherRequest;
  publishSecret: string;
  onPublishResult?: (result: PublishToolResult) => void;
}) =>
  new Agent({
    name: "Dr. Lurie Server-Side Publisher",
    instructions: [
      "You run server-side publishing for already-approved Dr. Lurié article data.",
      "Do not rewrite, summarize, or otherwise alter the approved article.",
      "Call publish_approved_article exactly once, then return a concise JSON-style status summary.",
    ].join("\n"),
    tools: [
      createPublishTool({ endpoint, input, publishSecret, onPublishResult }),
    ],
  });

const getAgentMetadata = (agentResult: unknown) => {
  const result =
    agentResult && typeof agentResult === "object"
      ? (agentResult as Record<string, unknown>)
      : {};
  const finalOutput = result.finalOutput;
  const usage = result.usage;
  const state =
    result.state && typeof result.state === "object"
      ? (result.state as Record<string, unknown>)
      : undefined;
  const history = Array.isArray(result.history) ? result.history : undefined;
  const currentAgent = state?.currentAgent;
  const currentAgentRecord =
    currentAgent && typeof currentAgent === "object"
      ? (currentAgent as Record<string, unknown>)
      : undefined;

  return {
    finalOutput,
    usage,
    historyLength: history?.length,
    currentAgentName:
      typeof currentAgent === "string"
        ? currentAgent
        : toStringValue(currentAgentRecord?.name),
  };
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, {
      success: false,
      error: "Method not allowed. Use POST.",
    });
  }

  let input: NormalizedPublisherRequest;
  let env: { endpoint: string; publishSecret: string };

  try {
    const body = parseBody(event);

    if (!body) {
      return jsonResponse(400, {
        success: false,
        error: "Missing request body.",
      });
    }

    input = normalizeRequest(body);
    env = validateEnvironment();
  } catch (error) {
    const statusCode = error instanceof RunnerError ? error.statusCode : 400;
    return jsonResponse(statusCode, {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Invalid publisher agent request.",
    });
  }

  const articlePath = `${repoContentRoot}/${input.slug}.md`;
  let publishResult: PublishToolResult | undefined;

  try {
    console.info("Starting publisher agent run.", {
      articlePath,
      imageCount: input.images.length,
      overwrite: input.overwrite,
      slug: input.slug,
    });

    const agent = createPublisherAgent({
      endpoint: env.endpoint,
      input,
      publishSecret: env.publishSecret,
      onPublishResult: (result) => {
        publishResult = result;
      },
    });
    const agentResult = await run(
      agent,
      `Publish the approved article at ${articlePath}.`,
      { maxTurns: 3 },
    );
    const metadata = getAgentMetadata(agentResult);

    if (!publishResult) {
      throw new RunnerError(
        500,
        "Publisher agent completed without returning publish endpoint results.",
      );
    }

    const imagePaths = toStringArray(
      publishResult.imagePaths ?? publishResult.media,
    );
    const success = publishResult.success === true || publishResult.ok === true;
    const statusCode = success ? 200 : Number(publishResult.statusCode) || 502;

    return jsonResponse(statusCode, {
      success,
      articlePath: toStringValue(publishResult.articlePath) ?? articlePath,
      imagePaths,
      deployStatus: toStringValue(publishResult.deployStatus) ?? "unknown",
      message:
        toStringValue(publishResult.error) ??
        toStringValue(publishResult.message) ??
        (success
          ? `Article publish queued for ${articlePath}.`
          : "Publish endpoint failed."),
      commit: toStringValue(publishResult.commit),
      agent: {
        ...metadata,
        normalizedSlug: input.slug,
        publishPayload: publishResult.payload,
      },
    });
  } catch (error) {
    console.error("Publisher agent failed.", {
      articlePath,
      slug: input.slug,
      error: error instanceof Error ? error.message : error,
    });

    const statusCode = error instanceof RunnerError ? error.statusCode : 500;

    return jsonResponse(statusCode, {
      success: false,
      articlePath,
      imagePaths: [],
      deployStatus: "failed",
      message:
        error instanceof Error ? error.message : "Publisher agent failed.",
      commit: undefined,
    });
  }
};
