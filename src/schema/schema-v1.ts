// schema-v1.ts
import Ajv, { JSONSchemaType } from "ajv";

export type AllowedAgentName = "reader_insight" | "research" | "angle" | "draft" | "final_article";
export type WorkflowStatus = "pending" | "in_progress" | "completed" | "failed" | "published";

export type AgentOutputEnvelope = {
  version: number;             // agent output version (repo contract)
  updated_at: string;          // ISO
  output: unknown;             // stage payload (schema-versioned ideally)
  expected_agent_version: number;
};

export type WorkflowHistoryEntry = {
  at: string;                  // ISO
  action: string;
  agent_name?: AllowedAgentName;
  details?: Record<string, unknown>;
};

export type WorkflowLockRecord = {
  token: string;
  owner_id: string;
  owner_label: string;
  acquired_at: string;         // ISO
  expires_at: string;          // ISO
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
  record_type: "content_source";
  schema_version: "content_source.v1";

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
    schema_version?: "content_blocks.v1";
    title?: string;
    deck?: string;
    description?: string;

    // structured content (future canonical)
    structure?: {
      schema_version?: "content_structure.v1";
      sections?: Array<{
        section_id: string;
        role?: string;          // intro/conclusion/body/etc.
        name?: string;
        block_refs?: string[];
      }>;
    };

    blocks?: Array<{
      block_id: string;
      block_type: string;       // markdown/image/cta/quiz/etc.
      payload?: unknown;
      section_id?: string;
    }>;
  };

  taxonomy?: {
    schema_version?: "taxonomy.v1";
    tags?: string[];
  };

  seo?: {
    schema_version?: "seo.v1";
    meta_title?: string;
    meta_description?: string;
    canonical_url?: string;
  };

  media?: {
    schema_version?: "media.v1";
    visual_strategy?: unknown;
    image_prompt_register?: Record<string, unknown>;
    image_generation_runs?: unknown[];
    image_asset_register?: unknown[];
    image_sets?: unknown[];
    media_revision_summary?: unknown;
  };

  editorial?: {
    schema_version?: "editorial.v1";
    writer_notes?: string;
    // optional “flat” draft content if agents prefer
    draft_markdown?: string;
  };

  emotional_strategy?: {
    schema_version?: "emotional_strategy.v1";
    overall_texture_assessment?: string;
    overly_polished_moments?: unknown[];
    opportunities_for_specificity?: unknown[];
    rhythm_adjustments?: unknown[];
    sensory_detail_additions?: unknown[];
    lines_to_preserve?: string[];
  };

  sources?: {
    schema_version?: "sources.v1";
    source_list?: Array<{
      source_id?: string;
      name: string;
      url: string;
      publisher?: string;
      accessed_at?: string;
    }>;
  };

  claims?: {
    schema_version?: "claims.v1";
    claim_list?: unknown[];
  };

  compliance?: {
    schema_version?: "compliance.v1";
    requirements?: unknown[];
  };

  commercial?: {
    schema_version?: "commercial.v1";
    offers?: unknown[];
  };

  approvals?: {
    schema_version?: "approvals.v1";
    approval_status?: string;   // repo doesn’t enforce; keep open
  };

  publication?: {
    schema_version?: "publication.v1";
    publication_status?: string;          // keep separate from workflow_status
    publish_payload?: PublishPayload;     // repo naming precedence
  };

  workflow?: {
    schema_version?: "content_workflow.v1";
    workflow_id?: string;
  };

  revision_control?: {
    schema_version?: "revision_control.v1";
    audit_findings?: unknown[];
    routing_decisions?: unknown[];
    revision_requests?: unknown[];
    change_assessments?: unknown[]; // easy future expansion: add structured scores here
  };

  versioning?: {
    schema_version?: "versioning.v1";
    record_version?: number;
    previous_version_refs?: string[];
  };
};

export type WorkflowRecord = {
  request_id: string;
  created_at: string;          // ISO
  updated_at: string;          // ISO
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
  version: number;             // optimistic concurrency (repo contract)
};

// ---------- JSON Schemas ----------
const contentSourceSchema: JSONSchemaType<ContentSourceV1> = {
  $id: "content_source.v1",
  type: "object",
  properties: {
    record_type: { const: "content_source" },
    schema_version: { const: "content_source.v1" },
    ids: { type: "object", properties: {
      content_id: { type: "string", nullable: true },
      publication_id: { type: "string", nullable: true },
      source_version_id: { type: "string", nullable: true },
      parent_content_id: { type: "string", nullable: true },
      workflow_id: { type: "string", nullable: true }
    }, required: [], additionalProperties: true, nullable: true },
    publication_context: { type: "object", properties: {
      publication_name: { type: "string", nullable: true },
      domain: { type: "string", nullable: true },
      topic_scope: { type: "string", nullable: true }
    }, required: [], additionalProperties: true, nullable: true },
    content: { type: "object", properties: {
      schema_version: { type: "string", nullable: true },
      title: { type: "string", nullable: true },
      deck: { type: "string", nullable: true },
      description: { type: "string", nullable: true },
      structure: { type: "object", properties: {
        schema_version: { type: "string", nullable: true },
        sections: { type: "array", items: {
          type: "object",
          properties: {
            section_id: { type: "string" },
            role: { type: "string", nullable: true },
            name: { type: "string", nullable: true },
            block_refs: { type: "array", items: { type: "string" }, nullable: true }
          },
          required: ["section_id"],
          additionalProperties: true
        }, nullable: true }
      }, required: [], additionalProperties: true, nullable: true },
      blocks: { type: "array", items: {
        type: "object",
        properties: {
          block_id: { type: "string" },
          block_type: { type: "string" },
          payload: { nullable: true },
          section_id: { type: "string", nullable: true }
        },
        required: ["block_id", "block_type"],
        additionalProperties: true
      }, nullable: true }
    }, required: [], additionalProperties: true, nullable: true },
    taxonomy: { type: "object", properties: {
      schema_version: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" }, nullable: true }
    }, required: [], additionalProperties: true, nullable: true },
    seo: { type: "object", properties: {
      schema_version: { type: "string", nullable: true },
      meta_title: { type: "string", nullable: true },
      meta_description: { type: "string", nullable: true },
      canonical_url: { type: "string", nullable: true }
    }, required: [], additionalProperties: true, nullable: true },
    media: { type: "object", properties: {
      schema_version: { type: "string", nullable: true }
    }, required: [], additionalProperties: true, nullable: true },
    editorial: { type: "object", properties: {
      schema_version: { type: "string", nullable: true },
      writer_notes: { type: "string", nullable: true },
      draft_markdown: { type: "string", nullable: true }
    }, required: [], additionalProperties: true, nullable: true },
    emotional_strategy: { type: "object", properties: {
      schema_version: { type: "string", nullable: true },
      overall_texture_assessment: { type: "string", nullable: true },
      lines_to_preserve: { type: "array", items: { type: "string" }, nullable: true }
    }, required: [], additionalProperties: true, nullable: true },
    sources: { type: "object", properties: {
      schema_version: { type: "string", nullable: true },
      source_list: { type: "array", items: {
        type: "object",
        properties: {
          source_id: { type: "string", nullable: true },
          name: { type: "string" },
          url: { type: "string" },
          publisher: { type: "string", nullable: true },
          accessed_at: { type: "string", nullable: true }
        },
        required: ["name", "url"],
        additionalProperties: true
      }, nullable: true }
    }, required: [], additionalProperties: true, nullable: true },
    claims: { type: "object", properties: {}, required: [], additionalProperties: true, nullable: true },
    compliance: { type: "object", properties: {}, required: [], additionalProperties: true, nullable: true },
    commercial: { type: "object", properties: {}, required: [], additionalProperties: true, nullable: true },
    approvals: { type: "object", properties: {
      schema_version: { type: "string", nullable: true },
      approval_status: { type: "string", nullable: true }
    }, required: [], additionalProperties: true, nullable: true },
    publication: { type: "object", properties: {
      schema_version: { type: "string", nullable: true },
      publication_status: { type: "string", nullable: true },
      publish_payload: {
        type: "object",
        properties: {
          slug: { type: "string" },
          title: { type: "string" },
          markdown: { type: "string", nullable: true },
          content: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
          publishDate: { type: "string", nullable: true },
          author: { type: "string", nullable: true },
          tags: { type: "array", items: { type: "string" }, nullable: true },
          images: { type: "array", items: {}, nullable: true },
          overwrite: { type: "boolean", nullable: true }
        },
        required: ["slug", "title"],
        additionalProperties: true,
        nullable: true
      }
    }, required: [], additionalProperties: true, nullable: true },
    workflow: { type: "object", properties: {}, required: [], additionalProperties: true, nullable: true },
    revision_control: { type: "object", properties: {}, required: [], additionalProperties: true, nullable: true },
    versioning: { type: "object", properties: {
      schema_version: { type: "string", nullable: true },
      record_version: { type: "number", nullable: true },
      previous_version_refs: { type: "array", items: { type: "string" }, nullable: true }
    }, required: [], additionalProperties: true, nullable: true }
  },
  required: ["record_type", "schema_version"],
  additionalProperties: true
};

const agentOutputEnvelopeSchema: JSONSchemaType<AgentOutputEnvelope> = {
  $id: "agent_output_envelope",
  type: "object",
  properties: {
    version: { type: "number" },
    updated_at: { type: "string" },
    output: { nullable: true },
    expected_agent_version: { type: "number" }
  },
  required: ["version", "updated_at", "expected_agent_version"],
  additionalProperties: true
};

const workflowRecordSchema: JSONSchemaType<WorkflowRecord> = {
  $id: "workflow_record",
  type: "object",
  properties: {
    request_id: { type: "string" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
    workflow_status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "published"] },
    current_stage: { type: "string", nullable: true },
    next_agent: { type: "string", nullable: true },
    completed_agents: { type: "array", items: { type: "string" } },
    failed_agents: { type: "array", items: { type: "string" } },
    last_error: { type: "string", nullable: true },
    needs_review: { type: "boolean" },
    input: { $ref: "content_source.v1#" },
    agent_outputs: { type: "object", required: [], additionalProperties: { $ref: "agent_output_envelope#" } },
    lock: {
      type: "object",
      properties: {
        token: { type: "string" },
        owner_id: { type: "string" },
        owner_label: { type: "string" },
        acquired_at: { type: "string" },
        expires_at: { type: "string" }
      },
      required: ["token", "owner_id", "owner_label", "acquired_at", "expires_at"],
      additionalProperties: true,
      nullable: true
    },
    history: { type: "array", items: { type: "object", properties: {}, required: [], additionalProperties: true } },
    version: { type: "number" }
  },
  required: [
    "request_id",
    "created_at",
    "updated_at",
    "workflow_status",
    "current_stage",
    "next_agent",
    "completed_agents",
    "failed_agents",
    "last_error",
    "needs_review",
    "input",
    "agent_outputs",
    "history",
    "version"
  ],
  additionalProperties: true
};

const ajv = new Ajv({ strict: false });
ajv.addSchema(contentSourceSchema);
ajv.addSchema(agentOutputEnvelopeSchema);

export const validateContentSourceV1 = ajv.compile<ContentSourceV1>(contentSourceSchema);
export const validateWorkflowRecord = ajv.compile<WorkflowRecord>(workflowRecordSchema);

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
        expected_agent_version: expected_agent_version
      }
    },
    version: record.version + 1
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
        action: "mark_agent_complete",
        agent_name,
        details: { next_agent, workflow_status }
      }
    ],
    version: record.version + 1
  };

  return nextRecord;
}
