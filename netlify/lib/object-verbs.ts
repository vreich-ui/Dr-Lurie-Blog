/**
 * Shared object-verb core for the dual-auth endpoint pair (T0.8).
 *
 * Both entry points expose the SAME C§2.0 verb surface (minus review/publish,
 * which arrive in P1): the publish-key `object-store.ts` (agents/scripts) and
 * the Netlify-Identity `admin-object.ts` (browser admin UI). The only thing
 * that differs between them is authentication and how the acting `Principal`
 * is derived — so all action logic lives here, called with a resolved
 * principal. Keeping it in one place is also what makes "the browser path
 * never sees the publish key" structural: `admin-object.ts` neither imports
 * nor references the publish secret, and this module never reads it either.
 *
 * Conflict codes, preserved exactly as audited (A§1.2): a stale
 * `expected_record_version` → 409; a lock that is missing/expired/held by
 * someone else → 423. They are distinct and both surface here.
 *
 * ID minting is the endpoint's job, not the engine's (T0.6 requires fully-formed
 * ops). Every fresh id — taxonomy `term_id` from `{slug,label}` (C§2.5-C), and
 * likewise omitted section/nav/slot ids — is minted through the single
 * `mintId` helper (src/lib/object-ids-mint.ts) before the op reaches the engine.
 *
 * Validation runs through T0.7. Cross-object resolvers (does this page ref
 * resolve? is this taxonomy term active?) are injected there and are wired as
 * the objects/registries they need land in later phases; until then those
 * checks report `optional` and the schema / id / reader-safety / artifact-trust
 * / structural checks still run in full.
 */
import { z } from 'zod';

import { collectBlobListItems, type BlobListResponse } from './blob-list.js';
import {
  checkinObjectLock,
  checkoutObjectLock,
  isObjectLockActive,
  refreshObjectLock,
  sanitizeObjectLock,
  type ObjectLockStore,
} from './object-lock.js';
import { objectRecordKey, objectStatusIndexKey, OBJECT_STORE_MARKER_VALUE } from './object-store-keys.js';
import {
  summarizeValidation,
  validateCandidatePatch,
  validateObject,
  type ObjectValidationContext,
} from './object-validate.js';
import { validateObjectIdForType } from '../../src/lib/object-ids.js';
import { mintId, MintIdError } from '../../src/lib/object-ids-mint.js';
import { applyPatchOps, PatchApplyError } from '../../src/lib/object-patch-apply.js';
import { buildPageBodyFromTemplate } from '../../src/lib/template-instantiate.js';
import { pageBodySchema, pageTypeIdSchema } from '../../src/schema/bodies/page-v1.js';
import { templateBodySchema } from '../../src/schema/bodies/template-v1.js';
import {
  objectTypes,
  objectTypeSchema,
  type ObjectRecord,
  type ObjectType,
  type Principal,
} from '../../src/schema/object-record-v1.js';
import {
  compareInventoryRows,
  inventoryDetailFromRecord,
  inventoryRowFromRecord,
  matchesInventoryFilters,
  type InventoryFilters,
  type InventoryRow,
} from './object-inventory.js';
import { publishObject, type PublishObjectDeps } from './object-publish.js';
import { checkPublishGate } from './publish-gate.js';
import { resolveRolesForPrincipal } from './roles.js';
import type { ApprovalPolicy } from '../../src/lib/approval-policy.js';
import { decideReview, discardProposal, publishActionSchema, submitReview } from './review-state.js';

// ─── store shape ──────────────────────────────────────────────────────────────

export type ObjectVerbStore = ObjectLockStore & {
  list(options: { prefix: string; directories?: boolean; paginate?: boolean }): Promise<BlobListResponse>;
};

// ─── request grammar (per-action) ────────────────────────────────────────────

const leaseSeconds = z.number().int().positive().optional();
const opsField = z.array(z.unknown());
const objectId = z.string().min(1);

export const objectVerbRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get'), object_type: objectTypeSchema, object_id: objectId }),
  z.object({
    action: z.literal('list'),
    object_type: objectTypeSchema,
    status: z.enum(['active', 'archived']).optional(),
  }),
  z.object({
    action: z.literal('inventory'),
    // All filters optional: omit object_type to sweep every type. With
    // object_id set (single-object detail), object_type is required — the
    // handler enforces that pairing since zod unions can't express it here.
    object_type: objectTypeSchema.optional(),
    object_id: objectId.optional(),
    status: z.enum(['active', 'archived']).optional(),
    requires_approval: z.boolean().optional(),
    review_state: z.enum(['none', 'open', 'changes_requested', 'approved']).optional(),
    pending_changes: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('create'),
    object_type: objectTypeSchema,
    site: z.string().min(1),
    body: z.unknown(),
    requested_id: z.string().min(1).optional(),
  }),
  // ─── W2.5: create a page FROM a template recipe (design-principles rule 5).
  // Builds the body from the template's slots (src/lib/template-instantiate.ts)
  // and hands it to the `create` case — one write path, all rules apply.
  z.object({
    action: z.literal('instantiate'),
    template_id: objectId,
    site: z.string().min(1),
    route: z.string().min(1),
    title: z.string().min(1),
    page_type: pageTypeIdSchema.optional(),
    seo: pageBodySchema.shape.seo.optional(),
    requested_id: z.string().min(1).optional(),
    // Preview mode: build + validate the would-be page, persist NOTHING.
    dry_run: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('checkout'),
    object_type: objectTypeSchema,
    object_id: objectId,
    lease_seconds: leaseSeconds,
  }),
  z.object({
    action: z.literal('refresh_lock'),
    object_type: objectTypeSchema,
    object_id: objectId,
    lock_token: z.string().min(1),
    lease_seconds: leaseSeconds,
  }),
  z.object({
    action: z.literal('checkin'),
    object_type: objectTypeSchema,
    object_id: objectId,
    lock_token: z.string().min(1),
  }),
  z.object({
    action: z.literal('patch'),
    object_type: objectTypeSchema,
    object_id: objectId,
    lock_token: z.string().min(1),
    expected_record_version: z.number().int().nonnegative(),
    ops: opsField,
  }),
  z.object({
    action: z.literal('validate'),
    object_type: objectTypeSchema,
    object_id: objectId,
    candidate_patch: opsField.optional(),
  }),
  // ─── T1.4 review-state wiring ───────────────────────────────────────────
  z.object({
    action: z.literal('submit_review'),
    object_type: objectTypeSchema,
    object_id: objectId,
    lock_token: z.string().min(1),
    note: z.string().optional(),
    // M-6: required by contract whenever an agent-executed publish of an
    // approval-gated type is intended (C§2.2); the publish gate — not this
    // schema — enforces that.
    requested_publish_action: publishActionSchema.optional(),
  }),
  z.object({
    action: z.literal('review_decide'),
    object_type: objectTypeSchema,
    object_id: objectId,
    decision: z.enum(['approve', 'request_changes']),
    note: z.string().optional(),
    publish_action: publishActionSchema.optional(),
  }),
  z.object({
    action: z.literal('discard'),
    object_type: objectTypeSchema,
    object_id: objectId,
    lock_token: z.string().min(1),
    // Exactly what each rejected op's history entry stores (T0.6, C§2.4).
    entries: z.array(z.object({ op: z.unknown(), capture: z.unknown() })).min(1),
  }),
  z.object({
    action: z.literal('publish_by_time'),
    object_type: objectTypeSchema,
    object_id: objectId,
    lock_token: z.string().min(1),
    published_time: z.union([z.string(), z.null()]).optional(),
  }),
]);

export type ObjectVerbRequest = z.infer<typeof objectVerbRequestSchema>;
export type ObjectVerbAction = ObjectVerbRequest['action'];

export type ObjectVerbResult = { status: number; body: Record<string, unknown> };

export type HandleObjectVerbOptions = {
  nowMs?: number;
  /** Injected T0.7 resolvers (references, taxonomy, pageType…). Empty until wired. */
  validationContext?: ObjectValidationContext;
  /** Forwarded to T1.3's publishObject (committer fetch/retry injection for tests). */
  publishDeps?: Omit<PublishObjectDeps, 'nowMs' | 'validationContext'>;
  /** Approval policy for the publish gate + inventory; defaults to the committed config (tests inject). */
  approvalPolicy?: ApprovalPolicy;
};

// ─── small helpers ────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const nowIso = (ms: number) => new Date(ms).toISOString();

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Deterministic stringify (stable key order) for seeding minted element ids. */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

const loadRecord = async (store: ObjectVerbStore, key: string): Promise<ObjectRecord | undefined> => {
  const raw = await store.get(key);
  return raw ? (JSON.parse(raw) as ObjectRecord) : undefined;
};

const ok = (body: Record<string, unknown>): ObjectVerbResult => ({ status: 200, body });
const err = (status: number, body: Record<string, unknown>): ObjectVerbResult => ({ status, body });

/** Pass a T0.5 lock result through as an HTTP result, surfacing record_version on success. */
const withRecordVersion = (result: {
  status: number;
  body: Record<string, unknown>;
  record?: { version: number };
}): ObjectVerbResult => ({
  status: result.status,
  body: result.record ? { ...result.body, record_version: result.record.version } : result.body,
});

// ─── ID minting into ops (the endpoint completes the op before the engine) ────

type MintedId = { index: number; field: string; id: string };

/**
 * Fill any omitted caller-supplied id on id-introducing ops, routed through
 * `mintId`. An id that is PRESENT is left untouched (the caller is referencing
 * or replacing a specific element); only a genuinely-absent id is minted.
 */
const mintOpsIds = (rawOps: readonly unknown[]): { ops: unknown[]; minted: MintedId[] } => {
  const minted: MintedId[] = [];
  const ops = rawOps.map((raw, index) => {
    if (!isRecord(raw) || typeof raw.op !== 'string') return raw; // malformed → let the engine reject it
    const op = deepClone(raw);
    const note = (field: string, id: string) => minted.push({ index, field, id });

    if (op.op === 'add_term' && isRecord(op.term) && !op.term.term_id && typeof op.term.slug === 'string') {
      const id = mintId({ kind: 'taxonomy_term' }, op.term.slug);
      op.term.term_id = id;
      note('term.term_id', id);
    } else if (op.op === 'upsert_section' && isRecord(op.section) && !op.section.id) {
      const id = mintId({ kind: 'section_instance' }, stableStringify(op.section));
      op.section.id = id;
      note('section.id', id);
    } else if (op.op === 'upsert_item' && isRecord(op.item) && !op.item.id) {
      const id = mintId({ kind: 'nav_item' }, stableStringify(op.item));
      op.item.id = id;
      note('item.id', id);
    } else if (op.op === 'upsert_group' && isRecord(op.group) && !op.group.id) {
      const id = mintId({ kind: 'nav_group' }, stableStringify(op.group));
      op.group.id = id;
      note('group.id', id);
    } else if (op.op === 'upsert_slot' && isRecord(op.slot) && !op.slot.slotId) {
      const id = mintId({ kind: 'template_slot' }, stableStringify(op.slot));
      op.slot.slotId = id;
      note('slot.slotId', id);
    }
    return op;
  });
  return { ops, minted };
};

// A patch the engine refuses maps to an HTTP code by kind: a malformed op is a
// bad request (400); a state conflict (duplicate / blind-revert) is 409; the
// rest are unprocessable (422). None of these are ever swallowed.
const patchErrorStatus = (code: PatchApplyError['code']): number => {
  if (code === 'invalid_op') return 400;
  if (code === 'duplicate_target' || code === 'blind_revert_refused') return 409;
  return 422; // op_not_applicable | invalid_body | target_not_found | alias_required | alias_conflict
};

const seedForCreate = (objectType: ObjectType, body: unknown): string => {
  if (isRecord(body)) {
    if (objectType === 'page' && typeof body.route === 'string') return body.route;
    if (objectType === 'page' && typeof body.title === 'string') return body.title;
    if (objectType === 'navigation' && typeof body.role === 'string') return body.role;
    if (objectType === 'site' && typeof body.name === 'string') return body.name;
    if (objectType === 'template' && typeof body.name === 'string') return body.name;
    if (objectType === 'taxonomy') return 'registry';
    if (objectType === 'section' && isRecord(body.section) && typeof body.section.type === 'string')
      return `shared_${body.section.type}`;
  }
  return stableStringify(body);
};

// ─── the dispatcher ───────────────────────────────────────────────────────────

export const handleObjectVerb = async (
  store: ObjectVerbStore,
  request: ObjectVerbRequest,
  principal: Principal,
  options: HandleObjectVerbOptions = {}
): Promise<ObjectVerbResult> => {
  const ts = options.nowMs ?? Date.now();
  const timestamp = nowIso(ts);
  const context = options.validationContext ?? {};

  switch (request.action) {
    case 'get': {
      const record = await loadRecord(store, objectRecordKey(request.object_type, request.object_id));
      return record ? ok({ record }) : err(404, { error: 'Object record not found', not_found: true });
    }

    case 'list': {
      const prefix = `objects/${request.object_type}/by-id/`;
      const listResult = await store.list({ prefix, directories: false, paginate: true });
      const items = await collectBlobListItems(listResult);
      const objects: Record<string, unknown>[] = [];
      for (const item of items) {
        const record = await loadRecord(store, item.key);
        if (!record) continue;
        if (request.status && record.status !== request.status) continue;
        objects.push({
          object_id: record.object_id,
          object_type: record.object_type,
          status: record.status,
          version: record.version,
          content_revision: record.content_revision,
          published_time: record.publication.published_time,
        });
      }
      return ok({ objects });
    }

    case 'inventory': {
      // Single-object detail view.
      if (request.object_id) {
        if (!request.object_type) {
          return err(400, { error: 'inventory with object_id requires object_type.' });
        }
        const record = await loadRecord(store, objectRecordKey(request.object_type, request.object_id));
        if (!record) return err(404, { error: 'Object record not found', not_found: true });
        return ok({ object: inventoryDetailFromRecord(record, ts, options.approvalPolicy), generated_at: timestamp });
      }

      const filters: InventoryFilters = {
        status: request.status,
        requires_approval: request.requires_approval,
        review_state: request.review_state,
        pending_changes: request.pending_changes,
      };
      const types = request.object_type ? [request.object_type] : objectTypes;
      const rows: InventoryRow[] = [];
      for (const objectType of types) {
        const listResult = await store.list({
          prefix: `objects/${objectType}/by-id/`,
          directories: false,
          paginate: true,
        });
        const items = await collectBlobListItems(listResult);
        for (const item of items) {
          const record = await loadRecord(store, item.key);
          if (!record) continue;
          const row = inventoryRowFromRecord(record, ts, options.approvalPolicy);
          if (matchesInventoryFilters(row, filters)) rows.push(row);
        }
      }
      rows.sort(compareInventoryRows(objectTypes));
      return ok({ objects: rows, generated_at: timestamp });
    }

    case 'create': {
      const objectType = request.object_type;
      if (objectType === 'content_item') {
        return err(400, { error: 'content_item is not creatable through the generic verbs (D§1).' });
      }

      let objectIdValue: string;
      if (request.requested_id) {
        const check = validateObjectIdForType(objectType, request.requested_id);
        if (!check.ok) return err(400, { error: 'Invalid requested_id', detail: check.error });
        objectIdValue = request.requested_id;
      } else {
        try {
          objectIdValue = mintId({ kind: 'object', objectType }, seedForCreate(objectType, request.body));
        } catch (error) {
          if (error instanceof MintIdError)
            return err(400, { error: 'Could not mint an object id', detail: error.message });
          throw error;
        }
      }

      const key = objectRecordKey(objectType, objectIdValue);
      if (await store.get(key)) return err(409, { error: 'Object already exists', object_id: objectIdValue });

      const groups = validateObject({ objectType, objectId: objectIdValue, body: request.body }, context);
      const summary = summarizeValidation(groups);
      if (!summary.eligible) {
        return err(422, {
          error: 'Validation failed',
          object_id: objectIdValue,
          validation: groups,
          blockers: summary.blockers,
        });
      }

      const record: ObjectRecord = {
        object_id: objectIdValue,
        object_type: objectType,
        schema_version: `${objectType}.v1`,
        site: request.site,
        created_at: timestamp,
        updated_at: timestamp,
        status: 'active',
        body: request.body,
        publication: { published_time: null },
        history: [{ at: timestamp, action: 'create', actor: principal }],
        version: 1,
        content_revision: 1,
      };
      await store.setJSON(key, record);
      await store.setJSON(objectStatusIndexKey(objectType, 'active', objectIdValue), OBJECT_STORE_MARKER_VALUE);
      return ok({ record });
    }

    case 'instantiate': {
      // The template must EXIST (draft is fine — the same existence semantics
      // as a shared_ref target); its body must parse as template.v1.
      const templateRecord = await loadRecord(store, objectRecordKey('template', request.template_id));
      if (!templateRecord) {
        return err(404, { error: 'Template not found', not_found: true, template_id: request.template_id });
      }
      const parsedTemplate = templateBodySchema.safeParse(templateRecord.body);
      if (!parsedTemplate.success) {
        return err(422, {
          error: 'Template body does not parse as template.v1 — fix the template before instantiating.',
          template_id: request.template_id,
          issues: parsedTemplate.error.issues,
        });
      }

      const built = buildPageBodyFromTemplate(parsedTemplate.data, {
        route: request.route,
        title: request.title,
        pageType: request.page_type,
        seo: request.seo,
        templateRef: templateRecord.object_id,
        instantiatedAt: timestamp,
      });
      if (!built.ok) {
        return err(422, { error: built.error, template_id: request.template_id });
      }

      if (request.dry_run) {
        // Preview: the exact body a real instantiate would create, its minted
        // (or requested) id, id availability, and full validation — nothing
        // persisted. This is also how the round-trip driver proves the verb
        // against production without leaving probe pages behind.
        let objectIdValue: string;
        if (request.requested_id) {
          const check = validateObjectIdForType('page', request.requested_id);
          if (!check.ok) return err(400, { error: 'Invalid requested_id', detail: check.error });
          objectIdValue = request.requested_id;
        } else {
          try {
            objectIdValue = mintId({ kind: 'object', objectType: 'page' }, seedForCreate('page', built.body));
          } catch (error) {
            if (error instanceof MintIdError)
              return err(400, { error: 'Could not mint an object id', detail: error.message });
            throw error;
          }
        }
        const groups = validateObject({ objectType: 'page', objectId: objectIdValue, body: built.body }, context);
        const summary = summarizeValidation(groups);
        const idTaken = Boolean(await store.get(objectRecordKey('page', objectIdValue)));
        return ok({
          dry_run: true,
          instantiated_from: templateRecord.object_id,
          object_id: objectIdValue,
          id_available: !idTaken,
          body: built.body,
          validation: groups,
          summary,
        });
      }

      const result = await handleObjectVerb(
        store,
        {
          action: 'create',
          object_type: 'page',
          site: request.site,
          body: built.body,
          ...(request.requested_id ? { requested_id: request.requested_id } : {}),
        },
        principal,
        options
      );
      if (result.status !== 200) return result;
      return ok({ ...result.body, instantiated_from: templateRecord.object_id });
    }

    case 'checkout': {
      const key = objectRecordKey(request.object_type, request.object_id);
      const result = await checkoutObjectLock(store, key, {
        actor: principal,
        leaseSeconds: request.lease_seconds,
        nowMs: ts,
      });
      // Surface the post-checkout version so the client can patch immediately
      // (lock writes bump version, D§3.1); the T0.5 library body omits it.
      return withRecordVersion(result);
    }

    case 'refresh_lock': {
      const key = objectRecordKey(request.object_type, request.object_id);
      const result = await refreshObjectLock(store, key, {
        actor: principal,
        lockToken: request.lock_token,
        leaseSeconds: request.lease_seconds,
        nowMs: ts,
      });
      return withRecordVersion(result);
    }

    case 'checkin': {
      const key = objectRecordKey(request.object_type, request.object_id);
      const result = await checkinObjectLock(store, key, {
        actor: principal,
        lockToken: request.lock_token,
        nowMs: ts,
      });
      return withRecordVersion(result);
    }

    case 'patch': {
      const key = objectRecordKey(request.object_type, request.object_id);
      const record = await loadRecord(store, key);
      if (!record) return err(404, { error: 'Object record not found', not_found: true });

      // Lock precondition (423): you must hold the live lock to mutate.
      if (!record.lock || record.lock.token !== request.lock_token || !isObjectLockActive(record.lock, ts)) {
        return err(423, { error: 'Lock required', locked: true, lock: sanitizeObjectLock(record.lock) });
      }
      // Optimistic concurrency (409): your view must be current.
      if (record.version !== request.expected_record_version) {
        return err(409, {
          error: 'Record version conflict',
          expected_record_version: request.expected_record_version,
          actual_record_version: record.version,
        });
      }

      let minted: MintedId[];
      let normalizedOps: unknown[];
      try {
        const result = mintOpsIds(request.ops);
        normalizedOps = result.ops;
        minted = result.minted;
      } catch (error) {
        if (error instanceof MintIdError)
          return err(400, { error: 'Could not mint an id for a patch op', detail: error.message });
        throw error;
      }

      let appliedRecord: ObjectRecord;
      try {
        const applied = applyPatchOps(record, normalizedOps, { actor: principal, at: timestamp });
        appliedRecord = applied.record;
      } catch (error) {
        if (error instanceof PatchApplyError) {
          return err(patchErrorStatus(error.code), {
            error: 'Patch could not be applied',
            code: error.code,
            message: error.message,
            details: error.details,
            minted,
          });
        }
        throw error;
      }

      const groups = validateObject(
        {
          objectType: request.object_type,
          objectId: request.object_id,
          body: appliedRecord.body,
          published: record.publication.published_time != null,
        },
        context
      );
      const summary = summarizeValidation(groups);
      if (!summary.eligible) {
        // Hard-fail rejects the op and does NOT persist (C§2.0).
        return err(422, {
          error: 'Validation failed',
          validation: groups,
          blockers: summary.blockers,
          record_version_unchanged: record.version,
          minted,
        });
      }

      await store.setJSON(key, appliedRecord);
      return ok({
        version: appliedRecord.version,
        content_revision: appliedRecord.content_revision,
        minted,
        validation_summary: summary,
      });
    }

    case 'validate': {
      const key = objectRecordKey(request.object_type, request.object_id);
      const record = await loadRecord(store, key);
      if (!record) return err(404, { error: 'Object record not found', not_found: true });

      if (request.candidate_patch && request.candidate_patch.length > 0) {
        let minted: MintedId[];
        let normalizedOps: unknown[];
        try {
          const result = mintOpsIds(request.candidate_patch);
          normalizedOps = result.ops;
          minted = result.minted;
        } catch (error) {
          if (error instanceof MintIdError)
            return err(400, { error: 'Could not mint an id for a candidate op', detail: error.message });
          throw error;
        }
        const validation = validateCandidatePatch(record, normalizedOps, context);
        return ok({
          eligible: validation.eligible,
          validation: validation.groups,
          apply_error: validation.applyError,
          minted,
        });
      }

      const groups = validateObject(
        {
          objectType: request.object_type,
          objectId: request.object_id,
          body: record.body,
          published: record.publication.published_time != null,
        },
        context
      );
      return ok({ validation: groups, summary: summarizeValidation(groups) });
    }

    // ─── T1.4 review-state wiring (UI wiring only; no gate/review logic
    // lives here — everything below calls straight into the already-built
    // T1.3/T1.4 pure functions) ────────────────────────────────────────────

    case 'submit_review': {
      const key = objectRecordKey(request.object_type, request.object_id);
      const record = await loadRecord(store, key);
      if (!record) return err(404, { error: 'Object record not found', not_found: true });
      if (!record.lock || record.lock.token !== request.lock_token || !isObjectLockActive(record.lock, ts)) {
        return err(423, { error: 'Lock required', locked: true, lock: sanitizeObjectLock(record.lock) });
      }

      const result = submitReview(record, {
        actor: principal,
        at: timestamp,
        note: request.note,
        requested_publish_action: request.requested_publish_action,
      });
      if (!result.ok) return err(result.status, result.body);

      await store.setJSON(key, result.record);
      return ok({ ...result.body, version: result.record.version, content_revision: result.record.content_revision });
    }

    case 'review_decide': {
      const key = objectRecordKey(request.object_type, request.object_id);
      const record = await loadRecord(store, key);
      if (!record) return err(404, { error: 'Object record not found', not_found: true });

      const result = decideReview(record, {
        actor: principal,
        actorRoles: resolveRolesForPrincipal(principal),
        at: timestamp,
        decision: request.decision,
        note: request.note,
        publish_action: request.publish_action,
      });
      if (!result.ok) return err(result.status, result.body);

      await store.setJSON(key, result.record);
      return ok({ ...result.body, version: result.record.version, content_revision: result.record.content_revision });
    }

    case 'discard': {
      const key = objectRecordKey(request.object_type, request.object_id);
      const record = await loadRecord(store, key);
      if (!record) return err(404, { error: 'Object record not found', not_found: true });
      if (!record.lock || record.lock.token !== request.lock_token || !isObjectLockActive(record.lock, ts)) {
        return err(423, { error: 'Lock required', locked: true, lock: sanitizeObjectLock(record.lock) });
      }

      const result = discardProposal(record, { entries: request.entries, actor: principal, at: timestamp });
      if (!result.ok) return err(result.status, result.body);

      await store.setJSON(key, result.record);
      return ok({ ...result.body, version: result.record.version, content_revision: result.record.content_revision });
    }

    case 'publish_by_time': {
      const key = objectRecordKey(request.object_type, request.object_id);
      const record = await loadRecord(store, key);
      if (!record) return err(404, { error: 'Object record not found', not_found: true });

      const gate = checkPublishGate({
        record,
        principal,
        roles: resolveRolesForPrincipal(principal),
        requested: { published_time: request.published_time },
        policy: options.approvalPolicy,
      });
      if (!gate.allow)
        return err(gate.status, { error: gate.reason, code: gate.code, requires_approval: gate.requires_approval });

      const result = await publishObject(
        store,
        {
          object_type: request.object_type,
          object_id: request.object_id,
          published_time: request.published_time,
          lock_token: request.lock_token,
          actor: principal,
        },
        { nowMs: ts, validationContext: context, ...options.publishDeps }
      );
      return { status: result.status, body: result.body };
    }
  }
};
