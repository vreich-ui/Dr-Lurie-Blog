import { randomUUID, timingSafeEqual } from 'node:crypto';

import { handler as saveArtifactHandler } from './save-artifact.js';
import { handler as saveJsonBlobHandler, type WorkflowRecord } from './save-json-blob.js';
import { handler as publishArticleHandler } from './publish-article.js';
import { handler as deployStatusHandler } from './deploy-status.js';
import { handler as verifyArticleImagesHandler } from './verify-article-images.js';
import { collectBlobListItems } from '../lib/blob-list.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore, getWorkflowBlobStore } from '../lib/blob-store.js';
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
  readArtifactReference,
  requestArtifactReferenceKey,
  resolveArtifactPointer,
  writeArtifactReferenceIndexes,
  type ArtifactIndexStore,
} from '../lib/artifact-index.js';
import { saveArtifactFromUrl } from '../lib/artifact-url-ingest.js';
import { validateFilename, validateRequestId } from '../../src/lib/agents-naming.js';

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
  isBase64Encoded?: boolean;
  log?: StructuredLogger;
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

const SERVER_NAME = 'Dr_Lurie_MCP_Server';
const SERVER_DIAGNOSTIC_NAME = 'Dr_Lurie_Science_MCP';
const PROTOCOL_VERSION = '2025-06-18';
const ALLOWED_AGENTS = allowedAgentNames;
const ALLOWED_AGENT_SET = new Set<string>(ALLOWED_AGENTS);
const ADMIN_TOOLS_ENABLED = process.env.MCP_ENABLE_ADMIN_TOOLS === 'true';
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

const createRequestId = () => `req_${randomUUID()}`;

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
  pattern: '^[^\u0000-\u001f\u007f<>]+$',
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
          type: { type: 'string', enum: ['image', 'video', 'audio', 'embed'] },
          src: stringSchema('Visible media source URL.'),
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
      'Optional rendering hints such as presentation, placement, or emphasis. Set placement=inline only when public.media should render inside the article body.'
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

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'save_json_blob_create_request',
    description:
      'Create a save-json-blob workflow request and return its record. MCP-created article drafts are validated as admin-publish drafts: use content.article_body (article_body.v1) with at least one reader-visible public node. Publication is controlled only by input.publication.published_time.',
    inputSchema: objectSchema(
      {
        input: contentSourceV1JsonSchema,
        request_id: stringSchema('Optional request id. A UUID-based id is generated when omitted.'),
        current_agent: agentNameJsonSchema(
          'Optional initial current agent; defaults to input.workflow.current_agent or no current stage.'
        ),
        next_agent: nullableAgentNameJsonSchema(
          'Optional initial next agent; defaults to input.workflow.next_agent or reader_insight.'
        ),
        validation_mode: adminPublishValidationModeSchema,
      },
      ['input', 'validation_mode']
    ),
  },

  {
    name: 'save_json_blob_create_article_draft',
    description:
      'Non-breaking helper for agents creating structured admin-publish drafts. Wraps save_json_blob_create_request with validation_mode: "admin_publish_draft". Use input.content.article_body.schema_version = "article_body.v1" and input.content.article_body.nodes[] with at least one public node; node.private is internal only and never visible copy.',
    inputSchema: objectSchema(
      {
        input: contentSourceV1JsonSchema,
        request_id: stringSchema('Optional request id. A UUID-based id is generated when omitted.'),
        current_agent: agentNameJsonSchema(
          'Optional initial current agent; defaults to input.workflow.current_agent or no current stage.'
        ),
        next_agent: nullableAgentNameJsonSchema(
          'Optional initial next agent; defaults to input.workflow.next_agent or reader_insight.'
        ),
      },
      ['input']
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
      'Set input.publication.published_time. Future timestamps save only; current/past timestamps publish content.article_body through the secure article publisher and write a publish receipt. Requires checkout lock_token.',
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
      '    public_media_src MUST be a Major Key artifact reference (image/{id}/{sha256}.{ext}) already in agent_outputs.',
      '    Legacy repo paths (src/assets/...), remote URLs (https://...), and data URIs are always rejected.',
      '  replace_image_asset_register: replace input.media.image_asset_register[] wholesale.',
      '    Entries must pass ImageAssetRecord schema; url/repoPath that are Major Key refs must be in agent_outputs.',
      '    Legacy paths, remote URLs, and data URIs are rejected.',
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
    description: 'Read-only Netlify deploy receipt lookup by commit or deploy id.',
    inputSchema: objectSchema({
      commit: stringSchema('Commit SHA to look up in saved Netlify deploy receipts.'),
      deployId: stringSchema('Netlify deploy id to look up in saved Netlify deploy receipts.'),
    }),
  },
  {
    name: 'verify_article_images',
    description:
      'Verify that a published article page contains expected image URLs and that each expected image is fetchable as an image. Server-only publish credentials are never accepted as inputs or returned.',
    inputSchema: objectSchema(
      {
        url: stringSchema('Published article URL to fetch and inspect for <img> sources.'),
        expectedImages: {
          type: 'array',
          items: stringSchema('Expected image URL or page-relative image path.'),
          description: 'Expected image URLs or page-relative image paths that must appear in the article HTML.',
        },
      },
      ['url', 'expectedImages']
    ),
  },
  ...(ADMIN_TOOLS_ENABLED
    ? [
        {
          name: 'save_json_blob_force_unlock',
          description:
            'Admin-only emergency tool that forcefully releases a workflow lock. Prefer checkin_request with the valid lock_token whenever possible.',
          inputSchema: objectSchema({ request_id: stringSchema() }, ['request_id']),
        },
      ]
    : []),
  {
    name: 'create_artifact_upload_intent',
    description:
      'Create a short-lived scoped direct artifact upload intent. New clients should call this tool first, then upload raw bytes with HTTP POST application/octet-stream to /api/artifacts/upload using the returned requiredHeaders. Keeps binary bytes out of MCP arguments and returns no server secrets other than the scoped upload token.',
    inputSchema: artifactUploadIntentInputSchema(),
  },
  {
    name: 'create_artifact_from_url',
    description:
      'Fallback tool to ingest an artifact from a public HTTPS URL. Use this when the MCP client cannot perform a direct HTTP POST of binary bytes. The server fetches the URL and saves it as a request artifact.',
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
    description: `Legacy small-artifact single-shot byte upload. Required: requestId, artifactKind, contentType, payload. Store only the returned ArtifactReference; never invent blobKey values, URLs, or repo paths. Generated binary files/images should use create_artifact_upload_intent plus raw HTTP POST /api/artifacts/upload. Writes final artifact bytes and an ArtifactReference index for the request. Returns artifact, complete=true, deduped; dedup is success and skips rewriting bytes.`,
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
    description: `List ArtifactReference metadata for a requestId. Required: requestId. Reads the request artifact index only; it does not read or write artifact bytes. Returns artifacts array. ${mediaPortabilityWarning}`,
    inputSchema: objectSchema(
      { requestId: stringSchema('Workflow request id whose artifact references should be listed.') },
      ['requestId']
    ),
  },
  {
    name: 'get_artifact_metadata',
    description: 'Get full ArtifactReference metadata for a requestId and sha256. Does not read artifact bytes.',
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
      'Admin-only MCP maintenance tool protected by server publish-key headers. Dry-runs by default; live mode deletes only allowlisted app-managed blob prefixes across workflow, artifact-index, and artifact blob stores.',
    inputSchema: objectSchema({
      dryRun: wipeBlobDryRunJsonSchema,
      confirm: wipeBlobConfirmJsonSchema,
      prefixes: wipeBlobPrefixesJsonSchema,
    }),
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
  ...ALLOWED_AGENTS.flatMap<ToolDefinition>((agentName) => [
    {
      name: `${agentName}_update_output`,
      description:
        agentName === 'final_article'
          ? [
              'Patch final_article output with a lock_token and default expected_agent_version to 0 for the first write.',
              '',
              'IMAGE ARTIFACT CONTRACT: Image artifacts MUST be supplied as a top-level output.artifactReferences: ArtifactReference[] array to be picked up by publish.',
              'Alternatively, wire images into article_body.nodes[].public.media.src as an image/{requestId}/{sha256}.{ext} pointer.',
              'Any other nesting — e.g. under output.metadata.artifactReferences, a singular output.artifactReference key, or inside output.images — is silently dropped by the publish pipeline and will produce a publish with an empty media array.',
              'Each entry in output.artifactReferences must be a complete ArtifactReference (blobKey, sha256, sizeBytes, contentType, createdAtISO); malformed entries are rejected with HTTP 400.',
              '',
              workflowLockInstruction,
            ].join('\n')
          : `Patch ${agentName} output with a lock_token and default expected_agent_version to 0 for the first write. ${workflowLockInstruction}`,
      inputSchema: objectSchema(
        {
          request_id: stringSchema(),
          output: { description: 'Agent output payload.' },
          expected_agent_version: intSchema(),
          lock_token: lockTokenSchema,
        },
        ['request_id', 'output', 'lock_token']
      ),
    },
    {
      name: `${agentName}_mark_complete`,
      description: `Mark ${agentName} complete with the agent name hardcoded and optional current_stage, next_agent, workflow_status, needs_review, last_error, and lock_token forwarded to the backend. ${stageTransitionDescription(agentName)} ${workflowLockInstruction}`,
      inputSchema: objectSchema(
        {
          request_id: stringSchema(),
          agent_name: agentNameJsonSchema(
            'Optional for compatibility with save_json_blob_mark_agent_complete; stage helpers always use their hardcoded agent.'
          ),
          expected_record_version: intSchema(),
          lock_token: lockTokenSchema,
          current_stage: nullableAgentNameJsonSchema(),
          next_agent: nullableAgentNameJsonSchema(),
          workflow_status: workflowStatusJsonSchema(),
          needs_review: { type: 'boolean' },
          last_error: nullableStringSchema(),
        },
        ['request_id', 'expected_record_version', 'lock_token']
      ),
    },
  ]),
];

const response = (statusCode: number, body: unknown, headers: Record<string, string> = jsonHeaders) => ({
  statusCode,
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const emptyResponse = (statusCode: number) => ({
  statusCode,
  headers: { ...jsonHeaders, 'Content-Type': 'text/plain' },
  body: '',
});

const rpcResponse = (id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  result,
});

const rpcError = (id: JsonRpcRequest['id'], code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

const parseBody = (event: LambdaEvent) => {
  if (!event.body) throw new Error('Missing request body.');

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  return JSON.parse(rawBody) as JsonRpcRequest | JsonRpcRequest[];
};

type AuthResult =
  | { ok: true }
  | { ok: false; reason: 'missing_token' | 'missing_authorization' | 'invalid_authorization' };

const getAuthResult = (event: LambdaEvent): AuthResult => {
  const token = toNonEmptyString(process.env.MCP_HTTP_AUTH_TOKEN);
  if (!token) {
    return process.env.MCP_HTTP_AUTH_TOKEN === undefined ? { ok: true } : { ok: false, reason: 'missing_token' };
  }

  const dedicatedToken = toNonEmptyString(getHeader(event.headers, 'x-mcp-auth-token'));
  const authorization = toNonEmptyString(getHeader(event.headers, 'authorization'));
  const bearerToken = getBearerToken(authorization);
  const providedTokens = [dedicatedToken, bearerToken].filter((provided): provided is string => Boolean(provided));

  if (providedTokens.length === 0) return { ok: false, reason: 'missing_authorization' };

  return providedTokens.some((provided) => safeSecretsMatch(provided, token))
    ? { ok: true }
    : { ok: false, reason: 'invalid_authorization' };
};

const getAuthDiagnosticReason = (reason: Exclude<AuthResult, { ok: true }>['reason']) => `mcp_auth_${reason}`;

const getHeader = (headers: LambdaEvent['headers'], name: string) => {
  const normalizedName = name.toLowerCase();
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);

  return entry?.[1];
};

const getRequestId = (event: LambdaEvent) =>
  toNonEmptyString(getHeader(event.headers, 'x-nf-request-id')) ?? randomUUID();

const getSlugFromValue = (value: unknown): string | null => {
  const record = getRecordValue(value);
  if (!record) return null;

  return (
    toNonEmptyString(record.slug) ??
    toNonEmptyString(record.articleSlug) ??
    toNonEmptyString(record.article_slug) ??
    getSlugFromValue(record.publication) ??
    getSlugFromValue(record.content)
  );
};

const getRpcSlug = (request: JsonRpcRequest) =>
  getSlugFromValue(request.params?.arguments) ?? getSlugFromValue(request.params);

const createStructuredLogger = (requestId: string): StructuredLogger => {
  return ({ event: logEvent, rpcMethod = null, slug = null, ...details }) => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        requestId,
        rpcMethod,
        slug,
        event: logEvent,
        ...details,
      })
    );
  };
};

const withStructuredLogger = (event: LambdaEvent): LambdaEvent => {
  const requestId = event.requestId ?? getRequestId(event);

  return {
    ...event,
    requestId,
    log: event.log ?? createStructuredLogger(requestId),
  };
};

const createSaveJsonBlobHeaders = (event: LambdaEvent, publishSecret: string) => ({
  ...(event.headers ?? {}),
  ...(getHeader(event.headers, 'x-nf-site-id') ? { 'x-nf-site-id': getHeader(event.headers, 'x-nf-site-id') } : {}),
  ...(getHeader(event.headers, 'x-nf-deploy-id')
    ? { 'x-nf-deploy-id': getHeader(event.headers, 'x-nf-deploy-id') }
    : {}),
  'x-publish-key': publishSecret,
  'content-type': 'application/json',
});

const invokeSaveJsonBlob = async (event: LambdaEvent, payload: Record<string, unknown>) => {
  const publishSecret = process.env.PUBLISH_SECRET || process.env.NETLIFY_PUBLISH_SECRET;

  if (!publishSecret) {
    return toolError('Server-side workflow storage credentials are not configured.');
  }

  const saveResponse = await _mcpInternal.saveJsonBlobHandler({
    httpMethod: 'POST',
    headers: createSaveJsonBlobHeaders(event, publishSecret),
    body: JSON.stringify(payload),
  });

  const bodyText = saveResponse.body ?? '';
  let parsedBody: Record<string, unknown> = {};

  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return toolError(`HTTP ${saveResponse.statusCode}: ${bodyText}`);
    }
  }

  if (saveResponse.statusCode < 200 || saveResponse.statusCode >= 300) {
    return toolError(
      typeof parsedBody.error === 'string' ? parsedBody.error : `HTTP ${saveResponse.statusCode}: ${bodyText}`,
      { statusCode: saveResponse.statusCode, ...sanitizeWorkflowErrorPayload(parsedBody) }
    );
  }

  return parsedBody;
};

const invokeSaveArtifact = async (event: LambdaEvent, payload: Record<string, unknown>) => {
  const publishSecret = process.env.PUBLISH_SECRET || process.env.NETLIFY_PUBLISH_SECRET;

  if (!publishSecret) {
    return toolError('Server-side artifact storage is not configured.');
  }

  const saveResponse = await saveArtifactHandler({
    httpMethod: 'POST',
    headers: createSaveJsonBlobHeaders(event, publishSecret),
    body: JSON.stringify(payload),
    log: event.log,
    requestId: event.requestId,
    rpcMethod: event.rpcMethod,
    slug: event.slug,
  });

  const bodyText = saveResponse.body ?? '';
  let parsedBody: Record<string, unknown> = {};

  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return toolError(`HTTP ${saveResponse.statusCode}: ${bodyText}`);
    }
  }

  if (saveResponse.statusCode < 200 || saveResponse.statusCode >= 300) {
    return toolError(
      typeof parsedBody.error === 'string' ? parsedBody.error : `HTTP ${saveResponse.statusCode}: ${bodyText}`
    );
  }

  return parsedBody;
};

const callPublishArticle = async (event: LambdaEvent, payload: Record<string, unknown>) => {
  const publishSecret = process.env.PUBLISH_SECRET || process.env.NETLIFY_PUBLISH_SECRET;

  if (!publishSecret) {
    return {
      ok: false as const,
      statusCode: 500,
      body: {
        error: 'Article publishing is not configured on the server.',
        error_code: 'article_publish_not_configured',
      },
    };
  }

  const publishResponse = await _mcpInternal.publishArticleHandler(
    {
      httpMethod: 'POST',
      headers: {
        ...(event.headers ?? {}),
        ...(getHeader(event.headers, 'x-nf-site-id')
          ? { 'x-nf-site-id': getHeader(event.headers, 'x-nf-site-id') }
          : {}),
        ...(getHeader(event.headers, 'x-nf-deploy-id')
          ? { 'x-nf-deploy-id': getHeader(event.headers, 'x-nf-deploy-id') }
          : {}),
        'x-publish-key': publishSecret,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      log: event.log,
      requestId: event.requestId,
      rpcMethod: event.rpcMethod,
      slug: event.slug,
    },
    {}
  );
  const body = parseJsonResponseBody(publishResponse.body);

  if (publishResponse.statusCode < 200 || publishResponse.statusCode >= 300) {
    return { ok: false as const, statusCode: publishResponse.statusCode, body };
  }

  return { ok: true as const, statusCode: publishResponse.statusCode, body };
};

const callDeployStatus = async (event: LambdaEvent, payload: Record<string, unknown>) => {
  const publishSecret = process.env.PUBLISH_SECRET || process.env.NETLIFY_PUBLISH_SECRET;

  if (!publishSecret) {
    return toolError('Deploy status lookup is not configured on the server.', {
      error_code: 'deploy_status_not_configured',
    });
  }

  const deployStatusResponse = await deployStatusHandler({
    httpMethod: 'POST',
    headers: {
      ...(event.headers ?? {}),
      'x-publish-key': publishSecret,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = parseJsonResponseBody(deployStatusResponse.body);

  if (deployStatusResponse.statusCode < 200 || deployStatusResponse.statusCode >= 300) {
    return toolError(
      typeof body.error === 'string'
        ? body.error
        : `HTTP ${deployStatusResponse.statusCode}: deploy status lookup failed`,
      { statusCode: deployStatusResponse.statusCode, ...body }
    );
  }

  return toolResult(body);
};

const callVerifyArticleImages = async (event: LambdaEvent, input: Record<string, unknown>) => {
  const publishSecret = process.env.PUBLISH_SECRET || process.env.NETLIFY_PUBLISH_SECRET;

  if (!publishSecret) {
    return toolError('Article image verification is not configured on the server.', {
      error_code: 'verify_article_images_not_configured',
    });
  }

  const verifyResponse = await verifyArticleImagesHandler({
    httpMethod: 'POST',
    headers: {
      ...(event.headers ?? {}),
      'x-publish-key': publishSecret,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      url: input.url,
      expectedImages: input.expectedImages,
    }),
  });
  const body = parseJsonResponseBody(verifyResponse.body);

  if (verifyResponse.statusCode < 200 || verifyResponse.statusCode >= 300) {
    return toolError(
      typeof body.error === 'string'
        ? body.error
        : `HTTP ${verifyResponse.statusCode}: article image verification failed`,
      { statusCode: verifyResponse.statusCode, ...body }
    );
  }

  return toolResult(body);
};

const hasReaderVisibleArticleBodyNode = (node: unknown) => {
  const record = getRecordValue(node);
  if (!record) return false;
  if (record.visibility && record.visibility !== 'public') return false;

  const publicFields = getRecordValue(record.public);
  if (!publicFields) return false;
  const media = getRecordValue(publicFields.media);
  const textValues = [
    publicFields.eyebrow,
    publicFields.title,
    publicFields.body,
    ...(Array.isArray(publicFields.items) ? publicFields.items : []),
    publicFields.ctaText,
    publicFields.ctaLink,
    publicFields.label,
    media?.src,
    media?.alt,
    media?.caption,
  ];

  return textValues.some((value) => toNonEmptyString(value) !== undefined);
};

const countPublicArticleBodyNodes = (articleBody: Record<string, unknown> | undefined) => {
  if (!Array.isArray(articleBody?.nodes)) return 0;
  return (articleBody.nodes as unknown[]).filter(hasReaderVisibleArticleBodyNode).length;
};

const extractAgentFinalArticleBody = (record: Record<string, unknown> | undefined) => {
  const output = getRecordValue(getRecordValue(getRecordValue(record?.agent_outputs)?.final_article)?.output);
  if (!output) return undefined;

  const directBody = getRecordValue(output.article_body);
  if (directBody?.schema_version === 'article_body.v1' && Array.isArray(directBody.nodes)) return directBody;

  const contentBody = getRecordValue(getRecordValue(output.content)?.article_body);
  if (contentBody?.schema_version === 'article_body.v1' && Array.isArray(contentBody.nodes)) return contentBody;

  return undefined;
};

const promoteAgentArticleBodyIfRicher = (
  record: Record<string, unknown> | undefined,
  recordInput: Record<string, unknown> | undefined
) => {
  const agentBody = extractAgentFinalArticleBody(record);
  if (!agentBody || countPublicArticleBodyNodes(agentBody) < 1) {
    return { effectiveRecordInput: recordInput, promotedArticleBody: undefined };
  }

  const inputContent = getRecordValue(recordInput?.content);
  return {
    effectiveRecordInput: { ...recordInput, content: { ...inputContent, article_body: agentBody } },
    promotedArticleBody: agentBody,
  };
};

const validateCanonicalArticleBody = (recordInput: Record<string, unknown> | undefined) => {
  const content = getRecordValue(recordInput?.content);
  const articleBody = getRecordValue(content?.article_body);

  if (articleBody?.schema_version !== 'article_body.v1') {
    return {
      ok: false as const,
      error: 'Publishing requires input.content.article_body.schema_version === "article_body.v1".',
      error_code: 'invalid_article_body_schema',
    };
  }

  if (!Array.isArray(articleBody.nodes) || !articleBody.nodes.some(hasReaderVisibleArticleBodyNode)) {
    return {
      ok: false as const,
      error: 'Publishing requires input.content.article_body.nodes with at least one reader-visible public node.',
      error_code: 'article_body_missing_public_node',
    };
  }

  return { ok: true as const, articleBody, content };
};

const slugifyPublishTitle = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'article';

const parseArtifactPointer = (value: string): { requestId: string; sha256: string; ext: string } | undefined => {
  const match = value.match(/^(?:image|pdf)\/([^/]+)\/([a-fA-F0-9]{64})\.([a-z0-9]+)$/);
  if (!match) return undefined;
  return { requestId: match[1], sha256: match[2].toLowerCase(), ext: match[3] };
};

const buildCanonicalPublishPayload = async (
  requestId: string,
  lockToken: string,
  record: WorkflowRecord,
  articleBody: Record<string, unknown>,
  publishedTime: string,
  artifactReferences: ArtifactReference[],
  event: LambdaEvent
) => {
  const recordInput = getRecordValue(record.input) || {};
  const content = getRecordValue(recordInput.content);
  const taxonomy = getRecordValue(recordInput.taxonomy);
  const seo = getRecordValue(recordInput.seo);
  const media = getRecordValue(recordInput.media);
  const title = toNonEmptyString(content?.title);

  if (!title) {
    return { ok: false as const, error: 'Publishing requires input.content.title.', error_code: 'missing_title' };
  }

  type ImageCandidate = { path: string; priority: number };
  const candidates: ImageCandidate[] = [];

  const isHeroAsset = (asset: Record<string, unknown> | undefined) => {
    if (!asset) return false;
    const metadata = getRecordValue(asset.metadata);
    const purpose = toNonEmptyString(asset.purpose) || toNonEmptyString(metadata?.purpose);
    const status = toNonEmptyString(asset.status) || toNonEmptyString(metadata?.status);
    const isPrimary =
      asset.primary === true ||
      asset.primary === 'true' ||
      metadata?.primary === true ||
      metadata?.primary === 'true' ||
      metadata?.hero === true ||
      metadata?.hero === 'true';

    return (
      purpose?.toLowerCase() === 'hero' ||
      purpose?.toLowerCase() === 'article' ||
      status?.toLowerCase() === 'primary' ||
      isPrimary
    );
  };

  const imageAssets = Array.isArray(media?.image_asset_register) ? media.image_asset_register : [];
  for (const asset of imageAssets) {
    const assetRecord = getRecordValue(asset);
    const path = toNonEmptyString(assetRecord?.repoPath) || toNonEmptyString(assetRecord?.url);
    if (path) {
      candidates.push({ path, priority: isHeroAsset(assetRecord) ? 10 : 5 });
    }
  }

  const imageSets = Array.isArray(media?.image_sets) ? media.image_sets : [];
  for (const set of imageSets) {
    const setRecord = getRecordValue(set);
    const assetIds = Array.isArray(setRecord?.asset_ids) ? setRecord.asset_ids : [];
    const isHeroSet = isHeroAsset(setRecord);
    for (const assetId of assetIds) {
      const asset = imageAssets.find((a: unknown) => getRecordValue(a)?.asset_id === assetId);
      const assetRecord = getRecordValue(asset);
      const path = toNonEmptyString(assetRecord?.repoPath) || toNonEmptyString(assetRecord?.url);
      if (path) {
        candidates.push({ path, priority: isHeroSet ? 12 : 6 });
      }
    }
  }

  const nodes = Array.isArray(articleBody.nodes) ? articleBody.nodes : [];
  for (const node of nodes) {
    const nodeRecord = getRecordValue(node);
    const nodePublic = getRecordValue(nodeRecord?.public);
    const nodeMedia = getRecordValue(nodePublic?.media);
    const path = toNonEmptyString(nodeMedia?.src);
    if (path && nodeMedia?.type === 'image') {
      const rendering = getRecordValue(nodeRecord?.rendering);
      const isHeroNode = rendering?.presentation === 'hero' || nodeRecord?.id === 'n_hero';
      candidates.push({ path, priority: isHeroNode ? 10 : 3 });
    } else if (path && nodeMedia?.type === 'document') {
      // Include document (PDF) pointers for cross-request resolution.
      // Priority 0 ensures PDFs never influence featured-image selection.
      candidates.push({ path, priority: 0 });
    }
  }

  const allRefs = [...artifactReferences];
  const finalArticleOutput = getRecordValue(record.agent_outputs?.final_article?.output);
  const finalRefs = Array.isArray(finalArticleOutput?.artifactReferences) ? finalArticleOutput.artifactReferences : [];
  for (const ref of finalRefs) {
    const refRecord = getRecordValue(ref);
    if (refRecord && !allRefs.find((r) => r.sha256 === refRecord.sha256)) {
      if (isArtifactReference(refRecord)) {
        allRefs.push(refRecord);
      }
    }
  }

  // Resolve cross-request artifact pointers: candidates may reference artifacts stored under a
  // different request ID (Major Key image refs from earlier workflow steps). Fetch and include
  // any that aren't already present in allRefs.
  const store = (await _mcpInternal.getArtifactIndexBlobStore(event)) as unknown as ArtifactIndexStore;
  const knownSha256s = new Set(allRefs.map((r) => r.sha256));
  for (const { path } of candidates) {
    const parsed = parseArtifactPointer(path);
    if (!parsed || knownSha256s.has(parsed.sha256)) continue;
    const crossRef = await readArtifactReference(store, parsed.requestId, parsed.sha256);
    if (crossRef && !isDeletedArtifactReference(crossRef)) {
      allRefs.push(crossRef);
      knownSha256s.add(parsed.sha256);
    } else if (!crossRef) {
      event.log?.({
        event: 'cross_request_artifact_not_found',
        requestId: parsed.requestId,
        sha256: parsed.sha256,
        candidatePath: path,
      });
    }
  }

  // Dedupe allRefs by sha256 (guards against duplicates from any source)
  const dedupedRefs: ArtifactReference[] = [];
  const dedupSeen = new Set<string>();
  for (const ref of allRefs) {
    if (!dedupSeen.has(ref.sha256)) {
      dedupSeen.add(ref.sha256);
      dedupedRefs.push(ref);
    }
  }

  for (const ref of dedupedRefs) {
    if (ref.contentType.startsWith('image/')) {
      const isHeroArtifact = isHeroAsset(ref as unknown as Record<string, unknown>);
      candidates.push({ path: ref.blobKey, priority: isHeroArtifact ? 10 : 2 });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const featuredImage = candidates[0]?.path;

  return {
    ok: true as const,
    payload: {
      requestId,
      request_id: requestId,
      lock_token: lockToken,
      article_body: articleBody,
      title,
      slug: slugifyPublishTitle(title),
      publishDate: publishedTime,
      published_time: publishedTime,
      description: toNonEmptyString(content?.description) ?? toNonEmptyString(content?.deck),
      excerpt: toNonEmptyString(content?.deck),
      seoDescription: toNonEmptyString(seo?.meta_description),
      tags: Array.isArray(taxonomy?.tags) ? taxonomy.tags : undefined,
      featuredImage,
      artifactReferences: dedupedRefs,
      overwrite: true,
    },
  };
};

const callPublishByTime = async (event: LambdaEvent, input: Record<string, unknown>) => {
  const requestId = toNonEmptyString(input.request_id);
  const lockToken = toNonEmptyString(input.lock_token);
  if (!requestId || !lockToken) return toolError('request_id and lock_token are required.');

  const now = new Date();
  const rawPublishedTime = input.published_time;
  const publishedTime =
    rawPublishedTime === undefined
      ? now.toISOString()
      : rawPublishedTime === null
        ? null
        : toNonEmptyString(rawPublishedTime);

  const publishedMs = publishedTime ? Date.parse(publishedTime) : Number.NaN;
  if (publishedTime !== null && (!publishedTime || Number.isNaN(publishedMs))) {
    return toolError('published_time must be omitted, null, or a valid ISO timestamp.', {
      error_code: 'invalid_published_time',
      published_time: rawPublishedTime,
    });
  }

  const getResult = await invokeSaveJsonBlob(event, { action: 'get_request', request_id: requestId });
  if ('isError' in getResult) return getResult;

  const record = getRecordValue(getResult.record);
  const recordInput = getRecordValue(record?.input);
  if (recordInput?.record_type !== 'content_source' || recordInput?.schema_version !== 'content_source.v1') {
    return toolError('Publishing requires a content_source.v1 workflow record.', {
      error_code: 'invalid_workflow_record_type',
      record_type: recordInput?.record_type,
      schema_version: recordInput?.schema_version,
    });
  }

  const { effectiveRecordInput, promotedArticleBody } = promoteAgentArticleBodyIfRicher(record, recordInput);
  const bodyValidation = validateCanonicalArticleBody(effectiveRecordInput);
  if (!bodyValidation.ok) return toolError(bodyValidation.error, bodyValidation);

  const artifactReferences = await getArtifactReferencesForRequest(event, requestId);

  if (publishedTime === null) {
    const payloadResult = await buildCanonicalPublishPayload(
      requestId,
      lockToken,
      record as unknown as WorkflowRecord,
      bodyValidation.articleBody,
      now.toISOString(),
      artifactReferences,
      event
    );
    if (!payloadResult.ok) return toolError(payloadResult.error, payloadResult);

    const unpublishResult = await callPublishArticle(event, { ...payloadResult.payload, published_time: null });
    if (!unpublishResult.ok) {
      return toolError('Article was not unpublished; published_time was not changed.', {
        error_code: 'unpublish_failed',
        publish_status: unpublishResult.statusCode,
        publish_result: unpublishResult.body,
      });
    }

    const receipt = {
      commit: unpublishResult.body.commit,
      commit_sha: unpublishResult.body.commit,
      article_path: unpublishResult.body.articlePath ?? unpublishResult.body.path,
      articlePath: unpublishResult.body.articlePath ?? unpublishResult.body.path,
      deployStatus: unpublishResult.body.deployStatus,
      message: unpublishResult.body.message,
      published_time: null,
      unpublished: true,
      media: unpublishResult.body.media,
    };

    const clearResult = await invokeSaveJsonBlob(event, {
      action: 'set_published_time',
      request_id: requestId,
      lock_token: lockToken,
      published_time: null,
      publish_receipt: receipt,
      ...(promotedArticleBody ? { article_body: promotedArticleBody } : {}),
    });
    if ('isError' in clearResult) return clearResult;
    return toolResult({
      status: 'unpublished',
      published_time: null,
      article_path: receipt.article_path,
      commit_sha: receipt.commit_sha,
      record: clearResult.record,
      publish_result: unpublishResult.body,
      media: unpublishResult.body.media,
    });
  }

  const isFuturePublish = publishedMs > now.getTime();

  const payloadResult = await buildCanonicalPublishPayload(
    requestId,
    lockToken,
    record as unknown as WorkflowRecord,
    bodyValidation.articleBody,
    publishedTime,
    artifactReferences,
    event
  );
  if (!payloadResult.ok) return toolError(payloadResult.error, payloadResult);

  const publishResult = await callPublishArticle(event, payloadResult.payload);
  if (!publishResult.ok) {
    return toolError('Article file was not written; published_time was not changed.', {
      error_code: 'publish_by_time_failed',
      publish_status: publishResult.statusCode,
      publish_result: publishResult.body,
    });
  }

  const receipt = {
    commit: publishResult.body.commit,
    commit_sha: publishResult.body.commit,
    article_path: publishResult.body.articlePath ?? publishResult.body.path,
    articlePath: publishResult.body.articlePath ?? publishResult.body.path,
    deployStatus: publishResult.body.deployStatus,
    message: publishResult.body.message,
    published_time: publishedTime,
    media: publishResult.body.media,
  };

  const saveResult = await invokeSaveJsonBlob(event, {
    action: 'set_published_time',
    request_id: requestId,
    lock_token: lockToken,
    published_time: publishedTime,
    publish_receipt: receipt,
    ...(promotedArticleBody ? { article_body: promotedArticleBody } : {}),
  });
  if ('isError' in saveResult) return saveResult;

  return toolResult({
    status: isFuturePublish ? 'time_set' : 'published',
    published_time: publishedTime,
    article_path: receipt.article_path,
    commit_sha: receipt.commit_sha,
    record: saveResult.record,
    publish_result: publishResult.body,
    media: receipt.media,
  });
};

const normalizeArtifactUploadIntentInput = (input: Record<string, unknown>) => {
  const requestId = toNonEmptyString(input.requestId);
  if (!requestId) return { ok: false as const, error: 'requestId is required.' };
  const requestIdValidation = validateRequestId(requestId);
  if (!requestIdValidation.ok) return { ok: false as const, error: requestIdValidation.error };

  const artifactKind = normalizeArtifactKindInput(input.artifactKind, true);
  if (!artifactKind.ok) return artifactKind;
  const normalizedArtifactKind = artifactKind.artifactKind as (typeof artifactKindValues)[number];

  const contentType = toNonEmptyString(input.contentType);
  if (!contentType) return { ok: false as const, error: 'contentType is required.' };

  const expectedSizeBytes = Number(input.expectedSizeBytes);
  const maxBytes = getDirectArtifactUploadMaxBytes();
  if (!Number.isInteger(expectedSizeBytes) || expectedSizeBytes < 0) {
    return { ok: false as const, error: 'expectedSizeBytes must be a non-negative integer.' };
  }
  if (expectedSizeBytes > maxBytes) {
    return { ok: false as const, error: `expectedSizeBytes must be less than or equal to ${maxBytes}.`, maxBytes };
  }

  const expectedSha256 = toNonEmptyString(input.expectedSha256)?.toLowerCase();
  if (!expectedSha256 || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return { ok: false as const, error: 'expectedSha256 must be a 64-character hex digest.' };
  }

  const filename = toNonEmptyString(input.filename);
  const filenameValidation = filename ? validateFilename(filename) : undefined;
  if (filename && (!isSafeArtifactFilename(filename) || !filenameValidation?.ok)) {
    return {
      ok: false as const,
      error:
        'filename must be readable lowercase kebab-case and must not contain control characters, angle brackets, or path separators.',
    };
  }

  const label = toNonEmptyString(input.label);
  if (label && !isSafeArtifactText(label, artifactReferenceLimits.label)) {
    return { ok: false as const, error: 'label must not contain control characters or angle brackets.' };
  }

  let tags: string[] | undefined;
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) return { ok: false as const, error: 'tags must be an array.' };
    if (input.tags.length > artifactReferenceLimits.tags) {
      return { ok: false as const, error: `tags must contain at most ${artifactReferenceLimits.tags} values.` };
    }
    tags = [];
    for (const tag of input.tags) {
      const normalizedTag = toNonEmptyString(tag);
      if (!normalizedTag || !isSafeArtifactText(normalizedTag, artifactReferenceLimits.tag)) {
        return { ok: false as const, error: 'tags must not contain control characters or angle brackets.' };
      }
      tags.push(normalizedTag);
    }
  }

  return {
    ok: true as const,
    value: {
      requestId: requestIdValidation.value,
      artifactKind: normalizedArtifactKind,
      contentType,
      expectedSizeBytes,
      expectedSha256,
      ...(filenameValidation?.ok ? { filename: filenameValidation.value } : {}),
      ...(label ? { label } : {}),
      ...(tags?.length ? { tags } : {}),
    },
    maxBytes,
  };
};

const getArtifactUploadBaseUrl = (event: LambdaEvent) => {
  const forwardedProto = toNonEmptyString(getHeader(event.headers, 'x-forwarded-proto'))?.split(',')[0]?.trim();
  const proto = forwardedProto || 'https';
  const forwardedHost = toNonEmptyString(getHeader(event.headers, 'x-forwarded-host'))?.split(',')[0]?.trim();
  const host = forwardedHost || toNonEmptyString(getHeader(event.headers, 'host'));

  if (!host || /[\s/]/.test(host)) return '/api/artifacts/upload';
  return `${proto}://${host}/api/artifacts/upload`;
};

const createRequiredArtifactUploadHeaders = (input: {
  requestId: string;
  artifactKind: string;
  contentType: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  uploadToken: string;
  filename?: string;
  tags?: string[];
}) => ({
  Authorization: `Bearer ${input.uploadToken}`,
  'Content-Type': 'application/octet-stream',
  'X-Artifact-Request-Id': input.requestId,
  'X-Artifact-Kind': input.artifactKind,
  'X-Artifact-Content-Type': input.contentType,
  'X-Artifact-Size': String(input.expectedSizeBytes),
  'X-Artifact-Sha256': input.expectedSha256,
  ...(input.filename ? { 'X-Artifact-Filename': input.filename } : {}),
  ...(input.tags?.length ? { 'X-Artifact-Tags': input.tags.join(',') } : {}),
});

const callCreateArtifactUploadIntent = async (event: LambdaEvent, input: Record<string, unknown>) => {
  const normalized = normalizeArtifactUploadIntentInput(input);
  if (!normalized.ok)
    return toolError(normalized.error, 'maxBytes' in normalized ? { maxBytes: normalized.maxBytes } : {});

  const expiresAt = Date.now() + defaultArtifactUploadTokenTtlMs;

  try {
    const uploadToken = createArtifactUploadToken({
      requestId: normalized.value.requestId,
      artifactKind: normalized.value.artifactKind,
      contentType: normalized.value.contentType,
      filename: normalized.value.filename,
      label: normalized.value.label,
      tags: normalized.value.tags,
      expectedSizeBytes: normalized.value.expectedSizeBytes,
      expectedSha256: normalized.value.expectedSha256,
      expiresAt,
    });

    return toolResult({
      ok: true,
      uploadUrl: getArtifactUploadBaseUrl(event),
      uploadToken,
      expiresAtISO: new Date(expiresAt).toISOString(),
      maxBytes: normalized.maxBytes,
      requiredHeaders: createRequiredArtifactUploadHeaders({ ...normalized.value, uploadToken }),
    });
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error), { maxBytes: normalized.maxBytes });
  }
};

const callArtifactUpload = async (event: LambdaEvent, payload: Record<string, unknown>) => {
  const result = await invokeSaveArtifact(event, payload);

  if ('isError' in result) return result;

  return toolResult(result);
};

const callAction = async (event: LambdaEvent, payload: Record<string, unknown>, resultKey: string) => {
  const result = await invokeSaveJsonBlob(event, payload);

  if ('isError' in result) return result;

  return toolResult({ [resultKey]: result[resultKey] });
};

const callNormalizedAction = async (
  event: LambdaEvent,
  createPayload: () => Record<string, unknown>,
  resultKey: string
) => {
  try {
    return await callAction(event, createPayload(), resultKey);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
};

const defaultFinalArticleCompletionFields = (input: Record<string, unknown>) => {
  if (Object.hasOwn(input, 'current_stage')) return {};

  return { current_stage: null };
};

const createMarkAgentCompletePayload = (input: Record<string, unknown>, agentName: string) => {
  const finalArticleDefaults =
    agentName === 'final_article'
      ? {
          ...defaultFinalArticleCompletionFields(input),
          ...(Object.hasOwn(input, 'next_agent') ? {} : { next_agent: null }),
          ...(Object.hasOwn(input, 'workflow_status') ? {} : { workflow_status: 'completed' }),
          ...(Object.hasOwn(input, 'needs_review') ? {} : { needs_review: false }),
          ...(Object.hasOwn(input, 'last_error') ? {} : { last_error: null }),
        }
      : {};
  const payload = {
    action: 'mark_agent_complete',
    ...finalArticleDefaults,
    ...input,
    agent_name: agentName,
  };

  return {
    ...payload,
    current_stage: normalizeOptionalAgentName(payload.current_stage, 'current_stage'),
    next_agent: normalizeOptionalAgentName(payload.next_agent, 'next_agent'),
  };
};

const callMarkAgentComplete = (event: LambdaEvent, input: Record<string, unknown>, agentName: string) => {
  return callNormalizedAction(event, () => createMarkAgentCompletePayload(input, agentName), 'record');
};

type ArtifactBlobStore = Awaited<ReturnType<typeof getArtifactBlobStore>>;

type ArtifactBrowseOptions = {
  createdAfter?: Date;
  createdBefore?: Date;
  cursor: number;
  includeDeleted: boolean;
  limit: number;
};

const parseJsonBlob = async (store: ArtifactIndexStore, key: string) => {
  const text = await store.get(key);
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const loadArtifactIndexKeysFromPrefix = async (store: ArtifactIndexStore, prefix: string, limit: number) => {
  const keys = await listArtifactIndexKeys(store, prefix);

  return keys.slice(0, limit);
};

const normalizeArtifactReconcileLimit = (limit: unknown) => {
  if (limit === undefined || limit === null) return { ok: true as const, value: ARTIFACT_LIST_DEFAULT_LIMIT };
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > ARTIFACT_LIST_MAX_LIMIT) {
    return { ok: false as const, error: `limit must be an integer from 1 to ${ARTIFACT_LIST_MAX_LIMIT}.` };
  }

  return { ok: true as const, value: limit as number };
};

const normalizeIndexedArtifactReference = (value: unknown) => {
  const record = getRecordValue(value);
  const originalBlobKey = toNonEmptyString(record?.blobKey);
  if (!record || !originalBlobKey) return undefined;

  const normalized = { ...record, blobKey: normalizeArtifactBlobKey(originalBlobKey) };
  if (!isArtifactReference(normalized)) return undefined;

  return { originalBlobKey, reference: { ...normalized, blobKey: originalBlobKey } as ArtifactReference };
};

const getArtifactKindFromBlobKey = (blobKey: string) => normalizeArtifactBlobKey(blobKey).split('/')[0] || '';

const summarizeArtifactReconciliation = (
  indexKey: string,
  reference: ArtifactReference,
  result: Awaited<ReturnType<typeof reconcileArtifactReference>>
) => ({
  indexKey,
  sha256: reference.sha256,
  previousBlobKey: reference.blobKey,
  status: result.status,
  blobKey: result.blobKey,
  ...(result.status === 'found' && result.correctedBlobKey ? { correctedBlobKey: result.correctedBlobKey } : {}),
  ...(result.status === 'missing'
    ? { exactFilenameExists: result.exactFilenameExists, nearbyCount: result.nearbyKeys.length }
    : {}),
  ...(result.status === 'ambiguous' ? { matchingKeys: result.matchingKeys } : {}),
});

type ArtifactReconciliationSummary = ReturnType<typeof summarizeArtifactReconciliation>;

const reconcileArtifactIndexKeys = async (
  artifactStore: ArtifactBlobStore,
  indexStore: ArtifactIndexStore,
  keys: string[],
  artifactKind?: string
) => {
  const results: ArtifactReconciliationSummary[] = [];
  let skipped = 0;

  for (const indexKey of keys) {
    const normalized = normalizeIndexedArtifactReference(await parseJsonBlob(indexStore, indexKey));
    if (!normalized) {
      skipped += 1;
      continue;
    }

    if (artifactKind && getArtifactKindFromBlobKey(normalized.reference.blobKey) !== artifactKind) {
      skipped += 1;
      continue;
    }

    const result = await reconcileArtifactReference(normalized.reference, artifactStore, indexStore, {
      logger: console,
    });
    results.push(summarizeArtifactReconciliation(indexKey, normalized.reference, result));
  }

  return { results, skipped };
};

const normalizeArtifactBrowseLimit = (limit: unknown) => {
  if (limit === undefined || limit === null) return { ok: true as const, value: ARTIFACT_LIST_DEFAULT_LIMIT };
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > ARTIFACT_LIST_MAX_LIMIT) {
    return { ok: false as const, error: `limit must be an integer from 1 to ${ARTIFACT_LIST_MAX_LIMIT}.` };
  }

  return { ok: true as const, value: limit as number };
};

const normalizeArtifactBrowseCursor = (cursor: unknown) => {
  if (cursor === undefined || cursor === null || cursor === '') return { ok: true as const, value: 0 };
  if (typeof cursor !== 'string' || !/^\d+$/.test(cursor)) {
    return { ok: false as const, error: 'cursor must be a cursor string returned by a previous artifact list call.' };
  }

  return { ok: true as const, value: Number(cursor) };
};

const normalizeArtifactBrowseOptions = (
  input: Record<string, unknown>
): ArtifactBrowseOptions | ReturnType<typeof toolError> => {
  const limit = normalizeArtifactBrowseLimit(input.limit);
  if (!limit.ok) return toolError(limit.error);

  const cursor = normalizeArtifactBrowseCursor(input.cursor);
  if (!cursor.ok) return toolError(cursor.error);

  const createdAfter = input.createdAfter === undefined ? undefined : new Date(String(input.createdAfter));
  if (createdAfter && Number.isNaN(createdAfter.getTime()))
    return toolError('createdAfter must be a valid ISO date string.');

  const createdBefore = input.createdBefore === undefined ? undefined : new Date(String(input.createdBefore));
  if (createdBefore && Number.isNaN(createdBefore.getTime())) {
    return toolError('createdBefore must be a valid ISO date string.');
  }

  return {
    limit: limit.value,
    cursor: cursor.value,
    includeDeleted: input.includeDeleted === true,
    createdAfter,
    createdBefore,
  };
};

const isArtifactBrowseOptions = (
  value: ArtifactBrowseOptions | ReturnType<typeof toolError>
): value is ArtifactBrowseOptions => !('isError' in value);

const paginateArtifacts = (artifacts: unknown[], limit: number, cursor: number) => {
  const page = artifacts.slice(cursor, cursor + limit);
  const nextOffset = cursor + page.length;

  return {
    artifacts: page,
    limit,
    cursor: String(cursor),
    nextCursor: nextOffset < artifacts.length ? String(nextOffset) : null,
  };
};

const getArtifactCreatedAtMs = (artifact: unknown) => {
  const value = getRecordValue(artifact);
  const createdAtISO = toNonEmptyString(value?.createdAtISO);

  return createdAtISO ? Date.parse(createdAtISO) : Number.NaN;
};

const filterArtifactsForBrowse = (artifacts: unknown[], options: ArtifactBrowseOptions) => {
  const visibleArtifacts = options.includeDeleted
    ? artifacts
    : artifacts.filter((artifact) => !isDeletedArtifactReference(artifact));

  if (!options.createdAfter && !options.createdBefore) return visibleArtifacts;

  const afterMs = options.createdAfter?.getTime() ?? Number.NEGATIVE_INFINITY;
  const beforeMs = options.createdBefore?.getTime() ?? Number.POSITIVE_INFINITY;

  return visibleArtifacts.filter((artifact) => {
    const createdAtMs = getArtifactCreatedAtMs(artifact);

    return Number.isFinite(createdAtMs) && createdAtMs >= afterMs && createdAtMs <= beforeMs;
  });
};

const listArtifactsFromPointerPrefixes = async (
  event: LambdaEvent,
  prefixes: string[],
  options: ArtifactBrowseOptions
) => {
  const store = (await _mcpInternal.getArtifactIndexBlobStore(event)) as unknown as ArtifactIndexStore;
  const pointerKeys: string[] = [];

  for (const prefix of prefixes) {
    pointerKeys.push(...(await listArtifactIndexKeys(store, prefix)));
  }

  const uniquePointerKeys = [...new Set(pointerKeys)].sort();
  const artifacts = await Promise.all(
    uniquePointerKeys.map(async (key) => resolveArtifactPointer(store, await parseJsonBlob(store, key)))
  );
  const filteredArtifacts = filterArtifactsForBrowse(
    artifacts.filter((artifact) => artifact !== undefined),
    options
  );

  return toolResult(paginateArtifacts(filteredArtifacts, options.limit, options.cursor));
};

const getAdminToolState = async (event: LambdaEvent) => {
  const adminState = await getAdminStateFromEvent(event);

  if (!adminState.authenticated) return toolError(adminState.error || 'A valid admin session token is required.');
  if (!adminState.isAdmin) return toolError('This user is not authorized to browse artifacts.');

  return adminState;
};

const requireAdminToolAccess = async (event: LambdaEvent) => {
  if (hasValidNetlifyPublishSecret(event)) return undefined;

  const adminState = await getAdminToolState(event);

  return 'isError' in adminState ? adminState : undefined;
};

const requireArtifactMigrationAccess = async (event: LambdaEvent) => {
  if (hasValidNetlifyPublishSecret(event)) return undefined;

  return requireAdminToolAccess(event);
};

const normalizeArtifactKindInput = (value: unknown, required: boolean) => {
  const artifactKind = toNonEmptyString(value);
  if (!artifactKind)
    return required ? { ok: false as const, error: 'artifactKind is required.' } : { ok: true as const };
  if (!artifactKindValues.includes(artifactKind as (typeof artifactKindValues)[number])) {
    return { ok: false as const, error: `artifactKind must be one of: ${artifactKindValues.join(', ')}.` };
  }

  return { ok: true as const, artifactKind };
};

const normalizeArtifactSha256Input = (value: unknown) => {
  const sha256 = toNonEmptyString(value)?.toLowerCase();
  if (!sha256) return { ok: false as const, error: 'sha256 is required.' };
  if (!/^[a-f0-9]{64}$/.test(sha256)) return { ok: false as const, error: 'sha256 must be a 64-character hex digest.' };

  return { ok: true as const, sha256 };
};

const loadArtifactReferenceForAdminMutation = async (store: ArtifactIndexStore, requestId: string, sha256: string) => {
  const artifact = await parseJsonBlob(store, requestArtifactReferenceKey(requestId, sha256));

  if (!artifact) return { ok: false as const, error: 'Artifact reference was not found.' };
  if (!isArtifactReference(artifact)) return { ok: false as const, error: 'Artifact reference JSON is invalid.' };

  return { ok: true as const, artifact };
};

const writeArtifactReferenceForAdminMutation = async (
  store: ArtifactIndexStore,
  requestId: string,
  artifact: ArtifactReference
) => {
  await store.setJSON(requestArtifactReferenceKey(requestId, artifact.sha256), artifact, {
    metadata: {
      requestId,
      sha256: artifact.sha256,
      contentType: artifact.contentType,
      ...(artifact.deletedAtISO ? { deletedAtISO: artifact.deletedAtISO } : {}),
    },
  });
};

const normalizeDeletedByInput = (value: unknown, fallback: string) => {
  const deletedBy = toNonEmptyString(value) ?? fallback;

  if (!isSafeArtifactText(deletedBy, artifactReferenceLimits.label)) {
    return {
      ok: false as const,
      error: `deletedBy must be a safe string up to ${artifactReferenceLimits.label} characters.`,
    };
  }

  return { ok: true as const, deletedBy };
};

const getArtifactReferencesForRequest = async (event: LambdaEvent, requestId: string): Promise<ArtifactReference[]> => {
  const store = (await _mcpInternal.getArtifactIndexBlobStore(event)) as unknown as ArtifactIndexStore;
  const pointerPrefix = `by-request/${encodeURIComponent(requestId)}/`;
  const pointerKeys = await listArtifactIndexKeys(store, pointerPrefix);

  const artifacts = pointerKeys.length
    ? await Promise.all(pointerKeys.map(async (key) => resolveArtifactPointer(store, await parseJsonBlob(store, key))))
    : await Promise.all(
        (await listArtifactIndexKeys(store, `request-artifacts/${encodeURIComponent(requestId)}/`)).map((key) =>
          parseJsonBlob(store, key)
        )
      );

  return artifacts.filter(
    (artifact): artifact is ArtifactReference => artifact !== undefined && !isDeletedArtifactReference(artifact)
  );
};

const listArtifactsForRequest = async (event: LambdaEvent, requestId: unknown) => {
  const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
  if (!normalizedRequestId) {
    return toolError('requestId is required.');
  }
  const requestIdValidation = validateRequestId(normalizedRequestId);
  if (!requestIdValidation.ok) return toolError(requestIdValidation.error);

  const artifacts = await getArtifactReferencesForRequest(event, requestIdValidation.value);

  return toolResult({
    artifacts,
  });
};

const getArtifactMetadata = async (event: LambdaEvent, requestId: unknown, sha256: unknown) => {
  const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
  if (!normalizedRequestId) {
    return toolError('requestId is required.');
  }
  const requestIdValidation = validateRequestId(normalizedRequestId);
  if (!requestIdValidation.ok) return toolError(requestIdValidation.error);

  const normalizedSha256 = normalizeArtifactSha256Input(sha256);
  if (!normalizedSha256.ok) return toolError(normalizedSha256.error);

  const store = (await _mcpInternal.getArtifactIndexBlobStore(event)) as unknown as ArtifactIndexStore;
  const artifact = await readArtifactReference(store, requestIdValidation.value, normalizedSha256.sha256);

  if (!artifact) return toolError('Artifact reference was not found.');

  return toolResult(artifact);
};

const listArtifactsByKind = async (event: LambdaEvent, input: Record<string, unknown>) => {
  const unauthorized = await requireAdminToolAccess(event);
  if (unauthorized) return unauthorized;

  const artifactKind = normalizeArtifactKindInput(input.artifactKind, true);
  if (!artifactKind.ok) return toolError(artifactKind.error);

  const options = normalizeArtifactBrowseOptions(input);
  if (!isArtifactBrowseOptions(options)) return options;

  return listArtifactsFromPointerPrefixes(event, [`by-kind/${artifactKind.artifactKind}/`], options);
};

const listArtifactsByRequest = async (event: LambdaEvent, input: Record<string, unknown>) => {
  const unauthorized = await requireAdminToolAccess(event);
  if (unauthorized) return unauthorized;

  const requestId = toNonEmptyString(input.requestId);
  if (!requestId) return toolError('requestId is required.');

  const artifactKind = normalizeArtifactKindInput(input.artifactKind, false);
  if (!artifactKind.ok) return toolError(artifactKind.error);

  const options = normalizeArtifactBrowseOptions(input);
  if (!isArtifactBrowseOptions(options)) return options;

  const prefix = artifactKind.artifactKind
    ? `by-request/${encodeURIComponent(requestId)}/${artifactKind.artifactKind}/`
    : `by-request/${encodeURIComponent(requestId)}/`;

  return listArtifactsFromPointerPrefixes(event, [prefix], options);
};

const searchArtifacts = async (event: LambdaEvent, input: Record<string, unknown>) => {
  const unauthorized = await requireAdminToolAccess(event);
  if (unauthorized) return unauthorized;

  const options = normalizeArtifactBrowseOptions(input);
  if (!isArtifactBrowseOptions(options)) return options;

  const tag = toNonEmptyString(input.tag);
  const normalizedTag = tag ? safePathSegment(tag) : undefined;
  if (tag && !normalizedTag) return toolError('tag must contain at least one safe path character.');

  const prefixes = normalizedTag
    ? [`by-tag/${normalizedTag}/`]
    : artifactKindValues.map((artifactKind) => `by-kind/${artifactKind}/`);

  return listArtifactsFromPointerPrefixes(event, prefixes, options);
};

const requestArtifactKeyPattern = /^request-artifacts\/([^/]+)\/([a-f0-9]{64})\.json$/i;

const parseRequestArtifactIndexKey = (key: string) => {
  const match = key.match(requestArtifactKeyPattern);
  if (!match) return undefined;

  return { requestId: decodeURIComponent(match[1]), sha256: match[2].toLowerCase() };
};

const inferArtifactKindFromContentType = (contentType: unknown) => {
  const normalized = toNonEmptyString(contentType)?.toLowerCase().split(';', 1)[0] ?? '';
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized === 'application/pdf') return 'pdf';
  if (
    normalized.startsWith('text/') ||
    normalized.includes('document') ||
    normalized === 'application/msword' ||
    normalized === 'application/rtf'
  ) {
    return 'doc';
  }
  if (normalized.includes('json') || normalized.includes('csv') || normalized.includes('xml')) return 'data';

  return 'other';
};

const getMigrationArtifactKind = (record: Record<string, unknown>, blobKey: string): string => {
  const explicitKind = toNonEmptyString(record.artifactKind);
  if (explicitKind && artifactKindValues.includes(explicitKind as (typeof artifactKindValues)[number]))
    return explicitKind;

  const [blobKeyKind] = normalizeArtifactBlobKey(blobKey).split('/');
  if (artifactKindValues.includes(blobKeyKind as (typeof artifactKindValues)[number])) return blobKeyKind;

  return inferArtifactKindFromContentType(record.contentType);
};

const migrationControlCharacters = `${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}`;
const unsafeMigrationFilenamePattern = new RegExp(`[${migrationControlCharacters}<>\\\\/]+`, 'gu');
const unsafeMigrationLabelPattern = new RegExp(`[${migrationControlCharacters}<>]+`, 'gu');

const normalizeMigrationFilename = (value: string) => {
  const filename = value.split(/[\\/]/).pop() || value;
  const normalized = filename
    .trim()
    .replace(/\s+/g, ' ')
    .replace(unsafeMigrationFilenamePattern, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, artifactReferenceLimits.originalFilename);

  return normalized || 'artifact';
};

const normalizeMigrationLabel = (value: string) => {
  const normalized = value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(unsafeMigrationLabelPattern, ' ')
    .slice(0, artifactReferenceLimits.label)
    .trim();

  return normalized || 'Artifact';
};

const getMigrationFilename = (record: Record<string, unknown>, blobKey: string, sha256: string) => {
  const metadata = getRecordValue(record.metadata);
  const metadataFilename = toNonEmptyString(metadata?.filename) ?? toNonEmptyString(metadata?.name);
  const existingFilename = toNonEmptyString(record.originalFilename);
  const blobFilename = normalizeArtifactBlobKey(blobKey).split('/').pop();

  return normalizeMigrationFilename(existingFilename ?? metadataFilename ?? blobFilename ?? sha256);
};

const getMigrationTags = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;

  const tags = value.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()));

  return tags.length ? tags : undefined;
};

const migrateArtifactIndexRecord = async (store: ArtifactIndexStore, key: string, input: { dryRun: boolean }) => {
  const parsedKey = parseRequestArtifactIndexKey(key);
  if (!parsedKey) return { indexKey: key, status: 'skipped' as const, reason: 'unexpected request artifact key shape' };

  const raw = await parseJsonBlob(store, key);
  const record = getRecordValue(raw);
  const blobKey = toNonEmptyString(record?.blobKey);
  if (!record || !blobKey) return { indexKey: key, status: 'skipped' as const, reason: 'invalid artifact JSON' };

  const normalizedBlobKey = normalizeArtifactBlobKey(blobKey);
  const artifactKind = getMigrationArtifactKind(record, normalizedBlobKey);
  const originalFilename = getMigrationFilename(record, normalizedBlobKey, parsedKey.sha256);
  const label = normalizeMigrationLabel(toNonEmptyString(record.label) ?? originalFilename);
  const tags = getMigrationTags(record.tags);
  const migratedRecord = {
    ...record,
    blobKey: normalizedBlobKey,
    sha256: parsedKey.sha256,
    artifactKind,
    originalFilename,
    label,
    ...(tags ? { tags } : {}),
  };

  if (!isArtifactReference(migratedRecord)) {
    return { indexKey: key, status: 'skipped' as const, reason: 'artifact JSON is still invalid after migration' };
  }

  const referenceChanged = JSON.stringify(record) !== JSON.stringify(migratedRecord);
  if (!input.dryRun) {
    if (referenceChanged) {
      await writeArtifactReferenceForAdminMutation(store, parsedKey.requestId, migratedRecord);
    } else {
      await writeArtifactReferenceIndexes(store, parsedKey.requestId, migratedRecord);
    }
  }

  return {
    indexKey: key,
    requestId: parsedKey.requestId,
    sha256: parsedKey.sha256,
    artifactKind,
    status: input.dryRun ? ('dry_run' as const) : ('migrated' as const),
    referenceUpdated: referenceChanged,
    pointersWritten: input.dryRun ? 0 : 2,
  };
};

type WipeBlobStore = Awaited<ReturnType<typeof getArtifactBlobStore>>;

type WipeBlobTarget = {
  logicalPrefix: string;
  listPrefix: string;
  store: WipeBlobStore;
};

const WIPE_BLOB_ALLOWED_PREFIXES = [
  'workflows/',
  'artifact-index/',
  ...artifactKindValues.map((kind) => `${kind}/`),
] as const;
const WIPE_BLOB_ALLOWED_PREFIX_SET = new Set<string>(WIPE_BLOB_ALLOWED_PREFIXES);
const WIPE_BLOB_ARTIFACT_PREFIX_SET = new Set<string>(artifactKindValues.map((kind) => `${kind}/`));

const isArtifactWipeBlobPrefix = (prefix: string) => WIPE_BLOB_ARTIFACT_PREFIX_SET.has(prefix);

const normalizeWipeBlobPrefixes = (value: unknown) => {
  if (value === undefined || value === null) {
    return { prefixes: [...WIPE_BLOB_ALLOWED_PREFIXES], skipped: [] as string[] };
  }

  if (!Array.isArray(value)) {
    return { prefixes: [] as string[], skipped: ['prefixes must be an array of strings.'] };
  }

  const prefixes: string[] = [];
  const skipped: string[] = [];
  for (const item of value) {
    const prefix = typeof item === 'string' ? item.trim() : '';
    if (!prefix || !WIPE_BLOB_ALLOWED_PREFIX_SET.has(prefix)) {
      skipped.push(String(item));
      continue;
    }

    if (!prefixes.includes(prefix)) prefixes.push(prefix);
  }

  return { prefixes, skipped };
};

const getWipeBlobTargets = async (event: LambdaEvent, prefixes: string[]): Promise<WipeBlobTarget[]> => {
  const workflowsStorePromise = prefixes.includes('workflows/') ? getWorkflowBlobStore(event) : undefined;
  const artifactIndexStorePromise = prefixes.includes('artifact-index/') ? getArtifactIndexBlobStore(event) : undefined;
  const artifactStorePromise = prefixes.some(isArtifactWipeBlobPrefix) ? getArtifactBlobStore(event) : undefined;

  const workflowsStore = await workflowsStorePromise;
  const artifactIndexStore = await artifactIndexStorePromise;
  const artifactStore = await artifactStorePromise;

  return prefixes.flatMap((prefix) => {
    if (prefix === 'workflows/' && workflowsStore) {
      return [{ logicalPrefix: prefix, listPrefix: prefix, store: workflowsStore }];
    }

    if (prefix === 'artifact-index/' && artifactIndexStore) {
      return [{ logicalPrefix: prefix, listPrefix: '', store: artifactIndexStore }];
    }

    if (artifactStore && isArtifactWipeBlobPrefix(prefix)) {
      return [{ logicalPrefix: prefix, listPrefix: prefix, store: artifactStore }];
    }

    return [];
  });
};

const listWipeBlobTargetKeys = async (target: WipeBlobTarget) => {
  const blobs = await collectBlobListItems(await target.store.list({ prefix: target.listPrefix }));

  return [...new Set(blobs.map((blob) => blob.key))].sort();
};

const toLogicalWipeBlobKey = (target: WipeBlobTarget, key: string) => {
  if (target.logicalPrefix === 'artifact-index/') return `${target.logicalPrefix}${key}`;

  return key;
};

const isWipeBlobKeyAllowed = (target: WipeBlobTarget, key: string) => {
  if (!WIPE_BLOB_ALLOWED_PREFIX_SET.has(target.logicalPrefix)) return false;
  if (target.logicalPrefix === 'artifact-index/') return true;

  return key.startsWith(target.logicalPrefix);
};

const wipeBlobStores = async (event: LambdaEvent, input: Record<string, unknown>) => {
  if (!hasValidNetlifyPublishSecret(event)) {
    return toolError('Unauthorized: a valid server publish key is required.');
  }

  const dryRun = input.dryRun !== false;
  if (!dryRun && input.confirm !== WIPE_BLOB_CONFIRMATION) {
    return toolError(`Live deletion requires confirm to equal ${WIPE_BLOB_CONFIRMATION}.`, {
      dryRun,
      deleted: 0,
      scanned: 0,
      skipped: 0,
      prefixes: [],
      sampleDeletedKeys: [],
    });
  }

  const normalizedPrefixes = normalizeWipeBlobPrefixes(input.prefixes);
  const targets = await getWipeBlobTargets(event, normalizedPrefixes.prefixes);
  let scanned = 0;
  let deleted = 0;
  let skipped = normalizedPrefixes.skipped.length;
  const sampleKeys: string[] = [];
  const sampleDeletedKeys: string[] = [];

  for (const target of targets) {
    const keys = await listWipeBlobTargetKeys(target);

    for (const key of keys) {
      if (!isWipeBlobKeyAllowed(target, key)) {
        skipped += 1;
        continue;
      }

      scanned += 1;
      const logicalKey = toLogicalWipeBlobKey(target, key);
      if (sampleKeys.length < WIPE_BLOB_SAMPLE_LIMIT) sampleKeys.push(logicalKey);

      if (!dryRun) {
        await target.store.del(key);
        deleted += 1;
        if (sampleDeletedKeys.length < WIPE_BLOB_SAMPLE_LIMIT) sampleDeletedKeys.push(logicalKey);
      }
    }
  }

  return toolResult({
    dryRun,
    deleted,
    scanned,
    skipped,
    prefixes: normalizedPrefixes.prefixes,
    sampleKeys,
    sampleDeletedKeys,
    skippedPrefixes: normalizedPrefixes.skipped,
  });
};

const migrateArtifactIndexes = async (event: LambdaEvent, input: Record<string, unknown>) => {
  const unauthorized = await requireArtifactMigrationAccess(event);
  if (unauthorized) return unauthorized;

  const limit = normalizeArtifactReconcileLimit(input.limit);
  if (!limit.ok) return toolError(limit.error);

  const cursor = normalizeArtifactBrowseCursor(input.cursor);
  if (!cursor.ok) return toolError(cursor.error);

  const dryRun = input.dryRun === true;
  const store = (await getArtifactIndexBlobStore(event)) as unknown as ArtifactIndexStore;
  const keys = await listArtifactIndexKeys(store, 'request-artifacts/');
  const pageKeys = keys.slice(cursor.value, cursor.value + limit.value);
  const results: Array<Awaited<ReturnType<typeof migrateArtifactIndexRecord>>> = [];

  for (const key of pageKeys) {
    results.push(await migrateArtifactIndexRecord(store, key, { dryRun }));
  }

  const nextOffset = cursor.value + pageKeys.length;
  const nextCursor = nextOffset < keys.length ? String(nextOffset) : null;
  const checkpoint = {
    cursor: String(cursor.value),
    nextCursor,
    lastKey: pageKeys.at(-1) ?? null,
    processed: results.length,
    totalKeys: keys.length,
  };
  const migrated = results.filter((result) => result.status === 'migrated' || result.status === 'dry_run').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const referenceUpdates = results.filter((result) => 'referenceUpdated' in result && result.referenceUpdated).length;
  const pointerWrites = results.reduce(
    (count, result) => count + ('pointersWritten' in result ? (result.pointersWritten ?? 0) : 0),
    0
  );

  console.info('Artifact index migration checkpoint.', { dryRun, migrated, skipped, referenceUpdates, ...checkpoint });

  return toolResult({
    dryRun,
    scanned: pageKeys.length,
    migrated,
    skipped,
    referenceUpdates,
    pointerWrites,
    checkpoint,
    results,
  });
};

const softDeleteArtifact = async (event: LambdaEvent, input: Record<string, unknown>) => {
  const unauthorized = await requireAdminToolAccess(event);
  if (unauthorized) return unauthorized;

  const adminState = await getAdminToolState(event);

  const requestId = toNonEmptyString(input.requestId);
  if (!requestId) return toolError('requestId is required.');

  const sha256 = normalizeArtifactSha256Input(input.sha256);
  if (!sha256.ok) return toolError(sha256.error);

  const store = (await _mcpInternal.getArtifactIndexBlobStore(event)) as unknown as ArtifactIndexStore;
  const loaded = await loadArtifactReferenceForAdminMutation(store, requestId, sha256.sha256);
  if (!loaded.ok) return toolError(loaded.error);

  const adminEmail = !('isError' in adminState) ? adminState.email : undefined;
  const adminUserId = !('isError' in adminState) ? adminState.userId : undefined;
  const deletedBy = normalizeDeletedByInput(input.deletedBy, adminEmail ?? adminUserId ?? 'admin');
  if (!deletedBy.ok) return toolError(deletedBy.error);

  const deletedArtifact: ArtifactReference = {
    ...loaded.artifact,
    deletedAtISO: loaded.artifact.deletedAtISO ?? new Date().toISOString(),
    deletedBy: loaded.artifact.deletedBy ?? deletedBy.deletedBy,
  };

  await writeArtifactReferenceForAdminMutation(store, requestId, deletedArtifact);

  return toolResult({ artifact: deletedArtifact, deleted: true });
};

const restoreArtifact = async (event: LambdaEvent, input: Record<string, unknown>) => {
  const unauthorized = await requireAdminToolAccess(event);
  if (unauthorized) return unauthorized;

  const requestId = toNonEmptyString(input.requestId);
  if (!requestId) return toolError('requestId is required.');

  const sha256 = normalizeArtifactSha256Input(input.sha256);
  if (!sha256.ok) return toolError(sha256.error);

  const store = (await _mcpInternal.getArtifactIndexBlobStore(event)) as unknown as ArtifactIndexStore;
  const loaded = await loadArtifactReferenceForAdminMutation(store, requestId, sha256.sha256);
  if (!loaded.ok) return toolError(loaded.error);

  const { deletedAtISO, deletedBy, ...restoredArtifact } = loaded.artifact;
  await writeArtifactReferenceForAdminMutation(store, requestId, restoredArtifact);

  return toolResult({ artifact: restoredArtifact, restored: Boolean(deletedAtISO || deletedBy) });
};

const reconcileArtifactIndexes = async (event: LambdaEvent, input: Record<string, unknown>) => {
  const unauthorized = await requireAdminToolAccess(event);
  if (unauthorized) return unauthorized;

  const artifactKind = normalizeArtifactKindInput(input.artifactKind, false);
  if (!artifactKind.ok) return toolError(artifactKind.error);

  const limit = normalizeArtifactReconcileLimit(input.limit);
  if (!limit.ok) return toolError(limit.error);

  const requestId = toNonEmptyString(input.requestId);
  const prefix = requestId ? `request-artifacts/${encodeURIComponent(requestId)}/` : 'request-artifacts/';
  const indexStore = await _mcpInternal.getArtifactIndexBlobStore(event);
  const artifactStore = await getArtifactBlobStore(event);
  const keys = await loadArtifactIndexKeysFromPrefix(indexStore, prefix, limit.value);
  const { results, skipped } = await reconcileArtifactIndexKeys(
    artifactStore,
    indexStore,
    keys,
    artifactKind.artifactKind
  );
  const corrected = results.filter((result) => 'correctedBlobKey' in result).length;
  const found = results.filter((result) => result.status === 'found').length;
  const missing = results.filter((result) => result.status === 'missing').length;
  const ambiguous = results.filter((result) => result.status === 'ambiguous').length;

  return toolResult({
    scanned: keys.length,
    reconciled: results.length,
    corrected,
    found,
    missing,
    ambiguous,
    skipped,
    results,
  });
};

const callTool = async (event: LambdaEvent, name: unknown, args: unknown) => {
  const input = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};

  switch (name) {
    case 'ping':
      return toolResult({ ok: true, server: SERVER_DIAGNOSTIC_NAME });
    case 'save_json_blob_create_request':
      return callAction(
        event,
        {
          action: 'create_request',
          input: input.input,
          request_id: input.request_id ?? createRequestId(),
          current_agent: input.current_agent,
          next_agent: input.next_agent,
          validation_mode: input.validation_mode ?? 'admin_publish_draft',
        },
        'record'
      );

    case 'save_json_blob_create_article_draft':
      return callAction(
        event,
        {
          action: 'create_request',
          input: input.input,
          request_id: input.request_id ?? createRequestId(),
          current_agent: input.current_agent,
          next_agent: input.next_agent,
          validation_mode: 'admin_publish_draft',
        },
        'record'
      );
    case 'save_json_blob_get_request':
      return callAction(event, { action: 'get_request', request_id: input.request_id }, 'record');
    case 'save_json_blob_list_pending_requests':
      return callNormalizedAction(
        event,
        () => ({
          action: 'list_pending_requests',
          stage: normalizeOptionalAgentName(input.stage, 'stage'),
          status: input.status,
          limit: input.limit,
        }),
        'records'
      );
    case 'save_json_blob_checkout_request':
      return callAction(
        event,
        {
          action: 'checkout_request',
          request_id: input.request_id,
          owner_id: input.owner_id,
          owner_label: input.owner_label,
          lease_seconds: input.lease_seconds,
        },
        'record'
      );
    case 'save_json_blob_refresh_lock':
      return callAction(
        event,
        {
          action: 'refresh_lock',
          request_id: input.request_id,
          lock_token: input.lock_token,
          lease_seconds: input.lease_seconds,
        },
        'record'
      );
    case 'save_json_blob_checkin_request':
      return callAction(
        event,
        { action: 'checkin_request', request_id: input.request_id, lock_token: input.lock_token },
        'record'
      );
    case 'save_json_blob_publish_by_time':
      return callPublishByTime(event, input);
    case 'save_json_blob_patch_canonical_input':
      return callAction(
        event,
        {
          action: 'patch_canonical_input',
          request_id: input.request_id,
          lock_token: input.lock_token,
          expected_record_version: input.expected_record_version,
          node_patches: input.node_patches,
          replace_image_asset_register: input.replace_image_asset_register,
          promote_publish_payload: input.promote_publish_payload,
          repair_workflow_status: input.repair_workflow_status,
          clear_last_error: input.clear_last_error,
          clear_failed_agents: input.clear_failed_agents,
          reset_needs_review: input.reset_needs_review,
        },
        'record'
      );
    case 'deploy_status':
      return callDeployStatus(event, input);
    case 'verify_article_images':
      return callVerifyArticleImages(event, input);
    case 'save_json_blob_force_unlock':
      if (!ADMIN_TOOLS_ENABLED) return toolError('Admin tools are not enabled.');
      return callAction(event, { action: 'force_unlock', request_id: input.request_id }, 'record');
    case 'create_artifact_upload_intent':
      return callCreateArtifactUploadIntent(event, input);
    case 'create_artifact_from_url': {
      const requestId = toNonEmptyString(input.requestId);
      if (!requestId) return toolError('requestId is required.');

      const artifactKind = toNonEmptyString(input.artifactKind);
      if (!artifactKind || !artifactKindValues.includes(artifactKind as ArtifactKind)) {
        return toolError(`artifactKind must be one of: ${artifactKindValues.join(', ')}.`);
      }

      const contentType = toNonEmptyString(input.contentType);
      if (!contentType) return toolError('contentType is required.');

      const sourceUrl = toNonEmptyString(input.sourceUrl);
      if (!sourceUrl) return toolError('sourceUrl is required.');

      const expectedSizeBytes = Number(input.expectedSizeBytes);
      if (!Number.isInteger(expectedSizeBytes) || expectedSizeBytes < 0) {
        return toolError('expectedSizeBytes must be a non-negative integer.');
      }

      const expectedSha256 = toNonEmptyString(input.expectedSha256)?.toLowerCase();
      if (!expectedSha256 || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
        return toolError('expectedSha256 must be a 64-character hex digest.');
      }

      const filename = toNonEmptyString(input.filename);
      if (filename && !isSafeArtifactFilename(filename)) {
        return toolError('filename contains unsafe characters or is too long.');
      }

      const label = toNonEmptyString(input.label);
      if (label && !isSafeArtifactText(label, artifactReferenceLimits.label)) {
        return toolError('label contains unsafe characters or is too long.');
      }

      const tags = Array.isArray(input.tags) ? (input.tags as string[]) : undefined;
      if (tags) {
        if (tags.length > artifactReferenceLimits.tags) {
          return toolError(`Too many tags. Max: ${artifactReferenceLimits.tags}`);
        }
        for (const tag of tags) {
          if (!isSafeArtifactText(tag, artifactReferenceLimits.tag)) {
            return toolError(`Tag "${tag}" contains unsafe characters or is too long.`);
          }
        }
      }

      const metadata = getRecordValue(input.metadata);

      const result = await saveArtifactFromUrl({
        requestId,
        artifactKind: artifactKind as ArtifactKind,
        contentType,
        sourceUrl,
        expectedSizeBytes,
        expectedSha256,
        filename,
        label,
        tags,
        metadata,
        event,
      });

      if (!result.ok) {
        return toolError(result.error, {
          statusCode: result.statusCode,
          sourceUrl: result.sourceUrl,
          maxBytes: result.maxBytes,
        });
      }

      return toolResult(result);
    }
    case 'save_artifact':
      return callArtifactUpload(event, {
        requestId: input.requestId,
        artifactKind: input.artifactKind,
        contentType: input.contentType,
        filename: input.filename,
        encoding: input.encoding,
        expectedSizeBytes: input.expectedSizeBytes,
        expectedSha256: input.expectedSha256,
        localSizeBytes: input.localSizeBytes,
        localSha256: input.localSha256,
        payload: input.payload,
        label: input.label,
        tags: input.tags,
        metadata: input.metadata,
      });
    case 'list_artifacts_for_request':
      return listArtifactsForRequest(event, input.requestId);
    case 'get_artifact_metadata':
      return getArtifactMetadata(event, input.requestId, input.sha256);
    case 'list_artifacts_by_kind':
      return listArtifactsByKind(event, input);
    case 'list_artifacts_by_request':
      return listArtifactsByRequest(event, input);
    case 'search_artifacts':
      return searchArtifacts(event, input);
    case 'soft_delete_artifact':
      return softDeleteArtifact(event, input);
    case 'restore_artifact':
      return restoreArtifact(event, input);
    case 'migrate_artifact_indexes':
      return migrateArtifactIndexes(event, input);
    case 'wipe_blob_stores':
      return wipeBlobStores(event, input);
    case 'reconcile_artifact_indexes':
      return reconcileArtifactIndexes(event, input);
    case 'save_json_blob_patch_agent_output':
      return callNormalizedAction(
        event,
        () => ({
          action: 'patch_agent_output',
          request_id: input.request_id,
          agent_name: normalizeAgentName(input.agent_name, 'agent_name'),
          expected_agent_version: input.expected_agent_version,
          lock_token: input.lock_token,
          output: input.output,
        }),
        'record'
      );
    case 'save_json_blob_mark_agent_complete':
      return callMarkAgentComplete(event, input, normalizeAgentName(input.agent_name, 'agent_name') as string);
    default:
      break;
  }

  if (typeof name === 'string') {
    const updateAgent = ALLOWED_AGENTS.find((agentName) => name === `${agentName}_update_output`);
    if (updateAgent) {
      return callAction(
        event,
        {
          action: 'patch_agent_output',
          request_id: input.request_id,
          agent_name: updateAgent,
          expected_agent_version: input.expected_agent_version ?? 0,
          lock_token: input.lock_token,
          output: input.output,
        },
        'record'
      );
    }

    const completeAgent = ALLOWED_AGENTS.find((agentName) => name === `${agentName}_mark_complete`);
    if (completeAgent) {
      return callMarkAgentComplete(event, input, completeAgent);
    }
  }

  return toolError(`Unknown tool: ${String(name)}`);
};

const handleRpcRequest = async (event: LambdaEvent, request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> => {
  const rpcMethod = typeof request.method === 'string' ? request.method : null;
  const slug = getRpcSlug(request);

  event.log?.({ event: 'rpc_request_received', rpcMethod, slug });

  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return rpcError(request.id, -32600, 'Invalid Request');
  }

  const isNotification = !Object.hasOwn(request, 'id');

  if (request.method === 'notifications/initialized') {
    event.log?.({ event: 'rpc_notification_ignored', rpcMethod, slug });
    return undefined;
  }

  if (isNotification) {
    event.log?.({ event: 'rpc_notification_ignored', rpcMethod, slug });
    return undefined;
  }

  switch (request.method) {
    case 'initialize':
      return rpcResponse(request.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: '0.1.0' },
      });
    case 'tools/list':
      return rpcResponse(request.id, { tools: TOOL_DEFINITIONS });
    case 'tools/call':
      event.log?.({ event: 'rpc_tool_call_started', rpcMethod, slug, toolName: request.params?.name });
      return rpcResponse(
        request.id,
        await callTool({ ...event, rpcMethod, slug }, request.params?.name, request.params?.arguments)
      );
    default:
      event.log?.({ event: 'rpc_method_not_found', rpcMethod, slug });
      return rpcError(request.id, -32601, `Method not found: ${request.method}`);
  }
};

export const _mcpInternal = {
  saveJsonBlobHandler,
  publishArticleHandler,
  getArtifactIndexBlobStore,
};

export const handler = async (rawEvent: LambdaEvent, _context?: LambdaContext) => {
  const event = withStructuredLogger(rawEvent);
  event.log?.({ event: 'mcp_request_received', rpcMethod: null, slug: null, httpMethod: event.httpMethod });
  if (event.httpMethod === 'OPTIONS') {
    return emptyResponse(204);
  }

  if (event.httpMethod !== 'POST') {
    return response(405, rpcError(null, -32000, 'Method not allowed.'), { ...jsonHeaders, Allow: 'POST' });
  }

  const authResult = getAuthResult(event);
  if (!authResult.ok) {
    const diagnosticReason = getAuthDiagnosticReason(authResult.reason);
    event.log?.({
      event: 'mcp_auth_rejected',
      rpcMethod: null,
      slug: null,
      hasMcpHttpAuthToken: Boolean(toNonEmptyString(process.env.MCP_HTTP_AUTH_TOKEN)),
      hasMcpAuthTokenHeader: Boolean(toNonEmptyString(getHeader(event.headers, 'x-mcp-auth-token'))),
      hasAuthorizationHeader: Boolean(toNonEmptyString(getHeader(event.headers, 'authorization'))),
      reason: diagnosticReason,
    });

    return response(401, rpcError(null, -32001, 'Unauthorized', { reason: diagnosticReason }));
  }

  let body: JsonRpcRequest | JsonRpcRequest[];

  try {
    body = parseBody(event);
  } catch (error) {
    return response(400, rpcError(null, -32700, 'Parse error', error instanceof Error ? error.message : String(error)));
  }

  try {
    const requests = Array.isArray(body) ? body : [body];
    const results = (await Promise.all(requests.map((request) => handleRpcRequest(event, request)))).filter(
      (result): result is JsonRpcResponse => Boolean(result)
    );

    if (results.length === 0) {
      return emptyResponse(202);
    }

    return response(200, Array.isArray(body) ? results : results[0]);
  } catch (error) {
    event.log?.({
      event: 'mcp_request_failed',
      rpcMethod: null,
      slug: null,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error('Failed to handle MCP JSON-RPC request.', error);

    return response(500, rpcError(null, -32000, 'Internal server error'));
  }
};
