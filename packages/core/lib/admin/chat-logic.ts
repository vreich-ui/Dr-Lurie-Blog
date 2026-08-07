import type { ChatEventView } from './chat-client.js';

export type ChatTimelineItem = { kind: 'event'; event: ChatEventView } | { kind: 'activity'; events: ChatEventView[] };

const QUIET_TOOL_EVENTS = new Set(['tool_call', 'tool_result']);

export function groupChatEvents(events: readonly ChatEventView[]): ChatTimelineItem[] {
  const grouped: ChatTimelineItem[] = [];
  let activity: ChatEventView[] = [];
  const flush = () => {
    if (activity.length) grouped.push({ kind: 'activity', events: activity });
    activity = [];
  };
  for (const event of events) {
    if (QUIET_TOOL_EVENTS.has(event.type) && !event.detail?.is_error) activity.push(event);
    else {
      flush();
      grouped.push({ kind: 'event', event });
    }
  }
  flush();
  return grouped;
}

export const TOOL_LABELS: Record<string, string> = {
  object_get: 'Read object',
  object_validate: 'Check readiness',
  patch: 'Update object',
  create_object: 'Create object',
  create_variant: 'Create variant',
  instantiate_template: 'Use template',
  instantiate_section_template: 'Use section template',
  publish: 'Publish',
  submit_review: 'Submit for review',
  discard: 'Discard changes',
  apply_theme: 'Apply theme',
  list_objects: 'Browse publication',
};

export function toolLabel(event: ChatEventView): string {
  const tool = String(event.detail?.tool ?? 'tool');
  return String(event.detail?.summary ?? TOOL_LABELS[tool] ?? tool.replaceAll('_', ' '));
}
