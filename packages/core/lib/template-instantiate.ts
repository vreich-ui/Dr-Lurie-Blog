/**
 * Template instantiation (W2.5) — build a page body from a template's slot
 * recipe (design-principles rule 5: "templates are recipes; PageTypes are
 * law").
 *
 * Pure: no store access, no clock. The `instantiate` verb (object-verbs.ts)
 * loads the template record, calls this builder, and routes the result through
 * the EXISTING `create` path — so every enforced rule (route uniqueness,
 * PageType law, reference integrity, reader safety) gates an instantiated page
 * exactly as it gates a hand-authored one. No second write path, no second
 * validator.
 *
 * Copy semantics (D§3.6): slot blueprints are DEEP-COPIED into the new page
 * with freshly minted deterministic section ids; `page.template` records
 * provenance only — pages never live-inherit from templates.
 *
 * Slot fill rules, in slot order:
 * - blueprint present      → copy it (fresh id; visibility/notes preserved).
 * - blueprintRef present   → copy the referenced section_template's blueprint
 *                            (W8.2). The builder stays PURE: the verb
 *                            pre-resolves every ref into
 *                            `request.resolvedBlueprints`; a ref missing from
 *                            the map is an instantiation error.
 * - required, no blueprint → the registry editor `defaultData` of the slot's
 *                            FIRST allowed component-bound type. The template
 *                            schema excludes pointer/leaf-only section types.
 * - optional, no blueprint → skipped; the slot documents what MAY go there.
 * - repeatable slots seed ONE instance; repetition is a post-create edit.
 */
import { mintId } from './object-ids-mint.js';
import { sectionEditorDefaultData } from './registry/object-contract.js';
import { pageBodySchema, type PageBody, type PageTypeId } from '../schema/bodies/page-v1.js';
import type { SectionInstance } from '../schema/bodies/section-v1.js';
import type { TemplateBody, TemplateSlot } from '../schema/bodies/template-v1.js';

export type InstantiateTemplateRequest = {
  /** The new page's route and reader-facing title — always caller-supplied. */
  route: string;
  title: string;
  /** Optional; defaults to the template's first `appliesTo` PageType. */
  pageType?: PageTypeId;
  /** Optional; defaults to {} — agents fill seo after creating. */
  seo?: PageBody['seo'];
  /** Provenance stamped into `page.template`: the template object id … */
  templateRef: string;
  /** … and the (server) instantiation timestamp, ISO. */
  instantiatedAt: string;
  /**
   * Pre-resolved section-template blueprints, keyed by stpl_* id (W8.2). The
   * verb loads + parses every slot's blueprintRef into this map so the
   * builder needs no store access.
   */
  resolvedBlueprints?: Record<string, SectionInstance>;
};

export type InstantiateTemplateResult = { ok: true; body: PageBody } | { ok: false; error: string };

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const resolvePageType = (
  template: TemplateBody,
  requested: PageTypeId | undefined
): { ok: true; pageType: PageTypeId } | { ok: false; error: string } => {
  if (requested) {
    // An empty appliesTo restricts nothing; a non-empty one is binding.
    if (template.appliesTo.length > 0 && !template.appliesTo.includes(requested)) {
      return {
        ok: false,
        error: `Template "${template.name}" does not apply to pageType "${requested}" (appliesTo: ${template.appliesTo.join(', ')}).`,
      };
    }
    return { ok: true, pageType: requested };
  }
  const first = template.appliesTo[0];
  if (!first) {
    return { ok: false, error: `Template "${template.name}" names no appliesTo PageType — pass page_type explicitly.` };
  }
  return { ok: true, pageType: first };
};

const sectionFromSlot = (
  slot: TemplateSlot,
  slotIndex: number,
  templateRef: string,
  resolvedBlueprints: Record<string, SectionInstance>
): { ok: true; section?: SectionInstance } | { ok: false; error: string } => {
  // Deterministic per template+slot (idempotent retries); unique within the
  // page even when two slots share one blueprint, and distinct from the
  // blueprint's own id — these sections are copies, never references.
  const id = mintId({ kind: 'section_instance' }, `${templateRef}/${slot.slotId}/${slotIndex}`);
  if (slot.blueprint) {
    return { ok: true, section: { ...deepClone(slot.blueprint), id } };
  }
  if (slot.blueprintRef) {
    const referenced = resolvedBlueprints[slot.blueprintRef];
    if (!referenced) {
      return {
        ok: false,
        error: `Slot "${slot.slotId}" references section template "${slot.blueprintRef}", which did not resolve — it must exist and parse as section_template.v1.`,
      };
    }
    return { ok: true, section: { ...deepClone(referenced), id } };
  }
  if (!slot.required) return { ok: true };
  const type = slot.allowed[0];
  if (!type) {
    return {
      ok: false,
      error: `Required slot "${slot.slotId}" has no blueprint and no allowed types — the template cannot supply its content.`,
    };
  }
  const defaults = sectionEditorDefaultData(type);
  if (!defaults) {
    return {
      ok: false,
      error: `Required slot "${slot.slotId}" has no blueprint and its first allowed type "${type}" has no registry defaultData — give the slot a blueprint.`,
    };
  }
  return { ok: true, section: { id, type, data: deepClone(defaults) } as SectionInstance };
};

export const buildPageBodyFromTemplate = (
  template: TemplateBody,
  request: InstantiateTemplateRequest
): InstantiateTemplateResult => {
  const pageType = resolvePageType(template, request.pageType);
  if (!pageType.ok) return { ok: false, error: pageType.error };

  const sections: SectionInstance[] = [];
  for (const [index, slot] of template.slots.entries()) {
    const filled = sectionFromSlot(slot, index, request.templateRef, request.resolvedBlueprints ?? {});
    if (!filled.ok) return { ok: false, error: filled.error };
    if (filled.section) sections.push(filled.section);
  }

  const body: PageBody = {
    route: request.route,
    pageType: pageType.pageType,
    title: request.title,
    seo: request.seo ?? {},
    template: { ref: request.templateRef, instantiated_at: request.instantiatedAt },
    sections,
  };

  // Self-check before the result feeds `create`: a malformed blueprint should
  // have been caught by template validation, but a builder that can emit an
  // unparseable page is a bug worth failing loudly here.
  const parsed = pageBodySchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    return { ok: false, error: `Instantiated body does not parse under page.v1: ${issues}` };
  }
  return { ok: true, body: parsed.data };
};
