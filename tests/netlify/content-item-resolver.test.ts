/**
 * The content-item resolver (playbook trap 4 closed) and its degrade
 * semantics — the piece that makes MANUAL article curation in content_grid
 * agent-usable:
 *
 *   - the index parses a GitHub contents listing into content-item ids
 *     (filename minus .md/.mdx — exactly the renderer's post.id);
 *   - validateObject with a resolver that ANSWERS: a real id passes, a ghost
 *     id is a blocker;
 *   - validateObject with a resolver that CANNOT answer (undefined — no
 *     GitHub env, transient error): the ref is unverifiable, NOT failed —
 *     the documented contract requireObject previously violated, which is
 *     why manual picks always blocked.
 */
import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseContentItemIds } from '../../packages/core/server/lib/content-item-index.js';
import { summarizeValidation, validateObject } from '../../packages/core/server/lib/object-validate.js';
import type { ObjectValidationContext } from '../../packages/core/server/lib/object-validate.js';

test('parseContentItemIds: files minus extension; dirs and non-markdown ignored', () => {
  const ids = parseContentItemIds([
    { type: 'file', name: 'retinol-explained-simply.md' },
    { type: 'file', name: 'skin-basics.mdx' },
    { type: 'file', name: 'notes.txt' },
    { type: 'dir', name: 'drafts' },
    { type: 'file', name: 42 },
    'garbage',
  ]);
  assert.deepEqual([...ids].sort(), ['retinol-explained-simply', 'skin-basics']);
  assert.deepEqual([...parseContentItemIds({ not: 'an array' })], []);
});

const manualGridBody = (items: string[]) => ({
  section: {
    id: 's_grid',
    type: 'content_grid',
    data: {
      heading: 'Picked reads',
      source: { kind: 'manual', items },
      limit: 3,
    },
  },
});

const contextWith = (resolve: ObjectValidationContext['resolveObject']): ObjectValidationContext => ({
  resolveObject: resolve,
});

test('a manual pick that exists in the content index passes; a ghost is a blocker', () => {
  const ids = new Set(['skin-basics']);
  const resolve: ObjectValidationContext['resolveObject'] = (objectType, objectId) =>
    objectType === 'content_item' ? { exists: ids.has(objectId) } : { exists: true };

  const ok = summarizeValidation(
    validateObject(
      { objectType: 'section', objectId: 'sec_g', body: manualGridBody(['skin-basics']) },
      contextWith(resolve)
    )
  );
  assert.deepEqual(ok.blockers, [], JSON.stringify(ok.blockers));

  const ghost = summarizeValidation(
    validateObject(
      { objectType: 'section', objectId: 'sec_g', body: manualGridBody(['skin-basics', 'no-such-post']) },
      contextWith(resolve)
    )
  );
  assert.equal(ghost.eligible, false);
  assert.ok(
    ghost.blockers.some((blocker) => blocker.message.includes('no-such-post')),
    JSON.stringify(ghost.blockers)
  );
});

test('an unanswerable content_item lookup (undefined) is unverifiable, not a failure', () => {
  const resolve: ObjectValidationContext['resolveObject'] = (objectType) =>
    objectType === 'content_item' ? undefined : { exists: true };
  const summary = summarizeValidation(
    validateObject(
      { objectType: 'section', objectId: 'sec_g', body: manualGridBody(['whatever']) },
      contextWith(resolve)
    )
  );
  assert.deepEqual(summary.blockers, [], JSON.stringify(summary.blockers));
});
