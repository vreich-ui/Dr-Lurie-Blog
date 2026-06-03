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
    visual_strategy?: unknown;
    image_prompt_register?: Record<string, unknown>;
    image_generation_runs?: unknown[];
    image_asset_register?: unknown[];
    image_sets?: unknown[];
    media_revision_summary?: unknown;
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
    claim_list?: unknown[];
  };

  compliance?: {
    schema_version?: 'compliance.v1';
    requirements?: unknown[];
  };

  commercial?: {
    schema_version?: 'commercial.v1';
    offers?: unknown[];
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
  };

  revision_control?: {
    schema_version?: 'revision_control.v1';
    audit_findings?: unknown[];
    routing_decisions?: unknown[];
    revision_requests?: unknown[];
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
  })
  .catchall(z.unknown());

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
      .catchall(z.unknown())
      .optional(),
    publication_context: z
      .object({
        publication_name: z.string().optional(),
        domain: z.string().optional(),
        topic_scope: z.string().optional(),
      })
      .catchall(z.unknown())
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
                  .catchall(z.unknown())
              )
              .optional(),
          })
          .catchall(z.unknown())
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
              .catchall(z.unknown())
          )
          .optional(),
      })
      .catchall(z.unknown())
      .optional(),
    taxonomy: z
      .object({
        schema_version: z.literal('taxonomy.v1').optional(),
        tags: z.array(z.string()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    seo: z
      .object({
        schema_version: z.literal('seo.v1').optional(),
        meta_title: z.string().optional(),
        meta_description: z.string().optional(),
        canonical_url: z.string().optional(),
      })
      .catchall(z.unknown())
      .optional(),
    media: z
      .object({
        schema_version: z.literal('media.v1').optional(),
        visual_strategy: z.unknown().optional(),
        image_prompt_register: z.record(z.string(), z.unknown()).optional(),
        image_generation_runs: z.array(z.unknown()).optional(),
        image_asset_register: z.array(z.unknown()).optional(),
        image_sets: z.array(z.unknown()).optional(),
        media_revision_summary: z.unknown().optional(),
      })
      .catchall(z.unknown())
      .optional(),
    editorial: z
      .object({
        schema_version: z.literal('editorial.v1').optional(),
        writer_notes: z.string().optional(),
        draft_markdown: z.string().optional(),
      })
      .catchall(z.unknown())
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
      .catchall(z.unknown())
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
              .catchall(z.unknown())
          )
          .optional(),
      })
      .catchall(z.unknown())
      .optional(),
    claims: z
      .object({
        schema_version: z.literal('claims.v1').optional(),
        claim_list: z.array(z.unknown()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    compliance: z
      .object({
        schema_version: z.literal('compliance.v1').optional(),
        requirements: z.array(z.unknown()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    commercial: z
      .object({
        schema_version: z.literal('commercial.v1').optional(),
        offers: z.array(z.unknown()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    approvals: z
      .object({
        schema_version: z.literal('approvals.v1').optional(),
        approval_status: z.string().optional(),
      })
      .catchall(z.unknown())
      .optional(),
    publication: z
      .object({
        schema_version: z.literal('publication.v1').optional(),
        publication_status: z.string().optional(),
        publish_payload: publishPayloadSchema.optional(),
      })
      .catchall(z.unknown())
      .optional(),
    workflow: z
      .object({
        schema_version: z.literal('content_workflow.v1').optional(),
        workflow_id: z.string().optional(),
      })
      .catchall(z.unknown())
      .optional(),
    revision_control: z
      .object({
        schema_version: z.literal('revision_control.v1').optional(),
        audit_findings: z.array(z.unknown()).optional(),
        routing_decisions: z.array(z.unknown()).optional(),
        revision_requests: z.array(z.unknown()).optional(),
        change_assessments: z.array(z.unknown()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    versioning: z
      .object({
        schema_version: z.literal('versioning.v1').optional(),
        record_version: z.number().optional(),
        previous_version_refs: z.array(z.string()).optional(),
      })
      .catchall(z.unknown())
      .optional(),
  })
  .catchall(z.unknown());

const allowedAgentNameSchema = z.enum(['reader_insight', 'research', 'angle', 'draft', 'final_article']);
const workflowStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed', 'published']);

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
