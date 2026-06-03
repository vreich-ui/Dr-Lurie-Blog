// schema-v1.ts
import { z } from 'zod';

export type AllowedAgentName = 'reader_insight' | 'research' | 'angle' | 'draft' | 'final_article';
export type WorkflowStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'published';

export type AgentOutputEnvelope = {
  version: number; // agent output version (repo contract)
  updated_at: string; // ISO
  output: unknown; // stage payload (schema-versioned ideally)
  expected_agent_version: number;
};

export type WorkflowHistoryEntry = {
  at: string; // ISO
  action: string;
  agent_name?: AllowedAgentName;
  details?: Record<string, unknown>;
};

export type WorkflowLockRecord = {
  token: string;
  owner_id: string;
  owner_label: string;
  acquired_at: string; // ISO
  expires_at: string; // ISO
};

export type PublishPayload = {
  slug: string;
  title: string;
  markdown?: string;
  content?: string;
  description?: string;
  publishDate?: string;
  author?: string;
  tags?: string[];
  images?: unknown[];
  overwrite?: boolean;
  draft?: boolean;
  articlePath?: string;
  category?: string;
  excerpt?: string;
  seoDescription?: string;
  featuredImage?: string;
  existingFeaturedImagePath?: string;
  videoLink?: string;
  ctaLink?: string;
  ctaText?: string;
  commitMessage?: string;
  metadata?: Record<string, unknown>;
};

type MetadataBag = Record<string, unknown>;

type ClaimRecord = {
  claim_id?: string;
  claim_text: string;
  claim_type?: string;
  source_ids?: string[];
  confidence?: number;
  status?: string;
  metadata?: MetadataBag;
};

type ComplianceRequirement = {
  requirement_id?: string;
  category: string;
  description: string;
  status?: string;
  related_claim_ids?: string[];
  notes?: string;
  metadata?: MetadataBag;
};

type CommercialOffer = {
  offer_id?: string;
  name: string;
  url?: string;
  cta_text?: string;
  disclosure?: string;
  placement?: string;
  metadata?: MetadataBag;
};

type ImagePromptRecord = {
  prompt_id: string;
  prompt: string;
  purpose?: string;
  status?: string;
  metadata?: MetadataBag;
};

type ImageGenerationRun = {
  run_id?: string;
  prompt_id?: string;
  provider?: string;
  status?: string;
  asset_ids?: string[];
  metadata?: MetadataBag;
};

type ImageAssetRecord = {
  asset_id: string;
  source?: string;
  url?: string;
  repoPath?: string;
  alt?: string;
  caption?: string;
  prompt_id?: string;
  status?: string;
  metadata?: MetadataBag;
};

type ImageSetRecord = {
  set_id?: string;
  purpose?: string;
  asset_ids?: string[];
  metadata?: MetadataBag;
};

type RevisionRequest = {
  request_id: string;
  requested_by_agent?: AllowedAgentName;
  target_section_id?: string;
  priority?: string;
  instruction: string;
  status?: string;
  metadata?: MetadataBag;
};

export type ContentSourceV1 = {
  record_type: 'content_source';
  schema_version: 'content_source.v1';

  ids?: {
    content_id?: string;
    publication_id?: string;
    source_version_id?: string;
    parent_content_id?: string | null;
    workflow_id?: string;
  };

  publication_context?: {
    publication_name?: string;
    domain?: string;
    topic_scope?: string;
  };

  content?: {
    schema_version?: 'content_blocks.v1';
    title?: string;
    deck?: string;
    description?: string;

    // structured content (future canonical)
    structure?: {
      schema_version?: 'content_structure.v1';
      sections?: Array<{
        section_id: string;
        role?: string; // intro/conclusion/body/etc.
        name?: string;
        block_refs?: string[];
      }>;
    };

    blocks?: Array<{
      block_id: string;
      block_type: string; // markdown/image/cta/quiz/etc.
      payload?: unknown;
      section_id?: string;
    }>;
  };

  taxonomy?: {
    schema_version?: 'taxonomy.v1';
    tags?: string[];
  };

  seo?: {
    schema_version?: 'seo.v1';
    meta_title?: string;
    meta_description?: string;
    canonical_url?: string;
  };

  media?: {
    schema_version?: 'media.v1';
    visual_strategy?: {
      primary_image_goal?: string;
      tone?: string;
      constraints?: string[];
      metadata?: MetadataBag;
    };
    image_prompt_register?: Record<string, ImagePromptRecord>;
    image_generation_runs?: ImageGenerationRun[];
    image_asset_register?: ImageAssetRecord[];
    image_sets?: ImageSetRecord[];
    media_revision_summary?: {
      summary?: string;
      resolved_request_ids?: string[];
      metadata?: MetadataBag;
    };
  };

  editorial?: {
    schema_version?: 'editorial.v1';
    writer_notes?: string;
    // optional “flat” draft content if agents prefer
    draft_markdown?: string;
  };

  emotional_strategy?: {
    schema_version?: 'emotional_strategy.v1';
    overall_texture_assessment?: string;
    overly_polished_moments?: unknown[];
    opportunities_for_specificity?: unknown[];
    rhythm_adjustments?: unknown[];
    sensory_detail_additions?: unknown[];
    lines_to_preserve?: string[];
  };

  sources?: {
    schema_version?: 'sources.v1';
    source_list?: Array<{
      source_id?: string;
      name: string;
      url: string;
      publisher?: string;
      accessed_at?: string;
    }>;
  };

  claims?: {
    schema_version?: 'claims.v1';
    claim_list?: ClaimRecord[];
    metadata?: MetadataBag;
  };

  compliance?: {
    schema_version?: 'compliance.v1';
    requirements?: ComplianceRequirement[];
    metadata?: MetadataBag;
  };

  commercial?: {
    schema_version?: 'commercial.v1';
    offers?: CommercialOffer[];
    metadata?: MetadataBag;
  };

  approvals?: {
    schema_version?: 'approvals.v1';
    approval_status?: string; // repo doesn’t enforce; keep open
  };

  publication?: {
    schema_version?: 'publication.v1';
    publication_status?: string; // keep separate from workflow_status
    publish_payload?: PublishPayload; // repo naming precedence
  };

  workflow?: {
    schema_version?: 'content_workflow.v1';
    workflow_id?: string;
    current_agent?: AllowedAgentName;
    previous_agent?: AllowedAgentName | null;
    next_agent?: AllowedAgentName | null;
    handoff_notes?: string;
    metadata?: MetadataBag;
  };

  revision_control?: {
    schema_version?: 'revision_control.v1';
    audit_findings?: unknown[];
    routing_decisions?: unknown[];
    revision_requests?: RevisionRequest[];
    change_assessments?: unknown[]; // easy future expansion: add structured scores here
  };

  versioning?: {
    schema_version?: 'versioning.v1';
    record_version?: number;
    previous_version_refs?: string[];
  };
};

export type WorkflowRecord = {
  request_id: string;
  created_at: string; // ISO
  updated_at: string; // ISO
  workflow_status: WorkflowStatus;
  current_stage: AllowedAgentName | null;
  next_agent: AllowedAgentName | null;
  completed_agents: AllowedAgentName[];
  failed_agents: AllowedAgentName[];
  last_error: string | null;
  needs_review: boolean;
  input: ContentSourceV1;
  agent_outputs: Partial<Record<AllowedAgentName, AgentOutputEnvelope>>;
  lock?: WorkflowLockRecord;
  history: WorkflowHistoryEntry[];
  version: number; // optimistic concurrency (repo contract)
};

// ---------- Zod Schemas ----------
const metadataBagSchema = z.record(z.string(), z.unknown());
const allowedAgentNameSchema = z.enum(['reader_insight', 'research', 'angle', 'draft', 'final_article']);
const workflowStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed', 'published']);

const publishPayloadSchema = z
  .object({
    slug: z.string(),
    title: z.string(),
    markdown: z.string().optional(),
    content: z.string().optional(),
    description: z.string().optional(),
    publishDate: z.string().optional(),
    author: z.string().optional(),
    tags: z.array(z.string()).optional(),
    images: z.array(z.unknown()).optional(),
    overwrite: z.boolean().optional(),
    draft: z.boolean().optional(),
    articlePath: z.string().optional(),
    category: z.string().optional(),
    excerpt: z.string().optional(),
    seoDescription: z.string().optional(),
    featuredImage: z.string().optional(),
    existingFeaturedImagePath: z.string().optional(),
    videoLink: z.string().optional(),
    ctaLink: z.string().optional(),
    ctaText: z.string().optional(),
    commitMessage: z.string().optional(),
    metadata: metadataBagSchema.optional(),
  })
  .strict();

const claimSchema = z
  .object({
    claim_id: z.string().optional(),
    claim_text: z.string(),
    claim_type: z.string().optional(),
    source_ids: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    status: z.string().optional(),
    metadata: metadataBagSchema.optional(),
  })
  .strict();

const complianceRequirementSchema = z
  .object({
    requirement_id: z.string().optional(),
    category: z.string(),
    description: z.string(),
    status: z.string().optional(),
    related_claim_ids: z.array(z.string()).optional(),
    notes: z.string().optional(),
    metadata: metadataBagSchema.optional(),
  })
  .strict();

const commercialOfferSchema = z
  .object({
    offer_id: z.string().optional(),
    name: z.string(),
    url: z.string().optional(),
    cta_text: z.string().optional(),
    disclosure: z.string().optional(),
    placement: z.string().optional(),
    metadata: metadataBagSchema.optional(),
  })
  .strict();

const imagePromptSchema = z
  .object({
    prompt_id: z.string(),
    prompt: z.string(),
    purpose: z.string().optional(),
    status: z.string().optional(),
    metadata: metadataBagSchema.optional(),
  })
  .strict();

const imageGenerationRunSchema = z
  .object({
    run_id: z.string().optional(),
    prompt_id: z.string().optional(),
    provider: z.string().optional(),
    status: z.string().optional(),
    asset_ids: z.array(z.string()).optional(),
    metadata: metadataBagSchema.optional(),
  })
  .strict();

const imageAssetSchema = z
  .object({
    asset_id: z.string(),
    source: z.string().optional(),
    url: z.string().optional(),
    repoPath: z.string().optional(),
    alt: z.string().optional(),
    caption: z.string().optional(),
    prompt_id: z.string().optional(),
    status: z.string().optional(),
    metadata: metadataBagSchema.optional(),
  })
  .strict();

const imageSetSchema = z
  .object({
    set_id: z.string().optional(),
    purpose: z.string().optional(),
    asset_ids: z.array(z.string()).optional(),
    metadata: metadataBagSchema.optional(),
  })
  .strict();

const revisionRequestSchema = z
  .object({
    request_id: z.string(),
    requested_by_agent: allowedAgentNameSchema.optional(),
    target_section_id: z.string().optional(),
    priority: z.string().optional(),
    instruction: z.string(),
    status: z.string().optional(),
    metadata: metadataBagSchema.optional(),
  })
  .strict();

export const contentSourceV1Schema = z
  .object({
    record_type: z.literal('content_source'),
    schema_version: z.literal('content_source.v1'),
    ids: z
      .object({
        content_id: z.string().optional(),
        publication_id: z.string().optional(),
        source_version_id: z.string().optional(),
        parent_content_id: z.string().nullable().optional(),
        workflow_id: z.string().optional(),
      })
      .strict()
      .optional(),
    publication_context: z
      .object({
        publication_name: z.string().optional(),
        domain: z.string().optional(),
        topic_scope: z.string().optional(),
      })
      .strict()
      .optional(),
    content: z
      .object({
        schema_version: z.literal('content_blocks.v1').optional(),
        title: z.string().optional(),
        deck: z.string().optional(),
        description: z.string().optional(),
        structure: z
          .object({
            schema_version: z.literal('content_structure.v1').optional(),
            sections: z
              .array(
                z
                  .object({
                    section_id: z.string(),
                    role: z.string().optional(),
                    name: z.string().optional(),
                    block_refs: z.array(z.string()).optional(),
                  })
                  .strict()
              )
              .optional(),
          })
          .strict()
          .optional(),
        blocks: z
          .array(
            z
              .object({
                block_id: z.string(),
                block_type: z.string(),
                payload: z.unknown().optional(),
                section_id: z.string().optional(),
              })
              .strict()
          )
          .optional(),
      })
      .strict()
      .optional(),
    taxonomy: z
      .object({
        schema_version: z.literal('taxonomy.v1').optional(),
        tags: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    seo: z
      .object({
        schema_version: z.literal('seo.v1').optional(),
        meta_title: z.string().optional(),
        meta_description: z.string().optional(),
        canonical_url: z.string().optional(),
      })
      .strict()
      .optional(),
    media: z
      .object({
        schema_version: z.literal('media.v1').optional(),
        visual_strategy: z
          .object({
            primary_image_goal: z.string().optional(),
            tone: z.string().optional(),
            constraints: z.array(z.string()).optional(),
            metadata: metadataBagSchema.optional(),
          })
          .strict()
          .optional(),
        image_prompt_register: z.record(z.string(), imagePromptSchema).optional(),
        image_generation_runs: z.array(imageGenerationRunSchema).optional(),
        image_asset_register: z.array(imageAssetSchema).optional(),
        image_sets: z.array(imageSetSchema).optional(),
        media_revision_summary: z
          .object({
            summary: z.string().optional(),
            resolved_request_ids: z.array(z.string()).optional(),
            metadata: metadataBagSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    editorial: z
      .object({
        schema_version: z.literal('editorial.v1').optional(),
        writer_notes: z.string().optional(),
        draft_markdown: z.string().optional(),
      })
      .strict()
      .optional(),
    emotional_strategy: z
      .object({
        schema_version: z.literal('emotional_strategy.v1').optional(),
        overall_texture_assessment: z.string().optional(),
        overly_polished_moments: z.array(z.unknown()).optional(),
        opportunities_for_specificity: z.array(z.unknown()).optional(),
        rhythm_adjustments: z.array(z.unknown()).optional(),
        sensory_detail_additions: z.array(z.unknown()).optional(),
        lines_to_preserve: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    sources: z
      .object({
        schema_version: z.literal('sources.v1').optional(),
        source_list: z
          .array(
            z
              .object({
                source_id: z.string().optional(),
                name: z.string(),
                url: z.string(),
                publisher: z.string().optional(),
                accessed_at: z.string().optional(),
              })
              .strict()
          )
          .optional(),
      })
      .strict()
      .optional(),
    claims: z
      .object({
        schema_version: z.literal('claims.v1').optional(),
        claim_list: z.array(claimSchema).optional(),
        metadata: metadataBagSchema.optional(),
      })
      .strict()
      .optional(),
    compliance: z
      .object({
        schema_version: z.literal('compliance.v1').optional(),
        requirements: z.array(complianceRequirementSchema).optional(),
        metadata: metadataBagSchema.optional(),
      })
      .strict()
      .optional(),
    commercial: z
      .object({
        schema_version: z.literal('commercial.v1').optional(),
        offers: z.array(commercialOfferSchema).optional(),
        metadata: metadataBagSchema.optional(),
      })
      .strict()
      .optional(),
    approvals: z
      .object({
        schema_version: z.literal('approvals.v1').optional(),
        approval_status: z.string().optional(),
      })
      .strict()
      .optional(),
    publication: z
      .object({
        schema_version: z.literal('publication.v1').optional(),
        publication_status: z.string().optional(),
        publish_payload: publishPayloadSchema.optional(),
      })
      .strict()
      .optional(),
    workflow: z
      .object({
        schema_version: z.literal('content_workflow.v1').optional(),
        workflow_id: z.string().optional(),
        current_agent: allowedAgentNameSchema.optional(),
        previous_agent: allowedAgentNameSchema.nullable().optional(),
        next_agent: allowedAgentNameSchema.nullable().optional(),
        handoff_notes: z.string().optional(),
        metadata: metadataBagSchema.optional(),
      })
      .strict()
      .optional(),
    revision_control: z
      .object({
        schema_version: z.literal('revision_control.v1').optional(),
        audit_findings: z
          .array(
            z
              .object({
                finding_id: z.string().optional(),
                severity: z.string().optional(),
                finding: z.string(),
                metadata: metadataBagSchema.optional(),
              })
              .strict()
          )
          .optional(),
        routing_decisions: z
          .array(
            z
              .object({
                decision_id: z.string().optional(),
                from_agent: allowedAgentNameSchema.optional(),
                to_agent: allowedAgentNameSchema.nullable().optional(),
                reason: z.string(),
                metadata: metadataBagSchema.optional(),
              })
              .strict()
          )
          .optional(),
        revision_requests: z.array(revisionRequestSchema).optional(),
        change_assessments: z
          .array(
            z
              .object({
                assessment_id: z.string().optional(),
                revision_request_id: z.string().optional(),
                outcome: z.string(),
                notes: z.string().optional(),
                metadata: metadataBagSchema.optional(),
              })
              .strict()
          )
          .optional(),
      })
      .strict()
      .optional(),
    versioning: z
      .object({
        schema_version: z.literal('versioning.v1').optional(),
        record_version: z.number().optional(),
        previous_version_refs: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const agentOutputEnvelopeSchema = z
  .object({
    version: z.number(),
    updated_at: z.string(),
    output: z.unknown().optional(),
    expected_agent_version: z.number(),
  })
  .catchall(z.unknown());

export const workflowRecordSchema = z
  .object({
    request_id: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    workflow_status: workflowStatusSchema,
    current_stage: allowedAgentNameSchema.nullable(),
    next_agent: allowedAgentNameSchema.nullable(),
    completed_agents: z.array(allowedAgentNameSchema),
    failed_agents: z.array(allowedAgentNameSchema),
    last_error: z.string().nullable(),
    needs_review: z.boolean(),
    input: contentSourceV1Schema,
    agent_outputs: z.partialRecord(allowedAgentNameSchema, agentOutputEnvelopeSchema),
    lock: z
      .object({
        token: z.string(),
        owner_id: z.string(),
        owner_label: z.string(),
        acquired_at: z.string(),
        expires_at: z.string(),
      })
      .catchall(z.unknown())
      .optional(),
    history: z.array(
      z
        .object({
          at: z.string(),
          action: z.string(),
          agent_name: allowedAgentNameSchema.optional(),
          details: z.record(z.string(), z.unknown()).optional(),
        })
        .catchall(z.unknown())
    ),
    version: z.number(),
  })
  .catchall(z.unknown());

export type ContentSourceV1ValidationIssue = z.core.$ZodIssue;

export const getContentSourceV1ValidationIssues = (value: unknown) => {
  const result = contentSourceV1Schema.safeParse(value);

  return result.success ? [] : result.error.issues;
};

export const parseContentSourceV1 = (value: unknown) => contentSourceV1Schema.safeParse(value);

export const validateContentSourceV1 = (value: unknown): value is ContentSourceV1 =>
  contentSourceV1Schema.safeParse(value).success;

export const validateWorkflowRecord = (value: unknown): value is WorkflowRecord =>
  workflowRecordSchema.safeParse(value).success;

export function getAgentOutputVersion(record: WorkflowRecord, agent: AllowedAgentName): number {
  return record.agent_outputs[agent]?.version ?? 0;
}

export function patchAgentOutput(
  record: WorkflowRecord,
  agent_name: AllowedAgentName,
  expected_agent_version: number,
  output: unknown,
  nowIso: string
): WorkflowRecord {
  const current = record.agent_outputs[agent_name];
  const currentVersion = current?.version ?? 0;

  if (expected_agent_version !== currentVersion) {
    throw new Error(`conflict: expected_agent_version=${expected_agent_version} current=${currentVersion}`);
  }

  const nextVersion = currentVersion + 1;
  const nextRecord: WorkflowRecord = {
    ...record,
    updated_at: nowIso,
    agent_outputs: {
      ...record.agent_outputs,
      [agent_name]: {
        version: nextVersion,
        updated_at: nowIso,
        output,
        expected_agent_version,
      },
    },
    version: record.version + 1,
  };

  return nextRecord;
}

export function markAgentComplete(
  record: WorkflowRecord,
  agent_name: AllowedAgentName,
  expected_record_version: number,
  next_agent: AllowedAgentName | null,
  workflow_status: WorkflowStatus,
  nowIso: string
): WorkflowRecord {
  if (expected_record_version !== record.version) {
    throw new Error(`conflict: expected_record_version=${expected_record_version} current=${record.version}`);
  }

  const completed = new Set(record.completed_agents);
  completed.add(agent_name);

  const nextRecord: WorkflowRecord = {
    ...record,
    updated_at: nowIso,
    workflow_status,
    current_stage: agent_name,
    next_agent,
    completed_agents: Array.from(completed),
    history: [
      ...record.history,
      {
        at: nowIso,
        action: 'mark_agent_complete',
        agent_name,
        details: { next_agent, workflow_status },
      },
    ],
    version: record.version + 1,
  };

  return nextRecord;
}
