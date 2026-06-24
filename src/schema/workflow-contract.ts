export const allowedAgentNames = ['reader_insight', 'research', 'angle', 'draft', 'final_article'] as const;
export type AllowedAgentName = (typeof allowedAgentNames)[number];

export const workflowStatuses = ['pending', 'in_progress', 'completed', 'failed'] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];
