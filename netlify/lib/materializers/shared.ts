/**
 * Shared helpers for the per-type materializers (T1.1).
 *
 * Every derived export is `{ __generated: {from, at, record_version}, ...body }`
 * (D§1), serialized with object keys sorted recursively so re-materializing an
 * unchanged object produces byte-identical output — the property T1.3's retry
 * logic depends on. Array order is preserved (it is meaningful — section
 * order, nav item order, term order); only plain-object key iteration order
 * is normalized.
 *
 * `at`/`record_version` are caller-supplied inputs, never generated in this
 * module — a materializer that called Date.now() itself could never be
 * deterministic across two calls.
 */
import { objectRecordKey } from '../object-store-keys.js';
import type { ObjectType } from '../../../src/schema/object-record-v1.js';

export interface MaterializeMeta {
  /** ISO timestamp of this materialization. An input, not generated here. */
  at: string;
  /** ObjectRecord.version at the moment of materialization. */
  record_version: number;
}

export interface GeneratedMarker {
  from: string;
  at: string;
  record_version: number;
}

export interface MaterializedFile {
  path: string;
  content: string;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
    );
  }
  return value;
};

/** Deterministic JSON serialization: object keys sorted recursively, array order preserved. */
export const canonicalJsonStringify = (value: unknown): string => `${JSON.stringify(canonicalize(value), null, 2)}\n`;

const generatedMarker = (objectType: ObjectType, objectId: string, meta: MaterializeMeta): GeneratedMarker => ({
  from: objectRecordKey(objectType, objectId),
  at: meta.at,
  record_version: meta.record_version,
});

/** Wraps a validated body with its `__generated` marker and serializes it deterministically. */
export const renderExport = <TBody extends object>(
  objectType: ObjectType,
  objectId: string,
  body: TBody,
  meta: MaterializeMeta
): string => canonicalJsonStringify({ __generated: generatedMarker(objectType, objectId, meta), ...body });
