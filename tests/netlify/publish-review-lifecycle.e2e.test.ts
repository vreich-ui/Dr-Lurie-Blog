import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { handleObjectVerb, type ObjectVerbRequest, type ObjectVerbStore } from '../../packages/core/server/lib/object-verbs.js';
import { materialize, type MaterializableObjectType } from '../../packages/core/server/lib/materialize.js';
import { objectRecordKey } from '../../packages/core/server/lib/object-store-keys.js';
import type { ApprovalPolicy } from '../../packages/core/lib/approval-policy.js';
import type { HistoryEntry, ObjectRecord, Principal } from '../../packages/core/schema/object-record-v1.js';

/**
 * T1.8 — Phase 1 exit drill.
 *
 * Proves the full publish/review machinery works as a SYSTEM — object store,
 * locking, patching, review-state, the configurable approval-policy publish
 * gate, materialize, git commit, and the publish stamp — driven exclusively
 * through `handleObjectVerb`, the single shared dispatcher both production
 * entry points (object-store.ts for agents, admin-object.ts for humans)
 * call. That is the real "system boundary" for Phase 1: unlike Phase 0, the
 * P1 exit criteria (04-phased-plan.md line 64) name no MCP-reachability
 * requirement, so this drill does not route through MCP the way T0.11 did —
 * `handleObjectVerb` IS production behavior here, verbatim, for both auth
 * paths.
 *
 * Matches 04-phased-plan.md's P1 exit criteria, UPDATED for the
 * configurable-approval-policy replacement of T1.4's hardcoded tiers
 * (2026-07-07, src/config/approval-policy.ts): the old "Tier 3 publish
 * attempt by an agent principal is refused" criterion no longer holds as a
 * universal rule — whether an agent may execute a publish is now the
 * approval policy's call, and once approved, the agent (not a human)
 * executes it, on every governed type. What survives verbatim: "a test page
 * object completes draft → patch → validate → submit → approve (field +
 * structural surfaces both exercised, Discard exercised with an inverse) →
 * publish → derived JSON committed → receipt on record; an approval is
 * correctly invalidated by a subsequent body write and NOT by lock activity
 * or the publish stamp." Scenario 3 below now demonstrates the REPLACEMENT
 * behavior: a type overridden to require approval still lets the approved
 * AGENT execute the publish — there is no separate human-execute step.
 *
 * Every scenario below asserts actual end state (record fields, history
 * chains with attributed actors, committed bytes at the mocked git head) —
 * never "no error thrown" alone.
 */

const AGENT: Principal = { kind: 'agent', agent_name: 'drill-agent', auth: 'publish_key' };
const HUMAN: Principal = { kind: 'human', id: 'u1', email: 'reviewer@example.com' };

const ENV_KEYS = ['GITHUB_CONTENT_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_BRANCH', 'BRANCH', 'ROLE_EMAILS_ADMIN'] as const;
const withDrillEnv = async (fn: () => Promise<void>) => {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  process.env.GITHUB_CONTENT_TOKEN = 'test-token';
  process.env.GITHUB_REPOSITORY = 'vreich-ui/dr-lurie-blog';
  process.env.ROLE_EMAILS_ADMIN = HUMAN.kind === 'human' ? HUMAN.email : '';
  delete process.env.GITHUB_BRANCH;
  delete process.env.BRANCH;
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

// ─── in-memory object store (mirrors object-verbs-review.test.ts) ───────────

const createMemoryStore = () => {
  const blobs = new Map<string, string>();
  return {
    blobs,
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown) {
      blobs.set(key, JSON.stringify(value));
    },
    async list({ prefix }: { prefix: string }) {
      return { blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
    read(objectType: ObjectRecord['object_type'], objectId: string): ObjectRecord {
      const raw = blobs.get(objectRecordKey(objectType, objectId));
      assert.ok(raw, `expected a stored record for ${objectType}/${objectId}`);
      return JSON.parse(raw as string) as ObjectRecord;
    },
  };
};
type Store = ReturnType<typeof createMemoryStore>;

// ─── git-faithful GitHub API mock (tree shas content-addressed over the
// resulting tree, like real git — the same technique object-publish.test.ts
// and object-verbs-review.test.ts use; needed so the no-op/retry paths are
// genuinely exercised, not simulated) ─────────────────────────────────────

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');

type RefPatchOutcome = 'ok' | { status: number; body: string };

const createGitHubApiMock = (options: { refPatchOutcomes?: RefPatchOutcome[] } = {}) => {
  const calls: Array<{ method: string; path: string }> = [];
  const blobs = new Map<string, string>();
  const trees = new Map<string, Map<string, string>>([['tree0', new Map()]]);
  const commitTrees = new Map<string, string>([['head0', 'tree0']]);
  let head = { sha: 'head0', treeSha: 'tree0' };
  const patchOutcomes = [...(options.refPatchOutcomes ?? [])];
  let commitCounter = 0;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path: url.pathname });

    if (method === 'GET' && url.pathname.includes('/git/ref/heads/')) {
      return new Response(JSON.stringify({ object: { sha: head.sha } }));
    }
    if (method === 'GET' && url.pathname.includes('/git/commits/')) {
      const sha = url.pathname.split('/').pop() as string;
      return new Response(JSON.stringify({ tree: { sha: commitTrees.get(sha) } }));
    }
    if (method === 'POST' && url.pathname.endsWith('/git/blobs')) {
      const sha = sha1(String(body?.content));
      blobs.set(sha, String(body?.content));
      return new Response(JSON.stringify({ sha }));
    }
    if (method === 'POST' && url.pathname.endsWith('/git/trees')) {
      const base = trees.get(String(body?.base_tree)) ?? new Map<string, string>();
      const next = new Map(base);
      for (const entry of body?.tree as Array<{ path: string; sha: string }>) next.set(entry.path, entry.sha);
      const unchanged = [...next.entries()].sort().join('|') === [...base.entries()].sort().join('|');
      const sha = unchanged ? String(body?.base_tree) : `tree_${sha1(JSON.stringify([...next.entries()].sort()))}`;
      trees.set(sha, next);
      return new Response(JSON.stringify({ sha }));
    }
    if (method === 'POST' && url.pathname.endsWith('/git/commits')) {
      commitCounter += 1;
      const sha = `commit${commitCounter}`;
      commitTrees.set(sha, String(body?.tree));
      return new Response(JSON.stringify({ sha }));
    }
    if (method === 'PATCH' && url.pathname.includes('/git/refs/heads/')) {
      const outcome = patchOutcomes.length ? (patchOutcomes.shift() as RefPatchOutcome) : 'ok';
      if (outcome === 'ok') {
        head = { sha: String(body?.sha), treeSha: commitTrees.get(String(body?.sha)) as string };
        return new Response(JSON.stringify({ object: { sha: head.sha } }));
      }
      return new Response(outcome.body, { status: outcome.status });
    }
    return new Response(`unexpected ${method} ${url.pathname}`, { status: 500 });
  }) as typeof fetch;

  const readFileAtHead = (filePath: string): string | undefined => {
    const blobSha = trees.get(head.treeSha)?.get(filePath);
    return blobSha === undefined ? undefined : blobs.get(blobSha);
  };

  return { fetchImpl, calls, getHead: () => head, readFileAtHead };
};

const publishDeps = (fetchImpl: typeof fetch) => ({
  fetchImpl,
  sleep: async () => {},
  exportRoot: 'sites/drlurie/data/site',
});

/**
 * Proves the committed export at head is byte-identical to what T1.1's
 * materializer deterministically produces for the marker actually embedded in
 * it — rather than guessing the `record_version`/`at` the publish call used
 * internally (the marker's `record_version` is the record's `version` field
 * at load time, a different number from the receipt's diagnostic
 * `content_revision`; reconstructing it by parsing the real committed marker
 * is the robust way to verify this, not by predicting version bookkeeping).
 */
const assertCommittedExportMatchesMaterializer = (
  github: ReturnType<typeof createGitHubApiMock>,
  objectType: MaterializableObjectType,
  objectId: string,
  body: unknown
) => {
  // Path never depends on at/record_version/body — safe to compute with a
  // throwaway meta (a VALID one: the materializer now guards meta at runtime,
  // by design). exportRoot DOES drive the path, so it must match the real
  // publish's binding (sites/drlurie/data/site).
  const { path } = materialize(objectType, objectId, body, {
    at: '1970-01-01T00:00:00.000Z',
    record_version: 0,
    exportRoot: 'sites/drlurie/data/site',
  });
  const committed = github.readFileAtHead(path);
  assert.ok(committed, `expected a committed export at ${path}`);
  const marker = (JSON.parse(committed as string) as { __generated: { at: string; record_version: number } })
    .__generated;

  const expected = materialize(objectType, objectId, body, {
    at: marker.at,
    record_version: marker.record_version,
    exportRoot: 'sites/drlurie/data/site',
  });
  assert.equal(
    committed,
    expected.content,
    'the committed export must be byte-identical to T1.1 output for its own marker'
  );
  return marker;
};

// ─── small call helper ───────────────────────────────────────────────────────

let clockMs = Date.parse('2026-07-07T09:00:00.000Z');
const tick = () => (clockMs += 1000);

const call = (
  store: Store,
  request: ObjectVerbRequest,
  principal: Principal,
  extra: { publishDeps?: Record<string, unknown>; approvalPolicy?: ApprovalPolicy } = {}
) => {
  tick();
  return handleObjectVerb(store as unknown as ObjectVerbStore, request, principal, {
    nowMs: clockMs,
    publishDeps: extra.publishDeps,
    approvalPolicy: extra.approvalPolicy,
  });
};

// Both scenarios below deliberately GATE the type under test via an explicit
// override — the committed dev default is all-autonomous (src/config/
// approval-policy.ts), which would let publish proceed with no review at
// all and make the approval-invalidation assertions vacuous. Gating by
// policy, not by leftover hardcoded tiers, is the whole point of this
// change.
const GATE_PAGE: ApprovalPolicy = { master: 'all-autonomous', overrides: { page: 'require-approval' } };
const GATE_NAVIGATION: ApprovalPolicy = { master: 'all-autonomous', overrides: { navigation: 'require-approval' } };

const historyActions = (record: ObjectRecord): Array<{ action: string; actor: string }> =>
  record.history.map((entry: HistoryEntry) => ({
    action: entry.action,
    actor: entry.actor.kind === 'human' ? entry.actor.email : entry.actor.agent_name,
  }));

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 1 + 2: a gated page — happy-path publish, then a second proposal
// whose approval goes stale before publish (same object, per the brief).
// ═══════════════════════════════════════════════════════════════════════════

test('Scenario 1+2 (page overridden to require-approval): propose → approve → agent publishes; then a second approval invalidated by a later body edit is correctly refused', async () => {
  await withDrillEnv(async () => {
    const store = createMemoryStore();
    const github = createGitHubApiMock();

    // ── draft ──────────────────────────────────────────────────────────────
    const created = await call(
      store,
      {
        action: 'create',
        object_type: 'page',
        site: 'site_drlurie',
        body: {
          route: '/drill',
          pageType: 'standard',
          title: 'Drill Page',
          seo: { description: 'P1 exit-drill fixture.' },
          sections: [{ id: 's_drillhero', type: 'hero', data: { heading: 'Original heading', actions: [] } }],
        },
        requested_id: 'page_p1_drill',
      },
      AGENT
    );
    assert.equal(created.status, 200, JSON.stringify(created.body));
    let record = created.body.record as ObjectRecord;
    assert.equal(record.version, 1);
    assert.equal(record.content_revision, 1);

    // ── checkout → patch → validate → submit ──────────────────────────────
    const checkout1 = await call(store, { action: 'checkout', object_type: 'page', object_id: 'page_p1_drill' }, AGENT);
    assert.equal(checkout1.status, 200, JSON.stringify(checkout1.body));
    const lock1 = checkout1.body.lockToken as string;

    // Both review surfaces, per the P1 exit criteria verbatim: a field-level
    // op (`update_section_data`, T0.6 capture kind 'fields' — surface 1) and a
    // structural op (`upsert_section`, capture kind 'element' — surface 2) in
    // the same proposal.
    const patch1 = await call(
      store,
      {
        action: 'patch',
        object_type: 'page',
        object_id: 'page_p1_drill',
        lock_token: lock1,
        expected_record_version: checkout1.body.record_version as number,
        ops: [
          { op: 'update_section_data', section_id: 's_drillhero', fields: { heading: 'Agent-proposed heading' } },
          {
            op: 'upsert_section',
            section: { id: 's_drillnew', type: 'prose', data: { body: '<p>New structural section.</p>' } },
          },
        ],
      },
      AGENT
    );
    assert.equal(patch1.status, 200, JSON.stringify(patch1.body));
    assert.equal(patch1.body.content_revision, 3, 'both ops mutate the body: content_revision advances by 2');

    const patched1 = store.read('page', 'page_p1_drill');
    const patch1Entries = patched1.history.slice(-2).map((entry) => ({
      action: entry.action,
      captureKind: (entry.details as { capture?: { kind?: string } } | undefined)?.capture?.kind,
    }));
    assert.deepEqual(
      patch1Entries,
      [
        { action: 'update_section_data', captureKind: 'fields' },
        { action: 'upsert_section', captureKind: 'element' },
      ],
      'both the field surface and the structural surface must be exercised in this proposal'
    );
    assert.equal(
      (patched1.body as { sections: unknown[] }).sections.length,
      2,
      'the structural op must have actually added the section'
    );

    const validate1 = await call(store, { action: 'validate', object_type: 'page', object_id: 'page_p1_drill' }, AGENT);
    assert.equal(validate1.status, 200);
    assert.equal(
      (validate1.body.summary as { eligible: boolean }).eligible,
      true,
      'the drafted page must validate clean'
    );

    const submit1 = await call(
      store,
      {
        action: 'submit_review',
        object_type: 'page',
        object_id: 'page_p1_drill',
        lock_token: lock1,
        requested_publish_action: { published_time: 'immediate' },
      },
      AGENT
    );
    assert.equal(submit1.status, 200, JSON.stringify(submit1.body));
    assert.equal(submit1.body.review_state, 'open');

    const checkin1 = await call(
      store,
      { action: 'checkin', object_type: 'page', object_id: 'page_p1_drill', lock_token: lock1 },
      AGENT
    );
    assert.equal(checkin1.status, 200);

    // ── human approves (field surface: update_section_data is a `fields` capture) ──
    const approve1 = await call(
      store,
      {
        action: 'review_decide',
        object_type: 'page',
        object_id: 'page_p1_drill',
        decision: 'approve',
        publish_action: { published_time: 'immediate' },
      },
      HUMAN
    );
    assert.equal(approve1.status, 200, JSON.stringify(approve1.body));
    assert.equal(approve1.body.review_state, 'approved');

    // ── agent publishes: gated type + matching M-6 pin ⇒ allowed ───────────
    const checkout2 = await call(store, { action: 'checkout', object_type: 'page', object_id: 'page_p1_drill' }, AGENT);
    const lock2 = checkout2.body.lockToken as string;

    const publish1 = await call(
      store,
      { action: 'publish_by_time', object_type: 'page', object_id: 'page_p1_drill', lock_token: lock2 },
      AGENT,
      { publishDeps: publishDeps(github.fetchImpl), approvalPolicy: GATE_PAGE }
    );
    assert.equal(publish1.status, 200, JSON.stringify(publish1.body));
    assert.equal(publish1.body.published, true);

    await call(store, { action: 'checkin', object_type: 'page', object_id: 'page_p1_drill', lock_token: lock2 }, AGENT);

    record = store.read('page', 'page_p1_drill');
    assert.ok(record.publication.published_time, 'the record must be stamped published');
    const receipt1 = record.publication.publish_receipt as Record<string, unknown>;
    assert.equal(receipt1.no_op, false);
    assert.equal(receipt1.commit_sha, github.getHead().sha, 'the receipt must name the commit actually landed');

    // Derived JSON committed: the bytes at head are exactly T1.1's output,
    // and it reflects BOTH the field-surface and structural-surface changes.
    const marker1 = assertCommittedExportMatchesMaterializer(github, 'page', 'page_p1_drill', record.body);
    assert.equal(marker1.at, record.publication.published_time, "the marker's `at` is the effective published_time");
    const publishedSections = (record.body as { sections: Array<{ id: string; data: Record<string, unknown> }> })
      .sections;
    assert.equal(publishedSections[0].data.heading, 'Agent-proposed heading', 'the field-surface change is live');
    assert.equal(publishedSections[1].id, 's_drillnew', 'the structural-surface change (added section) is live');

    // History chain, attributed correctly, in order.
    assert.deepEqual(historyActions(record), [
      { action: 'create', actor: 'drill-agent' },
      { action: 'checkout', actor: 'drill-agent' },
      { action: 'update_section_data', actor: 'drill-agent' },
      { action: 'upsert_section', actor: 'drill-agent' },
      { action: 'submit_review', actor: 'drill-agent' },
      { action: 'checkin', actor: 'drill-agent' },
      { action: 'review_decide', actor: 'reviewer@example.com' },
      { action: 'checkout', actor: 'drill-agent' },
      { action: 'publish', actor: 'drill-agent' },
      { action: 'checkin', actor: 'drill-agent' },
    ]);
    const contentRevisionAfterPublish = record.content_revision;
    const versionAfterPublish = record.version;

    // ═══ Scenario 2: a second proposal, approved, then invalidated by a
    // further body edit BEFORE publish — the approval must be refused, not
    // honored (D§3.9 invalidation, the load-bearing invariant). ═══

    const checkout3 = await call(store, { action: 'checkout', object_type: 'page', object_id: 'page_p1_drill' }, AGENT);
    const lock3 = checkout3.body.lockToken as string;

    const patch2 = await call(
      store,
      {
        action: 'patch',
        object_type: 'page',
        object_id: 'page_p1_drill',
        lock_token: lock3,
        expected_record_version: checkout3.body.record_version as number,
        ops: [{ op: 'update_section_data', section_id: 's_drillhero', fields: { heading: 'Second proposal heading' } }],
      },
      AGENT
    );
    assert.equal(patch2.status, 200);
    assert.equal(patch2.body.content_revision, contentRevisionAfterPublish + 1);

    await call(
      store,
      {
        action: 'submit_review',
        object_type: 'page',
        object_id: 'page_p1_drill',
        lock_token: lock3,
        requested_publish_action: { published_time: 'immediate' },
      },
      AGENT
    );
    await call(store, { action: 'checkin', object_type: 'page', object_id: 'page_p1_drill', lock_token: lock3 }, AGENT);

    const approve2 = await call(
      store,
      {
        action: 'review_decide',
        object_type: 'page',
        object_id: 'page_p1_drill',
        decision: 'approve',
        publish_action: { published_time: 'immediate' },
      },
      HUMAN
    );
    assert.equal(approve2.status, 200);
    const contentRevisionAtApproval = store.read('page', 'page_p1_drill').review?.decisions.slice(-1)[0]
      ?.content_revision as number;
    assert.equal(contentRevisionAtApproval, contentRevisionAfterPublish + 1);

    // A THIRD edit lands after approval — this is what must invalidate it.
    const checkout4 = await call(store, { action: 'checkout', object_type: 'page', object_id: 'page_p1_drill' }, AGENT);
    const lock4 = checkout4.body.lockToken as string;
    const patch3 = await call(
      store,
      {
        action: 'patch',
        object_type: 'page',
        object_id: 'page_p1_drill',
        lock_token: lock4,
        expected_record_version: checkout4.body.record_version as number,
        ops: [
          { op: 'update_section_data', section_id: 's_drillhero', fields: { heading: 'Edited again after approval' } },
        ],
      },
      AGENT
    );
    assert.equal(patch3.status, 200);
    const contentRevisionAfterLateEdit = patch3.body.content_revision as number;
    assert.equal(
      contentRevisionAfterLateEdit,
      contentRevisionAtApproval + 1,
      'the late edit must move content_revision past the pin'
    );
    await call(store, { action: 'checkin', object_type: 'page', object_id: 'page_p1_drill', lock_token: lock4 }, AGENT);

    // Publish attempt: MUST be refused as stale, before any commit.
    const checkout5 = await call(store, { action: 'checkout', object_type: 'page', object_id: 'page_p1_drill' }, AGENT);
    const lock5 = checkout5.body.lockToken as string;
    const githubCallsBeforeStaleAttempt = github.calls.length;

    const stalePublish = await call(
      store,
      { action: 'publish_by_time', object_type: 'page', object_id: 'page_p1_drill', lock_token: lock5 },
      AGENT,
      { publishDeps: publishDeps(github.fetchImpl), approvalPolicy: GATE_PAGE }
    );
    assert.equal(stalePublish.status, 403);
    assert.equal(stalePublish.body.code, 'approval_stale');

    assert.equal(
      github.calls.length,
      githubCallsBeforeStaleAttempt,
      'a stale-approval refusal must not touch git at all'
    );
    const afterStaleAttempt = store.read('page', 'page_p1_drill');
    assert.equal(
      afterStaleAttempt.publication.published_time,
      record.publication.published_time,
      'the stale, unauthorized content must NOT have been published — publication is unchanged from scenario 1'
    );
    assert.ok(
      afterStaleAttempt.version > versionAfterPublish,
      'the draft continued to accumulate real writes after the first publish'
    );
    assert.equal(
      (afterStaleAttempt.body as { sections: Array<{ data: { heading: string } }> }).sections[0].data.heading,
      'Edited again after approval',
      'the draft itself is untouched by the refusal — only publishing it was blocked'
    );

    await call(store, { action: 'checkin', object_type: 'page', object_id: 'page_p1_drill', lock_token: lock5 }, AGENT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 3: navigation overridden to require-approval — the REPLACEMENT
// behavior for the old Tier 3 rule. There is no separate human-execute step
// anymore: once approved, the AGENT executes the publish. An unapproved
// attempt is still denied before any commit.
// ═══════════════════════════════════════════════════════════════════════════

test('Scenario 3 (navigation overridden to require-approval): an unapproved agent publish is denied before any commit; once approved, the agent executes it directly', async () => {
  await withDrillEnv(async () => {
    const store = createMemoryStore();
    const github = createGitHubApiMock();

    const created = await call(
      store,
      {
        action: 'create',
        object_type: 'navigation',
        site: 'site_drlurie',
        body: {
          role: 'footer',
          groups: [
            {
              id: 'g_drill',
              items: [
                { id: 'n_drill', label: 'Original label', target: { kind: 'external', href: 'https://drlurie.com/x' } },
              ],
            },
          ],
        },
        requested_id: 'nav_p1_drill',
      },
      AGENT
    );
    assert.equal(created.status, 200, JSON.stringify(created.body));

    const checkout1 = await call(
      store,
      { action: 'checkout', object_type: 'navigation', object_id: 'nav_p1_drill' },
      AGENT
    );
    const lock1 = checkout1.body.lockToken as string;

    const patch = await call(
      store,
      {
        action: 'patch',
        object_type: 'navigation',
        object_id: 'nav_p1_drill',
        lock_token: lock1,
        expected_record_version: checkout1.body.record_version as number,
        ops: [
          { op: 'update_item', group_id: 'g_drill', item_id: 'n_drill', fields: { label: 'Agent-proposed label' } },
        ],
      },
      AGENT
    );
    assert.equal(patch.status, 200, JSON.stringify(patch.body));

    // An unapproved agent publish attempt is denied before any commit. The
    // gate runs BEFORE the lock check in publish_by_time (object-verbs.ts),
    // so this doesn't need its own lock — lock1 is still held by the patch
    // above and stays untouched.
    const githubCallsBeforeDenial = github.calls.length;
    const unapprovedAttempt = await call(
      store,
      {
        action: 'publish_by_time',
        object_type: 'navigation',
        object_id: 'nav_p1_drill',
        lock_token: 'irrelevant-gate-denies-first',
      },
      AGENT,
      { publishDeps: publishDeps(github.fetchImpl), approvalPolicy: GATE_NAVIGATION }
    );
    assert.equal(unapprovedAttempt.status, 403);
    assert.equal(unapprovedAttempt.body.code, 'approval_required');
    assert.equal(github.calls.length, githubCallsBeforeDenial, 'the denial must happen before any git call');

    await call(
      store,
      {
        action: 'submit_review',
        object_type: 'navigation',
        object_id: 'nav_p1_drill',
        lock_token: lock1,
        requested_publish_action: { published_time: 'immediate' },
      },
      AGENT
    );
    await call(
      store,
      { action: 'checkin', object_type: 'navigation', object_id: 'nav_p1_drill', lock_token: lock1 },
      AGENT
    );

    const approve = await call(
      store,
      {
        action: 'review_decide',
        object_type: 'navigation',
        object_id: 'nav_p1_drill',
        decision: 'approve',
        publish_action: { published_time: 'immediate' },
      },
      HUMAN
    );
    assert.equal(approve.status, 200);
    assert.equal(approve.body.review_state, 'approved');

    // Approved: the AGENT — not a human — executes the publish. There is no
    // separate human-execute step in the configurable-policy model; approval
    // is the only human touch (src/lib/approval-policy.ts).
    const agentCheckout = await call(
      store,
      { action: 'checkout', object_type: 'navigation', object_id: 'nav_p1_drill' },
      AGENT
    );
    const agentLock = agentCheckout.body.lockToken as string;

    const agentPublish = await call(
      store,
      { action: 'publish_by_time', object_type: 'navigation', object_id: 'nav_p1_drill', lock_token: agentLock },
      AGENT,
      { publishDeps: publishDeps(github.fetchImpl), approvalPolicy: GATE_NAVIGATION }
    );
    assert.equal(agentPublish.status, 200, JSON.stringify(agentPublish.body));
    assert.equal(agentPublish.body.published, true);

    await call(
      store,
      { action: 'checkin', object_type: 'navigation', object_id: 'nav_p1_drill', lock_token: agentLock },
      AGENT
    );

    const record = store.read('navigation', 'nav_p1_drill');
    assert.ok(record.publication.published_time, 'the record must now be stamped');
    const receipt = record.publication.publish_receipt as Record<string, unknown>;
    assert.equal(receipt.commit_sha, github.getHead().sha);

    const marker = assertCommittedExportMatchesMaterializer(github, 'navigation', 'nav_p1_drill', record.body);
    assert.equal(marker.at, record.publication.published_time);

    // History: the denied pre-approval attempt left NO trace at all (the gate
    // denies before publishObject ever touches the record). The final
    // publish is attributed to the AGENT, not the reviewer.
    assert.deepEqual(historyActions(record), [
      { action: 'create', actor: 'drill-agent' },
      { action: 'checkout', actor: 'drill-agent' },
      { action: 'update_item', actor: 'drill-agent' },
      { action: 'submit_review', actor: 'drill-agent' },
      { action: 'checkin', actor: 'drill-agent' },
      { action: 'review_decide', actor: 'reviewer@example.com' },
      { action: 'checkout', actor: 'drill-agent' },
      { action: 'publish', actor: 'drill-agent' },
      { action: 'checkin', actor: 'drill-agent' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 4: Discard — a rejected proposal cleanly reverts via T0.6's
// inverse mechanism.
// ═══════════════════════════════════════════════════════════════════════════

test('Scenario 4 (Discard): a rejected proposal cleanly reverts via the T0.6 inverse, attributed to the reviewer', async () => {
  await withDrillEnv(async () => {
    const store = createMemoryStore();

    const originalBody = {
      section: { id: 's_drillcta', type: 'prose', data: { body: '<p>Original prose body.</p>' } },
    };
    const created = await call(
      store,
      {
        action: 'create',
        object_type: 'section',
        site: 'site_drlurie',
        body: originalBody,
        requested_id: 'sec_p1_drill',
      },
      AGENT
    );
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const preProposalBody = (created.body.record as ObjectRecord).body;

    const checkout1 = await call(
      store,
      { action: 'checkout', object_type: 'section', object_id: 'sec_p1_drill' },
      AGENT
    );
    const lock1 = checkout1.body.lockToken as string;

    const patch = await call(
      store,
      {
        action: 'patch',
        object_type: 'section',
        object_id: 'sec_p1_drill',
        lock_token: lock1,
        expected_record_version: checkout1.body.record_version as number,
        ops: [
          {
            op: 'update_section_data',
            section_id: 's_drillcta',
            fields: { body: '<p>Agent-proposed prose that will be rejected.</p>' },
          },
        ],
      },
      AGENT
    );
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    const proposalHistoryEntry = store.read('section', 'sec_p1_drill').history.slice(-1)[0].details as {
      op: unknown;
      capture: unknown;
    };

    await call(
      store,
      { action: 'submit_review', object_type: 'section', object_id: 'sec_p1_drill', lock_token: lock1 },
      AGENT
    );
    await call(
      store,
      { action: 'checkin', object_type: 'section', object_id: 'sec_p1_drill', lock_token: lock1 },
      AGENT
    );

    // A human reviewer rejects it by discarding — under their OWN lock (C§2.4).
    const reviewerCheckout = await call(
      store,
      { action: 'checkout', object_type: 'section', object_id: 'sec_p1_drill' },
      HUMAN
    );
    assert.equal(reviewerCheckout.status, 200);
    const reviewerLock = reviewerCheckout.body.lockToken as string;

    const beforeDiscard = store.read('section', 'sec_p1_drill');
    const discard = await call(
      store,
      {
        action: 'discard',
        object_type: 'section',
        object_id: 'sec_p1_drill',
        lock_token: reviewerLock,
        entries: [proposalHistoryEntry as { op: unknown; capture: unknown }],
      },
      HUMAN
    );
    assert.equal(discard.status, 200, JSON.stringify(discard.body));

    await call(
      store,
      { action: 'checkin', object_type: 'section', object_id: 'sec_p1_drill', lock_token: reviewerLock },
      HUMAN
    );

    const record = store.read('section', 'sec_p1_drill');
    assert.deepEqual(record.body, preProposalBody, 'the object must cleanly revert to its pre-proposal body');
    assert.equal(
      (record.body as typeof originalBody).section.data.body,
      '<p>Original prose body.</p>',
      'the rejected prose must NOT survive'
    );
    assert.equal(
      record.content_revision,
      beforeDiscard.content_revision + 1,
      'discard is itself a body write and must bump content_revision (invalidating any approval over the rejected draft)'
    );

    const inverseEntry = record.history[record.history.length - 2]; // last is checkin
    assert.equal(inverseEntry.action, 'update_section_data');
    assert.equal(inverseEntry.actor.kind, 'human');
    assert.equal(
      (inverseEntry.actor as { email: string }).email,
      'reviewer@example.com',
      'the inverse write is attributed to the reviewer, not the agent'
    );

    assert.deepEqual(historyActions(record), [
      { action: 'create', actor: 'drill-agent' },
      { action: 'checkout', actor: 'drill-agent' },
      { action: 'update_section_data', actor: 'drill-agent' },
      { action: 'submit_review', actor: 'drill-agent' },
      { action: 'checkin', actor: 'drill-agent' },
      { action: 'checkout', actor: 'reviewer@example.com' },
      { action: 'update_section_data', actor: 'reviewer@example.com' },
      { action: 'checkin', actor: 'reviewer@example.com' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 5: a retried publish after a simulated transient git conflict
// converges — no duplicate commit, no partial state.
// ═══════════════════════════════════════════════════════════════════════════

test('Scenario 5 (transient git conflict): a retried publish converges to a single, correct commit — not a duplicate or partial one', async () => {
  await withDrillEnv(async () => {
    const store = createMemoryStore();
    // Script the FIRST ref-update PATCH to lose a race (non-fast-forward,
    // simulating a concurrent commit stream landing first — OQ-13); the
    // second attempt (T1.2's internal retry) must succeed.
    const nonFastForward: RefPatchOutcome = { status: 422, body: 'Update is not a fast forward' };
    const github = createGitHubApiMock({ refPatchOutcomes: [nonFastForward] });

    const created = await call(
      store,
      {
        action: 'create',
        object_type: 'page',
        site: 'site_drlurie',
        body: {
          route: '/drill-retry',
          pageType: 'standard',
          title: 'Retry Drill Page',
          seo: {},
          sections: [{ id: 's_retry', type: 'hero', data: { heading: 'Retry drill heading', actions: [] } }],
        },
        requested_id: 'page_p1_retry',
      },
      AGENT
    );
    assert.equal(created.status, 200, JSON.stringify(created.body));

    const checkout1 = await call(store, { action: 'checkout', object_type: 'page', object_id: 'page_p1_retry' }, AGENT);
    const lock1 = checkout1.body.lockToken as string;
    await call(
      store,
      {
        action: 'patch',
        object_type: 'page',
        object_id: 'page_p1_retry',
        lock_token: lock1,
        expected_record_version: checkout1.body.record_version as number,
        ops: [{ op: 'set_page_meta', fields: { title: 'Retry Drill Page (patched)' } }],
      },
      AGENT
    );
    await call(
      store,
      {
        action: 'submit_review',
        object_type: 'page',
        object_id: 'page_p1_retry',
        lock_token: lock1,
        requested_publish_action: { published_time: 'immediate' },
      },
      AGENT
    );
    await call(store, { action: 'checkin', object_type: 'page', object_id: 'page_p1_retry', lock_token: lock1 }, AGENT);
    await call(
      store,
      {
        action: 'review_decide',
        object_type: 'page',
        object_id: 'page_p1_retry',
        decision: 'approve',
        publish_action: { published_time: 'immediate' },
      },
      HUMAN
    );

    const checkout2 = await call(store, { action: 'checkout', object_type: 'page', object_id: 'page_p1_retry' }, AGENT);
    const lock2 = checkout2.body.lockToken as string;

    const publish = await call(
      store,
      { action: 'publish_by_time', object_type: 'page', object_id: 'page_p1_retry', lock_token: lock2 },
      AGENT,
      { publishDeps: publishDeps(github.fetchImpl) }
    );

    // The retry must be transparent to the caller: a single successful result.
    assert.equal(publish.status, 200, JSON.stringify(publish.body));
    assert.equal(publish.body.published, true);

    await call(store, { action: 'checkin', object_type: 'page', object_id: 'page_p1_retry', lock_token: lock2 }, AGENT);

    const record = store.read('page', 'page_p1_retry');
    assert.ok(record.publication.published_time, 'the record must be stamped despite the transient conflict');
    const storedReceipt = record.publication.publish_receipt as Record<string, unknown>;
    assert.equal(storedReceipt.attempts, 2, 'exactly one retry happened (lost race, then succeeded)');
    assert.equal(
      storedReceipt.commit_sha,
      github.getHead().sha,
      'the receipt names the commit that actually won the ref'
    );

    // Real git behavior: each attempt mints its own commit object (2 total —
    // one per attempt), but only ONE ref-move ever lands at head. The first
    // attempt's commit exists but is orphaned — no ref ever points to it —
    // which is exactly "not a duplicate or partial commit": the repo's
    // history has one, and only one, commit for this publish.
    const commitPosts = github.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/git/commits'));
    const refPatches = github.calls.filter((c) => c.method === 'PATCH');
    assert.equal(commitPosts.length, 2, 'one commit object per attempt (failed + retry)');
    assert.equal(refPatches.length, 2, 'exactly the failed attempt + the succeeding retry, no more');

    // The committed bytes at head are byte-identical to T1.1's deterministic
    // output for this exact body/version/timestamp — proving determinism is
    // what let the retry converge cleanly rather than diverge.
    const marker = assertCommittedExportMatchesMaterializer(github, 'page', 'page_p1_retry', record.body);
    assert.equal(marker.at, record.publication.published_time);

    // No partial state: version/content_revision reflect exactly the writes
    // that actually happened (create, checkout, patch, submit, checkin,
    // review_decide, checkout, publish-stamp) — the failed ref PATCH left no
    // record-side residue at all (T1.3's export-first ordering).
    assert.deepEqual(historyActions(record), [
      { action: 'create', actor: 'drill-agent' },
      { action: 'checkout', actor: 'drill-agent' },
      { action: 'set_page_meta', actor: 'drill-agent' },
      { action: 'submit_review', actor: 'drill-agent' },
      { action: 'checkin', actor: 'drill-agent' },
      { action: 'review_decide', actor: 'reviewer@example.com' },
      { action: 'checkout', actor: 'drill-agent' },
      { action: 'publish', actor: 'drill-agent' },
      { action: 'checkin', actor: 'drill-agent' },
    ]);
  });
});
