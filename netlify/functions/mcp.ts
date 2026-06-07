import { randomUUID } from 'node:crypto';

import { handler as saveArtifactHandler } from './save-artifact.js';
import { handler as saveJsonBlobHandler } from './save-json-blob.js';
import { getBlobListItems } from '../lib/blob-list.js';
import { getArtifactIndexBlobStore } from '../lib/blob-store.js';

type LambdaEvent = {
  blobs?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
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
const ALLOWED_AGENTS = ['reader_insight', 'research', 'angle', 'draft', 'final_article'] as const;
const ALLOWED_AGENT_SET = new Set<string>(ALLOWED_AGENTS);
const ADMIN_TOOLS_ENABLED = process.env.MCP_ENABLE_ADMIN_TOOLS === 'true';

const jsonHeaders = {
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'mcp-session-id',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

const textContent = (text: string) => [{ type: 'text', text }];

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

const artifactKindJsonSchema = (description?: string) => ({
  type: 'string',
  enum: ['image', 'audio', 'video', 'binary', 'markdown'],
  ...(description ? { description } : {}),
});
const artifactEncodingJsonSchema = (description?: string) => ({
  type: 'string',
  enum: ['base64', 'binary'],
  ...(description ? { description } : {}),
});
const artifactMetadataJsonSchema = metadataBagSchema('Optional artifact metadata saved in the artifact reference.');

const publishPayloadJsonSchema = objectSchema(
  {
    slug: stringSchema('Destination slug for the published article.'),
    title: stringSchema('Published article title.'),
    markdown: stringSchema('Markdown body to publish.'),
    content: stringSchema('Alternate article body content to publish.'),
    description: stringSchema('Published article summary or meta description.'),
    publishDate: stringSchema('Publish date string.'),
    author: stringSchema('Article author name.'),
    tags: stringArraySchema('Article tags.'),
    images: arraySchema({}, 'Image metadata or asset references.'),
    overwrite: { type: 'boolean', description: 'Whether an existing article at the slug may be overwritten.' },
    draft: { type: 'boolean', description: 'Whether to publish the article as a draft.' },
    articlePath: stringSchema('Optional normalized repository path, usually src/data/post/{slug}.md.'),
    category: stringSchema('Article category.'),
    excerpt: stringSchema('Article excerpt.'),
    seoDescription: stringSchema('SEO description.'),
    featuredImage: stringSchema('Featured image filename or path.'),
    existingFeaturedImagePath: stringSchema('Existing repository image path for the featured image.'),
    videoLink: stringSchema('Optional video link.'),
    ctaLink: stringSchema('Optional CTA link.'),
    ctaText: stringSchema('Optional CTA text.'),
    commitMessage: stringSchema('Optional publish commit message.'),
    metadata: metadataBagSchema('Optional publish-payload extension data.'),
  },
  ['slug', 'title'],
  'Publication payload used by the publishing step; include slug, title, and article body fields when ready to publish.'
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
      blocks: arraySchema(contentBlockJsonSchema, 'Structured content blocks.'),
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
      draft_markdown: stringSchema(
        'Markdown draft body agents can pass between drafting, revision, and publishing steps.'
      ),
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
      schema_version: constStringSchema('publication.v1'),
      publication_status: stringSchema('Publication status separate from workflow_status.'),
      publish_payload: publishPayloadJsonSchema,
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
  'Structured content_source.v1 workflow input.'
);

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'save_json_blob_create_request',
    description: 'Create a save-json-blob workflow request and return its record.',
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
    description: 'Fetch a save-json-blob workflow request record by request_id.',
    inputSchema: objectSchema({ request_id: stringSchema() }, ['request_id']),
  },
  {
    name: 'save_json_blob_list_pending_requests',
    description: 'List pending save-json-blob workflow request summaries, optionally filtered by stage and status.',
    inputSchema: objectSchema({
      stage: stringSchema(),
      status: stringSchema(),
      limit: { type: 'integer', minimum: 1, maximum: 1000 },
    }),
  },
  {
    name: 'save_json_blob_patch_agent_output',
    description: `Patch one agent output for a save-json-blob workflow request and return its record. ${workflowLockInstruction}`,
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        agent_name: stringSchema(),
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
        agent_name: stringSchema(),
        expected_record_version: intSchema(),
        lock_token: lockTokenSchema,
        current_stage: nullableStringSchema(),
        next_agent: nullableStringSchema(),
        workflow_status: stringSchema(),
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
    name: 'save_json_blob_mark_published',
    description:
      'Mark a completed workflow record as published after the final article has been validated and publishing has succeeded or been handed off. This tool only updates workflow state; it does not invoke the article publishing endpoint. Server-only publish credentials are never accepted as inputs or returned.',
    inputSchema: objectSchema(
      {
        request_id: stringSchema(),
        lock_token: lockTokenSchema,
        commit_metadata: {
          type: 'object',
          description:
            'Optional publication result metadata such as commit SHA, commit URL, article path, deploy status, and a human-readable message.',
          additionalProperties: true,
        },
      },
      ['request_id', 'lock_token', 'commit_metadata']
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
    name: 'save_artifact',
    description:
      'Single-shot byte upload. Required: requestId, artifactKind, contentType, payload. Agents must call this immediately after creating image, audio, video, binary, or markdown bytes and store only the returned ArtifactReference; never invent blobKey values, URLs, or repo paths. Writes final artifact bytes to the artifact blob store and an ArtifactReference index for the request. Returns artifact, complete=true, deduped; dedup is success and skips rewriting bytes.',
    inputSchema: objectSchema(
      {
        requestId: stringSchema('Workflow request id that owns this artifact.'),
        artifactKind: artifactKindJsonSchema('Artifact kind for storage routing.'),
        contentType: stringSchema('MIME type for the artifact bytes.'),
        filename: stringSchema('Optional original filename used only for the blob extension.'),
        encoding: artifactEncodingJsonSchema('Payload encoding; defaults to base64.'),
        payload: stringSchema('Artifact bytes as base64 unless encoding is binary.'),
        metadata: artifactMetadataJsonSchema,
      },
      ['requestId', 'artifactKind', 'contentType', 'payload']
    ),
  },
  {
    name: 'save_artifact_chunk',
    description:
      'Chunked byte upload. Required: requestId, artifactKind, contentType, clientUploadId, chunkIndex, totalChunks, payload. Agents must call this immediately for large created artifacts and store only the final returned ArtifactReference; never invent blobKey values, URLs, or repo paths. Writes one chunk blob; when all chunks exist, assembles final artifact bytes and writes the request index. Returns complete=false until finalization; dedup is success and skips rewriting bytes.',
    inputSchema: objectSchema(
      {
        requestId: stringSchema('Workflow request id that owns this artifact.'),
        artifactKind: artifactKindJsonSchema('Artifact kind for storage routing.'),
        contentType: stringSchema('MIME type for the complete artifact bytes.'),
        clientUploadId: stringSchema('Stable UUID shared by every chunk in this upload.'),
        chunkIndex: intSchema('Zero-based chunk index.'),
        totalChunks: { type: 'integer', minimum: 1, description: 'Total number of chunks in this upload.' },
        filename: stringSchema('Optional original filename used only for the final blob extension.'),
        encoding: artifactEncodingJsonSchema('Chunk payload encoding; defaults to base64.'),
        payload: stringSchema('Chunk bytes as base64 unless encoding is binary.'),
        metadata: artifactMetadataJsonSchema,
      },
      ['requestId', 'artifactKind', 'contentType', 'clientUploadId', 'chunkIndex', 'totalChunks', 'payload']
    ),
  },
  {
    name: 'list_artifacts_for_request',
    description:
      'List ArtifactReference metadata for a requestId. Required: requestId. Reads the request artifact index only; it does not read or write artifact bytes. Returns artifacts array.',
    inputSchema: objectSchema(
      { requestId: stringSchema('Workflow request id whose artifact references should be listed.') },
      ['requestId']
    ),
  },
  {
    name: 'ping',
    description: 'Diagnostic tool that confirms the MCP server is reachable.',
    inputSchema: objectSchema({}),
  },
  ...ALLOWED_AGENTS.flatMap<ToolDefinition>((agentName) => [
    {
      name: `${agentName}_update_output`,
      description: `Patch ${agentName} output with a lock_token and default expected_agent_version to 0 for the first write. ${workflowLockInstruction}`,
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
          agent_name: stringSchema(
            'Optional for compatibility with save_json_blob_mark_agent_complete; stage helpers always use their hardcoded agent.'
          ),
          expected_record_version: intSchema(),
          lock_token: lockTokenSchema,
          current_stage: nullableStringSchema(),
          next_agent: nullableStringSchema(),
          workflow_status: stringSchema(),
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

const isAuthorized = (event: LambdaEvent) => {
  const token = process.env.MCP_HTTP_AUTH_TOKEN;
  if (!token) return true;

  const authorization = event.headers?.authorization ?? event.headers?.Authorization;

  return authorization === `Bearer ${token}`;
};

const getHeader = (headers: LambdaEvent['headers'], name: string) => {
  const normalizedName = name.toLowerCase();
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);

  return entry?.[1];
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
  const publishSecret = process.env.NETLIFY_PUBLISH_SECRET || process.env.PUBLISH_SECRET;

  if (!publishSecret) {
    return toolError('Server-side workflow storage credentials are not configured.');
  }

  const saveResponse = await saveJsonBlobHandler({
    blobs: event.blobs,
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
  const publishSecret = process.env.NETLIFY_PUBLISH_SECRET || process.env.PUBLISH_SECRET;

  if (!publishSecret) {
    return toolError('Server-side artifact storage is not configured.');
  }

  const saveResponse = await saveArtifactHandler({
    blobs: event.blobs,
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
      typeof parsedBody.error === 'string' ? parsedBody.error : `HTTP ${saveResponse.statusCode}: ${bodyText}`
    );
  }

  return parsedBody;
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

const listArtifactsForRequest = async (event: LambdaEvent, requestId: unknown) => {
  if (typeof requestId !== 'string' || requestId.trim().length === 0) {
    return toolError('requestId is required.');
  }

  const store = await getArtifactIndexBlobStore(event);
  const prefix = `request-artifacts/${encodeURIComponent(requestId)}/`;
  const result = await store.list({ prefix });
  const blobs = getBlobListItems(result);
  const artifacts = await Promise.all(
    blobs.map(async (blob) => {
      const text = await store.get(blob.key);

      if (!text) return undefined;

      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    })
  );

  return toolResult({ artifacts: artifacts.filter((artifact) => artifact !== undefined) });
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
    case 'save_json_blob_mark_published':
      return callAction(
        event,
        {
          action: 'mark_published',
          request_id: input.request_id,
          lock_token: input.lock_token,
          commit_metadata: input.commit_metadata,
        },
        'record'
      );
    case 'save_json_blob_force_unlock':
      if (!ADMIN_TOOLS_ENABLED) return toolError('Admin tools are not enabled.');
      return callAction(event, { action: 'force_unlock', request_id: input.request_id }, 'record');
    case 'save_artifact':
      return callArtifactUpload(event, {
        requestId: input.requestId,
        artifactKind: input.artifactKind,
        contentType: input.contentType,
        filename: input.filename,
        encoding: input.encoding,
        payload: input.payload,
        metadata: input.metadata,
      });
    case 'save_artifact_chunk':
      return callArtifactUpload(event, {
        requestId: input.requestId,
        artifactKind: input.artifactKind,
        contentType: input.contentType,
        filename: input.filename,
        clientUploadId: input.clientUploadId,
        chunkIndex: input.chunkIndex,
        totalChunks: input.totalChunks,
        encoding: input.encoding,
        payload: input.payload,
        metadata: input.metadata,
      });
    case 'list_artifacts_for_request':
      return listArtifactsForRequest(event, input.requestId);
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
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return rpcError(request.id, -32600, 'Invalid Request');
  }

  const isNotification = !Object.hasOwn(request, 'id');

  if (request.method === 'notifications/initialized') {
    return undefined;
  }

  if (isNotification) {
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
      return rpcResponse(request.id, await callTool(event, request.params?.name, request.params?.arguments));
    default:
      return rpcError(request.id, -32601, `Method not found: ${request.method}`);
  }
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return emptyResponse(204);
  }

  if (event.httpMethod !== 'POST') {
    return response(405, rpcError(null, -32000, 'Method not allowed.'), { ...jsonHeaders, Allow: 'POST' });
  }

  if (!isAuthorized(event)) {
    return response(401, rpcError(null, -32001, 'Unauthorized'));
  }

  try {
    const body = parseBody(event);
    const requests = Array.isArray(body) ? body : [body];
    const results = (await Promise.all(requests.map((request) => handleRpcRequest(event, request)))).filter(
      (result): result is JsonRpcResponse => Boolean(result)
    );

    if (results.length === 0) {
      return emptyResponse(202);
    }

    return response(200, Array.isArray(body) ? results : results[0]);
  } catch (error) {
    return response(400, rpcError(null, -32700, 'Parse error', error instanceof Error ? error.message : String(error)));
  }
};
