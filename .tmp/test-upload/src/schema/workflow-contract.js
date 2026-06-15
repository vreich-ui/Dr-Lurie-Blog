export const allowedAgentNames = ['reader_insight', 'research', 'angle', 'draft', 'final_article'];
export const workflowStatuses = ['pending', 'in_progress', 'completed', 'failed', 'published'];
export const knownPublicationStatuses = ['draft', 'ready', 'scheduled'];
export const publicationStatusDescription = 'Article payload status separate from workflow_status. Known first-party values are draft, ready, and scheduled; published/live are not publication_status values. Scheduled records require publication.scheduled_for and a server-authorized scheduled publish call when due. Use workflow_status: published after mark_published for the committed live article state.';
