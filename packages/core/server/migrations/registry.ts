/**
 * Schema-migration framework (W11 T11.9) — the executable path for a
 * breaking `schema_version` bump, so "one site survives on additive-optional
 * discipline; a fleet cannot" gets an actual mechanism instead of a doctrine.
 *
 * A migration is a pure, named, one-hop transition for ONE object type:
 * `<type>.v<N>` → `<type>.v<N+1>`. `findMigrationChain` walks the registered
 * set to connect an arbitrary (from, to) pair — usually one hop, but chains
 * compose (v1→v2→v3) without every migration needing to know about every
 * other one. `migrate` is always a pure `(body) => body` — used for the
 * dry-run preview AND to validate the chain actually reaches a body that
 * parses under the target schema before anything is ever written.
 *
 * Writing the migrated shape back to the real object store goes through the
 * STANDARD patch-op grammar, never a raw blob write (the same boundary every
 * other write path in this codebase respects) — `toPatchOps` is where a
 * migration's author supplies the exact ops for their type's existing
 * grammar (e.g. `set_site_fields` for a deep-merge-shaped type; something
 * op-shaped and type-specific for types with narrower field ops). A
 * migration with no `toPatchOps` is preview-only by design (e.g. informational
 * migrations, or ones not yet wired for a live write) — `migrate-site.mjs`
 * reports it as migratable-in-dry-run but blocked for `--write`, rather than
 * silently reaching around the grammar.
 *
 * No real migrations are registered here (`MIGRATIONS` ships empty) — T11.9's
 * own non-goal is "no actual schema bump shipped." The synthetic v1→v2 test
 * in registry.test.ts / classify.test.ts proves the machinery works before
 * any real bump ever needs it.
 */
import type { ObjectType } from '../../schema/object-record-v1.js';

export type SchemaMigration = {
  readonly objectType: ObjectType;
  /** The schema_version this migration reads, e.g. 'page.v1'. */
  readonly from: string;
  /** The schema_version this migration produces, e.g. 'page.v2'. */
  readonly to: string;
  readonly description: string;
  /** Pure body transform — used for dry-run preview and chain validation. */
  readonly migrate: (body: unknown) => unknown;
  /**
   * Real patch ops (this type's existing grammar) that move a checked-out
   * record from `oldBody`'s shape to `newBody`'s shape. Absent = preview-only:
   * `migrate-site.mjs --write` reports this migration's records as blocked
   * rather than attempting an unsafe workaround.
   */
  readonly toPatchOps?: (oldBody: unknown, newBody: unknown) => unknown[];
  /** Inverse body transform, for rollback preview. Omit when irreversible. */
  readonly inverse?: (body: unknown) => unknown;
  /** Explicit marker: no safe inverse exists (a human-visible rollback boundary). */
  readonly irreversible?: boolean;
};

/** The real, shipped registry. Empty until a real schema bump exists (non-goal of T11.9). */
export const MIGRATIONS: readonly SchemaMigration[] = [];

export type MigrationChainResult =
  | { readonly found: true; readonly chain: readonly SchemaMigration[] }
  | { readonly found: false; readonly reason: string };

/**
 * BFS over the registered migrations for one object type, from `from` to
 * `to`. Returns the ordered chain of migrations to apply, or `found: false`
 * with a reason (no path / already at target). A no-op chain (from === to)
 * is `found: true` with an empty chain — nothing to migrate.
 */
export const findMigrationChain = (
  migrations: readonly SchemaMigration[],
  objectType: ObjectType,
  from: string,
  to: string
): MigrationChainResult => {
  if (from === to) return { found: true, chain: [] };

  const edges = migrations.filter((m) => m.objectType === objectType);
  const byFrom = new Map<string, SchemaMigration[]>();
  for (const edge of edges) {
    const list = byFrom.get(edge.from) ?? [];
    list.push(edge);
    byFrom.set(edge.from, list);
  }

  // BFS, tracking the path of migrations taken to reach each version.
  const visited = new Set<string>([from]);
  const queue: { version: string; path: SchemaMigration[] }[] = [{ version: from, path: [] }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const candidates = byFrom.get(current.version) ?? [];
    for (const edge of candidates) {
      if (edge.to === to) return { found: true, chain: [...current.path, edge] };
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      queue.push({ version: edge.to, path: [...current.path, edge] });
    }
  }

  return {
    found: false,
    reason: `no registered migration path from '${from}' to '${to}' for object type '${objectType}'`,
  };
};

/** Runs a body through every migration's `migrate()` in order. */
export const applyMigrationChain = (body: unknown, chain: readonly SchemaMigration[]): unknown =>
  chain.reduce((current, migration) => migration.migrate(current), body);

export type ReverseChainResult =
  | { readonly reversible: true; readonly inverseChain: readonly SchemaMigration[] }
  | { readonly reversible: false; readonly blockedAt: SchemaMigration };

/**
 * Reverses a chain for rollback preview: every step must carry an `inverse`
 * and NOT be marked `irreversible` — the first step (walking backwards) that
 * fails either check is the human-visible rollback boundary, reported by
 * name rather than silently stopping partway.
 */
export const reverseChain = (chain: readonly SchemaMigration[]): ReverseChainResult => {
  for (const migration of [...chain].reverse()) {
    if (migration.irreversible || !migration.inverse) {
      return { reversible: false, blockedAt: migration };
    }
  }
  return { reversible: true, inverseChain: [...chain].reverse() };
};

/** Applies a chain's `inverse` steps in reverse order (rollback preview only — throws if any step is irreversible). */
export const applyReverseChain = (body: unknown, chain: readonly SchemaMigration[]): unknown => {
  const reversed = reverseChain(chain);
  if (!reversed.reversible) {
    throw new Error(
      `cannot reverse: migration '${reversed.blockedAt.from} → ${reversed.blockedAt.to}' is irreversible (${reversed.blockedAt.description}).`
    );
  }
  // reverseChain() already proved every step here carries `inverse` — the
  // non-null assertion reflects that already-checked invariant, not a new
  // assumption.
  return reversed.inverseChain.reduce((current, migration) => migration.inverse!(current), body);
};
