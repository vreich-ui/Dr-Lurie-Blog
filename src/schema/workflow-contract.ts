export const allowedAgentNames = ['reader_insight', 'research', 'angle', 'draft', 'final_article'] as const;
export type AllowedAgentName = (typeof allowedAgentNames)[number];

export const workflowStatuses = ['pending', 'in_progress', 'completed', 'failed', 'published'] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];

export const knownPublicationStatuses = ['draft', 'ready', 'scheduled'] as const;
export type KnownPublicationStatus = (typeof knownPublicationStatuses)[number];

export const publicationStatusDescription =
  'Article payload status separate from workflow_status. Known first-party values are draft, ready, and scheduled; published/live are not publication_status values. Scheduled records require publication.scheduled_for and a server-authorized scheduled publish call when due. Use workflow_status: published after mark_published for the committed live article state.';
