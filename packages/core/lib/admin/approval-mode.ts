/**
 * Actions that may be approved consecutively for one active agent run.
 *
 * This is intentionally an allow-list. Publication, deletion, discard, theme,
 * access-control, and release actions always require an individual decision.
 */
const RUN_SAFE_TOOLS = new Set([
  'patch',
  'create_object',
  'create_variant',
  'instantiate_template',
  'instantiate_section_template',
  'submit_review',
  'create_pdf_template',
  'get_agent_artifact_job_status',
]);

export function isRunSafeApproval(tool: string): boolean {
  return RUN_SAFE_TOOLS.has(tool);
}
