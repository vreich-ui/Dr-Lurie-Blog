import { z } from 'zod';
import { workflowRecordSchema, type WorkflowLockRecord } from './schema-v1.js';
import { allowedAgentNames } from './workflow-contract.js';

export type { WorkflowLockRecord } from './schema-v1.js';

export const objectTypes = ['page', 'section', 'navigation', 'taxonomy', 'site', 'template', 'content_item'] as const;
export type ObjectType = (typeof objectTypes)[number];

export const objectTypeSchema = z.enum(objectTypes);
export const objectIdSchema = z.string();

export const principalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('human'),
    id: z.string(),
    email: z.string(),
  }),
  z.object({
    kind: z.literal('agent'),
    agent_name: z.string(),
    auth: z.enum(['publish_key', 'mcp_token']),
  }),
]);
export type Principal = z.infer<typeof principalSchema>;

export const reviewStateSchema = z.object({
  state: z.enum(['open', 'changes_requested', 'approved']),
  decisions: z.array(
    z.object({
      at: z.string(),
      by: principalSchema,
      decision: z.enum(['approve', 'request_changes']),
      note: z.string().optional(),
      publish_action: z
        .object({
          published_time: z.union([z.string(), z.null(), z.literal('immediate')]),
        })
        .optional(),
      content_revision: z.number(),
    })
  ),
});
export type ReviewState = z.infer<typeof reviewStateSchema>;

export const publishReceiptSchema = z.record(z.string(), z.unknown());

export const publicationStateSchema = z.object({
  published_time: z.string().nullable(),
  publish_receipt: publishReceiptSchema.optional(),
});
export type PublicationState = z.infer<typeof publicationStateSchema>;

export const workflowExtensionSchema = z.object({
  workflow_status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
  current_stage: z.enum(allowedAgentNames).nullable(),
  next_agent: z.enum(allowedAgentNames).nullable(),
  completed_agents: z.array(z.enum(allowedAgentNames)),
  failed_agents: z.array(z.enum(allowedAgentNames)),
  last_error: z.string().nullable(),
  needs_review: z.boolean(),
  agent_outputs: z.record(z.string(), z.unknown()),
});
export type WorkflowExtension = z.infer<typeof workflowExtensionSchema>;

export const historyEntrySchema = z.object({
  at: z.string(),
  action: z.string(),
  actor: principalSchema,
  details: z.record(z.string(), z.unknown()).optional(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const workflowLockRecordSchema = workflowRecordSchema.shape.lock;

export const objectRecordSchema = z.object({
  object_id: objectIdSchema,
  object_type: objectTypeSchema,
  schema_version: z.string(),
  site: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  status: z.enum(['active', 'archived']),
  body: z.unknown(),
  publication: publicationStateSchema,
  review: reviewStateSchema.optional(),
  lock: workflowLockRecordSchema.optional(),
  history: z.array(historyEntrySchema),
  version: z.number(),
  content_revision: z.number(),
  workflow: workflowExtensionSchema.optional(),
});

export type ObjectRecord<TBody = unknown> = Omit<z.infer<typeof objectRecordSchema>, 'body' | 'lock'> & {
  body: TBody;
  lock?: WorkflowLockRecord;
};
