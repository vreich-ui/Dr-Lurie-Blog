import { randomUUID, timingSafeEqual } from 'node:crypto';
import { handler as saveArtifactHandler } from './save-artifact.js';
import { finalizeUpload } from './save-artifact.js';
import { handler as saveJsonBlobHandler } from './save-json-blob.js';
import { handler as publishArticleHandler } from './publish-article.js';
import { handler as deployStatusHandler } from './deploy-status.js';
import { handler as verifyArticleImagesHandler } from './verify-article-images.js';
import { collectBlobListItems, getBlobListItems } from '../lib/blob-list.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore, getWorkflowBlobStore } from '../lib/blob-store.js';
import { cleanupUploadSessionChunks, createUploadSession, getFinalizeUploadSessionPayload, markUploadSessionFinalized, UPLOAD_SESSION_CHUNK_SIZE_BYTES, UPLOAD_SESSION_MAX_BYTES, } from '../lib/artifact-upload-sessions.js';
import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { allowedAgentNames, publicationStatusDescription, workflowStatuses, } from '../../src/schema/workflow-contract.js';
import { artifactKindValues, artifactReferenceLimits, isArtifactReference, isDeletedArtifactReference, isSafeArtifactText, normalizeArtifactBlobKey, reconcileArtifactReference, safePathSegment, } from '../lib/artifacts.js';
const SERVER_NAME = 'Dr_Lurie_MCP_Server';
const SERVER_DIAGNOSTIC_NAME = 'Dr_Lurie_Science_MCP';
const PROTOCOL_VERSION = '2025-06-18';
const ALLOWED_AGENTS = allowedAgentNames;
const ALLOWED_AGENT_SET = new Set(ALLOWED_AGENTS);
const ADMIN_TOOLS_ENABLED = process.env.MCP_ENABLE_ADMIN_TOOLS === 'true';
const ARTIFACT_LIST_DEFAULT_LIMIT = 50;
const ARTIFACT_LIST_MAX_LIMIT = 100;
const WIPE_BLOB_CONFIRMATION = 'WIPE_BLOBS';
const WIPE_BLOB_SAMPLE_LIMIT = 20;
const SCHEDULED_PUBLISH_DUE_WINDOW_MS = 5 * 60 * 1000;
const SINGLE_SHOT_ARTIFACT_GUIDANCE_MAX_BYTES = 750_000;
const CHUNKED_ARTIFACT_TARGET_CHUNK_BYTES = 256_000;
const jsonHeaders = {
    'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, x-publish-key',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'mcp-session-id',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
};
const textContent = (text) => [{ type: 'text', text }];
const toNonEmptyString = (value) => {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};
const getRecordValue = (value) => value && typeof value === 'object' ? value : undefined;
const safeSecretsMatch = (provided, expected) => {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length)
        return false;
    return timingSafeEqual(providedBuffer, expectedBuffer);
};
const getBearerToken = (authorization) => {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || undefined;
};
const hasValidNetlifyPublishSecret = (event) => {
    const expected = toNonEmptyString(process.env.NETLIFY_PUBLISH_SECRET);
    if (!expected)
        return false;
    const provided = toNonEmptyString(getHeader(event.headers, 'x-publish-key')) ??
        getBearerToken(getHeader(event.headers, 'authorization'));
    return Boolean(provided && safeSecretsMatch(provided, expected));
};
const verifyScheduledPublishToken = (token) => {
    const provided = toNonEmptyString(token);
    const expected = process.env.SCHEDULED_PUBLISH_TOKEN;
    if (!expected) {
        return {
            ok: false,
            error: 'Scheduled publishing is not configured on the server.',
            error_code: 'scheduled_publish_not_configured',
        };
    }
    if (!provided || !safeSecretsMatch(provided, expected)) {
        return {
            ok: false,
            error: 'Scheduled publish token is missing or invalid.',
            error_code: 'invalid_scheduled_publish_token',
        };
    }
    return { ok: true };
};
const getScheduledTime = (publication, publishPayload) => toNonEmptyString(publication.scheduled_for) ??
    toNonEmptyString(publication.scheduledFor) ??
    toNonEmptyString(publishPayload?.scheduled_for) ??
    toNonEmptyString(publishPayload?.scheduledFor);
const parseJsonResponseBody = (bodyText) => {
    if (!bodyText)
        return {};
    try {
        return JSON.parse(bodyText);
    }
    catch {
        return { error: bodyText };
    }
};
const toolResult = (payload) => ({
    content: textContent(JSON.stringify(payload, null, 2)),
    structuredContent: payload,
});
const toolError = (message, payload = {}) => ({
    isError: true,
    content: textContent(message),
    structuredContent: { error: message, ...payload },
});
const sanitizeWorkflowLock = (lock) => {
    if (!lock || typeof lock !== 'object')
        return undefined;
    const record = lock;
    return {
        owner_id: record.owner_id,
        owner_label: record.owner_label,
        acquired_at: record.acquired_at,
        expires_at: record.expires_at,
    };
};
const sanitizeWorkflowErrorPayload = (payload) => {
    const sanitized = { ...payload };
    const lock = sanitizeWorkflowLock(payload.lock);
    if (lock)
        sanitized.lock = lock;
    return sanitized;
};
const agentList = () => ALLOWED_AGENTS.join('|');
const workflowLockInstruction = 'Agents must call checkout first to acquire a lock_token, then patch output with that lock_token, then mark complete with that lock_token, then check in when done or refresh the lock before it expires as needed.';
const STAGE_TRANSITIONS = {
    reader_insight: { nextAgent: 'research' },
    research: { nextAgent: 'angle' },
    angle: { nextAgent: 'draft' },
    draft: { nextAgent: 'final_article' },
    final_article: { nextAgent: null, workflowStatus: 'completed' },
};
const stageTransitionDescription = (agentName) => {
    const transition = STAGE_TRANSITIONS[agentName];
    const nextAgent = transition.nextAgent === null ? 'null' : transition.nextAgent;
    const workflowStatus = transition.workflowStatus ? ` with workflow_status: "${transition.workflowStatus}"` : '';
    return `Common transition: ${agentName} → ${nextAgent}${workflowStatus}.`;
};
const normalizeAgentName = (value, fieldName) => {
    if (value === null || value === undefined)
        return value;
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
const normalizeOptionalAgentName = (value, fieldName) => {
    if (value === undefined || value === null)
        return value;
    return normalizeAgentName(value, fieldName);
};
const createRequestId = () => `req_${randomUUID()}`;
const stringSchema = (description) => ({
    type: 'string',
    minLength: 1,
    ...(description ? { description } : {}),
});
const intSchema = (description) => ({ type: 'integer', minimum: 0, ...(description ? { description } : {}) });
const nullableStringSchema = (description) => ({
    anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    ...(description ? { description } : {}),
});
const constStringSchema = (value, description) => ({
    type: 'string',
    const: value,
    ...(description ? { description } : {}),
});
const lockTokenSchema = stringSchema('Lock token returned by checkout_request; required for mutating workflow records.');
const ownerIdSchema = stringSchema('Stable owner id for the agent or process acquiring the workflow lock.');
const ownerLabelSchema = stringSchema('Human-readable owner label for the agent or process acquiring the workflow lock.');
const leaseSecondsSchema = {
    type: 'integer',
    minimum: 1,
    description: 'Optional lock lease duration in seconds; backend default applies when omitted.',
};
const objectSchema = (properties, required = [], description) => ({
    type: 'object',
    ...(description ? { description } : {}),
    properties,
    required,
    additionalProperties: false,
});
const arraySchema = (items, description) => ({
    type: 'array',
    items,
    ...(description ? { description } : {}),
});
const stringArraySchema = (description) => arraySchema({ type: 'string' }, description);
const metadataBagSchema = (description) => ({
    type: 'object',
    description,
    properties: {},
    additionalProperties: true,
});
const agentNameJsonSchema = (description) => ({
    type: 'string',
    enum: ALLOWED_AGENTS,
    ...(description ? { description } : {}),
});
const nullableAgentNameJsonSchema = (description) => ({
    anyOf: [{ type: 'string', enum: ALLOWED_AGENTS }, { type: 'null' }],
    ...(description ? { description } : {}),
});
const workflowStatusJsonSchema = (description) => ({
    type: 'string',
    enum: workflowStatuses,
    ...(description ? { description } : {}),
});
const adminPublishValidationModeSchema = {
    type: 'string',
    enum: ['admin_publish_draft'],
    description: 'Required validation mode for MCP-created admin-publish article drafts. The backend rejects skeletal drafts unless publication.publish_payload.title (or content.title), publication.publish_payload.slug (or content.title), publication.publish_payload.author, and a body field at publication.publish_payload.markdown, publication.publish_payload.content, editorial.draft_markdown, or content.blocks markdown are present.',
};
const artifactKindJsonSchema = (description) => ({
    type: 'string',
    enum: [...artifactKindValues],
    ...(description ? { description } : {}),
});
const artifactEncodingJsonSchema = (description) => ({
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
const expectedSizeBytesJsonSchema = intSchema('Optional expected complete artifact byte size for upload integrity checks.');
const expectedSha256JsonSchema = {
    type: 'string',
    pattern: '^[a-fA-F0-9]{64}$',
    description: 'Optional expected complete artifact SHA-256 hex digest for upload integrity checks.',
};
const uploadDirectoryJsonSchema = stringSchema('Optional repository upload directory used to derive metadata.repoPath, e.g. src/assets/images/uploads/<slug>/.');
const uploadSessionCreateInputSchema = () => objectSchema({
    requestId: stringSchema('Workflow request id that owns this artifact.'),
    artifactKind: artifactKindJsonSchema('Artifact kind for storage routing.'),
    contentType: stringSchema('MIME type for the artifact bytes.'),
    filename: {
        ...stringSchema('Optional original filename used for final blob extension and ArtifactReference originalFilename.'),
        maxLength: artifactReferenceLimits.originalFilename,
    },
    expectedSizeBytes: {
        ...expectedSizeBytesJsonSchema,
        maximum: UPLOAD_SESSION_MAX_BYTES,
    },
    expectedSha256: expectedSha256JsonSchema,
    label: artifactLabelJsonSchema,
    tags: artifactTagsJsonSchema,
    metadata: artifactMetadataJsonSchema,
    uploadDirectory: uploadDirectoryJsonSchema,
}, ['requestId', 'artifactKind', 'contentType', 'expectedSizeBytes', 'expectedSha256']);
const uploadSessionFinalizeInputSchema = () => objectSchema({
    sessionId: stringSchema('Upload session id returned by create_upload_session.'),
    requestId: stringSchema('Workflow request id that owns this artifact.'),
    artifactKind: artifactKindJsonSchema('Artifact kind for storage routing.'),
    contentType: stringSchema('MIME type for the artifact bytes.'),
    filename: {
        ...stringSchema('Optional original filename used for final blob extension and ArtifactReference originalFilename.'),
        maxLength: artifactReferenceLimits.originalFilename,
    },
    expectedSizeBytes: {
        ...expectedSizeBytesJsonSchema,
        maximum: UPLOAD_SESSION_MAX_BYTES,
    },
    expectedSha256: expectedSha256JsonSchema,
    label: artifactLabelJsonSchema,
    tags: artifactTagsJsonSchema,
    metadata: artifactMetadataJsonSchema,
    uploadDirectory: uploadDirectoryJsonSchema,
}, ['sessionId', 'requestId', 'artifactKind', 'contentType', 'expectedSizeBytes', 'expectedSha256']);
const artifactListLimitJsonSchema = {
    type: 'integer',
    minimum: 1,
    maximum: ARTIFACT_LIST_MAX_LIMIT,
    description: `Optional result limit; defaults to ${ARTIFACT_LIST_DEFAULT_LIMIT}, max ${ARTIFACT_LIST_MAX_LIMIT}.`,
};
const artifactListCursorJsonSchema = stringSchema('Optional opaque pagination cursor returned by a previous list call.');
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
const wipeBlobConfirmJsonSchema = stringSchema(`Required only for live deletion; must equal ${WIPE_BLOB_CONFIRMATION}.`);
const wipeBlobPrefixesJsonSchema = arraySchema({ type: 'string', enum: ['workflows/', 'artifact-index/', ...artifactKindValues.map((kind) => `${kind}/`)] }, 'Optional logical prefixes to wipe. Defaults to all app-managed prefixes.');
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
const isoDateStringSchema = (description) => ({
    type: 'string',
    format: 'date-time',
    description,
});
const publishPayloadJsonSchema = objectSchema({
    slug: stringSchema('Destination slug for the published article; admin import requires this or enough content.title text to compute one.'),
    title: stringSchema('Published article title; admin import requires this or content.title.'),
    markdown: stringSchema('Markdown body to publish; one accepted admin-import body field.'),
    content: stringSchema('Alternate article body content to publish; one accepted admin-import body field.'),
    description: stringSchema('Published article summary or meta description.'),
    publishDate: stringSchema('Publish date string.'),
    author: stringSchema('Article author name; required for admin import.'),
    tags: stringArraySchema('Article tags.'),
    images: arraySchema({}, 'Image metadata or asset references.'),
    mediaEntries: arraySchema({}, 'Permissive media entry payloads accepted by the runtime publisher; use for existing base64 media entries when needed.'),
    artifactReferences: arraySchema({}, 'ArtifactReference objects returned by save_artifact or save_artifact_chunk. Store these objects exactly as returned; never invent or rewrite blobKey, sha256, size, contentType, or timestamp values.'),
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
}, ['slug', 'title'], 'Publication payload used by the publishing step. MCP-created admin-publish drafts must include publication.publish_payload.title or content.title, publication.publish_payload.slug or content.title, publication.publish_payload.author, and one body field: publication.publish_payload.markdown, publication.publish_payload.content, editorial.draft_markdown, or content.blocks markdown.');
const contentBlockJsonSchema = objectSchema({
    block_id: stringSchema('Stable block identifier.'),
    block_type: stringSchema('Block kind such as markdown, image, cta, or quiz.'),
    payload: { description: 'Block payload for the declared block_type; use metadata bags for non-contract fields.' },
    section_id: stringSchema('Optional section id this block belongs to.'),
}, ['block_id', 'block_type']);
const claimJsonSchema = objectSchema({
    claim_id: stringSchema('Stable claim identifier.'),
    claim_text: stringSchema('Verifiable claim text to fact-check or preserve.'),
    claim_type: stringSchema('Claim category such as factual, medical, product, or comparative.'),
    source_ids: stringArraySchema('Source ids that support or contextualize the claim.'),
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Agent confidence from 0 to 1.' },
    status: stringSchema('Review status such as proposed, verified, needs_source, or rejected.'),
    metadata: metadataBagSchema('Optional claim-specific extension data.'),
}, ['claim_text']);
const complianceRequirementJsonSchema = objectSchema({
    requirement_id: stringSchema('Stable compliance requirement identifier.'),
    category: stringSchema('Requirement category such as medical_claim, disclosure, source_quality, or privacy.'),
    description: stringSchema('Plain-language compliance requirement.'),
    status: stringSchema('Compliance status such as pending, satisfied, needs_review, or blocked.'),
    related_claim_ids: stringArraySchema('Claim ids this requirement applies to.'),
    notes: stringSchema('Reviewer or agent notes.'),
    metadata: metadataBagSchema('Optional compliance-specific extension data.'),
}, ['category', 'description']);
const commercialOfferJsonSchema = objectSchema({
    offer_id: stringSchema('Stable offer identifier.'),
    name: stringSchema('Offer or product name.'),
    url: stringSchema('Destination URL for the offer.'),
    cta_text: stringSchema('CTA text associated with the offer.'),
    disclosure: stringSchema('Commercial disclosure text.'),
    placement: stringSchema('Suggested article placement or section id.'),
    metadata: metadataBagSchema('Optional offer-specific extension data.'),
}, ['name']);
const imagePromptJsonSchema = objectSchema({
    prompt_id: stringSchema('Stable image prompt identifier.'),
    prompt: stringSchema('Image-generation prompt text.'),
    purpose: stringSchema('Use case such as hero, inline, diagram, or social.'),
    status: stringSchema('Prompt status such as proposed, approved, generated, or rejected.'),
    metadata: metadataBagSchema('Optional prompt-specific extension data.'),
}, ['prompt_id', 'prompt']);
const imageAssetJsonSchema = objectSchema({
    asset_id: stringSchema('Stable image asset identifier.'),
    source: stringSchema('Asset source such as upload, generated, remote, or existing_repo.'),
    url: stringSchema('Public or remote image URL when available.'),
    repoPath: stringSchema('Repository path for publishable image assets.'),
    alt: stringSchema('Accessible alt text.'),
    caption: stringSchema('Optional display caption.'),
    prompt_id: stringSchema('Image prompt id that produced this asset, if applicable.'),
    status: stringSchema('Asset status such as proposed, approved, uploaded, or rejected.'),
    metadata: metadataBagSchema('Optional asset-specific extension data.'),
}, ['asset_id']);
const revisionRequestJsonSchema = objectSchema({
    request_id: stringSchema('Stable revision request identifier.'),
    requested_by_agent: agentNameJsonSchema('Agent requesting the revision.'),
    target_section_id: stringSchema('Target content section id, if the request is section-specific.'),
    priority: stringSchema('Priority such as low, normal, high, or blocking.'),
    instruction: stringSchema('Concrete revision instruction.'),
    status: stringSchema('Revision status such as open, accepted, rejected, or resolved.'),
    metadata: metadataBagSchema('Optional revision-specific extension data.'),
}, ['request_id', 'instruction']);
const contentSourceV1JsonSchema = objectSchema({
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
            sections: arraySchema(objectSchema({
                section_id: stringSchema('Stable section identifier.'),
                role: stringSchema('Section role, such as intro, body, or conclusion.'),
                name: stringSchema('Human-readable section name.'),
                block_refs: stringArraySchema('Block ids included in this section.'),
            }, ['section_id'])),
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
        image_generation_runs: arraySchema(objectSchema({
            run_id: stringSchema('Stable generation run identifier.'),
            prompt_id: stringSchema('Prompt id used for this run.'),
            provider: stringSchema('Generation provider or tool.'),
            status: stringSchema('Generation status.'),
            asset_ids: stringArraySchema('Image asset ids produced by this run.'),
            metadata: metadataBagSchema('Optional generation-run extension data.'),
        }), 'Image generation run records.'),
        image_asset_register: arraySchema(imageAssetJsonSchema, 'Concrete image asset records.'),
        image_sets: arraySchema(objectSchema({
            set_id: stringSchema('Stable image set identifier.'),
            purpose: stringSchema('Image set purpose such as article, social, or thumbnail.'),
            asset_ids: stringArraySchema('Assets included in this set.'),
            metadata: metadataBagSchema('Optional image-set extension data.'),
        }), 'Image set records.'),
        media_revision_summary: objectSchema({
            summary: stringSchema('Summary of media revisions.'),
            resolved_request_ids: stringArraySchema('Revision request ids resolved by this media pass.'),
            metadata: metadataBagSchema('Optional media-revision extension data.'),
        }),
    }),
    editorial: objectSchema({
        schema_version: constStringSchema('editorial.v1'),
        writer_notes: stringSchema('Notes for writers and editors.'),
        draft_markdown: stringSchema('Markdown draft body agents can pass between drafting, revision, and publishing steps.'),
    }),
    sources: objectSchema({
        schema_version: constStringSchema('sources.v1'),
        source_list: arraySchema(objectSchema({
            source_id: stringSchema('Stable source id.'),
            name: stringSchema('Source name.'),
            url: stringSchema('Source URL.'),
            publisher: stringSchema('Source publisher.'),
            accessed_at: stringSchema('Access timestamp.'),
        }, ['name', 'url']), 'Cited sources.'),
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
        publication_status: stringSchema(publicationStatusDescription),
        scheduled_for: stringSchema('ISO timestamp for scheduled publication. Due scheduled-publish calls may publish when this timestamp is now, in the past, or within the short server due window.'),
        publish_payload: publishPayloadJsonSchema,
    }),
    workflow: objectSchema({
        schema_version: constStringSchema('content_workflow.v1'),
        workflow_id: stringSchema('Workflow identifier agents should preserve across handoffs and backend workflow records.'),
        current_agent: agentNameJsonSchema('Agent currently responsible for this content-source handoff.'),
        previous_agent: nullableAgentNameJsonSchema('Agent that handed off this content source, if any.'),
        next_agent: nullableAgentNameJsonSchema('Agent expected to receive the next handoff, if any.'),
        handoff_notes: stringSchema('Concise handoff notes for the next agent.'),
        metadata: metadataBagSchema('Optional workflow-handoff extension data.'),
    }),
    revision_control: objectSchema({
        schema_version: constStringSchema('revision_control.v1'),
        audit_findings: arraySchema(objectSchema({
            finding_id: stringSchema('Stable audit finding identifier.'),
            severity: stringSchema('Finding severity.'),
            finding: stringSchema('Audit finding text.'),
            metadata: metadataBagSchema('Optional audit-finding extension data.'),
        }), 'Audit findings.'),
        routing_decisions: arraySchema(objectSchema({
            decision_id: stringSchema('Stable routing decision identifier.'),
            from_agent: agentNameJsonSchema('Agent making the routing decision.'),
            to_agent: nullableAgentNameJsonSchema('Agent receiving the next route, or null when complete.'),
            reason: stringSchema('Routing rationale.'),
            metadata: metadataBagSchema('Optional routing-decision extension data.'),
        }), 'Routing decisions.'),
        revision_requests: arraySchema(revisionRequestJsonSchema, 'Concrete revision requests.'),
        change_assessments: arraySchema(objectSchema({
            assessment_id: stringSchema('Stable change assessment identifier.'),
            revision_request_id: stringSchema('Revision request id this assessment addresses.'),
            outcome: stringSchema('Assessment outcome.'),
            notes: stringSchema('Assessment notes.'),
            metadata: metadataBagSchema('Optional change-assessment extension data.'),
        }), 'Change assessments.'),
    }),
    versioning: objectSchema({
        schema_version: constStringSchema('versioning.v1'),
        record_version: intSchema('Content-source record version agents should increment or preserve for revision tracking.'),
        previous_version_refs: stringArraySchema('Previous content-source version references.'),
    }),
}, ['record_type', 'schema_version'], 'Structured content_source.v1 workflow input. For MCP admin-publish drafts, include importable article fields: publication.publish_payload.title or content.title, publication.publish_payload.slug or content.title, publication.publish_payload.author, and publication.publish_payload.markdown, publication.publish_payload.content, editorial.draft_markdown, or content.blocks markdown.');
const TOOL_DEFINITIONS = [
    {
        name: 'save_json_blob_create_request',
        description: 'Create a save-json-blob workflow request and return its record. MCP-created article drafts are validated as admin-publish drafts: include publication.publish_payload.title or content.title, publication.publish_payload.slug or content.title, publication.publish_payload.author, and a body at publication.publish_payload.markdown, publication.publish_payload.content, editorial.draft_markdown, or content.blocks markdown.',
        inputSchema: objectSchema({
            input: contentSourceV1JsonSchema,
            request_id: stringSchema('Optional request id. A UUID-based id is generated when omitted.'),
            current_agent: agentNameJsonSchema('Optional initial current agent; defaults to input.workflow.current_agent or no current stage.'),
            next_agent: nullableAgentNameJsonSchema('Optional initial next agent; defaults to input.workflow.next_agent or reader_insight.'),
            validation_mode: adminPublishValidationModeSchema,
        }, ['input', 'validation_mode']),
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
            stage: agentNameJsonSchema(),
            status: workflowStatusJsonSchema(),
            limit: { type: 'integer', minimum: 1, maximum: 1000 },
        }),
    },
    {
        name: 'save_json_blob_patch_agent_output',
        description: `Patch one agent output for a save-json-blob workflow request and return its record. ${workflowLockInstruction}`,
        inputSchema: objectSchema({
            request_id: stringSchema(),
            agent_name: agentNameJsonSchema(),
            expected_agent_version: intSchema(),
            lock_token: lockTokenSchema,
            output: { description: 'Agent output payload.' },
        }, ['request_id', 'agent_name', 'expected_agent_version', 'lock_token', 'output']),
    },
    {
        name: 'save_json_blob_mark_agent_complete',
        description: `Mark one agent complete for a save-json-blob workflow request and return its record. ${workflowLockInstruction}`,
        inputSchema: objectSchema({
            request_id: stringSchema(),
            agent_name: agentNameJsonSchema(),
            expected_record_version: intSchema(),
            lock_token: lockTokenSchema,
            current_stage: nullableAgentNameJsonSchema(),
            next_agent: nullableAgentNameJsonSchema(),
            workflow_status: workflowStatusJsonSchema(),
            needs_review: { type: 'boolean' },
            last_error: nullableStringSchema(),
        }, ['request_id', 'agent_name', 'expected_record_version', 'lock_token']),
    },
    {
        name: 'save_json_blob_checkout_request',
        description: `Checkout a save-json-blob workflow request and acquire a lock_token before patching output. ${workflowLockInstruction}`,
        inputSchema: objectSchema({
            request_id: stringSchema(),
            owner_id: ownerIdSchema,
            owner_label: ownerLabelSchema,
            lease_seconds: leaseSecondsSchema,
        }, ['request_id', 'owner_id', 'owner_label']),
    },
    {
        name: 'save_json_blob_refresh_lock',
        description: `Refresh an active workflow lock before it expires when more time is needed. ${workflowLockInstruction}`,
        inputSchema: objectSchema({ request_id: stringSchema(), lock_token: lockTokenSchema, lease_seconds: leaseSecondsSchema }, ['request_id', 'lock_token']),
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
        description: 'Mark a completed workflow record as published after the final article has been validated and publishing has succeeded or been handed off. This tool only updates workflow state; it does not invoke the article publishing endpoint. Server-only publish credentials are never accepted as inputs or returned.',
        inputSchema: objectSchema({
            request_id: stringSchema(),
            expected_record_version: intSchema('Optional workflow record version that should be visible before marking published.'),
            lock_token: lockTokenSchema,
            commit_metadata: {
                type: 'object',
                description: 'Optional publication result metadata such as commit SHA, commit URL, article path, deploy status, and a human-readable message.',
                additionalProperties: true,
            },
        }, ['request_id', 'lock_token', 'commit_metadata']),
    },
    {
        name: 'save_json_blob_publish_scheduled',
        description: 'Publish a due scheduled content_source.v1 record to GitHub, then mark the workflow published. Requires checkout lock_token, agent identity, publication.publication_status: scheduled, publication.scheduled_for due now or in the short server due window, and a server-configured scheduled publish token. Returns structured reasons when validation or publishing prevents publication. Server-only publish credentials are never accepted as inputs or returned.',
        inputSchema: objectSchema({
            request_id: stringSchema(),
            expected_record_version: intSchema('Optional workflow record version that should be visible before marking published.'),
            lock_token: lockTokenSchema,
            scheduled_publish_token: stringSchema('One-time or short-lived scheduled publish authorization token provided by an admin-controlled channel.'),
            agent_id: stringSchema('Stable identifier for the agent or process requesting scheduled publication.'),
            agent_owner: stringSchema('Human, team, or admin owner responsible for the scheduled publishing agent.'),
            agent_label: stringSchema('Optional human-readable label for audit metadata.'),
        }, ['request_id', 'lock_token', 'scheduled_publish_token', 'agent_id', 'agent_owner']),
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
        description: 'Verify that a published article page contains expected image URLs and that each expected image is fetchable as an image. Server-only publish credentials are never accepted as inputs or returned.',
        inputSchema: objectSchema({
            url: stringSchema('Published article URL to fetch and inspect for <img> sources.'),
            expectedImages: {
                type: 'array',
                items: stringSchema('Expected image URL or page-relative image path.'),
                description: 'Expected image URLs or page-relative image paths that must appear in the article HTML.',
            },
        }, ['url', 'expectedImages']),
    },
    ...(ADMIN_TOOLS_ENABLED
        ? [
            {
                name: 'save_json_blob_force_unlock',
                description: 'Admin-only emergency tool that forcefully releases a workflow lock. Prefer checkin_request with the valid lock_token whenever possible.',
                inputSchema: objectSchema({ request_id: stringSchema() }, ['request_id']),
            },
        ]
        : []),
    {
        name: 'save_artifact',
        description: `Single-shot byte upload and preferred/default artifact path. Required: requestId, artifactKind, contentType, payload. Agents must call this immediately after creating image, pdf, video, doc, audio, data, attachment, or other bytes and store only the returned ArtifactReference; never invent blobKey values, URLs, or repo paths. Prefer this tool for normal web images and artifacts up to ${SINGLE_SHOT_ARTIFACT_GUIDANCE_MAX_BYTES} raw bytes; 50-150 KB JPEG/PNG images should be uploaded in one call, not chunked. Writes final artifact bytes to the artifact blob store and an ArtifactReference index for the request. Returns artifact, complete=true, deduped; dedup is success and skips rewriting bytes.`,
        inputSchema: objectSchema({
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
            payload: stringSchema(`Artifact bytes as base64 unless encoding is binary. Preferred for normal web images up to ${SINGLE_SHOT_ARTIFACT_GUIDANCE_MAX_BYTES} raw bytes; do not chunk merely because an image is around 50 KB.`),
            label: artifactLabelJsonSchema,
            tags: artifactTagsJsonSchema,
            metadata: artifactMetadataJsonSchema,
        }, ['requestId', 'artifactKind', 'contentType', 'payload']),
    },
    {
        name: 'save_artifact_chunk',
        description: `Chunked byte upload fallback for artifacts too large for one MCP tool call. Required: requestId, artifactKind, contentType, clientUploadId, chunkIndex, totalChunks, payload. Do not use this for ordinary 50-150 KB generated web images; call save_artifact once instead. Use chunks only after a single-shot upload is rejected by client/tool payload limits or when the raw artifact is larger than ${SINGLE_SHOT_ARTIFACT_GUIDANCE_MAX_BYTES} bytes. When chunking is necessary, use the largest safe chunks the client accepts, targeting about ${CHUNKED_ARTIFACT_TARGET_CHUNK_BYTES} raw bytes per chunk rather than many tiny chunks. Store only the final returned ArtifactReference; never invent blobKey values, URLs, or repo paths. Writes one chunk blob; when all chunks exist, assembles final artifact bytes and writes the request index. Returns complete=false until finalization; dedup is success and skips rewriting bytes.`,
        inputSchema: objectSchema({
            requestId: stringSchema('Workflow request id that owns this artifact.'),
            artifactKind: artifactKindJsonSchema('Artifact kind for storage routing.'),
            contentType: stringSchema('MIME type for the complete artifact bytes.'),
            clientUploadId: stringSchema('Stable UUID shared by every chunk in this upload.'),
            chunkIndex: intSchema('Zero-based chunk index.'),
            totalChunks: {
                type: 'integer',
                minimum: 1,
                description: 'Total number of chunks in this upload. For normal 50-150 KB images, use save_artifact instead of splitting into chunks.',
            },
            filename: {
                ...stringSchema('Optional original filename used for final blob extension and ArtifactReference originalFilename.'),
                maxLength: artifactReferenceLimits.originalFilename,
            },
            encoding: artifactEncodingJsonSchema('Chunk payload encoding; defaults to base64.'),
            expectedSizeBytes: expectedSizeBytesJsonSchema,
            expectedSha256: expectedSha256JsonSchema,
            localSizeBytes: expectedSizeBytesJsonSchema,
            localSha256: expectedSha256JsonSchema,
            payload: stringSchema(`Chunk bytes as base64 unless encoding is binary. Only use when the complete artifact is too large for save_artifact; target about ${CHUNKED_ARTIFACT_TARGET_CHUNK_BYTES} raw bytes per chunk when possible.`),
            label: artifactLabelJsonSchema,
            tags: artifactTagsJsonSchema,
            metadata: artifactMetadataJsonSchema,
        }, ['requestId', 'artifactKind', 'contentType', 'clientUploadId', 'chunkIndex', 'totalChunks', 'payload']),
    },
    {
        name: 'save_artifact_create_upload_session',
        description: `Create a short-lived artifact upload session for larger binary assets without sending bytes through MCP. Required: requestId, artifactKind, contentType, expectedSizeBytes, expectedSha256. Returns sessionId, uploadUrl, uploadToken, chunkSizeBytes=${UPLOAD_SESSION_CHUNK_SIZE_BYTES}, maxBytes=${UPLOAD_SESSION_MAX_BYTES}, and totalChunks. Use for artifacts larger than about 30 KB and up to ${UPLOAD_SESSION_MAX_BYTES} bytes. Upload chunks with HTTP PUT application/octet-stream to uploadUrl using x-upload-token, x-session-id, x-chunk-index, x-total-chunks, and optional x-chunk-sha256 headers, then call save_artifact_finalize_upload_session.`,
        inputSchema: uploadSessionCreateInputSchema(),
    },
    {
        name: 'create_upload_session',
        description: `Create a short-lived artifact upload session. Alias of save_artifact_create_upload_session with output fields sessionId, uploadUrl, uploadToken, chunkSizeBytes, maxBytes, and totalChunks. Required: requestId, artifactKind, contentType, expectedSizeBytes, expectedSha256. Optional: filename, label, tags, metadata, uploadDirectory. Upload chunks with HTTP PUT application/octet-stream to uploadUrl using x-upload-token, x-session-id, x-chunk-index, x-total-chunks, and optional x-chunk-sha256 headers, then call finalize_upload_session.`,
        inputSchema: uploadSessionCreateInputSchema(),
    },
    {
        name: 'save_artifact_finalize_upload_session',
        description: 'Finalize a binary artifact upload session after all raw chunks have been uploaded. Verifies all chunks are present, verifies total size and sha256, writes final artifact bytes and indexes, and returns the immutable ArtifactReference. Idempotent retries return the same ArtifactReference after a session has finalized.',
        inputSchema: uploadSessionFinalizeInputSchema(),
    },
    {
        name: 'finalize_upload_session',
        description: 'Finalize a binary artifact upload session. Alias of save_artifact_finalize_upload_session. Required: sessionId, requestId, artifactKind, contentType, expectedSizeBytes, expectedSha256. Optional: filename, label, tags, metadata, uploadDirectory. Returns the immutable ArtifactReference.',
        inputSchema: uploadSessionFinalizeInputSchema(),
    },
    {
        name: 'list_artifacts_for_request',
        description: 'List ArtifactReference metadata for a requestId. Required: requestId. Reads the request artifact index only; it does not read or write artifact bytes. Returns artifacts array.',
        inputSchema: objectSchema({ requestId: stringSchema('Workflow request id whose artifact references should be listed.') }, ['requestId']),
    },
    {
        name: 'list_artifacts_by_kind',
        description: 'Admin-only artifact browser. Lists artifacts via artifact-index/by-kind/{artifactKind}/ pointers and resolves them to ArtifactReference objects. Does not read artifact bytes.',
        inputSchema: objectSchema({
            artifactKind: artifactKindJsonSchema('Artifact kind pointer prefix to browse.'),
            limit: artifactListLimitJsonSchema,
            cursor: artifactListCursorJsonSchema,
            includeDeleted: artifactIncludeDeletedJsonSchema,
        }, ['artifactKind']),
    },
    {
        name: 'list_artifacts_by_request',
        description: 'Admin-only artifact browser. Lists artifacts via artifact-index/by-request/{requestId}/ pointers, optionally scoped by artifactKind, and resolves them to ArtifactReference objects. Does not read artifact bytes.',
        inputSchema: objectSchema({
            requestId: stringSchema('Workflow request id to browse artifacts for.'),
            artifactKind: artifactKindJsonSchema('Optional artifact kind pointer prefix within the request.'),
            limit: artifactListLimitJsonSchema,
            cursor: artifactListCursorJsonSchema,
            includeDeleted: artifactIncludeDeletedJsonSchema,
        }, ['requestId']),
    },
    {
        name: 'search_artifacts',
        description: 'Admin-only artifact search using prefix indexes, not full text search. With tag, lists artifact-index/by-tag/{tag}/ pointers; without tag, lists by-kind pointer prefixes. Optional createdAfter/createdBefore filters are applied after resolving ArtifactReference objects. Does not read artifact bytes.',
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
        description: 'Admin-only soft delete for an ArtifactReference. Marks request-artifacts/{requestId}/{sha256}.json with deletedAtISO/deletedBy and leaves binary artifact bytes in place.',
        inputSchema: objectSchema({
            requestId: stringSchema('Workflow request id that owns the artifact reference.'),
            sha256: expectedSha256JsonSchema,
            deletedBy: artifactDeletedByJsonSchema,
        }, ['requestId', 'sha256']),
    },
    {
        name: 'restore_artifact',
        description: 'Admin-only restore for a soft-deleted ArtifactReference. Clears deletedAtISO/deletedBy on request-artifacts/{requestId}/{sha256}.json and keeps existing blob bytes untouched.',
        inputSchema: objectSchema({
            requestId: stringSchema('Workflow request id that owns the artifact reference.'),
            sha256: expectedSha256JsonSchema,
        }, ['requestId', 'sha256']),
    },
    {
        name: 'migrate_artifact_indexes',
        description: 'Admin-only one-time artifact-index migration. Scans request-artifacts/{requestId}/{sha256}.json, fills missing artifactKind/originalFilename/label fields, writes by-kind and by-request pointers, and returns cursor checkpoints for large idempotent batches.',
        inputSchema: objectSchema({
            cursor: artifactListCursorJsonSchema,
            limit: artifactReconcileLimitJsonSchema,
            dryRun: artifactMigrationDryRunJsonSchema,
        }),
    },
    {
        name: 'wipe_blob_stores',
        description: 'Admin-only MCP maintenance tool protected by server publish-key headers. Dry-runs by default; live mode deletes only allowlisted app-managed blob prefixes across workflow, artifact-index, and artifact blob stores.',
        inputSchema: objectSchema({
            dryRun: wipeBlobDryRunJsonSchema,
            confirm: wipeBlobConfirmJsonSchema,
            prefixes: wipeBlobPrefixesJsonSchema,
        }),
    },
    {
        name: 'reconcile_artifact_indexes',
        description: 'Admin-only artifact-index correction job. Reads request-artifacts JSON references, normalizes blobKeys, checks artifact bytes, corrects stale artifact-index blobKey values when a single matching blob is found, and returns compact correction diagnostics.',
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
    {
        name: 'diagnostic_upload',
        description: 'Run a diagnostic HTTP PUT to check the upload endpoint for 403 errors and proxy issues.',
        inputSchema: objectSchema({
            uploadUrl: stringSchema('The absolute upload URL to test.'),
            uploadToken: stringSchema('The upload token to use in the x-upload-token header.'),
            sessionId: stringSchema('The session id to use in the x-session-id header.'),
        }, ['uploadUrl', 'uploadToken', 'sessionId']),
    },
    ...ALLOWED_AGENTS.flatMap((agentName) => [
        {
            name: `${agentName}_update_output`,
            description: `Patch ${agentName} output with a lock_token and default expected_agent_version to 0 for the first write. ${workflowLockInstruction}`,
            inputSchema: objectSchema({
                request_id: stringSchema(),
                output: { description: 'Agent output payload.' },
                expected_agent_version: intSchema(),
                lock_token: lockTokenSchema,
            }, ['request_id', 'output', 'lock_token']),
        },
        {
            name: `${agentName}_mark_complete`,
            description: `Mark ${agentName} complete with the agent name hardcoded and optional current_stage, next_agent, workflow_status, needs_review, last_error, and lock_token forwarded to the backend. ${stageTransitionDescription(agentName)} ${workflowLockInstruction}`,
            inputSchema: objectSchema({
                request_id: stringSchema(),
                agent_name: agentNameJsonSchema('Optional for compatibility with save_json_blob_mark_agent_complete; stage helpers always use their hardcoded agent.'),
                expected_record_version: intSchema(),
                lock_token: lockTokenSchema,
                current_stage: nullableAgentNameJsonSchema(),
                next_agent: nullableAgentNameJsonSchema(),
                workflow_status: workflowStatusJsonSchema(),
                needs_review: { type: 'boolean' },
                last_error: nullableStringSchema(),
            }, ['request_id', 'expected_record_version', 'lock_token']),
        },
    ]),
];
const response = (statusCode, body, headers = jsonHeaders) => ({
    statusCode,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
});
const emptyResponse = (statusCode) => ({
    statusCode,
    headers: { ...jsonHeaders, 'Content-Type': 'text/plain' },
    body: '',
});
const rpcResponse = (id, result) => ({
    jsonrpc: '2.0',
    id: id ?? null,
    result,
});
const rpcError = (id, code, message, data) => ({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
});
const parseBody = (event) => {
    if (!event.body)
        throw new Error('Missing request body.');
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(rawBody);
};
const isAuthorized = (event) => {
    const token = process.env.MCP_HTTP_AUTH_TOKEN;
    if (!token)
        return true;
    const authorization = event.headers?.authorization ?? event.headers?.Authorization;
    return authorization === `Bearer ${token}`;
};
const getHeader = (headers, name) => {
    const normalizedName = name.toLowerCase();
    const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);
    return entry?.[1];
};
const getRequestId = (event) => toNonEmptyString(getHeader(event.headers, 'x-nf-request-id')) ?? randomUUID();
const getSlugFromValue = (value) => {
    const record = getRecordValue(value);
    if (!record)
        return null;
    return (toNonEmptyString(record.slug) ??
        toNonEmptyString(record.articleSlug) ??
        toNonEmptyString(record.article_slug) ??
        getSlugFromValue(record.publication) ??
        getSlugFromValue(record.publish_payload) ??
        getSlugFromValue(record.publishPayload) ??
        getSlugFromValue(record.content));
};
const getRpcSlug = (request) => getSlugFromValue(request.params?.arguments) ?? getSlugFromValue(request.params);
const createStructuredLogger = (requestId) => {
    return ({ event: logEvent, rpcMethod = null, slug = null, ...details }) => {
        console.log(JSON.stringify({
            ts: new Date().toISOString(),
            requestId,
            rpcMethod,
            slug,
            event: logEvent,
            ...details,
        }));
    };
};
const withStructuredLogger = (event) => {
    const requestId = event.requestId ?? getRequestId(event);
    return {
        ...event,
        requestId,
        log: event.log ?? createStructuredLogger(requestId),
    };
};
const createSaveJsonBlobHeaders = (event, publishSecret) => ({
    ...(event.headers ?? {}),
    ...(getHeader(event.headers, 'x-nf-site-id') ? { 'x-nf-site-id': getHeader(event.headers, 'x-nf-site-id') } : {}),
    ...(getHeader(event.headers, 'x-nf-deploy-id')
        ? { 'x-nf-deploy-id': getHeader(event.headers, 'x-nf-deploy-id') }
        : {}),
    'x-publish-key': publishSecret,
    'content-type': 'application/json',
});
const invokeSaveJsonBlob = async (event, payload) => {
    const publishSecret = process.env.NETLIFY_PUBLISH_SECRET || process.env.PUBLISH_SECRET;
    if (!publishSecret) {
        return toolError('Server-side workflow storage credentials are not configured.');
    }
    const saveResponse = await saveJsonBlobHandler({
        httpMethod: 'POST',
        headers: createSaveJsonBlobHeaders(event, publishSecret),
        body: JSON.stringify(payload),
    });
    const bodyText = saveResponse.body ?? '';
    let parsedBody = {};
    if (bodyText) {
        try {
            parsedBody = JSON.parse(bodyText);
        }
        catch {
            return toolError(`HTTP ${saveResponse.statusCode}: ${bodyText}`);
        }
    }
    if (saveResponse.statusCode < 200 || saveResponse.statusCode >= 300) {
        return toolError(typeof parsedBody.error === 'string' ? parsedBody.error : `HTTP ${saveResponse.statusCode}: ${bodyText}`, { statusCode: saveResponse.statusCode, ...sanitizeWorkflowErrorPayload(parsedBody) });
    }
    return parsedBody;
};
const invokeSaveArtifact = async (event, payload) => {
    const publishSecret = process.env.NETLIFY_PUBLISH_SECRET || process.env.PUBLISH_SECRET;
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
    let parsedBody = {};
    if (bodyText) {
        try {
            parsedBody = JSON.parse(bodyText);
        }
        catch {
            return toolError(`HTTP ${saveResponse.statusCode}: ${bodyText}`);
        }
    }
    if (saveResponse.statusCode < 200 || saveResponse.statusCode >= 300) {
        return toolError(typeof parsedBody.error === 'string' ? parsedBody.error : `HTTP ${saveResponse.statusCode}: ${bodyText}`);
    }
    return parsedBody;
};
const callPublishArticle = async (event, payload) => {
    const publishSecret = process.env.PUBLISH_SECRET || process.env.NETLIFY_PUBLISH_SECRET;
    if (!publishSecret) {
        return {
            ok: false,
            statusCode: 500,
            body: {
                error: 'Article publishing is not configured on the server.',
                error_code: 'article_publish_not_configured',
            },
        };
    }
    const publishResponse = await publishArticleHandler({
        httpMethod: 'POST',
        headers: {
            ...(event.headers ?? {}),
            ...(getHeader(event.headers, 'x-nf-site-id') ? { 'x-nf-site-id': getHeader(event.headers, 'x-nf-site-id') } : {}),
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
    });
    const body = parseJsonResponseBody(publishResponse.body);
    if (publishResponse.statusCode < 200 || publishResponse.statusCode >= 300) {
        return { ok: false, statusCode: publishResponse.statusCode, body };
    }
    return { ok: true, statusCode: publishResponse.statusCode, body };
};
const callDeployStatus = async (event, payload) => {
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
        return toolError(typeof body.error === 'string'
            ? body.error
            : `HTTP ${deployStatusResponse.statusCode}: deploy status lookup failed`, { statusCode: deployStatusResponse.statusCode, ...body });
    }
    return toolResult(body);
};
const callVerifyArticleImages = async (event, input) => {
    const publishSecret = process.env.NETLIFY_PUBLISH_SECRET || process.env.PUBLISH_SECRET;
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
        return toolError(typeof body.error === 'string'
            ? body.error
            : `HTTP ${verifyResponse.statusCode}: article image verification failed`, { statusCode: verifyResponse.statusCode, ...body });
    }
    return toolResult(body);
};
const callScheduledPublish = async (event, input) => {
    const tokenResult = verifyScheduledPublishToken(input.scheduled_publish_token);
    if (!tokenResult.ok)
        return toolError(tokenResult.error, tokenResult);
    const agentId = toNonEmptyString(input.agent_id);
    const agentOwner = toNonEmptyString(input.agent_owner);
    const agentLabel = toNonEmptyString(input.agent_label);
    if (!agentId || !agentOwner) {
        return toolError('agent_id and agent_owner are required for scheduled publishing.', {
            error_code: 'missing_scheduled_publish_agent_identity',
        });
    }
    const requestId = toNonEmptyString(input.request_id);
    const lockToken = toNonEmptyString(input.lock_token);
    if (!requestId || !lockToken)
        return toolError('request_id and lock_token are required.');
    const getResult = await invokeSaveJsonBlob(event, { action: 'get_request', request_id: requestId });
    if ('isError' in getResult)
        return getResult;
    const record = getRecordValue(getResult.record);
    const recordInput = getRecordValue(record?.input);
    const publication = getRecordValue(recordInput?.publication);
    const publishPayload = getRecordValue(publication?.publish_payload);
    const publicationStatus = toNonEmptyString(publication?.publication_status)?.toLowerCase();
    if (publicationStatus !== 'scheduled') {
        return toolError('Scheduled publish requires publication.publication_status: scheduled.', {
            error_code: 'publication_not_scheduled',
            publication_status: publication?.publication_status,
        });
    }
    const scheduledFor = publication ? getScheduledTime(publication, publishPayload) : undefined;
    const scheduledMs = scheduledFor ? Date.parse(scheduledFor) : Number.NaN;
    if (!scheduledFor || Number.isNaN(scheduledMs)) {
        return toolError('Scheduled publish requires a valid publication.scheduled_for ISO timestamp.', {
            error_code: 'invalid_scheduled_for',
            scheduled_for: scheduledFor,
        });
    }
    const nowMs = Date.now();
    if (scheduledMs > nowMs + SCHEDULED_PUBLISH_DUE_WINDOW_MS) {
        return toolError('Scheduled article is not due for publishing yet.', {
            error_code: 'scheduled_publish_not_due',
            scheduled_for: scheduledFor,
            now: new Date(nowMs).toISOString(),
            due_window_ms: SCHEDULED_PUBLISH_DUE_WINDOW_MS,
        });
    }
    if (!publishPayload) {
        return toolError('Scheduled publish requires publication.publish_payload.', {
            error_code: 'missing_publish_payload',
        });
    }
    const publishResult = await callPublishArticle(event, {
        ...publishPayload,
        requestId,
        request_id: requestId,
        lock_token: lockToken,
    });
    if (!publishResult.ok) {
        return toolError('Scheduled article was not published.', {
            error_code: 'scheduled_publish_failed',
            publish_status: publishResult.statusCode,
            publish_result: publishResult.body,
            scheduled_for: scheduledFor,
        });
    }
    const commitMetadata = {
        commit: publishResult.body.commit,
        articlePath: publishResult.body.articlePath ?? publishResult.body.path,
        deployStatus: publishResult.body.deployStatus,
        message: publishResult.body.message,
        scheduled_for: scheduledFor,
        scheduled_publish: true,
        agent_id: agentId,
        agent_owner: agentOwner,
        ...(agentLabel ? { agent_label: agentLabel } : {}),
    };
    const markResult = await invokeSaveJsonBlob(event, {
        action: 'mark_published',
        request_id: requestId,
        expected_record_version: input.expected_record_version,
        lock_token: lockToken,
        commit_metadata: commitMetadata,
    });
    if ('isError' in markResult)
        return markResult;
    return toolResult({
        record: markResult.record,
        publish_result: publishResult.body,
        commit_metadata: commitMetadata,
    });
};
const callArtifactUpload = async (event, payload) => {
    const result = await invokeSaveArtifact(event, payload);
    if ('isError' in result)
        return result;
    return toolResult(result);
};
const callCreateArtifactUploadSession = async (event, input) => {
    try {
        return toolResult(await createUploadSession(event, input));
    }
    catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
    }
};
const callFinalizeArtifactUploadSession = async (event, input) => {
    try {
        const finalization = await getFinalizeUploadSessionPayload(event, input);
        if (!finalization.ok)
            return toolError(finalization.error, { statusCode: finalization.statusCode });
        if (finalization.alreadyFinalized) {
            return toolResult({ ok: true, complete: true, deduped: true, artifact: finalization.artifact });
        }
        if (!finalization.uploadInput || !finalization.bytes) {
            return toolError('Upload session finalization did not produce artifact bytes.');
        }
        const response = await finalizeUpload(event, finalization.uploadInput, finalization.bytes);
        const body = JSON.parse(response.body);
        if (response.statusCode < 200 || response.statusCode >= 300) {
            return toolError(typeof body.error === 'string' ? body.error : `HTTP ${response.statusCode}`, body);
        }
        if (body.artifact && typeof body.artifact === 'object') {
            await markUploadSessionFinalized(event, finalization.manifest, body.artifact);
            cleanupUploadSessionChunks(event, finalization.manifest).catch((cleanupError) => {
                console.warn('Upload session cleanup failed after finalize.', cleanupError);
            });
        }
        return toolResult(body);
    }
    catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
    }
};
const callAction = async (event, payload, resultKey) => {
    const result = await invokeSaveJsonBlob(event, payload);
    if ('isError' in result)
        return result;
    return toolResult({ [resultKey]: result[resultKey] });
};
const callNormalizedAction = async (event, createPayload, resultKey) => {
    try {
        return await callAction(event, createPayload(), resultKey);
    }
    catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
    }
};
const defaultFinalArticleCompletionFields = (input) => {
    if (Object.hasOwn(input, 'current_stage'))
        return {};
    return { current_stage: null };
};
const createMarkAgentCompletePayload = (input, agentName) => {
    const finalArticleDefaults = agentName === 'final_article'
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
const callMarkAgentComplete = (event, input, agentName) => {
    return callNormalizedAction(event, () => createMarkAgentCompletePayload(input, agentName), 'record');
};
const requestArtifactReferenceKey = (requestId, sha256) => {
    return `request-artifacts/${encodeURIComponent(requestId)}/${sha256}.json`;
};
const parseJsonBlob = async (store, key) => {
    const text = await store.get(key);
    if (!text)
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
};
const loadArtifactFromPointer = async (store, pointer) => {
    const value = getRecordValue(pointer);
    const pointerRequestId = toNonEmptyString(value?.requestId);
    const sha256 = toNonEmptyString(value?.sha256);
    if (!pointerRequestId || !sha256)
        return undefined;
    return parseJsonBlob(store, requestArtifactReferenceKey(pointerRequestId, sha256));
};
const listPointerKeys = async (store, prefixes) => {
    const keys = [];
    for (const prefix of prefixes) {
        const result = await store.list({ prefix });
        keys.push(...getBlobListItems(result).map((blob) => blob.key));
    }
    return [...new Set(keys)].filter((key) => key.endsWith('.json')).sort();
};
const loadArtifactsFromPrefix = async (store, prefix) => {
    const keys = await listPointerKeys(store, [prefix]);
    return Promise.all(keys.map((key) => parseJsonBlob(store, key)));
};
const loadArtifactIndexKeysFromPrefix = async (store, prefix, limit) => {
    const keys = await listPointerKeys(store, [prefix]);
    return keys.slice(0, limit);
};
const normalizeArtifactReconcileLimit = (limit) => {
    if (limit === undefined || limit === null)
        return { ok: true, value: ARTIFACT_LIST_DEFAULT_LIMIT };
    if (!Number.isInteger(limit) || limit < 1 || limit > ARTIFACT_LIST_MAX_LIMIT) {
        return { ok: false, error: `limit must be an integer from 1 to ${ARTIFACT_LIST_MAX_LIMIT}.` };
    }
    return { ok: true, value: limit };
};
const normalizeIndexedArtifactReference = (value) => {
    const record = getRecordValue(value);
    const originalBlobKey = toNonEmptyString(record?.blobKey);
    if (!record || !originalBlobKey)
        return undefined;
    const normalized = { ...record, blobKey: normalizeArtifactBlobKey(originalBlobKey) };
    if (!isArtifactReference(normalized))
        return undefined;
    return { originalBlobKey, reference: { ...normalized, blobKey: originalBlobKey } };
};
const getArtifactKindFromBlobKey = (blobKey) => normalizeArtifactBlobKey(blobKey).split('/')[0] || '';
const summarizeArtifactReconciliation = (indexKey, reference, result) => ({
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
const reconcileArtifactIndexKeys = async (artifactStore, indexStore, keys, artifactKind) => {
    const results = [];
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
const normalizeArtifactBrowseLimit = (limit) => {
    if (limit === undefined || limit === null)
        return { ok: true, value: ARTIFACT_LIST_DEFAULT_LIMIT };
    if (!Number.isInteger(limit) || limit < 1 || limit > ARTIFACT_LIST_MAX_LIMIT) {
        return { ok: false, error: `limit must be an integer from 1 to ${ARTIFACT_LIST_MAX_LIMIT}.` };
    }
    return { ok: true, value: limit };
};
const normalizeArtifactBrowseCursor = (cursor) => {
    if (cursor === undefined || cursor === null || cursor === '')
        return { ok: true, value: 0 };
    if (typeof cursor !== 'string' || !/^\d+$/.test(cursor)) {
        return { ok: false, error: 'cursor must be a cursor string returned by a previous artifact list call.' };
    }
    return { ok: true, value: Number(cursor) };
};
const normalizeArtifactBrowseOptions = (input) => {
    const limit = normalizeArtifactBrowseLimit(input.limit);
    if (!limit.ok)
        return toolError(limit.error);
    const cursor = normalizeArtifactBrowseCursor(input.cursor);
    if (!cursor.ok)
        return toolError(cursor.error);
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
const isArtifactBrowseOptions = (value) => !('isError' in value);
const paginateArtifacts = (artifacts, limit, cursor) => {
    const page = artifacts.slice(cursor, cursor + limit);
    const nextOffset = cursor + page.length;
    return {
        artifacts: page,
        limit,
        cursor: String(cursor),
        nextCursor: nextOffset < artifacts.length ? String(nextOffset) : null,
    };
};
const getArtifactCreatedAtMs = (artifact) => {
    const value = getRecordValue(artifact);
    const createdAtISO = toNonEmptyString(value?.createdAtISO);
    return createdAtISO ? Date.parse(createdAtISO) : Number.NaN;
};
const filterArtifactsForBrowse = (artifacts, options) => {
    const visibleArtifacts = options.includeDeleted
        ? artifacts
        : artifacts.filter((artifact) => !isDeletedArtifactReference(artifact));
    if (!options.createdAfter && !options.createdBefore)
        return visibleArtifacts;
    const afterMs = options.createdAfter?.getTime() ?? Number.NEGATIVE_INFINITY;
    const beforeMs = options.createdBefore?.getTime() ?? Number.POSITIVE_INFINITY;
    return visibleArtifacts.filter((artifact) => {
        const createdAtMs = getArtifactCreatedAtMs(artifact);
        return Number.isFinite(createdAtMs) && createdAtMs >= afterMs && createdAtMs <= beforeMs;
    });
};
const listArtifactsFromPointerPrefixes = async (event, prefixes, options) => {
    const store = await getArtifactIndexBlobStore(event);
    const pointerKeys = await listPointerKeys(store, prefixes);
    const artifacts = await Promise.all(pointerKeys.map(async (key) => loadArtifactFromPointer(store, await parseJsonBlob(store, key))));
    const filteredArtifacts = filterArtifactsForBrowse(artifacts.filter((artifact) => artifact !== undefined), options);
    return toolResult(paginateArtifacts(filteredArtifacts, options.limit, options.cursor));
};
const getAdminToolState = async (event) => {
    const adminState = await getAdminStateFromEvent(event);
    if (!adminState.authenticated)
        return toolError(adminState.error || 'A valid admin session token is required.');
    if (!adminState.isAdmin)
        return toolError('This user is not authorized to browse artifacts.');
    return adminState;
};
const requireAdminToolAccess = async (event) => {
    const adminState = await getAdminToolState(event);
    return 'isError' in adminState ? adminState : undefined;
};
const requireArtifactMigrationAccess = async (event) => {
    if (hasValidNetlifyPublishSecret(event))
        return undefined;
    return requireAdminToolAccess(event);
};
const normalizeArtifactKindInput = (value, required) => {
    const artifactKind = toNonEmptyString(value);
    if (!artifactKind)
        return required ? { ok: false, error: 'artifactKind is required.' } : { ok: true };
    if (!artifactKindValues.includes(artifactKind)) {
        return { ok: false, error: `artifactKind must be one of: ${artifactKindValues.join(', ')}.` };
    }
    return { ok: true, artifactKind };
};
const normalizeArtifactSha256Input = (value) => {
    const sha256 = toNonEmptyString(value)?.toLowerCase();
    if (!sha256)
        return { ok: false, error: 'sha256 is required.' };
    if (!/^[a-f0-9]{64}$/.test(sha256))
        return { ok: false, error: 'sha256 must be a 64-character hex digest.' };
    return { ok: true, sha256 };
};
const loadArtifactReferenceForAdminMutation = async (store, requestId, sha256) => {
    const artifact = await parseJsonBlob(store, requestArtifactReferenceKey(requestId, sha256));
    if (!artifact)
        return { ok: false, error: 'Artifact reference was not found.' };
    if (!isArtifactReference(artifact))
        return { ok: false, error: 'Artifact reference JSON is invalid.' };
    return { ok: true, artifact };
};
const writeArtifactReferenceForAdminMutation = async (store, requestId, artifact) => {
    await store.setJSON(requestArtifactReferenceKey(requestId, artifact.sha256), artifact, {
        metadata: {
            requestId,
            sha256: artifact.sha256,
            contentType: artifact.contentType,
            ...(artifact.deletedAtISO ? { deletedAtISO: artifact.deletedAtISO } : {}),
        },
    });
};
const normalizeDeletedByInput = (value, fallback) => {
    const deletedBy = toNonEmptyString(value) ?? fallback;
    if (!isSafeArtifactText(deletedBy, artifactReferenceLimits.label)) {
        return {
            ok: false,
            error: `deletedBy must be a safe string up to ${artifactReferenceLimits.label} characters.`,
        };
    }
    return { ok: true, deletedBy };
};
const listArtifactsForRequest = async (event, requestId) => {
    const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    if (!normalizedRequestId) {
        return toolError('requestId is required.');
    }
    const store = await getArtifactIndexBlobStore(event);
    const pointerPrefix = `by-request/${encodeURIComponent(normalizedRequestId)}/`;
    const pointerResult = await store.list({ prefix: pointerPrefix });
    const pointerBlobs = getBlobListItems(pointerResult);
    const artifacts = pointerBlobs.length
        ? await Promise.all(pointerBlobs.map(async (blob) => loadArtifactFromPointer(store, await parseJsonBlob(store, blob.key))))
        : await loadArtifactsFromPrefix(store, `request-artifacts/${encodeURIComponent(normalizedRequestId)}/`);
    return toolResult({
        artifacts: artifacts.filter((artifact) => artifact !== undefined && !isDeletedArtifactReference(artifact)),
    });
};
const listArtifactsByKind = async (event, input) => {
    const unauthorized = await requireAdminToolAccess(event);
    if (unauthorized)
        return unauthorized;
    const artifactKind = normalizeArtifactKindInput(input.artifactKind, true);
    if (!artifactKind.ok)
        return toolError(artifactKind.error);
    const options = normalizeArtifactBrowseOptions(input);
    if (!isArtifactBrowseOptions(options))
        return options;
    return listArtifactsFromPointerPrefixes(event, [`by-kind/${artifactKind.artifactKind}/`], options);
};
const listArtifactsByRequest = async (event, input) => {
    const unauthorized = await requireAdminToolAccess(event);
    if (unauthorized)
        return unauthorized;
    const requestId = toNonEmptyString(input.requestId);
    if (!requestId)
        return toolError('requestId is required.');
    const artifactKind = normalizeArtifactKindInput(input.artifactKind, false);
    if (!artifactKind.ok)
        return toolError(artifactKind.error);
    const options = normalizeArtifactBrowseOptions(input);
    if (!isArtifactBrowseOptions(options))
        return options;
    const prefix = artifactKind.artifactKind
        ? `by-request/${encodeURIComponent(requestId)}/${artifactKind.artifactKind}/`
        : `by-request/${encodeURIComponent(requestId)}/`;
    return listArtifactsFromPointerPrefixes(event, [prefix], options);
};
const searchArtifacts = async (event, input) => {
    const unauthorized = await requireAdminToolAccess(event);
    if (unauthorized)
        return unauthorized;
    const options = normalizeArtifactBrowseOptions(input);
    if (!isArtifactBrowseOptions(options))
        return options;
    const tag = toNonEmptyString(input.tag);
    const normalizedTag = tag ? safePathSegment(tag) : undefined;
    if (tag && !normalizedTag)
        return toolError('tag must contain at least one safe path character.');
    const prefixes = normalizedTag
        ? [`by-tag/${normalizedTag}/`]
        : artifactKindValues.map((artifactKind) => `by-kind/${artifactKind}/`);
    return listArtifactsFromPointerPrefixes(event, prefixes, options);
};
const requestArtifactKeyPattern = /^request-artifacts\/([^/]+)\/([a-f0-9]{64})\.json$/i;
const parseRequestArtifactIndexKey = (key) => {
    const match = key.match(requestArtifactKeyPattern);
    if (!match)
        return undefined;
    return { requestId: decodeURIComponent(match[1]), sha256: match[2].toLowerCase() };
};
const inferArtifactKindFromContentType = (contentType) => {
    const normalized = toNonEmptyString(contentType)?.toLowerCase().split(';', 1)[0] ?? '';
    if (normalized.startsWith('image/'))
        return 'image';
    if (normalized.startsWith('video/'))
        return 'video';
    if (normalized.startsWith('audio/'))
        return 'audio';
    if (normalized === 'application/pdf')
        return 'pdf';
    if (normalized.startsWith('text/') ||
        normalized.includes('document') ||
        normalized === 'application/msword' ||
        normalized === 'application/rtf') {
        return 'doc';
    }
    if (normalized.includes('json') || normalized.includes('csv') || normalized.includes('xml'))
        return 'data';
    return 'other';
};
const getMigrationArtifactKind = (record, blobKey) => {
    const explicitKind = toNonEmptyString(record.artifactKind);
    if (explicitKind && artifactKindValues.includes(explicitKind))
        return explicitKind;
    const [blobKeyKind] = normalizeArtifactBlobKey(blobKey).split('/');
    if (artifactKindValues.includes(blobKeyKind))
        return blobKeyKind;
    return inferArtifactKindFromContentType(record.contentType);
};
const migrationControlCharacters = `${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}`;
const unsafeMigrationFilenamePattern = new RegExp(`[${migrationControlCharacters}<>\\\\/]+`, 'gu');
const unsafeMigrationLabelPattern = new RegExp(`[${migrationControlCharacters}<>]+`, 'gu');
const normalizeMigrationFilename = (value) => {
    const filename = value.split(/[\\/]/).pop() || value;
    const normalized = filename
        .trim()
        .replace(/\s+/g, ' ')
        .replace(unsafeMigrationFilenamePattern, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, artifactReferenceLimits.originalFilename);
    return normalized || 'artifact';
};
const normalizeMigrationLabel = (value) => {
    const normalized = value
        .trim()
        .replace(/\s+/g, ' ')
        .replace(unsafeMigrationLabelPattern, ' ')
        .slice(0, artifactReferenceLimits.label)
        .trim();
    return normalized || 'Artifact';
};
const getMigrationFilename = (record, blobKey, sha256) => {
    const metadata = getRecordValue(record.metadata);
    const metadataFilename = toNonEmptyString(metadata?.filename) ?? toNonEmptyString(metadata?.name);
    const existingFilename = toNonEmptyString(record.originalFilename);
    const blobFilename = normalizeArtifactBlobKey(blobKey).split('/').pop();
    return normalizeMigrationFilename(existingFilename ?? metadataFilename ?? blobFilename ?? sha256);
};
const getMigrationTags = (value) => {
    if (!Array.isArray(value))
        return undefined;
    const tags = value.filter((tag) => typeof tag === 'string' && Boolean(tag.trim()));
    return tags.length ? tags : undefined;
};
const buildArtifactPointer = (requestId, artifact) => ({
    requestId,
    sha256: artifact.sha256,
    artifactKind: artifact.artifactKind ?? getArtifactKindFromBlobKey(artifact.blobKey),
});
const writeMigratedArtifactPointers = async (store, requestId, artifact) => {
    const pointer = buildArtifactPointer(requestId, artifact);
    const pointerMetadata = { requestId, sha256: artifact.sha256, artifactKind: pointer.artifactKind };
    await Promise.all([
        store.setJSON(`by-kind/${pointer.artifactKind}/${artifact.sha256}.json`, pointer, { metadata: pointerMetadata }),
        store.setJSON(`by-request/${encodeURIComponent(requestId)}/${pointer.artifactKind}/${artifact.sha256}.json`, pointer, { metadata: pointerMetadata }),
    ]);
};
const migrateArtifactIndexRecord = async (store, key, input) => {
    const parsedKey = parseRequestArtifactIndexKey(key);
    if (!parsedKey)
        return { indexKey: key, status: 'skipped', reason: 'unexpected request artifact key shape' };
    const raw = await parseJsonBlob(store, key);
    const record = getRecordValue(raw);
    const blobKey = toNonEmptyString(record?.blobKey);
    if (!record || !blobKey)
        return { indexKey: key, status: 'skipped', reason: 'invalid artifact JSON' };
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
        return { indexKey: key, status: 'skipped', reason: 'artifact JSON is still invalid after migration' };
    }
    const referenceChanged = JSON.stringify(record) !== JSON.stringify(migratedRecord);
    if (!input.dryRun) {
        if (referenceChanged)
            await writeArtifactReferenceForAdminMutation(store, parsedKey.requestId, migratedRecord);
        await writeMigratedArtifactPointers(store, parsedKey.requestId, migratedRecord);
    }
    return {
        indexKey: key,
        requestId: parsedKey.requestId,
        sha256: parsedKey.sha256,
        artifactKind,
        status: input.dryRun ? 'dry_run' : 'migrated',
        referenceUpdated: referenceChanged,
        pointersWritten: input.dryRun ? 0 : 2,
    };
};
const WIPE_BLOB_ALLOWED_PREFIXES = [
    'workflows/',
    'artifact-index/',
    ...artifactKindValues.map((kind) => `${kind}/`),
];
const WIPE_BLOB_ALLOWED_PREFIX_SET = new Set(WIPE_BLOB_ALLOWED_PREFIXES);
const WIPE_BLOB_ARTIFACT_PREFIX_SET = new Set(artifactKindValues.map((kind) => `${kind}/`));
const isArtifactWipeBlobPrefix = (prefix) => WIPE_BLOB_ARTIFACT_PREFIX_SET.has(prefix);
const normalizeWipeBlobPrefixes = (value) => {
    if (value === undefined || value === null) {
        return { prefixes: [...WIPE_BLOB_ALLOWED_PREFIXES], skipped: [] };
    }
    if (!Array.isArray(value)) {
        return { prefixes: [], skipped: ['prefixes must be an array of strings.'] };
    }
    const prefixes = [];
    const skipped = [];
    for (const item of value) {
        const prefix = typeof item === 'string' ? item.trim() : '';
        if (!prefix || !WIPE_BLOB_ALLOWED_PREFIX_SET.has(prefix)) {
            skipped.push(String(item));
            continue;
        }
        if (!prefixes.includes(prefix))
            prefixes.push(prefix);
    }
    return { prefixes, skipped };
};
const getWipeBlobTargets = async (event, prefixes) => {
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
const listWipeBlobTargetKeys = async (target) => {
    const blobs = await collectBlobListItems(await target.store.list({ prefix: target.listPrefix }));
    return [...new Set(blobs.map((blob) => blob.key))].sort();
};
const toLogicalWipeBlobKey = (target, key) => {
    if (target.logicalPrefix === 'artifact-index/')
        return `${target.logicalPrefix}${key}`;
    return key;
};
const isWipeBlobKeyAllowed = (target, key) => {
    if (!WIPE_BLOB_ALLOWED_PREFIX_SET.has(target.logicalPrefix))
        return false;
    if (target.logicalPrefix === 'artifact-index/')
        return true;
    return key.startsWith(target.logicalPrefix);
};
const wipeBlobStores = async (event, input) => {
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
    const sampleKeys = [];
    const sampleDeletedKeys = [];
    for (const target of targets) {
        const keys = await listWipeBlobTargetKeys(target);
        for (const key of keys) {
            if (!isWipeBlobKeyAllowed(target, key)) {
                skipped += 1;
                continue;
            }
            scanned += 1;
            const logicalKey = toLogicalWipeBlobKey(target, key);
            if (sampleKeys.length < WIPE_BLOB_SAMPLE_LIMIT)
                sampleKeys.push(logicalKey);
            if (!dryRun) {
                await target.store.del(key);
                deleted += 1;
                if (sampleDeletedKeys.length < WIPE_BLOB_SAMPLE_LIMIT)
                    sampleDeletedKeys.push(logicalKey);
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
const migrateArtifactIndexes = async (event, input) => {
    const unauthorized = await requireArtifactMigrationAccess(event);
    if (unauthorized)
        return unauthorized;
    const limit = normalizeArtifactReconcileLimit(input.limit);
    if (!limit.ok)
        return toolError(limit.error);
    const cursor = normalizeArtifactBrowseCursor(input.cursor);
    if (!cursor.ok)
        return toolError(cursor.error);
    const dryRun = input.dryRun === true;
    const store = await getArtifactIndexBlobStore(event);
    const keys = await listPointerKeys(store, ['request-artifacts/']);
    const pageKeys = keys.slice(cursor.value, cursor.value + limit.value);
    const results = [];
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
    const pointerWrites = results.reduce((count, result) => count + ('pointersWritten' in result ? (result.pointersWritten ?? 0) : 0), 0);
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
const softDeleteArtifact = async (event, input) => {
    const adminState = await getAdminToolState(event);
    if ('isError' in adminState)
        return adminState;
    const requestId = toNonEmptyString(input.requestId);
    if (!requestId)
        return toolError('requestId is required.');
    const sha256 = normalizeArtifactSha256Input(input.sha256);
    if (!sha256.ok)
        return toolError(sha256.error);
    const store = await getArtifactIndexBlobStore(event);
    const loaded = await loadArtifactReferenceForAdminMutation(store, requestId, sha256.sha256);
    if (!loaded.ok)
        return toolError(loaded.error);
    const deletedBy = normalizeDeletedByInput(input.deletedBy, adminState.email ?? adminState.userId ?? 'admin');
    if (!deletedBy.ok)
        return toolError(deletedBy.error);
    const deletedArtifact = {
        ...loaded.artifact,
        deletedAtISO: loaded.artifact.deletedAtISO ?? new Date().toISOString(),
        deletedBy: loaded.artifact.deletedBy ?? deletedBy.deletedBy,
    };
    await writeArtifactReferenceForAdminMutation(store, requestId, deletedArtifact);
    return toolResult({ artifact: deletedArtifact, deleted: true });
};
const restoreArtifact = async (event, input) => {
    const unauthorized = await requireAdminToolAccess(event);
    if (unauthorized)
        return unauthorized;
    const requestId = toNonEmptyString(input.requestId);
    if (!requestId)
        return toolError('requestId is required.');
    const sha256 = normalizeArtifactSha256Input(input.sha256);
    if (!sha256.ok)
        return toolError(sha256.error);
    const store = await getArtifactIndexBlobStore(event);
    const loaded = await loadArtifactReferenceForAdminMutation(store, requestId, sha256.sha256);
    if (!loaded.ok)
        return toolError(loaded.error);
    const { deletedAtISO, deletedBy, ...restoredArtifact } = loaded.artifact;
    await writeArtifactReferenceForAdminMutation(store, requestId, restoredArtifact);
    return toolResult({ artifact: restoredArtifact, restored: Boolean(deletedAtISO || deletedBy) });
};
const reconcileArtifactIndexes = async (event, input) => {
    const unauthorized = await requireAdminToolAccess(event);
    if (unauthorized)
        return unauthorized;
    const artifactKind = normalizeArtifactKindInput(input.artifactKind, false);
    if (!artifactKind.ok)
        return toolError(artifactKind.error);
    const limit = normalizeArtifactReconcileLimit(input.limit);
    if (!limit.ok)
        return toolError(limit.error);
    const requestId = toNonEmptyString(input.requestId);
    const prefix = requestId ? `request-artifacts/${encodeURIComponent(requestId)}/` : 'request-artifacts/';
    const indexStore = await getArtifactIndexBlobStore(event);
    const artifactStore = await getArtifactBlobStore(event);
    const keys = await loadArtifactIndexKeysFromPrefix(indexStore, prefix, limit.value);
    const { results, skipped } = await reconcileArtifactIndexKeys(artifactStore, indexStore, keys, artifactKind.artifactKind);
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
const callTool = async (event, name, args) => {
    const input = args && typeof args === 'object' ? args : {};
    switch (name) {
        case 'ping':
            return toolResult({ ok: true, server: SERVER_DIAGNOSTIC_NAME });
        case 'diagnostic_upload':
            try {
                const fetchResponse = await fetch(String(input.uploadUrl), {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'x-upload-token': String(input.uploadToken),
                        'x-session-id': String(input.sessionId),
                        'x-chunk-index': '0',
                        'x-total-chunks': '1',
                    },
                    body: Buffer.from('test'),
                });
                const headers = Object.fromEntries(fetchResponse.headers.entries());
                const body = await fetchResponse.text();
                return toolResult({
                    status: fetchResponse.status,
                    statusText: fetchResponse.statusText,
                    headers,
                    body,
                });
            }
            catch (error) {
                return toolError(`Diagnostic upload failed: ${error.message}`);
            }
        case 'save_json_blob_create_request':
            return callAction(event, {
                action: 'create_request',
                input: input.input,
                request_id: input.request_id ?? createRequestId(),
                current_agent: input.current_agent,
                next_agent: input.next_agent,
                validation_mode: input.validation_mode ?? 'admin_publish_draft',
            }, 'record');
        case 'save_json_blob_get_request':
            return callAction(event, { action: 'get_request', request_id: input.request_id }, 'record');
        case 'save_json_blob_list_pending_requests':
            return callNormalizedAction(event, () => ({
                action: 'list_pending_requests',
                stage: normalizeOptionalAgentName(input.stage, 'stage'),
                status: input.status,
                limit: input.limit,
            }), 'records');
        case 'save_json_blob_checkout_request':
            return callAction(event, {
                action: 'checkout_request',
                request_id: input.request_id,
                owner_id: input.owner_id,
                owner_label: input.owner_label,
                lease_seconds: input.lease_seconds,
            }, 'record');
        case 'save_json_blob_refresh_lock':
            return callAction(event, {
                action: 'refresh_lock',
                request_id: input.request_id,
                lock_token: input.lock_token,
                lease_seconds: input.lease_seconds,
            }, 'record');
        case 'save_json_blob_checkin_request':
            return callAction(event, { action: 'checkin_request', request_id: input.request_id, lock_token: input.lock_token }, 'record');
        case 'save_json_blob_mark_published':
            return callAction(event, {
                action: 'mark_published',
                request_id: input.request_id,
                expected_record_version: input.expected_record_version,
                lock_token: input.lock_token,
                commit_metadata: input.commit_metadata,
            }, 'record');
        case 'save_json_blob_publish_scheduled':
            return callScheduledPublish(event, input);
        case 'deploy_status':
            return callDeployStatus(event, input);
        case 'verify_article_images':
            return callVerifyArticleImages(event, input);
        case 'save_json_blob_force_unlock':
            if (!ADMIN_TOOLS_ENABLED)
                return toolError('Admin tools are not enabled.');
            return callAction(event, { action: 'force_unlock', request_id: input.request_id }, 'record');
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
                expectedSizeBytes: input.expectedSizeBytes,
                expectedSha256: input.expectedSha256,
                localSizeBytes: input.localSizeBytes,
                localSha256: input.localSha256,
                payload: input.payload,
                label: input.label,
                tags: input.tags,
                metadata: input.metadata,
            });
        case 'save_artifact_create_upload_session':
        case 'create_upload_session':
            return callCreateArtifactUploadSession(event, input);
        case 'save_artifact_finalize_upload_session':
        case 'finalize_upload_session':
            return callFinalizeArtifactUploadSession(event, input);
        case 'list_artifacts_for_request':
            return listArtifactsForRequest(event, input.requestId);
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
            return callNormalizedAction(event, () => ({
                action: 'patch_agent_output',
                request_id: input.request_id,
                agent_name: normalizeAgentName(input.agent_name, 'agent_name'),
                expected_agent_version: input.expected_agent_version,
                lock_token: input.lock_token,
                output: input.output,
            }), 'record');
        case 'save_json_blob_mark_agent_complete':
            return callMarkAgentComplete(event, input, normalizeAgentName(input.agent_name, 'agent_name'));
        default:
            break;
    }
    if (typeof name === 'string') {
        const updateAgent = ALLOWED_AGENTS.find((agentName) => name === `${agentName}_update_output`);
        if (updateAgent) {
            return callAction(event, {
                action: 'patch_agent_output',
                request_id: input.request_id,
                agent_name: updateAgent,
                expected_agent_version: input.expected_agent_version ?? 0,
                lock_token: input.lock_token,
                output: input.output,
            }, 'record');
        }
        const completeAgent = ALLOWED_AGENTS.find((agentName) => name === `${agentName}_mark_complete`);
        if (completeAgent) {
            return callMarkAgentComplete(event, input, completeAgent);
        }
    }
    return toolError(`Unknown tool: ${String(name)}`);
};
const handleRpcRequest = async (event, request) => {
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
            return rpcResponse(request.id, await callTool({ ...event, rpcMethod, slug }, request.params?.name, request.params?.arguments));
        default:
            event.log?.({ event: 'rpc_method_not_found', rpcMethod, slug });
            return rpcError(request.id, -32601, `Method not found: ${request.method}`);
    }
};
export const handler = async (rawEvent) => {
    const event = withStructuredLogger(rawEvent);
    event.log?.({ event: 'mcp_request_received', rpcMethod: null, slug: null, httpMethod: event.httpMethod });
    if (event.httpMethod === 'OPTIONS') {
        return emptyResponse(204);
    }
    if (event.httpMethod !== 'POST') {
        return response(405, rpcError(null, -32000, 'Method not allowed.'), { ...jsonHeaders, Allow: 'POST' });
    }
    if (!isAuthorized(event)) {
        return response(401, rpcError(null, -32001, 'Unauthorized'));
    }
    let body;
    try {
        body = parseBody(event);
    }
    catch (error) {
        return response(400, rpcError(null, -32700, 'Parse error', error instanceof Error ? error.message : String(error)));
    }
    try {
        const requests = Array.isArray(body) ? body : [body];
        const results = (await Promise.all(requests.map((request) => handleRpcRequest(event, request)))).filter((result) => Boolean(result));
        if (results.length === 0) {
            return emptyResponse(202);
        }
        return response(200, Array.isArray(body) ? results : results[0]);
    }
    catch (error) {
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
