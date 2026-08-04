/**
 * The MCP server — fleet law (W14 T14.3).
 *
 * This file used to live in `netlify/functions/` and be Dr-Lurie's alone. Two
 * things bound it to that one client, and only the first was obvious:
 *
 *  1. it opened by importing `sites/drlurie/config/policy-bindings`, and
 *  2. it is a COMPOSITE — it dispatches to sibling function handlers,
 *     imported statically from the same directory.
 *
 * So the decoupling is dependency injection, not a file move. `configureMcp`
 * is the seam: each site's shim registers its own policy bindings, builds the
 * governed handlers from the core factories with ITS SiteBinding, and passes
 * them in.
 *
 * RETIRED (2026-07-29): the legacy `save_json_blob_*` article pipeline and its
 * per-stage workflow tools are gone — module, publish path, tools and all
 * (ruling OQ-W11-6; its last consumer, CMS-Agent's dr-lurie hook, moved to the
 * object dialect first). Articles are `content_item` OBJECTS on every site in
 * the fleet. The committed legacy posts under `src/data/post/` and their
 * rendering are untouched: this retired the WRITE pipeline, not the published
 * content.
 *
 * `verify-article-images` survives that retirement and is still injected
 * rather than imported: it is a per-site function, and it serves the OBJECT
 * path (post-release image verification) as much as it ever served the legacy
 * one. It stays OPTIONAL — a site that injects no handler does not advertise
 * the tool rather than advertising one that cannot run.
 *
 * FAILS CLOSED: calling into this module before `configureMcp` throws. A
 * silent fallback to another tenant's handlers is the one outcome worse than
 * a crash.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * A Netlify function handler, as invoked in-process by the tool bodies.
 * `LambdaEvent`/`LambdaContext` are declared further down this module.
 */
type SiblingResponse = { statusCode: number; body?: string; headers?: Record<string, string> };
type SiblingHandler = (event: LambdaEvent, context?: LambdaContext) => Promise<SiblingResponse>;

/**
 * The governed trio every site has, plus the optional image-verification
 * handler a site supplies when it deploys `verify-article-images`.
 */
export interface McpSiblingHandlers {
  saveArtifactHandler: SiblingHandler;
  objectStoreHandler: SiblingHandler;
  deployStatusHandler: SiblingHandler;
  verifyArticleImagesHandler?: SiblingHandler;
}

let siblings: McpSiblingHandlers | undefined;

/** Called once per site, by that site's shim, before any request is served. */
export const configureMcp = (handlers: McpSiblingHandlers): void => {
  siblings = handlers;
};

const requireSiblings = (): McpSiblingHandlers => {
  if (!siblings) {
    throw new Error(
      "MCP server not configured — this site's shim must call configureMcp() " +
        '(and import its own config/policy-bindings) before serving a request.'
    );
  }
  return siblings;
};

/**
 * Tools that cannot work without a handler only some sites inject. A site that
 * injects none must not ADVERTISE them — listing a tool an agent cannot call
 * is worse than omitting it: the agent plans around it and fails mid-run.
 *
 * Caught by T14.4's live round-trip: injecting the handlers alone left every
 * one of these in `tools/list` on a site that had none of them.
 */
const OPTIONAL_HANDLER_TOOLS = new Set(['verify_article_images']);

/**
 * Operational tools that remain callable for admin and test workflows, but
 * are intentionally absent from agent discovery. They are
 * not part of normal information exchange or governed object editing, and a
 * large destructive/upload surface makes agent planning needlessly noisy.
 */
const INTERNAL_ONLY_TOOLS = new Set([
  'trigger_netlify_build',
  'create_artifact_upload_intent',
  'create_artifact_from_url',
  'save_artifact',
  'soft_delete_artifact',
  'restore_artifact',
  'migrate_artifact_indexes',
  'wipe_blob_stores',
  'reconcile_artifact_indexes',
]);

/** True when this site supplied the article-image verification handler. */
const hasVerifyArticleImages = (): boolean => Boolean(requireSiblings().verifyArticleImagesHandler);

/** An optional handler: present only on a site that deploys the function. */
const requireOptional = (name: 'verifyArticleImagesHandler') => {
  const handlerFn = requireSiblings()[name];
  if (!handlerFn) {
    throw new Error(`This site does not deploy '${name}', so the tool is unavailable.`);
  }
  return handlerFn;
};

const saveArtifactHandler: SiblingHandler = (event, context) => requireSiblings().saveArtifactHandler(event, context);
const objectStoreHandler: SiblingHandler = (event, context) => requireSiblings().objectStoreHandler(event, context);
const deployStatusHandler: SiblingHandler = (event, context) => requireSiblings().deployStatusHandler(event, context);
const verifyArticleImagesHandler: SiblingHandler = (event, context) =>
  requireOptional('verifyArticleImagesHandler')(event, context);
import {
  isNetlifyBuildHookConfigured,
  NetlifyBuildHookTriggerError,
  triggerNetlifyBuild,
} from '../lib/netlify-deploys.js';
import { releaseToProduction } from '../lib/production-release.js';
import { buildPdfToolStorageGrant } from '../lib/pdf-tool-storage-grant.js';
import {
  canonicalPlatformArtifact,
  createPlatformArtifactJob,
  createPlatformPdfTemplate,
  deletePlatformPdfTemplate,
  getPlatformArtifactBySlot,
  getPlatformArtifactJobStatus,
  getPlatformPdfTemplate,
  listPlatformPdfTemplates,
  publishPlatformPdfTemplate,
  verifyPlatformArtifact,
  type PlatformArtifactJobInput,
  type PlatformCreateTemplateInput,
} from '../lib/pdf-tool-client.js';
import { collectBlobListItems } from '../lib/blob-list.js';
import {
  getArtifactBlobStore,
  getArtifactIndexBlobStore,
  getCommerceBlobStore,
  getCommerceEventsBlobStore,
  getSiteObjectsBlobStore,
  getWorkflowBlobStore,
} from '../lib/blob-store.js';
import { getOrderDetail, listOrders } from '../lib/commerce-admin.js';
import { orderReissue } from '../lib/order-reissue.js';
import { productSetPrice } from '../lib/product-set-price.js';
import { getStripeClient } from '../lib/stripe-env.js';
import type { ObjectVerbStore } from '../lib/object-verbs.js';
import {
  createArtifactUploadToken,
  defaultArtifactUploadTokenTtlMs,
  getDirectArtifactUploadMaxBytes,
} from '../lib/artifact-upload.js';
import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
import { getGovernanceBlobStore } from '../lib/governance-store.js';
import { getAgentKeysDoc, resolveVerifiedAgentName, type AgentKeysBlobStore } from '../lib/agent-keys.js';
import {
  buildWwwAuthenticate,
  resolveOAuthPrincipal,
  resolveRequestOrigin,
  type ResolvedOAuthPrincipal,
} from '../lib/oauth-server.js';
import type { OAuthBlobStore } from '../lib/oauth-store.js';
import {
  artifactKindValues,
  artifactReferenceLimits,
  isArtifactReference,
  isDeletedArtifactReference,
  isSafeArtifactFilename,
  isSafeArtifactText,
  normalizeArtifactBlobKey,
  reconcileArtifactReference,
  safePathSegment,
  type ArtifactKind,
  type ArtifactReference,
} from '../lib/artifacts.js';
import {
  listArtifactIndexKeys,
  listArtifactReferencesForRequest,
  readArtifactReference,
  requestArtifactReferenceKey,
  resolveArtifactPointer,
  writeArtifactReferenceIndexes,
  type ArtifactIndexStore,
} from '../lib/artifact-index.js';
import { saveArtifactFromUrl } from '../lib/artifact-url-ingest.js';
import { validateFilename, validateRequestId } from '../../lib/agents-naming.js';
import { getSiteIdentity } from '../../lib/site-identity.js';
import {
  listPageTypeDefinitions,
  pageTypeDefinitionJsonSchema,
  unimplementedPageTypeIds,
} from '../../lib/registry/page-types.js';
import {
  buildObjectContract,
  listSectionTypeContracts,
  OBJECT_CONTRACT_TYPES,
} from '../../lib/registry/object-contract.js';
import { objectTypes, type ObjectType } from '../../schema/object-record-v1.js';
import { pageTypeIds } from '../../schema/bodies/page-v1.js';

const mediaPortabilityWarning =
  'Media portability constraint: repo-style paths (src/assets/.../uploads/<slug>/...) are scoped to the specific article slug they were generated for and must NEVER be copied into a different request public_media_src or artifactReferences. portable:false and scoped_to_slug/scoped_to_request_id metadata are machine-readable hard constraints, not suggestions. Only artifact pointers freshly resolved for the CURRENT request (image/{requestId}/{sha}.{ext} or pdf/{requestId}/{sha}.{ext}) are safe inputs for a new or repair request. See docs/agents/naming-convention.md for canonical naming rules.';

type StructuredLogPayload = {
  event: string;
  rpcMethod?: string | null;
  slug?: string | null;
  [key: string]: unknown;
};

type StructuredLogger = (payload: StructuredLogPayload) => void;

type LambdaEvent = {
  blobs?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  /** Epoch ms by which this invocation is killed by the platform; derived from the Lambda context when available. */
  invocationDeadlineMs?: number;
  isBase64Encoded?: boolean;
  log?: StructuredLogger;
  queryStringParameters?: Record<string, string | undefined>;
  rpcMethod?: string | null;
  requestId?: string;
  slug?: string | null;
  /** W11 T11.10: set once per request when the Authorization bearer token resolves to a VERIFIED per-agent credential. */
  verifiedAgentName?: string;
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

// Derived from the site-identity seam; for Dr-Lurie the resolved values are
// byte-identical to the historical literals ('Dr_Lurie_MCP_Server' /
// 'Dr_Lurie_Science_MCP') — external connectors key on serverInfo.name, so
// the identity config must never change them casually.
const SERVER_NAME = getSiteIdentity().mcpServerName;
const SERVER_DIAGNOSTIC_NAME = getSiteIdentity().mcpDiagnosticName;
const PROTOCOL_VERSION = '2025-06-18';

// Cold-start observability: a fresh runtime instance means the caller just
// paid module-evaluation latency. Surfaced in the per-request structured log
// and in the ping tool so slow first calls are attributable from client side.
const INSTANCE_BOOTED_AT_MS = Date.now();
let instanceInvocationCount = 0;
const ARTIFACT_LIST_DEFAULT_LIMIT = 50;
const ARTIFACT_LIST_MAX_LIMIT = 100;
const WIPE_BLOB_CONFIRMATION = 'WIPE_BLOBS';
const WIPE_BLOB_SAMPLE_LIMIT = 20;
const SINGLE_SHOT_ARTIFACT_GUIDANCE_MAX_BYTES = 750_000;

const jsonHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, content-type, mcp-protocol-version, mcp-session-id, x-mcp-auth-token, x-publish-key',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'mcp-session-id',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

const textContent = (text: string) => [{ type: 'text', text }];

const toNonEmptyString = (value: unknown) => {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getRecordValue = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const safeSecretsMatch = (provided: string, expected: string) => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
};

const getBearerToken = (authorization: string | undefined) => {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || undefined;
};

/**
 * The URL-borne shared token (W14 F9). Reason it exists: claude.ai's custom-
 * connector form takes a URL and OAuth credentials — there is NO field for a
 * static bearer or a custom header — so once F1 closed the fail-open gate,
 * every header-less client (Wolf's connector included) was locked out with no
 * way back in short of implementing an OAuth server. `?key=<token>` is the
 * standard workaround for exactly this shape of client and is what the other
 * Netlify-hosted MCP endpoints in this account already use.
 *
 * It is deliberately the WEAKEST of the three paths and is documented as such:
 * a URL query string is recorded by proxies, CDN access logs, and browser
 * history in a way an `Authorization` header is not. Any client that can send
 * headers should send headers. The value is compared with the same constant-
 * time `safeSecretsMatch` as the header paths, and is never logged — the
 * rejection diagnostic records only WHETHER a key was present.
 */
const getUrlKeyToken = (event: LambdaEvent) => {
  const params = event.queryStringParameters ?? {};

  return toNonEmptyString(params.key) ?? toNonEmptyString(params.mcp_key);
};

const hasValidNetlifyPublishSecret = (event: LambdaEvent) => {
  const expected = toNonEmptyString(process.env.PUBLISH_SECRET ?? process.env.NETLIFY_PUBLISH_SECRET);
  if (!expected) return false;

  const provided =
    toNonEmptyString(getHeader(event.headers, 'x-publish-key')) ??
    getBearerToken(getHeader(event.headers, 'authorization'));

  return Boolean(provided && safeSecretsMatch(provided, expected));
};

const parseJsonResponseBody = (bodyText: string | undefined) => {
  if (!bodyText) return {};

  try {
    return JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return { error: bodyText };
  }
};

const toolResult = (payload: Record<string, unknown>) => ({
  content: textContent(JSON.stringify(payload, null, 2)),
  structuredContent: payload,
});

const toolError = (message: string, payload: Record<string, unknown> = {}) => ({
  isError: true,
  content: textContent(message),
  structuredContent: { error: message, ...payload },
});

const stringSchema = (description?: string) => ({
  type: 'string',
  minLength: 1,
  ...(description ? { description } : {}),
});
const intSchema = (description?: string) => ({ type: 'integer', minimum: 0, ...(description ? { description } : {}) });
const nullableStringSchema = (description?: string) => ({
  anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
  ...(description ? { description } : {}),
});

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
  description?: string
): Record<string, unknown> => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required,
  additionalProperties: false,
});

const arraySchema = (items: Record<string, unknown>, description?: string) => ({
  type: 'array',
  items,
  ...(description ? { description } : {}),
});

const metadataBagSchema = (description: string) => ({
  type: 'object',
  description,
  properties: {},
  additionalProperties: true,
});
const artifactKindJsonSchema = (description?: string) => ({
  type: 'string',
  enum: [...artifactKindValues],
  ...(description ? { description } : {}),
});
const artifactEncodingJsonSchema = (description?: string) => ({
  type: 'string',
  enum: ['base64', 'binary'],
  ...(description ? { description } : {}),
});
const artifactMetadataJsonSchema = metadataBagSchema('Optional artifact metadata saved in the artifact reference.');
const artifactLabelJsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: artifactReferenceLimits.label,
  pattern: '^[^\\u0000-\\u001f\\u007f<>]+$',
  description: 'Optional safe human-readable artifact label saved in the ArtifactReference.',
};
const artifactTagsJsonSchema = {
  type: 'array',
  maxItems: artifactReferenceLimits.tags,
  items: {
    type: 'string',
    minLength: 1,
    maxLength: artifactReferenceLimits.tag,
    pattern: '^[^\\u0000-\\u001f\\u007f<>]+$',
  },
  description: 'Optional safe ArtifactReference tags for filtering or display.',
};
const expectedSizeBytesJsonSchema = intSchema(
  'Optional expected complete artifact byte size for upload integrity checks.'
);
const expectedSha256JsonSchema = {
  type: 'string',
  pattern: '^[a-fA-F0-9]{64}$',
  description: 'Optional expected complete artifact SHA-256 hex digest for upload integrity checks.',
};

const artifactUploadIntentInputSchema = () =>
  objectSchema(
    {
      requestId: stringSchema('Workflow request id that owns this artifact.'),
      artifactKind: artifactKindJsonSchema('Artifact kind for storage routing.'),
      contentType: stringSchema('Real MIME type of the artifact bytes, e.g. image/png or application/pdf.'),
      filename: {
        ...stringSchema('Optional original filename used for blob extension and ArtifactReference originalFilename.'),
        maxLength: artifactReferenceLimits.originalFilename,
      },
      expectedSizeBytes: expectedSizeBytesJsonSchema,
      expectedSha256: expectedSha256JsonSchema,
      label: artifactLabelJsonSchema,
      tags: artifactTagsJsonSchema,
    },
    ['requestId', 'artifactKind', 'contentType', 'expectedSizeBytes', 'expectedSha256']
  );

const artifactListLimitJsonSchema = {
  type: 'integer',
  minimum: 1,
  maximum: ARTIFACT_LIST_MAX_LIMIT,
  description: `Optional result limit; defaults to ${ARTIFACT_LIST_DEFAULT_LIMIT}, max ${ARTIFACT_LIST_MAX_LIMIT}.`,
};
const artifactListCursorJsonSchema = stringSchema(
  'Optional opaque pagination cursor returned by a previous list call.'
);
const artifactReconcileLimitJsonSchema = {
  type: 'integer',
  minimum: 1,
  maximum: ARTIFACT_LIST_MAX_LIMIT,
  description: `Optional maximum number of artifact-index JSON references to reconcile; defaults to ${ARTIFACT_LIST_DEFAULT_LIMIT}, max ${ARTIFACT_LIST_MAX_LIMIT}.`,
};
const artifactMigrationDryRunJsonSchema = {
  type: 'boolean',
  description: 'When true, report migration actions without writing artifact-index records or pointers.',
};

const wipeBlobDryRunJsonSchema = {
  type: 'boolean',
  default: true,
  description: 'When true or omitted, only count and sample matching blob keys without deleting them.',
};
const wipeBlobConfirmJsonSchema = stringSchema(
  `Required only for live deletion; must equal ${WIPE_BLOB_CONFIRMATION}.`
);
const wipeBlobPrefixesJsonSchema = arraySchema(
  { type: 'string', enum: ['workflows/', 'artifact-index/', ...artifactKindValues.map((kind) => `${kind}/`)] },
  'REQUIRED, non-empty — no default. The artifact prefixes (image/, pdf/, etc.) and artifact-index/ are ' +
    'shared with live CMS objects (a content_item article’s media lives at image/{objectRequestId}/{sha}.ext, ' +
    'indistinguishable by prefix from a legacy workflow record’s artifacts) — wiping them can delete live, ' +
    'published media. Pass exactly the prefixes you have verified are safe; workflows/ is the only prefix that ' +
    'is unambiguously legacy-only.'
);
const artifactIncludeDeletedJsonSchema = {
  type: 'boolean',
  description: 'When true, include soft-deleted artifact references. Defaults to false.',
};
const artifactDeletedByJsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: artifactReferenceLimits.label,
  pattern: '^[^ -<>]+$',
  description: 'Optional safe actor label recorded as deletedBy; defaults to the authenticated admin email or user id.',
};

const artifactSearchTagJsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: artifactReferenceLimits.tag,
  description: 'Optional tag to search via artifact-index/by-tag pointers.',
};
const isoDateStringSchema = (description: string) => ({
  type: 'string',
  format: 'date-time',
  description,
});

// ── Object-verb tool schemas (T0.9). Additive; the article tool schemas above
//    are untouched. ──
// Single source of truth: the envelope's object-type vocabulary (was a
// hand-copied literal that could drift from object-record-v1.ts).
const OBJECT_TYPE_VALUES = [...objectTypes];
const objectTypeEnumSchema = (description = 'CMS object type.') => ({
  type: 'string',
  enum: OBJECT_TYPE_VALUES,
  description,
});
const anyObjectSchema = (description: string) => ({ type: 'object', additionalProperties: true, description });
const patchOpsSchema = (description: string) =>
  arraySchema({ type: 'object', additionalProperties: true }, description);
// The M-6 publish-action pin (review-state.ts publishActionSchema): an ISO
// instant, the literal string 'immediate', or null (unpublish).
const publishActionInputSchema = (description: string) =>
  objectSchema(
    {
      published_time: {
        anyOf: [
          { type: 'string', minLength: 1, description: 'ISO 8601 instant, or the literal "immediate".' },
          { type: 'null', description: 'null pins an unpublish.' },
        ],
      },
    },
    ['published_time'],
    description
  );

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'deploy_status',
    description:
      'Read-only Netlify deploy receipt lookup by commit or deploy id. Besides the receipt, the response carries publishedDeploy (the deploy production is actually serving) and productionConfirmed (whether that published deploy matches the commit/deployId you asked about) whenever the site lookup is available. A deploy can be deployStatus:"ready" without being what production serves (locked Auto Publishing) — treat a release as live only when deployStatus is "ready" AND productionConfirmed is true. Absent publishedDeploy/productionConfirmed fields mean the published-deploy signal was unavailable (unknown), not "not live".',
    inputSchema: objectSchema({
      commit: stringSchema('Commit SHA to look up in saved Netlify deploy receipts.'),
      deployId: stringSchema('Netlify deploy id to look up in saved Netlify deploy receipts.'),
    }),
  },
  {
    name: 'verify_article_images',
    description:
      'Verify that a published article page contains the expected images and that each is fetchable as an image. DEPLOY-AWARE TIMING: pass the publish commit as "commit" and this tool correlates the check to that commit\'s Netlify deploy — image assertions run only once that deploy is confirmed "ready", and a page still served by a stale/previous deploy comes back inconclusive:true (deploy timing), never a false missing-image defect. deployReady:true in the response means the target deploy is live and the result is definitive. Without a commit it falls back to the legacy heuristic (poll deploy_status until deployStatus is "ready" yourself first; an immediate check may hit the previous deploy). A response with inconclusive:true means the deploy is probably not live yet — retry later; it is NOT a proven image defect. MATCHING: for LEGACY committed-asset articles pass the display paths from the publish response (e.g. ~/assets/images/uploads/{slug}/{file}.png) — Astro rewrites committed assets to hashed build URLs (/_astro/{file}.{hash}.{ext}), so matching falls back from exact URL to filename-stem. For OBJECT articles (content_item) pass the node media PUBLIC paths (/img/{id}/{sha256}.{ext}) — they appear verbatim as the rendered <img> src, and the object_publish response\'s production.article_path gives the page URL. Each result reports matchedUrl/matchedBy. Server-only publish credentials are never accepted as inputs or returned.',
    inputSchema: objectSchema(
      {
        url: stringSchema('Published article URL to fetch and inspect for <img> src/srcset sources.'),
        expectedImages: {
          type: 'array',
          items: stringSchema('Expected image URL, page-relative image path, or ~/assets display path.'),
          description:
            'Expected images that must appear in the article HTML. Display paths (~/assets/images/uploads/...) are matched by filename stem against Astro-hashed build URLs.',
        },
        commit: stringSchema(
          "Optional publish commit SHA. When set, the check waits for/correlates to that commit's Netlify deploy so a not-yet-live deploy returns inconclusive instead of a false missing-image defect. Use the commit_sha from the publish receipt."
        ),
        deployTimeoutSeconds: {
          type: 'integer',
          minimum: 0,
          maximum: 120,
          description:
            'Optional seconds to wait in-call for the target commit deploy to reach a terminal state. Default 0 = single-shot correlation (poll deploy_status yourself first). Capped so the call always returns.',
        },
        deployPollIntervalSeconds: {
          type: 'integer',
          minimum: 1,
          maximum: 30,
          description: 'Optional poll interval (seconds) used only when deployTimeoutSeconds > 0. Default 5.',
        },
      },
      ['url', 'expectedImages']
    ),
  },
  {
    name: 'trigger_netlify_build',
    description:
      "Manually trigger a Netlify build via the server-side build hook, without needing a new git commit. No input is required. This QUEUES a build asynchronously — it does not wait for the build to finish, so poll deploy_status afterward (the same way you already do after a normal publish) to know when the resulting deploy is actually ready. IMPORTANT — batch, do not spam: each triggered build consumes real Netlify build minutes, so use this to batch multiple publishes into a single build rather than triggering one build per publish. For example, after publishing several articles in a row, call this once at the end instead of calling it after every individual object_publish call. Optional reason is recorded only in this function's own server-side logs for traceability of who triggered a build and why — it is never sent to Netlify and never included in the response.",
    inputSchema: objectSchema({
      reason: stringSchema(
        "Optional free-text reason for triggering this build, recorded only in this function's own server logs for traceability. Never sent to Netlify."
      ),
    }),
  },
  {
    name: 'release_to_production',
    description:
      'Release accumulated CMS object exports to production. Object publishes commit to main with [skip netlify], so they do NOT deploy on their own — this is the explicit release that makes them live, and the ONLY thing that fires a production build for them. Steps: resolve the target commit (defaults to the content-branch HEAD, which includes every accumulated skipped export commit), POST the server-side production build hook ONCE (the same hook trigger_netlify_build uses; the only allowed production-build trigger), then poll Netlify deploy receipts until the deploy for that commit is terminal, and report whether production actually reflects it. Returns released:true only when the site\'s PUBLISHED deploy (what production actually serves) reflects the target commit — confirmed as productionConfirmed:true; released:false with status build_not_confirmed_live means the build did not finish within the wait budget (re-check deploy_status). status build_ready_not_published means the build IS ready but production still serves an older commit — Netlify "Auto Publishing" is likely locked; unlock it or publish the deploy manually, then re-check deploy_status. When the published-deploy lookup is unavailable, the tool degrades to ready-by-commit with productionConfirmed:false — treat that as "not independently proven live". WAIT BUDGET: the in-call wait is capped to this serverless function\'s remaining invocation time (seconds, not the full build duration), so a normal 30-120s production build usually returns build_not_confirmed_live on the first call — that is the expected flow, not an error. Do not retry release_to_production; poll deploy_status with the returned targetCommit until deployStatus is "ready" AND productionConfirmed is true. One release deploys every skipped commit at once, so batch publishes and release once — it consumes real build minutes.',
    inputSchema: objectSchema({
      commit: stringSchema(
        'Optional commit SHA the live production deploy must reflect. Defaults to the current content branch HEAD.'
      ),
      force_build: {
        type: 'boolean',
        description:
          'When true (default), POST the build hook to force a fresh production build before verifying. When false, only wait for and verify the deploy already triggered by the push.',
      },
      timeout_seconds: {
        type: 'integer',
        minimum: 1,
        description:
          'Optional maximum seconds to wait for the deploy to reach a terminal state before reporting back. Always additionally capped to the remaining serverless invocation budget so the call returns a structured receipt instead of being killed by the platform timeout.',
      },
    }),
  },
  {
    name: 'create_agent_artifact_job',
    description:
      "Create a pdf-tool artifact job through THIS site's trusted Platform bridge. Pass the owning site_id and content-item request_id; Platform resolves the canonical pdf-tool project, verifies request ownership, mints and forwards a fresh short-lived storage grant server-side, and never returns the grant. Do not call pdf-tool directly or guess projectId. The job is asynchronous: poll get_agent_artifact_job_status with the returned jobId; do not recreate it. For template-driven PDFs pass template_id + data (+ optional assets) instead of a prompt.",
    inputSchema: objectSchema(
      {
        site_id: stringSchema('Owning site object id, e.g. site_acme. Must match this deployment.'),
        request_id: stringSchema('Existing content_item object id that will own the artifact.'),
        artifact_kind: { type: 'string', enum: ['image', 'pdf'], description: 'Artifact kind.' },
        operation: { type: 'string', enum: ['generate', 'edit'], description: 'Defaults to generate.' },
        prompt: stringSchema('Generation prompt; required for image generation.'),
        filename: stringSchema('Output filename including the format-matching extension.'),
        slot: stringSchema('Stable request-scoped slot such as article_image_1.'),
        model: stringSchema('Optional explicit model; omit to use the registered project policy.'),
        requirements: anyObjectSchema(
          'pdf-tool requirements, e.g. {maxBytes, image:{outputFormat:"webp", size:"1536x1024", usageContext:"article_body"}}.'
        ),
        template_id: stringSchema('A published pdf_template id to render from, in place of prompt.'),
        data: anyObjectSchema('Template data payload for a template_id-driven PDF render.'),
        assets: anyObjectSchema('Optional supporting assets (e.g. {images: [...]}) for a template_id-driven PDF render.'),
      },
      ['site_id', 'request_id', 'artifact_kind', 'filename']
    ),
  },
  {
    name: 'get_agent_artifact_job_status',
    description:
      'Poll a job created through this Platform bridge. Platform re-validates site/request scope and injects the canonical project and a fresh grant. On completion it verifies materialization server-side and returns the canonical ArtifactReference plus public_path; neither the grant nor materialization proof is exposed. Poll this jobId instead of recreating the job.',
    inputSchema: objectSchema(
      {
        site_id: stringSchema('Owning site object id; must match this deployment.'),
        request_id: stringSchema('The same content_item request id used to create the job.'),
        job_id: stringSchema('Job id returned by create_agent_artifact_job.'),
      },
      ['site_id', 'request_id', 'job_id']
    ),
  },
  {
    name: 'get_agent_artifact_by_slot',
    description:
      'Retrieve and verify the canonical artifact for a request-scoped slot through the trusted Platform bridge. Site ownership, canonical project, storage grant, and materialization verification are handled server-side. Returns ArtifactReference + public_path with no grant or proof.',
    inputSchema: objectSchema(
      {
        site_id: stringSchema('Owning site object id; must match this deployment.'),
        request_id: stringSchema('Existing content_item request id.'),
        slot: stringSchema('The exact slot used when the job was created.'),
      },
      ['site_id', 'request_id', 'slot']
    ),
  },
  {
    name: 'create_pdf_template',
    description:
      "Create or version a pdf-tool PDF template for THIS site through the trusted Platform bridge. Platform resolves the canonical project and mints/forwards a short-lived storage grant server-side; never call pdf-tool directly or pass a grant. Draft only — call publish_pdf_template to activate. renderer is pinned for the template's life; pdfme publishes immediately, react-pdf/typst/chromium require a passed validation render first.",
    inputSchema: objectSchema(
      {
        site_id: stringSchema('Owning site object id, e.g. site_acme. Must match this deployment.'),
        template_json: anyObjectSchema('The pdf-tool template definition for the chosen renderer.'),
        renderer: {
          type: 'string',
          enum: ['pdfme', 'react-pdf', 'typst', 'chromium'],
          description: "Rendering engine, pinned for the template's life. Omit to default to pdfme.",
        },
        template_id: stringSchema('Optional existing template id to version instead of creating a new template.'),
        label: stringSchema('Optional human-readable label.'),
        tags: arraySchema({ type: 'string', minLength: 1 }, 'Optional list of tags.'),
      },
      ['site_id', 'template_json']
    ),
  },
  {
    name: 'list_pdf_templates',
    description:
      "List pdf-tool PDF templates for THIS site through the trusted Platform bridge. Site ownership, canonical project, and storage grant are resolved server-side.",
    inputSchema: objectSchema(
      {
        site_id: stringSchema('Owning site object id; must match this deployment.'),
        limit: intSchema('Optional page size.'),
        cursor: stringSchema('Optional pagination cursor from a previous list_pdf_templates call.'),
      },
      ['site_id']
    ),
  },
  {
    name: 'get_pdf_template',
    description:
      "Fetch a pdf-tool PDF template record for THIS site through the trusted Platform bridge.",
    inputSchema: objectSchema(
      {
        site_id: stringSchema('Owning site object id; must match this deployment.'),
        template_id: stringSchema('The template object id.'),
        version: intSchema('Optional specific version; omit for the active version.'),
      },
      ['site_id', 'template_id']
    ),
  },
  {
    name: 'publish_pdf_template',
    description:
      'Publish (activate) a pdf-tool PDF template version for THIS site through the trusted Platform bridge. react-pdf/typst/chromium templates require a passed validation report first (surfaced verbatim as HTTP 409 TEMPLATE_VALIDATION_REQUIRED otherwise); pdfme publishes immediately.',
    inputSchema: objectSchema(
      {
        site_id: stringSchema('Owning site object id; must match this deployment.'),
        template_id: stringSchema('The template object id to publish.'),
        version: intSchema('Optional specific version to publish; omit for the latest draft version.'),
      },
      ['site_id', 'template_id']
    ),
  },
  {
    name: 'delete_pdf_template',
    description:
      "Deactivate a pdf-tool PDF template for THIS site through the trusted Platform bridge. This is a soft, reversible deactivation (status -> disabled), NOT a hard delete: the underlying template data and stored bytes are preserved. A disabled template is hidden from list_pdf_templates by default, and is blocked from publish_pdf_template and from rendering (create_agent_artifact_job) until reactivated. Deactivating an already-disabled template succeeds without error (idempotent).",
    inputSchema: objectSchema(
      {
        site_id: stringSchema('Owning site object id; must match this deployment.'),
        template_id: stringSchema('The template object id to deactivate.'),
        version: intSchema('Optional specific version to deactivate; omit for the latest/active version.'),
        reason: stringSchema('Optional human-readable reason for deactivation, forwarded to pdf-tool.'),
      },
      ['site_id', 'template_id']
    ),
  },
  {
    name: 'create_artifact_upload_intent',
    description:
      'Create a short-lived scoped direct artifact upload intent. New clients should call this tool first, then upload raw bytes with HTTP POST application/octet-stream to /api/artifacts/upload using the returned requiredHeaders. Keeps binary bytes out of MCP arguments and returns no server secrets other than the scoped upload token. Accepted image formats: JPEG, PNG, WebP only — the upload decodes the bytes and rejects GIF, AVIF, SVG, and anything that does not decode as the declared type. PDF uploads must start with %PDF-.',
    inputSchema: artifactUploadIntentInputSchema(),
  },
  {
    name: 'create_artifact_from_url',
    description:
      'Fallback tool to ingest an artifact from a public HTTPS URL. Use this when the MCP client cannot perform a direct HTTP POST of binary bytes. The server fetches the URL, verifies expectedSizeBytes/expectedSha256 against the fetched bytes, and saves it as a request artifact. Accepted image formats: JPEG, PNG, WebP only (GIF, AVIF, and SVG are rejected); PDF bytes must start with %PDF-.',
    inputSchema: objectSchema(
      {
        requestId: stringSchema('Workflow request id that owns this artifact.'),
        artifactKind: artifactKindJsonSchema('Artifact kind for storage routing.'),
        contentType: stringSchema('MIME type of the artifact bytes.'),
        sourceUrl: stringSchema('Public HTTPS URL of the artifact to fetch.'),
        expectedSizeBytes: expectedSizeBytesJsonSchema,
        expectedSha256: expectedSha256JsonSchema,
        filename: {
          ...stringSchema('Optional original filename used for blob extension and ArtifactReference originalFilename.'),
          maxLength: artifactReferenceLimits.originalFilename,
        },
        label: artifactLabelJsonSchema,
        tags: artifactTagsJsonSchema,
        metadata: artifactMetadataJsonSchema,
      },
      ['requestId', 'artifactKind', 'contentType', 'sourceUrl', 'expectedSizeBytes', 'expectedSha256']
    ),
  },
  {
    name: 'save_artifact',
    description: `Legacy small-artifact single-shot byte upload. Required: requestId, artifactKind, contentType, payload. Store only the returned ArtifactReference; never invent blobKey values, URLs, or repo paths. Generated binary files/images should use create_artifact_upload_intent plus raw HTTP POST /api/artifacts/upload. Writes final artifact bytes and an ArtifactReference index for the request. Accepted image formats: JPEG, PNG, WebP only (GIF, AVIF, and SVG are rejected); PDF bytes must start with %PDF-. Returns artifact, complete=true, deduped; dedup is success and skips rewriting bytes.`,
    inputSchema: objectSchema(
      {
        requestId: stringSchema('Workflow request id that owns this artifact.'),
        artifactKind: artifactKindJsonSchema('Artifact kind for storage routing.'),
        contentType: stringSchema('MIME type for the artifact bytes.'),
        filename: {
          ...stringSchema('Optional original filename used for blob extension and ArtifactReference originalFilename.'),
          maxLength: artifactReferenceLimits.originalFilename,
        },
        encoding: artifactEncodingJsonSchema('Payload encoding; defaults to base64.'),
        expectedSizeBytes: expectedSizeBytesJsonSchema,
        expectedSha256: expectedSha256JsonSchema,
        localSizeBytes: expectedSizeBytesJsonSchema,
        localSha256: expectedSha256JsonSchema,
        payload: stringSchema(
          `Artifact bytes as base64 unless encoding is binary. Preferred for normal web images up to ${SINGLE_SHOT_ARTIFACT_GUIDANCE_MAX_BYTES} raw bytes; do not chunk merely because an image is around 50 KB.`
        ),
        label: artifactLabelJsonSchema,
        tags: artifactTagsJsonSchema,
        metadata: artifactMetadataJsonSchema,
      },
      ['requestId', 'artifactKind', 'contentType', 'payload']
    ),
  },
  {
    name: 'list_artifacts_for_request',
    description: `List ArtifactReference metadata for a requestId. Required: requestId. Reads the request artifact index only; it does not read or write artifact bytes. Soft-deleted artifacts are excluded — an artifact you uploaded but cannot see here has been deleted (use get_artifact_metadata to inspect it). Returns artifacts array. ${mediaPortabilityWarning}`,
    inputSchema: objectSchema(
      { requestId: stringSchema('Workflow request id whose artifact references should be listed.') },
      ['requestId']
    ),
  },
  {
    name: 'get_artifact_metadata',
    description:
      'Get full ArtifactReference metadata for a requestId and sha256. Does not read artifact bytes. Unlike list_artifacts_for_request, this also returns soft-deleted references — check for a deletedAtISO field; a reference carrying it is excluded from listing, trust checks, and publish until restored.',
    inputSchema: objectSchema(
      {
        requestId: stringSchema('Workflow request id that owns the artifact.'),
        sha256: expectedSha256JsonSchema,
      },
      ['requestId', 'sha256']
    ),
  },
  {
    name: 'list_artifacts_by_kind',
    description:
      'Admin-only artifact browser. Lists artifacts via artifact-index/by-kind/{artifactKind}/ pointers and resolves them to ArtifactReference objects. Does not read artifact bytes.',
    inputSchema: objectSchema(
      {
        artifactKind: artifactKindJsonSchema('Artifact kind pointer prefix to browse.'),
        limit: artifactListLimitJsonSchema,
        cursor: artifactListCursorJsonSchema,
        includeDeleted: artifactIncludeDeletedJsonSchema,
      },
      ['artifactKind']
    ),
  },
  {
    name: 'list_artifacts_by_request',
    description:
      'Admin-only artifact browser. Lists artifacts via artifact-index/by-request/{requestId}/ pointers, optionally scoped by artifactKind, and resolves them to ArtifactReference objects. Does not read artifact bytes.',
    inputSchema: objectSchema(
      {
        requestId: stringSchema('Workflow request id to browse artifacts for.'),
        artifactKind: artifactKindJsonSchema('Optional artifact kind pointer prefix within the request.'),
        limit: artifactListLimitJsonSchema,
        cursor: artifactListCursorJsonSchema,
        includeDeleted: artifactIncludeDeletedJsonSchema,
      },
      ['requestId']
    ),
  },
  {
    name: 'search_artifacts',
    description:
      'Admin-only artifact search using prefix indexes, not full text search. With tag, lists artifact-index/by-tag/{tag}/ pointers; without tag, lists by-kind pointer prefixes. Optional createdAfter/createdBefore filters are applied after resolving ArtifactReference objects. Does not read artifact bytes.',
    inputSchema: objectSchema({
      tag: artifactSearchTagJsonSchema,
      createdAfter: isoDateStringSchema('Optional inclusive lower createdAtISO bound.'),
      createdBefore: isoDateStringSchema('Optional inclusive upper createdAtISO bound.'),
      limit: artifactListLimitJsonSchema,
      cursor: artifactListCursorJsonSchema,
      includeDeleted: artifactIncludeDeletedJsonSchema,
    }),
  },
  {
    name: 'soft_delete_artifact',
    description:
      'Admin-only soft delete for an ArtifactReference. Marks request-artifacts/{requestId}/{sha256}.json with deletedAtISO/deletedBy and leaves binary artifact bytes in place.',
    inputSchema: objectSchema(
      {
        requestId: stringSchema('Workflow request id that owns the artifact reference.'),
        sha256: expectedSha256JsonSchema,
        deletedBy: artifactDeletedByJsonSchema,
      },
      ['requestId', 'sha256']
    ),
  },
  {
    name: 'restore_artifact',
    description:
      'Admin-only restore for a soft-deleted ArtifactReference. Clears deletedAtISO/deletedBy on request-artifacts/{requestId}/{sha256}.json and keeps existing blob bytes untouched.',
    inputSchema: objectSchema(
      {
        requestId: stringSchema('Workflow request id that owns the artifact reference.'),
        sha256: expectedSha256JsonSchema,
      },
      ['requestId', 'sha256']
    ),
  },
  {
    name: 'migrate_artifact_indexes',
    description:
      'Admin-only one-time artifact-index migration. Scans request-artifacts/{requestId}/{sha256}.json, fills missing artifactKind/originalFilename/label fields, writes by-kind and by-request pointers, and returns cursor checkpoints for large idempotent batches.',
    inputSchema: objectSchema({
      cursor: artifactListCursorJsonSchema,
      limit: artifactReconcileLimitJsonSchema,
      dryRun: artifactMigrationDryRunJsonSchema,
    }),
  },
  {
    name: 'wipe_blob_stores',
    description:
      'Admin-only MCP maintenance tool protected by server publish-key headers. Dry-runs by default; live mode ' +
      'deletes ONLY the prefixes you explicitly pass — there is no default-to-everything mode. prefixes is ' +
      'required and non-empty on every call, dry run included, so a caller can never wipe more than it verified ' +
      'it meant to. See prefixes for which ones are safe to wipe unconditionally vs. which are shared with live ' +
      'CMS object data and need a cross-reference first.',
    inputSchema: objectSchema(
      {
        dryRun: wipeBlobDryRunJsonSchema,
        confirm: wipeBlobConfirmJsonSchema,
        prefixes: wipeBlobPrefixesJsonSchema,
      },
      ['prefixes']
    ),
  },
  {
    name: 'reconcile_artifact_indexes',
    description:
      'Admin-only artifact-index correction job. Reads request-artifacts JSON references, normalizes blobKeys, checks artifact bytes, corrects stale artifact-index blobKey values when a single matching blob is found, and returns compact correction diagnostics.',
    inputSchema: objectSchema({
      requestId: stringSchema('Optional workflow request id to reconcile; omit to scan request-artifacts by prefix.'),
      artifactKind: artifactKindJsonSchema('Optional artifact kind to reconcile after reading request-artifacts JSON.'),
      limit: artifactReconcileLimitJsonSchema,
    }),
  },
  {
    name: 'ping',
    description: 'Diagnostic tool that confirms the MCP server is reachable.',
    inputSchema: objectSchema({}),
  },

  // ── Object verbs (T0.9): the generic CMS object store. Each proxies to
  //    netlify/functions/object-store.ts with the publish key injected
  //    server-side (the A§1.8 pattern). Purely additive — the article tools
  //    above are unchanged. Submit/publish/review arrive in P1. ──
  {
    name: 'object_get',
    description: 'Fetch a CMS object record (current draft state) by type and id from the site-objects store.',
    inputSchema: objectSchema(
      { object_type: objectTypeEnumSchema(), object_id: stringSchema('The object id, e.g. page_home.') },
      ['object_type', 'object_id']
    ),
  },
  {
    name: 'object_list',
    description: 'List CMS object summaries for a type, optionally filtered by status (active | archived).',
    inputSchema: objectSchema(
      {
        object_type: objectTypeEnumSchema(),
        status: { type: 'string', enum: ['active', 'archived'], description: 'Optional status filter.' },
      },
      ['object_type']
    ),
  },
  {
    name: 'object_create',
    description:
      'Create a CMS object from object_type, site, and the per-type body. requested_id is optional — omit it to have a valid id minted server-side. For recipe types (template / section_template / theme): REUSE FIRST — object_inventory lists existing recipes with self-describing summaries; create only when none fits, and include description/whenToUse/scope (required to publish). Creation may be restricted per type by the committed creation policy — check object_contract(<type>).creation_policy; a denial is a 403 with code creation_restricted. content_item (articles) is creatable since W7.3: the body is the annotated node list (per-node private.strategy/intent — hook/agitation/resolution etc. — plus commercial/rendering/chat metadata) with plain-text or rich_text.v1 node bodies; read object_contract("content_item") first. Committed legacy posts stay on the old article tools. tracking_config (W13) is the per-site tracker-registry SINGLETON: creation is human/seed-only and a second active registry is refused (409) — read object_contract("tracking_config") and edit the existing trk_* object instead.',
    inputSchema: objectSchema(
      {
        object_type: objectTypeEnumSchema(),
        site: stringSchema('Owning site object id, e.g. site_acme.'),
        body: anyObjectSchema('The per-type object body; validated server-side against the T0.2 schema.'),
        requested_id: stringSchema('Optional explicit object id; a valid id is minted from the body when omitted.'),
        agent_name: stringSchema('Optional self-declared agent name recorded on history (attribution only).'),
      },
      ['object_type', 'site', 'body']
    ),
  },
  {
    name: 'object_instantiate_template',
    description:
      "Create a new page FROM a template recipe (design rule 5: templates are recipes; PageTypes are law). Deep-copies the template's slot blueprints into a fresh page body in slot order (a required slot without a blueprint falls back to the registry defaultData of its first allowed type; an optional slot without one is skipped), stamps page.template provenance ({ref, instantiated_at} — pages never live-inherit from templates), and routes the result through the SAME create validation as object_create (route uniqueness, PageType law, reference integrity). The template must exist (draft is fine); page_type defaults to the template's first appliesTo entry. Pass dry_run: true to preview the built body, the would-be object id, id availability, and full validation without persisting anything.",
    inputSchema: objectSchema(
      {
        template_id: stringSchema('The template object id, e.g. tpl_interior.'),
        site: stringSchema('Owning site object id, e.g. site_acme.'),
        route: stringSchema("The new page's route, e.g. /pricing — must be unique across pages."),
        title: stringSchema("The new page's reader-facing title."),
        page_type: {
          type: 'string',
          enum: [...pageTypeIds],
          description: "Optional PageType for the new page; defaults to the template's first appliesTo entry.",
        },
        seo: anyObjectSchema('Optional seo object ({title?, description?, ogImage?, robots?}); defaults to {}.'),
        requested_id: stringSchema('Optional explicit page id; a valid id is minted from the route when omitted.'),
        dry_run: {
          type: 'boolean',
          description: 'true → return the built body, would-be id, id availability, and validation; persist nothing.',
        },
        agent_name: stringSchema('Optional self-declared agent name recorded on history (attribution only).'),
      },
      ['template_id', 'site', 'route', 'title']
    ),
  },
  {
    name: 'object_instantiate_section_template',
    description:
      'Stamp a section-template recipe (W8): deep-copies the recipe\'s blueprint with a freshly minted s_* section id into an existing page — as ONE upsert_section through the standard patch path, so PageType law, the leaf rule, and reference integrity all gate it — or mints a standalone shared sec_* object through the standard create path. Page mode requires YOUR current page checkout (lock_token + expected_record_version; the verb never auto-checkouts). Stamped sections never live-inherit from the recipe (editing the recipe changes future stamps only). Pass dry_run: true to preview the exact op (page mode) or the would-be object (standalone mode) plus full validation without persisting; page-mode dry_run needs neither lock_token nor expected_record_version. The stamped section id is deterministic in (recipe, page, expected_record_version) — after a lost response / 409, dry_run with your ORIGINAL expected_record_version and object_get the page: if that section_id is already present, the first stamp landed. Read object_contract("section_template") first.',
    inputSchema: objectSchema(
      {
        section_template_id: stringSchema('The section-template object id, e.g. stpl_hero_landing.'),
        target: anyObjectSchema(
          'Where to stamp: {kind:"page", page_id, position?, lock_token, expected_record_version} (insert into a page you hold the checkout for; position clamped, appended when omitted) OR {kind:"standalone", requested_id?} (mint a new shared sec_* object; a valid id is minted from the recipe name when omitted).'
        ),
        dry_run: {
