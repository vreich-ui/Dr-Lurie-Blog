/**
 * Object impact computation (T3.10, lib half) — the real affected-surface
 * lists that replace the Phase 2 "affects all pages" stub:
 *
 *   - section  → pages whose section list carries a `shared_ref` to it
 *   - navigation → pages that render the instance, via page-level
 *     `navigationOverrides` first, else the owning Site object's
 *     `defaultNavigation` role assignments (override beats default per
 *     role, D§4.3)
 *   - template → pages whose `template.ref` names it (provenance, not live
 *     inheritance — listed because re-publishing the template does NOT
 *     touch them, and the impact view should say so)
 *
 * Same read paths as the inventory verb (T0.8 store list + load); pure
 * derivation, no writes. This is also the reference count T3.4's
 * archive-refusal check consumes: a section with a non-empty `pages` list
 * must refuse archive/delete (C§2.3-section) — enforcement lands with the
 * archive verb, which does not exist yet.
 *
 * Surface-3 wiring (the admin object page rendering these lists) is the
 * remaining half of T3.10.
 */
import { collectBlobListItems, type BlobListResponse } from './blob-list.js';
import type { ObjectRecord, ObjectType } from '../../packages/core/schema/object-record-v1.js';

export type ObjectImpactStore = {
  get(key: string): Promise<string | null>;
  list(options: { prefix: string; directories?: boolean; paginate?: boolean }): Promise<BlobListResponse>;
};

export type ImpactedPage = {
  object_id: string;
  route: string | null;
  via: 'shared_ref' | 'navigation_override' | 'site_default' | 'template_ref';
};

export type ObjectImpact = {
  object_type: ObjectType;
  object_id: string;
  /** False when this type has no computed impact surface (yet). */
  computed: boolean;
  pages: ImpactedPage[];
  notes: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const loadRecords = async (store: ObjectImpactStore, objectType: ObjectType): Promise<ObjectRecord[]> => {
  const listResult = await store.list({ prefix: `objects/${objectType}/by-id/`, directories: false, paginate: true });
  const items = await collectBlobListItems(listResult);
  const records: ObjectRecord[] = [];
  for (const item of items) {
    const raw = await store.get(item.key);
    if (raw) records.push(JSON.parse(raw) as ObjectRecord);
  }
  return records;
};

const pageRoute = (record: ObjectRecord): string | null => {
  const body = record.body;
  return isRecord(body) && typeof body.route === 'string' ? body.route : null;
};

const pageReferencesSection = (record: ObjectRecord, sectionObjectId: string): boolean => {
  const body = record.body;
  if (!isRecord(body) || !Array.isArray(body.sections)) return false;
  return body.sections.some(
    (section) =>
      isRecord(section) &&
      section.type === 'shared_ref' &&
      isRecord(section.data) &&
      section.data.section === sectionObjectId
  );
};

const NAV_ROLES = ['header', 'footer', 'secondary', 'social'] as const;

/** How a page ends up rendering a navigation instance, if it does. */
const navigationUsage = (
  page: ObjectRecord,
  navObjectId: string,
  siteDefaults: Map<string, Record<string, unknown>>
): ImpactedPage['via'] | undefined => {
  const body = page.body;
  const overrides = isRecord(body) && isRecord(body.navigationOverrides) ? body.navigationOverrides : {};
  const defaults = siteDefaults.get(page.site) ?? {};
  for (const role of NAV_ROLES) {
    const overridden = overrides[role];
    if (overridden === navObjectId) return 'navigation_override';
    // An override for this role points elsewhere → the default is not used
    // for this role on this page.
    if (typeof overridden === 'string') continue;
    if (defaults[role] === navObjectId) return 'site_default';
  }
  return undefined;
};

export const computeObjectImpact = async (
  store: ObjectImpactStore,
  target: { object_type: ObjectType; object_id: string }
): Promise<ObjectImpact> => {
  const base: ObjectImpact = {
    object_type: target.object_type,
    object_id: target.object_id,
    computed: true,
    pages: [],
    notes: [],
  };

  if (target.object_type === 'section') {
    const pages = await loadRecords(store, 'page');
    base.pages = pages
      .filter((page) => pageReferencesSection(page, target.object_id))
      .map((page) => ({ object_id: page.object_id, route: pageRoute(page), via: 'shared_ref' as const }));
    return base;
  }

  if (target.object_type === 'navigation') {
    const [pages, sites] = await Promise.all([loadRecords(store, 'page'), loadRecords(store, 'site')]);
    const siteDefaults = new Map<string, Record<string, unknown>>();
    for (const site of sites) {
      if (isRecord(site.body) && isRecord(site.body.defaultNavigation)) {
        siteDefaults.set(site.object_id, site.body.defaultNavigation);
      }
    }
    if (sites.length === 0) {
      base.notes.push(
        'No Site object exists yet (P5): only page-level navigationOverrides are computable — chrome rendered via code defaults is not listed.'
      );
    }
    base.pages = pages.flatMap((page) => {
      const via = navigationUsage(page, target.object_id, siteDefaults);
      return via ? [{ object_id: page.object_id, route: pageRoute(page), via }] : [];
    });
    return base;
  }

  if (target.object_type === 'template') {
    const pages = await loadRecords(store, 'page');
    base.pages = pages
      .filter((page) => {
        const body = page.body;
        return isRecord(body) && isRecord(body.template) && body.template.ref === target.object_id;
      })
      .map((page) => ({ object_id: page.object_id, route: pageRoute(page), via: 'template_ref' as const }));
    base.notes.push(
      'Templates stamp provenance only (no live inheritance, D§3.6): re-publishing this template does not change these pages.'
    );
    return base;
  }

  base.computed = false;
  base.notes.push(`No impact surface computed for object type '${target.object_type}' yet.`);
  return base;
};
