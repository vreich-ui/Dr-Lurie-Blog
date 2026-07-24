/**
 * Per-record disposition classification (W11 T11.9) — the dry-run half of
 * `migrate-site.mjs` and the fleet CI gate: given a record's declared
 * `schema_version` and body, decide whether it already parses under the
 * head schema, can be migrated there via the registry, or is blocked.
 *
 * Pure — no store/filesystem access — so it is unit-testable against
 * synthetic schema pairs (the adversarial "required-field addition" case
 * the T11.9 brief calls for) without any real object type or live store.
 */
import { findMigrationChain, applyMigrationChain, type SchemaMigration } from './registry.js';
import type { ObjectType } from '../../schema/object-record-v1.js';

/** The minimal shape classification needs — a zod-like schema, not the real import, so tests can pass a synthetic one. */
export type BodySchemaLike = {
  safeParse: (value: unknown) => { success: boolean };
};

export type RecordDisposition =
  | { readonly disposition: 'parses-as-is' }
  | { readonly disposition: 'migratable'; readonly chain: readonly SchemaMigration[]; readonly writable: boolean }
  | { readonly disposition: 'blocked'; readonly reason: string };

export type ClassifyRecordInput = {
  readonly objectType: ObjectType;
  /** The record's declared schema_version, e.g. 'page.v1'. */
  readonly schemaVersion: string;
  readonly body: unknown;
  /** The CURRENT (head) schema this object type validates against today. */
  readonly currentSchema: BodySchemaLike;
  /** The head schema_version string (e.g. 'page.v2') — what `schemaVersion` needs to reach. */
  readonly currentSchemaVersion: string;
  readonly migrations: readonly SchemaMigration[];
};

/**
 * Classify ONE record. Order of checks, deliberately:
 *   1. Already parses under the head schema as-is → no migration needed,
 *      regardless of what `schema_version` claims (an untouched v1 record
 *      whose shape happens to still satisfy a v2 schema is legitimately
 *      done, not blocked on a version-string technicality).
 *   2. A registered chain from schemaVersion → currentSchemaVersion exists,
 *      and applying it produces a body that DOES parse under the head
 *      schema → migratable. `writable` reports whether every step in the
 *      chain carries `toPatchOps` (a real write is possible) or the chain
 *      is preview-only.
 *   3. A chain exists but the migrated body STILL doesn't parse (a broken
 *      migration) → blocked, with that surfaced explicitly (this is the
 *      one case worth distinguishing from "no path at all" — a silently
 *      broken migration is worse than a missing one).
 *   4. No chain found → blocked, no path.
 */
export const classifyRecord = (input: ClassifyRecordInput): RecordDisposition => {
  if (input.currentSchema.safeParse(input.body).success) {
    return { disposition: 'parses-as-is' };
  }

  const chainResult = findMigrationChain(
    input.migrations,
    input.objectType,
    input.schemaVersion,
    input.currentSchemaVersion
  );
  if (!chainResult.found) {
    return { disposition: 'blocked', reason: chainResult.reason };
  }

  const migrated = applyMigrationChain(input.body, chainResult.chain);
  if (!input.currentSchema.safeParse(migrated).success) {
    return {
      disposition: 'blocked',
      reason: `migration chain '${input.schemaVersion} → ${input.currentSchemaVersion}' ran but the result still does not parse under the head schema — the migration itself is broken.`,
    };
  }

  return {
    disposition: 'migratable',
    chain: chainResult.chain,
    writable: chainResult.chain.every((m) => typeof m.toPatchOps === 'function'),
  };
};

export type SiteScanRecord = {
  readonly objectType: ObjectType;
  readonly objectId: string;
  readonly schemaVersion: string;
  readonly body: unknown;
};

export type SiteScanResolvers = {
  readonly currentSchema: (objectType: ObjectType) => BodySchemaLike | undefined;
  readonly currentSchemaVersion: (objectType: ObjectType) => string;
  readonly migrations: readonly SchemaMigration[];
};

export type SiteScanResult = {
  readonly objectId: string;
  readonly objectType: ObjectType;
  readonly disposition: RecordDisposition;
};

/**
 * Classifies every record in a scan (a whole site's worth, in practice).
 * `gatePasses` is the CI-gate verdict: every record parses-as-is or is
 * migratable — a single `blocked` record fails the whole scan (per the
 * brief: "a failing site blocks merge").
 */
export const classifySiteRecords = (
  records: readonly SiteScanRecord[],
  resolvers: SiteScanResolvers
): { readonly results: readonly SiteScanResult[]; readonly gatePasses: boolean } => {
  const results = records.map((record) => {
    const currentSchema = resolvers.currentSchema(record.objectType);
    if (!currentSchema) {
      return {
        objectId: record.objectId,
        objectType: record.objectType,
        disposition: {
          disposition: 'blocked' as const,
          reason: `no current schema registered for object type '${record.objectType}'.`,
        },
      };
    }
    return {
      objectId: record.objectId,
      objectType: record.objectType,
      disposition: classifyRecord({
        objectType: record.objectType,
        schemaVersion: record.schemaVersion,
        body: record.body,
        currentSchema,
        currentSchemaVersion: resolvers.currentSchemaVersion(record.objectType),
        migrations: resolvers.migrations,
      }),
    };
  });

  const gatePasses = results.every((r) => r.disposition.disposition !== 'blocked');
  return { results, gatePasses };
};
