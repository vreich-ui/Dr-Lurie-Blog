import { randomUUID, timingSafeEqual } from 'node:crypto';

import { handler as saveArtifactHandler } from './save-artifact.js';
import { handler as saveJsonBlobHandler, type WorkflowRecord } from './save-json-blob.js';
import { handler as objectStoreHandler } from './object-store.js';
import { handler as publishArticleHandler } from './publish-article.js';
import { handler as deployStatusHandler } from './deploy-status.js';
import { handler as verifyArticleImagesHandler } from './verify-article-images.js';
import {
  isNetlifyBuildHookConfigured,
  NetlifyBuildHookTriggerError,
  triggerNetlifyBuild,
} from '../lib/netlify-deploys.js';
import { releaseToProduction } from '../lib/production-release.js';
import { buildPdfToolStorageGrant } from '../lib/pdf-tool-storage-grant.js';
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
import { allowedAgentNames, workflowStatuses } from '../../src/schema/workflow-contract.js';
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
import { validateFilename, validateRequestId } from '../../src/lib/agents-naming.js';
import { getSiteIdentity } from '../../src/lib/site-identity.js';
import {
  listPageTypeDefinitions,
  pageTypeDefinitionJsonSchema,
  unimplementedPageTypeIds,
} from '../../src/lib/registry/page-types.js';
import {
  buildObjectContract,
  listSectionTypeContracts,
  OBJECT_CONTRACT_TYPES,
} from '../../src/lib/registry/object-contract.js';
import { objectTypes, type ObjectType } from '../../src/schema/object-record-v1.js';
import { pageTypeIds } from '../../src/schema/bodies/page-v1.js';

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
const ALLOWED_AGENTS = allowedAgentNames;
const ALLOWED_AGENT_SET = new Set<string>(ALLOWED_AGENTS);
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

const sanitizeWorkflowLock = (lock: unknown) => {
  if (!lock || typeof lock !== 'object') return undefined;

  const record = lock as Record<string, unknown>;
  return {
    owner_id: record.owner_id,
    owner_label: record.owner_label,
    acquired_at: record.acquired_at,
    expires_at: record.expires_at,
  };
};

const sanitizeWorkflowErrorPayload = (payload: Record<string, unknown>) => {
  const sanitized: Record<string, unknown> = { ...payload };
  const lock = sanitizeWorkflowLock(payload.lock);
  if (lock) sanitized.lock = lock;
  return sanitized;
};

const agentList = () => ALLOWED_AGENTS.join('|');

const workflowLockInstruction =
  'Agents must call checkout first to acquire a lock_token, then patch output with that lock_token, then mark complete with that lock_token, then check in when done or refresh the lock before it expires as needed.';

const STAGE_TRANSITIONS: Record<
  (typeof ALLOWED_AGENTS)[number],
  { nextAgent: string | null; workflowStatus?: string }
> = {
  reader_insight: { nextAgent: 'research' },
  research: { nextAgent: 'angle' },
  angle: { nextAgent: 'draft' },
  draft: { nextAgent: 'final_article' },
  final_article: { nextAgent: null, workflowStatus: 'completed' },
};

const stageTransitionDescription = (agentName: (typeof ALLOWED_AGENTS)[number]) => {
  const transition = STAGE_TRANSITIONS[agentName];
  const nextAgent = transition.nextAgent === null ? 'null' : transition.nextAgent;
  const workflowStatus = transition.workflowStatus ? ` with workflow_status: "${transition.workflowStatus}"` : '';

  return `Common transition: ${agentName} → ${nextAgent}${workflowStatus}.`;
};

const normalizeAgentName = (value: unknown, fieldName: string) => {
  if (value === null || value === undefined) return value;

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be one of ${agentList()}.`);
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (!ALLOWED_AGENT_SET.has(normalized)) {
    throw new Error(`${fieldName} must be one of ${agentList()}.`);
  }

  return normalized;
};

const normalizeOptionalAgentName = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null) return value;

  return normalizeAgentName(value, fieldName);
};

const missingRequestIdError = () =>
  toolError(
    'request_id is required and is not auto-generated. Supply a request_id matching req_<flow>_<topic>_<yyyymmdd>_<nn> (lowercase snake_case), e.g. req_publish_drlurie_20260703_01.',
    { error_code: 'missing_request_id' }
  );

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
const constStringSchema = (value: string, description?: string) => ({
  type: 'string',
  const: value,
  ...(description ? { description } : {}),
});

const lockTokenSchema = stringSchema(
  'Lock token returned by checkout_request; required for mutating workflow records.'
);
const ownerIdSchema = stringSchema('Stable owner id for the agent or process acquiring the workflow lock.');
const ownerLabelSchema = stringSchema(
  'Human-readable owner label for the agent or process acquiring the workflow lock.'
);
const leaseSecondsSchema = {
  type: 'integer',
  minimum: 1,
  description: 'Optional lock lease duration in seconds; backend default applies when omitted.',
};

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

const stringArraySchema = (description?: string) => arraySchema({ type: 'string' }, description);
const metadataBagSchema = (description: string) => ({
  type: 'object',
  description,
  properties: {},
  additionalProperties: true,
});
const agentNameJsonSchema = (description?: string) => ({
  type: 'string',
  enum: ALLOWED_AGENTS,
  ...(description ? { description } : {}),
});
const nullableAgentNameJsonSchema = (description?: string) => ({
  anyOf: [{ type: 'string', enum: ALLOWED_AGENTS }, { type: 'null' }],
  ...(description ? { description } : {}),
});
const workflowStatusJsonSchema = (description?: string) => ({
  type: 'string',
  enum: workflowStatuses,
  ...(description ? { description } : {}),
});
const adminPublishValidationModeSchema = {
  type: 'string',
  enum: ['admin_publish_draft'],
  description:
    'Required validation mode for MCP-created admin-publish article drafts. Use content.article_body with schema_version article_body.v1 and at least one reader-visible public node.',
};

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
  'Optional logical prefixes to wipe. Defaults to all app-managed prefixes.'
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

const articleBodyNodeJsonSchema = objectSchema(
  {
    id: stringSchema('Stable opaque node id starting with n_; do not include strategy or commercial keywords.'),
    kind: { type: 'string', enum: ['content', 'action', 'placement', 'interactive'] },
    public: objectSchema(
      {
        eyebrow: stringSchema('Visible eyebrow text.'),
        title: stringSchema('Visible node title.'),
        body: stringSchema('Visible Markdown-capable body copy.'),
        items: stringArraySchema('Visible list items.'),
        ctaText: stringSchema('Visible CTA text.'),
        ctaLink: stringSchema('Visible CTA URL.'),
        label: stringSchema('Visible label.'),
        media: objectSchema({
          type: {
            type: 'string',
            enum: ['image', 'video', 'audio', 'embed', 'document'],
            description:
              "Media kind. Use 'image' for pictures and 'document' for PDFs; document media renders as a link, not an image.",
          },
          title: stringSchema('Visible media title; used as link text for document media.'),
          contentType: stringSchema('Optional MIME type of the media bytes, e.g. image/png or application/pdf.'),
          src: stringSchema(
            'Media source. For images this MUST be an artifact pointer (image/{requestId}/{sha256}.{ext}) from an uploaded artifact — plain https:// URLs and data: URIs are rejected for image media. For documents use the PDF artifact blobKey (pdf/{requestId}/{sha256}.pdf).'
          ),
          alt: stringSchema('Accessible visible alt text.'),
          caption: stringSchema('Visible media caption.'),
        }),
      },
      [],
      'Reader-visible node fields. Use these for visible copy.'
    ),
    private: metadataBagSchema(
      'Internal-only strategy metadata for agents/editors. Never use node.private as reader-visible copy.'
    ),
    commercial: metadataBagSchema('Optional commercial metadata, disclosures, destinations, and offer details.'),
    chat: objectSchema({
      invitationText: stringSchema('Visible chat invitation text.'),
      suggestedQuery: stringSchema('Suggested chat query.'),
    }),
    rendering: metadataBagSchema(
      "Rendering hints controlling placement and presentation. REQUIRED if this node carries public.media: set placement to 'inline' so the image/media renders inside the article body. Without an explicit placement, a node image is NOT rendered in the published article body (the publish still succeeds, but the response includes an image_not_rendered warning). Valid placement values: 'inline', 'section', 'sidebar', 'afterParagraph', 'footer' (only 'inline' renders media in the body today). For the page hero image, give the node id 'n_hero' and reference the same artifact as the publish featuredImage — the hero image is emitted to the frontmatter image field, not the body, and needs no placement."
    ),
    visibility: { type: 'string', enum: ['public', 'internal', 'hidden'] },
  },
  ['id', 'kind', 'public'],
  'One article_body.v1 node. Minimum useful article bodies include at least one public node with reader-facing public fields.'
);

const articleBodyV1JsonSchema = objectSchema(
  {
    schema_version: constStringSchema('article_body.v1'),
    nodes: arraySchema(
      articleBodyNodeJsonSchema,
      'Structured article nodes. Minimum required body is one node; at least one node must be public or omit visibility.'
    ),
    chat: metadataBagSchema('Optional article-level chat configuration.'),
    defaults: metadataBagSchema('Optional article-level rendering/default metadata.'),
    metadata: metadataBagSchema('Optional article-level metadata.'),
  },
  ['schema_version', 'nodes'],
  'Canonical structured article body for admin-publish drafts. Use content.article_body.schema_version = "article_body.v1" and content.article_body.nodes[].'
);

const contentBlockJsonSchema = objectSchema(
  {
    block_id: stringSchema('Stable block identifier.'),
    block_type: stringSchema('Block kind such as markdown, image, cta, or quiz.'),
    payload: { description: 'Block payload for the declared block_type; use metadata bags for non-contract fields.' },
    section_id: stringSchema('Optional section id this block belongs to.'),
  },
  ['block_id', 'block_type']
);

const claimJsonSchema = objectSchema(
  {
    claim_id: stringSchema('Stable claim identifier.'),
    claim_text: stringSchema('Verifiable claim text to fact-check or preserve.'),
    claim_type: stringSchema('Claim category such as factual, medical, product, or comparative.'),
    source_ids: stringArraySchema('Source ids that support or contextualize the claim.'),
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Agent confidence from 0 to 1.' },
    status: stringSchema('Review status such as proposed, verified, needs_source, or rejected.'),
    metadata: metadataBagSchema('Optional claim-specific extension data.'),
  },
  ['claim_text']
);

const complianceRequirementJsonSchema = objectSchema(
  {
    requirement_id: stringSchema('Stable compliance requirement identifier.'),
    category: stringSchema('Requirement category such as medical_claim, disclosure, source_quality, or privacy.'),
    description: stringSchema('Plain-language compliance requirement.'),
    status: stringSchema('Compliance status such as pending, satisfied, needs_review, or blocked.'),
    related_claim_ids: stringArraySchema('Claim ids this requirement applies to.'),
    notes: stringSchema('Reviewer or agent notes.'),
    metadata: metadataBagSchema('Optional compliance-specific extension data.'),
  },
  ['category', 'description']
);

const commercialOfferJsonSchema = objectSchema(
  {
    offer_id: stringSchema('Stable offer identifier.'),
    name: stringSchema('Offer or product name.'),
    url: stringSchema('Destination URL for the offer.'),
    cta_text: stringSchema('CTA text associated with the offer.'),
    disclosure: stringSchema('Commercial disclosure text.'),
    placement: stringSchema('Suggested article placement or section id.'),
    metadata: metadataBagSchema('Optional offer-specific extension data.'),
  },
  ['name']
);

const imagePromptJsonSchema = objectSchema(
  {
    prompt_id: stringSchema('Stable image prompt identifier.'),
    prompt: stringSchema('Image-generation prompt text.'),
    purpose: stringSchema('Use case such as hero, inline, diagram, or social.'),
    status: stringSchema('Prompt status such as proposed, approved, generated, or rejected.'),
    metadata: metadataBagSchema('Optional prompt-specific extension data.'),
  },
  ['prompt_id', 'prompt']
);

const imageAssetJsonSchema = objectSchema(
  {
    asset_id: stringSchema('Stable image asset identifier.'),
    source: stringSchema('Asset source such as upload, generated, remote, or existing_repo.'),
    url: stringSchema('Public or remote image URL when available.'),
    repoPath: stringSchema('Repository path for publishable image assets.'),
    alt: stringSchema('Accessible alt text.'),
    caption: stringSchema('Optional display caption.'),
    prompt_id: stringSchema('Image prompt id that produced this asset, if applicable.'),
    status: stringSchema('Asset status such as proposed, approved, uploaded, or rejected.'),
    metadata: metadataBagSchema('Optional asset-specific extension data.'),
  },
  ['asset_id']
);

const revisionRequestJsonSchema = objectSchema(
  {
    request_id: stringSchema('Stable revision request identifier.'),
    requested_by_agent: agentNameJsonSchema('Agent requesting the revision.'),
    target_section_id: stringSchema('Target content section id, if the request is section-specific.'),
    priority: stringSchema('Priority such as low, normal, high, or blocking.'),
    instruction: stringSchema('Concrete revision instruction.'),
    status: stringSchema('Revision status such as open, accepted, rejected, or resolved.'),
    metadata: metadataBagSchema('Optional revision-specific extension data.'),
  },
  ['request_id', 'instruction']
);

const contentSourceV1JsonSchema = objectSchema(
  {
    record_type: constStringSchema('content_source', 'Required discriminator for workflow content-source records.'),
    schema_version: constStringSchema('content_source.v1', 'Required schema version discriminator.'),
    ids: objectSchema({
      content_id: stringSchema('Stable content id.'),
      publication_id: stringSchema('Publication id.'),
      source_version_id: stringSchema('Source version id.'),
      parent_content_id: nullableStringSchema('Parent content id, if this record derives from another content item.'),
      workflow_id: stringSchema('Workflow id associated with this content source.'),
    }),
    publication_context: objectSchema({
      publication_name: stringSchema('Publication name.'),
      domain: stringSchema('Publication domain.'),
      topic_scope: stringSchema('Topic scope or editorial lane.'),
    }),
    content: objectSchema({
      schema_version: constStringSchema('content_blocks.v1'),
      title: stringSchema('Working or final article title agents should use for the content source.'),
      deck: stringSchema('Short deck or subtitle.'),
      description: stringSchema('Brief content description.'),
      structure: objectSchema({
        schema_version: constStringSchema('content_structure.v1'),
        sections: arraySchema(
          objectSchema(
            {
              section_id: stringSchema('Stable section identifier.'),
              role: stringSchema('Section role, such as intro, body, or conclusion.'),
              name: stringSchema('Human-readable section name.'),
              block_refs: stringArraySchema('Block ids included in this section.'),
            },
            ['section_id']
          )
        ),
      }),
      article_body: articleBodyV1JsonSchema,
      blocks: arraySchema(
        contentBlockJsonSchema,
        'Non-publishing structured content blocks. Publishing uses only content.article_body.'
      ),
    }),
    taxonomy: objectSchema({
      schema_version: constStringSchema('taxonomy.v1'),
      tags: stringArraySchema('Taxonomy tags.'),
    }),
    seo: objectSchema({
      schema_version: constStringSchema('seo.v1'),
      meta_title: stringSchema('SEO meta title.'),
      meta_description: stringSchema('SEO meta description.'),
      canonical_url: stringSchema('Canonical URL.'),
    }),
    media: objectSchema({
      schema_version: constStringSchema('media.v1'),
      visual_strategy: objectSchema({
        primary_image_goal: stringSchema('Primary image goal for the article.'),
        tone: stringSchema('Visual tone or art direction.'),
        constraints: stringArraySchema('Visual constraints agents should honor.'),
        metadata: metadataBagSchema('Optional visual-strategy extension data.'),
      }),
      image_prompt_register: {
        type: 'object',
        description: 'Agent-generated image prompts keyed by prompt id.',
        additionalProperties: imagePromptJsonSchema,
      },
      image_generation_runs: arraySchema(
        objectSchema({
          run_id: stringSchema('Stable generation run identifier.'),
          prompt_id: stringSchema('Prompt id used for this run.'),
          provider: stringSchema('Generation provider or tool.'),
          status: stringSchema('Generation status.'),
          asset_ids: stringArraySchema('Image asset ids produced by this run.'),
          metadata: metadataBagSchema('Optional generation-run extension data.'),
        }),
        'Image generation run records.'
      ),
      image_asset_register: arraySchema(imageAssetJsonSchema, 'Concrete image asset records.'),
      image_sets: arraySchema(
        objectSchema({
          set_id: stringSchema('Stable image set identifier.'),
          purpose: stringSchema('Image set purpose such as article, social, or thumbnail.'),
          asset_ids: stringArraySchema('Assets included in this set.'),
          metadata: metadataBagSchema('Optional image-set extension data.'),
        }),
        'Image set records.'
      ),
      media_revision_summary: objectSchema({
        summary: stringSchema('Summary of media revisions.'),
        resolved_request_ids: stringArraySchema('Revision request ids resolved by this media pass.'),
        metadata: metadataBagSchema('Optional media-revision extension data.'),
      }),
    }),
    editorial: objectSchema({
      schema_version: constStringSchema('editorial.v1'),
      writer_notes: stringSchema('Notes for writers and editors.'),
    }),
    sources: objectSchema({
      schema_version: constStringSchema('sources.v1'),
      source_list: arraySchema(
        objectSchema(
          {
            source_id: stringSchema('Stable source id.'),
            name: stringSchema('Source name.'),
            url: stringSchema('Source URL.'),
            publisher: stringSchema('Source publisher.'),
            accessed_at: stringSchema('Access timestamp.'),
          },
          ['name', 'url']
        ),
        'Cited sources.'
      ),
    }),
    claims: objectSchema({
      schema_version: constStringSchema('claims.v1'),
      claim_list: arraySchema(claimJsonSchema, 'Fact claims extracted or checked by agents.'),
      metadata: metadataBagSchema('Optional claims-section extension data.'),
    }),
    compliance: objectSchema({
      schema_version: constStringSchema('compliance.v1'),
      requirements: arraySchema(complianceRequirementJsonSchema, 'Concrete compliance requirements for the article.'),
      metadata: metadataBagSchema('Optional compliance-section extension data.'),
    }),
    commercial: objectSchema({
      schema_version: constStringSchema('commercial.v1'),
      offers: arraySchema(commercialOfferJsonSchema, 'Commercial offer records.'),
      metadata: metadataBagSchema('Optional commercial-section extension data.'),
    }),
    approvals: objectSchema({
      schema_version: constStringSchema('approvals.v1'),
      approval_status: stringSchema('Approval status.'),
    }),
    publication: objectSchema({
      schema_version: constStringSchema('publication.v2'),
      published_time: {
        anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
        description:
          'Only publication control field. Null/missing/invalid means not live and not scheduled; future ISO timestamp schedules; current or past ISO timestamp publishes/live.',
      },
    }),
    workflow: objectSchema({
      schema_version: constStringSchema('content_workflow.v1'),
      workflow_id: stringSchema(
        'Workflow identifier agents should preserve across handoffs and backend workflow records.'
      ),
      current_agent: agentNameJsonSchema('Agent currently responsible for this content-source handoff.'),
      previous_agent: nullableAgentNameJsonSchema('Agent that handed off this content source, if any.'),
      next_agent: nullableAgentNameJsonSchema('Agent expected to receive the next handoff, if any.'),
      handoff_notes: stringSchema('Concise handoff notes for the next agent.'),
      metadata: metadataBagSchema('Optional workflow-handoff extension data.'),
    }),
    revision_control: objectSchema({
      schema_version: constStringSchema('revision_control.v1'),
      audit_findings: arraySchema(
        objectSchema({
          finding_id: stringSchema('Stable audit finding identifier.'),
          severity: stringSchema('Finding severity.'),
          finding: stringSchema('Audit finding text.'),
          metadata: metadataBagSchema('Optional audit-finding extension data.'),
        }),
        'Audit findings.'
      ),
      routing_decisions: arraySchema(
        objectSchema({
          decision_id: stringSchema('Stable routing decision identifier.'),
          from_agent: agentNameJsonSchema('Agent making the routing decision.'),
          to_agent: nullableAgentNameJsonSchema('Agent receiving the next route, or null when complete.'),
          reason: stringSchema('Routing rationale.'),
          metadata: metadataBagSchema('Optional routing-decision extension data.'),
        }),
        'Routing decisions.'
      ),
      revision_requests: arraySchema(revisionRequestJsonSchema, 'Concrete revision requests.'),
      change_assessments: arraySchema(
        objectSchema({
          assessment_id: stringSchema('Stable change assessment identifier.'),
          revision_request_id: stringSchema('Revision request id this assessment addresses.'),
          outcome: stringSchema('Assessment outcome.'),
          notes: stringSchema('Assessment notes.'),
          metadata: metadataBagSchema('Optional change-assessment extension data.'),
        }),
        'Change assessments.'
      ),
    }),
    versioning: objectSchema({
      schema_version: constStringSchema('versioning.v1'),
      record_version: intSchema(
        'Content-source record version agents should increment or preserve for revision tracking.'
      ),
      previous_version_refs: stringArraySchema('Previous content-source version references.'),
    }),
  },
  ['record_type', 'schema_version'],
  'Structured content_source.v1 workflow input. For MCP admin-publish drafts, use content.article_body with schema_version article_body.v1 plus at least one reader-visible public node. Publication is controlled only by input.publication.published_time.'
);

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
    name: 'save_json_blob_create_request',
    description:
      'Create a save-json-blob workflow request and return its record. request_id is required and must match req_<flow>_<topic>_<yyyymmdd>_<nn> using lowercase snake_case (e.g. req_publish_drlurie_20260702_01); it is not auto-generated, and a non-conforming id breaks every later artifact operation for the request. MCP-created article drafts are validated as admin-publish drafts: use content.article_body (article_body.v1) with at least one reader-visible public node. Publication is controlled only by input.publication.published_time.',
    inputSchema: objectSchema(
      {
        input: contentSourceV1JsonSchema,
        request_id: stringSchema(
          'Required. Must match req_<flow>_<topic>_<yyyymmdd>_<nn> using lowercase snake_case — e.g. req_publish_drlurie_20260702_01. Agents must supply this; it is not auto-generated. Use a date matching today and a 2-digit sequence number.'
        ),
        current_agent: agentNameJsonSchema(
          'Optional initial current agent; defaults to input.workflow.current_agent or no current stage.'
        ),
        next_agent: nullableAgentNameJsonSchema(
          'Optional initial next agent; defaults to input.workflow.next_agent or reader_insight.'
        ),
        validation_mode: adminPublishValidationModeSchema,
      },
      ['input', 'request_id', 'validation_mode']
    ),
  },

  {
    name: 'save_json_blob_create_article_draft',
    description:
      'Non-breaking helper for agents creating structured admin-publish drafts. Wraps save_json_blob_create_request with validation_mode: "admin_publish_draft". request_id is required and must match req_<flow>_<topic>_<yyyymmdd>_<nn> using lowercase snake_case (e.g. req_publish_drlurie_20260702_01); it is not auto-generated, and a non-conforming id breaks every later artifact operation for the request. Use input.content.article_body.schema_version = "article_body.v1" and input.content.article_body.nodes[] with at least one public node; node.private is internal only and never visible copy.',
    inputSchema: objectSchema(
      {
        input: contentSourceV1JsonSchema,
        request_id: stringSchema(
          'Required. Must match req_<flow>_<topic>_<yyyymmdd>_<nn> using lowercase snake_case — e.g. req_publish_drlurie_20260702_01. Agents must supply this; it is not auto-generated. Use a date matching today and a 2-digit sequence number.'
        ),
        current_agent: agentNameJsonSchema(
          'Optional initial current agent; defaults to input.workflow.current_agent or no current stage.'
        ),
        next_agent: nullableAgentNameJsonSchema(
          'Optional initial next agent; defaults to input.workflow.next_agent or reader_insight.'
        ),
      },
      ['input', 'request_id']
    ),
  },
  {
    name: 'save_json_blob_get_request',
    description: `Fetch a save-json-blob workflow request record by request_id. ${mediaPortabilityWarning}`,
    inputSchema: objectSchema({ request_id: stringSchema() }, ['request_id']),
  },
  {
    name: 'save_json_blob_list_pending_requests',
    description: `List pending save-json-blob workflow request records, optionally filtered by stage and status. ${mediaPortabilityWarning}`,
    inputSchema: objectSchema({
      stage: agentNameJsonSchema(),
      status: workflowStatusJsonSchema(),
      limit: { type: 'integer', minimum: 1, maximum: 1000 },
    }),
  },
  {
    name: 'save_json_blob_patch_agent_output',
    description: `Patch one agent output for a save-json-blob workflow request and return its record. ${workflowLockInstruction}`,
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        agent_name: agentNameJsonSchema(),
        expected_agent_version: intSchema(),
        lock_token: lockTokenSchema,
        output: { description: 'Agent output payload.' },
      },
      ['request_id', 'agent_name', 'expected_agent_version', 'lock_token', 'output']
    ),
  },
  {
    name: 'save_json_blob_mark_agent_complete',
    description: `Mark one agent complete for a save-json-blob workflow request and return its record. ${workflowLockInstruction}`,
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        agent_name: agentNameJsonSchema(),
        expected_record_version: intSchema(),
        lock_token: lockTokenSchema,
        current_stage: nullableAgentNameJsonSchema(),
        next_agent: nullableAgentNameJsonSchema(),
        workflow_status: workflowStatusJsonSchema(),
        needs_review: { type: 'boolean' },
        last_error: nullableStringSchema(),
      },
      ['request_id', 'agent_name', 'expected_record_version', 'lock_token']
    ),
  },
  {
    name: 'save_json_blob_checkout_request',
    description: `Checkout a save-json-blob workflow request and acquire a lock_token before patching output. ${workflowLockInstruction}`,
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        owner_id: ownerIdSchema,
        owner_label: ownerLabelSchema,
        lease_seconds: leaseSecondsSchema,
      },
      ['request_id', 'owner_id', 'owner_label']
    ),
  },
  {
    name: 'save_json_blob_refresh_lock',
    description: `Refresh an active workflow lock before it expires when more time is needed. ${workflowLockInstruction}`,
    inputSchema: objectSchema(
      { request_id: stringSchema(), lock_token: lockTokenSchema, lease_seconds: leaseSecondsSchema },
      ['request_id', 'lock_token']
    ),
  },
  {
    name: 'save_json_blob_checkin_request',
    description: `Check in a workflow request to release the lock after patching output and marking complete. ${workflowLockInstruction}`,
    inputSchema: objectSchema({ request_id: stringSchema(), lock_token: lockTokenSchema }, [
      'request_id',
      'lock_token',
    ]),
  },

  {
    name: 'save_json_blob_publish_by_time',
    description:
      'Set input.publication.published_time and run the article publisher. Omitted or current/past timestamps publish now (status "published"). A FUTURE timestamp also materializes media and commits the article file (status "time_set") — the page stays hidden by the published_time gate until that time passes and the site rebuilds. null unpublishes (status "unpublished"): the article is re-committed with published_time: null. In every mode the publisher validates and commits; a failed publish leaves published_time unchanged. Requires checkout lock_token.',
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        lock_token: lockTokenSchema,
        published_time: nullableStringSchema(
          'Optional ISO timestamp. Omit to publish now. Future timestamps schedule; null clears publication time.'
        ),
      },
      ['request_id', 'lock_token']
    ),
  },
  {
    name: 'save_json_blob_patch_canonical_input',
    description: [
      'Repair canonical input fields on an existing workflow record in place, under the normal checkout/lock/version discipline.',
      'Use this BEFORE save_json_blob_publish_by_time when publish_by_time fails with 422 due to invalid image paths or missing publication fields.',
      'Sequence: checkout_request → save_json_blob_patch_canonical_input → save_json_blob_publish_by_time → checkin_request.',
      '',
      'Supported repairs (at least one required):',
      '  node_patches: replace or remove public.media.src/alt/caption on specific article_body nodes by node_id.',
      '    public_media_src MUST be a trusted Major Key artifact reference (image/{id}/{sha256}.{ext}): an artifact',
      '    uploaded for THIS request (visible via list_artifacts_for_request) or already saved in agent_outputs.',
      '    Legacy repo paths (src/assets/...), remote URLs (https://...), and data URIs are always rejected.',
      '  replace_image_asset_register: replace input.media.image_asset_register[] wholesale.',
      '    Entries must pass ImageAssetRecord schema; url/repoPath that are Major Key refs must be trusted',
      '    (uploaded for this request or in agent_outputs). Legacy paths, remote URLs, and data URIs are rejected.',
      '  promote_publish_payload: set input.publication.publish_payload from a complete PublishPayload object.',
      '    Image-bearing fields (featuredImage, existingFeaturedImagePath, images[].src/url/blobKey,',
      '    mediaEntries[].src/url/blobKey, artifactReferences[].blobKey) must be trusted Major Key artifact refs.',
      '  repair_workflow_status: reset workflow_status (e.g. "failed" → "pending" or "in_progress").',
      '  clear_last_error: when true, clears last_error to null. Audited only if last_error was non-null.',
      '  clear_failed_agents: when true, clears failed_agents to []. Audited only if list was non-empty.',
      '  reset_needs_review: when true, sets needs_review to false. Audited only if it was true.',
      '',
      'All changes are recorded in workflow history with old/new value summaries.',
      workflowLockInstruction,
    ].join('\n'),
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        lock_token: lockTokenSchema,
        expected_record_version: intSchema(
          'Record version the caller read. Rejected with 409 if the record has since advanced.'
        ),
        node_patches: arraySchema(
          objectSchema(
            {
              node_id: stringSchema(
                'Stable node ID (e.g. n_r1a2b3). Must already exist in input.content.article_body.nodes.'
              ),
              public_media_src: {
                anyOf: [
                  {
                    type: 'string',
                    minLength: 1,
                    description:
                      'New src — must be a Major Key artifact reference (image/{id}/{sha256}.{ext}) already in agent_outputs.',
                  },
                  { type: 'null', description: 'Null removes the media object entirely.' },
                ],
              },
              public_media_alt: nullableStringSchema('New alt text, or null to remove.'),
              public_media_caption: nullableStringSchema('New caption text, or null to remove.'),
            },
            ['node_id']
          ),
          'Patches to apply to specific nodes in input.content.article_body.nodes[].'
        ),
        replace_image_asset_register: arraySchema(
          imageAssetJsonSchema,
          'Full replacement for input.media.image_asset_register[]. Each entry must be a valid ImageAssetRecord. Major Key artifact refs in url/repoPath must be in agent_outputs.'
        ),
        promote_publish_payload: {
          type: 'object',
          description:
            'Complete PublishPayload object (with slug and title) to set at input.publication.publish_payload. Image-bearing fields must reference trusted Major Key artifact refs.',
          properties: {},
          additionalProperties: true,
        },
        repair_workflow_status: workflowStatusJsonSchema(
          'Reset workflow_status to this value (e.g. "pending" or "in_progress") after canonical repair.'
        ),
        clear_last_error: {
          type: 'boolean',
          description:
            'When true, clears last_error to null. Useful when moving a failed record back to a retryable state.',
        },
        clear_failed_agents: {
          type: 'boolean',
          description: 'When true, clears failed_agents to []. Useful when retrying after a repaired canonical input.',
        },
        reset_needs_review: {
          type: 'boolean',
          description: 'When true, sets needs_review to false. Useful after resolving the issue that triggered review.',
        },
      },
      ['request_id', 'lock_token', 'expected_record_version']
    ),
  },
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
      "Manually trigger a Netlify build via the server-side build hook, without needing a new git commit. No input is required. This QUEUES a build asynchronously — it does not wait for the build to finish, so poll deploy_status afterward (the same way you already do after a normal publish) to know when the resulting deploy is actually ready. IMPORTANT — batch, do not spam: each triggered build consumes real Netlify build minutes, so use this to batch multiple publishes into a single build rather than triggering one build per publish. For example, after publishing several articles in a row, call this once at the end instead of calling it after every individual save_json_blob_publish_by_time call. Optional reason is recorded only in this function's own server-side logs for traceability of who triggered a build and why — it is never sent to Netlify and never included in the response.",
    inputSchema: objectSchema({
      reason: stringSchema(
        "Optional free-text reason for triggering this build, recorded only in this function's own server logs for traceability. Never sent to Netlify."
      ),
    }),
  },
