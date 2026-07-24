/**
 * Display-name identity module (T9.2) — the "no naked ref" rule made
 * executable. Every admin surface renders objects, history, and ids through
 * these three helpers instead of printing raw `req_*` / `sec_*` / node ids.
 *
 *   objectDisplayName(record) — a human title for any of the ten object types,
 *                               derived from the object's own body.
 *   verbToPhrase(entry)       — a history entry as a plain-language sentence.
 *   idTooltip(id)             — the raw id, framed for a title/tooltip only.
 *
 * Pure, dependency-free, and unit-tested against real seed bodies so the
 * derivation cannot silently drift from the shapes on disk.
 */
import type {
  ObjectRecord,
  ObjectType,
  HistoryEntry,
  Principal,
} from '../../schema/object-record-v1.js';

/** Human label for each object type — used for fallbacks and type badges. */
export const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  page: 'Page',
  section: 'Section',
  navigation: 'Navigation',
  taxonomy: 'Taxonomy',
  site: 'Site',
  template: 'Page template',
  section_template: 'Section template',
  theme: 'Theme',
  product: 'Product',
  content_item: 'Article',
  tracking_config: 'Tracking config',
};

export function objectTypeLabel(type: ObjectType): string {
  return OBJECT_TYPE_LABELS[type] ?? titleCase(String(type).replace(/_/g, ' '));
}

// ─── generic helpers ──────────────────────────────────────────────────────────

type Bag = Record<string, unknown>;

const asBag = (value: unknown): Bag => (value && typeof value === 'object' ? (value as Bag) : {});
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Title-cased, de-slugified copy: "barrier-repair-guide" → "Barrier Repair Guide". */
export function deSlug(slug: string | undefined): string | undefined {
  if (!slug) return undefined;
  const cleaned = slug
    .replace(/^\/+|\/+$/g, '')
    .replace(/[-_/]+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return titleCase(cleaned);
}

function titleCase(text: string): string {
  return text.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** First heading/strong text out of a section's stored HTML, tags stripped. */
function firstHeadingText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const match = html.match(/<(h[1-6]|strong)[^>]*>([\s\S]*?)<\/\1>/i);
  const inner = match?.[2] ?? '';
  const text = inner
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

// ─── object display name ──────────────────────────────────────────────────────

/**
 * A human title for an object, derived from its body. Never returns a raw
 * machine id; when nothing nameable exists it falls back to "Untitled <type>"
 * (the id belongs in a tooltip via {@link idTooltip}, not the visible label).
 */
export function objectDisplayName(record: Pick<ObjectRecord, 'object_type' | 'body' | 'object_id'>): string {
  const body = asBag(record.body);

  const named = str(body.name) ?? str(body.title) ?? str(asBag(body.presentation).title as unknown) ?? undefined;

  switch (record.object_type) {
    case 'site':
    case 'theme':
    case 'template':
    case 'section_template':
      return str(body.name) ?? fallback(record);

    case 'page':
      return str(body.title) ?? deSlug(str(body.route)) ?? fallback(record);

    case 'content_item':
      return str(body.title) ?? deSlug(str(body.slug)) ?? fallback(record);

    case 'product':
      return str(asBag(body.presentation).title) ?? deSlug(str(body.slug)) ?? fallback(record);

    case 'section': {
      const section = asBag(body.section);
      return (
        firstHeadingText(str(asBag(section.data).body)) ??
        str(section.heading) ??
        str(section.name) ??
        deSlug(str(section.id)) ??
        fallback(record)
      );
    }

    case 'navigation': {
      const role = str(body.role);
      const brand = str(asBag(body.brand).text);
      if (role) return `${capitalize(role)} navigation`;
      if (brand) return `${brand} navigation`;
      return fallback(record);
    }

    case 'taxonomy': {
      const kinds = Object.keys(asBag(body.kinds));
      return kinds.length ? `Taxonomy (${kinds.join(', ')})` : 'Site taxonomy';
    }

    default:
      return named ?? fallback(record);
  }
}

function fallback(record: Pick<ObjectRecord, 'object_type'>): string {
  return `Untitled ${objectTypeLabel(record.object_type).toLowerCase()}`;
}

// ─── principals + history phrasing ────────────────────────────────────────────

/** A human name for a principal — person's email local-part, or agent name. */
export function principalName(principal: Principal | undefined): string {
  if (!principal) return 'Someone';
  if (principal.kind === 'agent') {
    return `${titleCase(principal.agent_name.replace(/[_-]+/g, ' '))} (agent)`;
  }
  const email = str(principal.email);
  if (!email) return 'A signed-in user';
  const local = email.split('@')[0];
  return titleCase(local.replace(/[._-]+/g, ' '));
}

/** action → past-tense verb phrase (object-agnostic; the timeline supplies context). */
const VERB_PHRASES: Record<string, string> = {
  create: 'created',
  object_create: 'created',
  create_request: 'created',
  create_variant: 'created a variant',
  instantiate: 'created from a template',
  instantiate_section: 'created a section from a template',
  checkout: 'checked out',
  checkout_request: 'requested checkout',
  admin_checkout: 'checked out',
  checkin: 'checked in',
  checkin_request: 'requested check-in',
  admin_checkin: 'checked in',
  patch: 'edited',
  update_item: 'updated',
  update_section_data: 'updated section content',
  upsert_section: 'updated a section',
  admin_update_node: 'edited a block',
  admin_save_draft: 'saved a draft',
  patch_agent_output: 'updated agent output',
  patch_canonical_input: 'updated the canonical input',
  submit_review: 'submitted for review',
  review_decide: 'reviewed',
  validate: 'validated',
  publish: 'published',
  publish_by_time: 'published',
  set_published_time: 'scheduled publication',
  apply_theme: 'applied a theme',
  discard: 'discarded changes',
  refresh_lock: 'refreshed the lock',
  admin_refresh_lock: 'refreshed the lock',
  force_release: 'force-released the lock',
  admin_force_release: 'force-released the lock',
  mark_agent_complete: 'completed an agent stage',
};

/**
 * A history entry rendered as one plain sentence: "<Person> <did something>".
 * `review_decide` refines by the recorded decision when present.
 */
export function verbToPhrase(entry: Pick<HistoryEntry, 'action' | 'actor' | 'details'>): string {
  let verb = VERB_PHRASES[entry.action];

  if (entry.action === 'review_decide') {
    const decision = str(asBag(entry.details).decision);
    if (decision === 'approve') verb = 'approved the changes';
    else if (decision === 'request_changes') verb = 'requested changes';
  }

  if (!verb) verb = entry.action.replace(/[_.]+/g, ' ').trim();

  return `${principalName(entry.actor)} ${verb}`;
}

// ─── id tooltip ───────────────────────────────────────────────────────────────

/** Frames a raw id for a title/tooltip — the only sanctioned place an id shows. */
export function idTooltip(id: string | undefined): string {
  const value = str(id);
  return value ? `Internal id: ${value}` : 'No id assigned';
}
