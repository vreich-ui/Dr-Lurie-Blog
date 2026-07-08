/**
 * Structural-capacity registry — the declarative "hard rules" layer for
 * agent-editable objects.
 *
 * Design intent: an agent-first CMS can generate a site in a flash; the hard
 * part is EDITING it safely and repeatably. LLMs won't be consistent, so the
 * structural rules that keep rendering intact are FIXED here, in one
 * inspectable, type-checked table — leaving an editing agent to decide only the
 * few content attributes that actually matter (which CTAs, what labels), inside
 * bounds it cannot violate. This is data, not free-form validation logic, so a
 * different agent can be pointed at a different part of the site and reason
 * about its constraints from this one place. It generalizes to new render slots
 * (Phase 4 section components) by adding rows, never by re-deriving logic.
 *
 * `level` chooses severity, consumed by the validation pipeline
 * (netlify/lib/object-validate.ts):
 *   - 'warning' advises and NEVER blocks a publish (the slot degrades
 *     gracefully — e.g. a flex-wrapping container just wraps).
 *   - 'missing' hard-blocks at publish time (reserve for a bound whose
 *     violation genuinely breaks rendering or layout).
 *
 * Content REMOVAL is always legal: no `min` is set anywhere today, so an agent
 * may empty a slot — that is a content decision, not a structural break (an
 * empty header action list simply renders no CTA buttons).
 *
 * Header-actions cap rationale (the owner's "adding a button conflicts with the
 * menu" case): Header.astro lays the center menu and the right-side action
 * cluster into a shared, finite horizontal budget (the position:'center'
 * three-column grid). Extra header CTAs crowd that budget against the menu.
 * It wraps, it does not crash — so this is a `warning`, tuned to one slot of
 * headroom over the seeded two-action header.
 */
import type { NavigationBody } from '../../schema/bodies/navigation-v1.js';

export type CapacityRule = {
  /** Flag when the slot holds MORE than this many entries. */
  max?: number;
  /** Flag when the slot holds FEWER than this many entries. */
  min?: number;
  /** 'warning' advises; 'missing' hard-blocks at publish. */
  level: 'warning' | 'missing';
};

/** navigation.role → capacity rule for that role's top-level `actions[]` slot. */
export const navActionCapacity: Partial<Record<NavigationBody['role'], CapacityRule>> = {
  header: { max: 3, level: 'warning' },
};
