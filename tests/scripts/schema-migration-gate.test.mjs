/**
 * Pure-logic tests for scripts/ci/schema-migration-gate.mjs's fleet
 * aggregation (W11 T11.9) — plain, uncompiled, run directly against the
 * real repo like discover-fleet-matrix.test.mjs. `aggregateFleetGate` takes
 * already-built per-site dry-run reports, so it needs no tsc compile / real
 * store to exercise; the full compile -> dynamic-import -> real-repo-scan
 * path is proven separately by actually running the script (see this
 * task's commit notes) and by migrate-site.test.ts's own real-tree check.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateFleetGate } from '../../scripts/ci/schema-migration-gate.mjs';

test('aggregateFleetGate passes when every site is gatePasses: true', () => {
  const result = aggregateFleetGate([
    { site: 'drlurie', report: { gatePasses: true, recordCount: 64 } },
    { site: 'acme', report: { gatePasses: true, recordCount: 3 } },
  ]);
  assert.deepEqual(result, { allPass: true, totalRecords: 67, failingSites: [] });
});

test('aggregateFleetGate fails and names every blocked site when at least one is gatePasses: false', () => {
  const result = aggregateFleetGate([
    { site: 'drlurie', report: { gatePasses: true, recordCount: 64 } },
    { site: 'acme', report: { gatePasses: false, recordCount: 3 } },
    { site: 'beta', report: { gatePasses: false, recordCount: 1 } },
  ]);
  assert.equal(result.allPass, false);
  assert.deepEqual(result.failingSites, ['acme', 'beta']);
  assert.equal(result.totalRecords, 68);
});

test('aggregateFleetGate passes vacuously for an empty fleet', () => {
  assert.deepEqual(aggregateFleetGate([]), { allPass: true, totalRecords: 0, failingSites: [] });
});
