export const allowedAgentNames = ['reader_insight', 'research', 'angle', 'draft', 'final_article'] as const;
export type AllowedAgentName = (typeof allowedAgentNames)[number];

export const workflowStatuses = ['pending', 'in_progress', 'completed', 'failed', 'published'] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];

export const knownPublicationStatuses = ['draft', 'ready', 'scheduled', 'published'] as const;
export type KnownPublicationStatus = (typeof knownPublicationStatuses)[number];

export const publicationStatusDescription =
  'Article payload status separate from workflow_status. publication_status: draft means the payload is not publishable yet; ready means publish now through the immediate publishing path; scheduled plus publication.scheduled_for means publish later through the due scheduled-publish path. published is reserved for records whose publication payload has been published; use workflow_status: published only after actual successful publish and mark_published for the committed live article state.';
