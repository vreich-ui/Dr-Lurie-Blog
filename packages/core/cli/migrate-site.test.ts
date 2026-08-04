import '../../../sites/drlurie/config/policy-bindings.js'; // registers site providers — handleObjectVerb needs activeCreationPolicy()
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CURRENT_SCHEMAS,
  CURRENT_SCHEMA_VERSIONS,
  scanSiteExports,
  buildDryRunReport,
  renderReport,
  buildPatchOpsForChain,
  applyRecordMigration,
  runWritePlan,
} from './migrate-site.mjs';
import { handleObjectVerb, type ObjectVerbRequest, type ObjectVerbStore } from '../server/lib/object-verbs.js';
import type { Principal } from '../schema/object-record-v1.js';

// ─── scratch export-tree helpers ────────────────────────────────────────────
// scanSiteExports takes an arbitrary directory (it doesn't have to be a real
// sites/<client> tree), so every disk-touching test here works against an
// OS-tmp scratch dir — no dependency on this repo's real committed content,
// and no risk of ever touching it.
const mkScratchSite = () => fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-site-test-'));

const writeExport = (siteDir: string, relPath: string, generatedFrom: string, body: Record<string, unknown>) => {
  const filePath = path.join(siteDir, 'data', 'site', relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({ __generated: { at: '2026-01-01T00:00:00.000Z', from: generatedFrom, record_version: 1 }, ...body })
  );
};

// pageType 'standard' (not 'home') — a 'home' page has an unconditional,
// publish-time-enforced requirement (navigationOverrides.footer) that has
// nothing to do with what these tests are proving.
const validPageBody = () => ({
  route: '/test-page',
  pageType: 'standard',
  title: 'Home',
  seo: { description: 'x' },
  sections: [{ id: 's_hero', type: 'hero', data: { heading: 'Hi', actions: [] } }],
});

describe('CURRENT_SCHEMAS / CURRENT_SCHEMA_VERSIONS', () => {
  it('pins one schema + one version string per governed object type', () => {
    // In the compiled test tree the schema machinery MUST load — the
    // undefined branch exists only for raw-checkout --admin-parity runs
    // (see migrate-site.mjs's machinery note).
    assert.ok(CURRENT_SCHEMAS, 'compiled tree must load the schema machinery');
    assert.ok(CURRENT_SCHEMA_VERSIONS, 'compiled tree must derive the version map');
    const types = Object.keys(CURRENT_SCHEMAS);
    assert.ok(types.length >= 10, 'expected at least the ten governed object types');
    for (const t of types) {
      assert.strictEqual(typeof CURRENT_SCHEMAS[t as keyof typeof CURRENT_SCHEMAS].safeParse, 'function');
      assert.strictEqual(CURRENT_SCHEMA_VERSIONS[t], `${t}.v1`);
    }
  });
});

describe('scanSiteExports', () => {
  it('returns [] for a site with no data/site tree', () => {
    const siteDir = mkScratchSite();
    try {
      assert.deepStrictEqual(scanSiteExports(siteDir), []);
    } finally {
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });

  it('scans single-file (site/taxonomy) and directory-based (pages/sections/…) exports, deriving objectId from __generated.from', () => {
    const siteDir = mkScratchSite();
    try {
      writeExport(siteDir, 'site.json', 'objects/site/by-id/site_acme.json', { brandName: 'Acme' });
      writeExport(siteDir, 'taxonomy.json', 'objects/taxonomy/by-id/tax_acme.json', { kinds: {} });
      writeExport(siteDir, 'pages/page_home.json', 'objects/page/by-id/page_home.json', validPageBody());
      // .gitkeep and non-.json files must be ignored, not misread as records.
      fs.writeFileSync(path.join(siteDir, 'data', 'site', 'pages', '.gitkeep'), '');
      fs.writeFileSync(path.join(siteDir, 'data', 'site', 'pages', 'notes.txt'), 'not json');

      const records = scanSiteExports(siteDir);
      const byId = Object.fromEntries(records.map((r) => [r.objectId, r]));

      assert.strictEqual(records.length, 3);
      assert.strictEqual(byId.site_acme.objectType, 'site');
      assert.strictEqual(byId.tax_acme.objectType, 'taxonomy');
      assert.strictEqual(byId.page_home.objectType, 'page');
      assert.deepStrictEqual(byId.page_home.body, validPageBody());
      assert.strictEqual(byId.page_home.body.__generated, undefined, '__generated must be stripped from the body');
      // Today's assumed version (no real per-record tag exists in an export).
      assert.strictEqual(byId.page_home.schemaVersion, 'page.v1');
    } finally {
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });

  it('ignores an export directory it has no objectType mapping for, rather than guessing', () => {
    const siteDir = mkScratchSite();
    try {
      fs.mkdirSync(path.join(siteDir, 'data', 'site', 'some-future-dir'), { recursive: true });
      fs.writeFileSync(
        path.join(siteDir, 'data', 'site', 'some-future-dir', 'x.json'),
        JSON.stringify({ __generated: { from: 'objects/unknown/by-id/x.json' }, a: 1 })
      );
      assert.deepStrictEqual(scanSiteExports(siteDir), []);
    } finally {
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });
});

describe('buildDryRunReport / renderReport', () => {
  it('reports gatePasses: true when every scanned export already parses under the head schema', () => {
    const siteDir = mkScratchSite();
    try {
      writeExport(siteDir, 'pages/page_home.json', 'objects/page/by-id/page_home.json', validPageBody());
      const report = buildDryRunReport(siteDir);
      assert.strictEqual(report.recordCount, 1);
      assert.strictEqual(report.gatePasses, true);
      assert.strictEqual(report.results[0]?.disposition.disposition, 'parses-as-is');
      const rendered = renderReport(report);
      assert.match(rendered, /GATE: PASS/);
      assert.match(rendered, /parses-as-is: 1/);
    } finally {
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });

  it('reports gatePasses: false and names the blocked record when an export fails the head schema with no migration registered', () => {
    const siteDir = mkScratchSite();
    try {
      // Missing `sections` — fails pageBodySchema.
      writeExport(siteDir, 'pages/page_broken.json', 'objects/page/by-id/page_broken.json', {
        route: '/broken',
        pageType: 'standard',
        title: 'Broken',
        seo: {},
      });
      const report = buildDryRunReport(siteDir);
      assert.strictEqual(report.gatePasses, false);
      assert.strictEqual(report.results[0]?.disposition.disposition, 'blocked');
      const rendered = renderReport(report);
      assert.match(rendered, /GATE: FAIL/);
      assert.match(rendered, /BLOCKED\s+page\/page_broken/);
    } finally {
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });

  it('the real committed sites/drlurie export tree passes the gate today (proves the harness breaks nothing live)', () => {
    // This file is compiled into .tmp/ci-test — the real repo's committed
    // JSON exports (plain data, not part of any TS import graph) are not
    // copied there. `npm run test`'s own invocation (`cd .tmp/ci-test &&
    // node --test`) puts the real repo root two levels above cwd; guard
    // with an existence check and skip gracefully if that assumption ever
    // stops holding, rather than false-failing the whole suite.
    const candidateRoot = path.resolve(process.cwd(), '..', '..');
    const realSiteDir = path.join(candidateRoot, 'sites', 'drlurie');
    if (!fs.existsSync(path.join(realSiteDir, 'data', 'site', 'site.json'))) {
      console.log(`[migrate-site.test] skipping real-repo check — ${realSiteDir} not reachable from this cwd.`);
      return;
    }
    const report = buildDryRunReport(realSiteDir);
    assert.ok(report.recordCount > 0, 'expected the real drlurie export tree to have records');
    if (!report.gatePasses) console.log(renderReport(report));
    assert.strictEqual(report.gatePasses, true, 'the real committed exports must all parse under the head schemas');
  });
});

// ─── the synthetic migration used by every write-path test below ───────────
// Deliberately compatible with the REAL (strict) page schema — `title`
// stays a plain string — because these tests prove the WRITE MECHANISM
// (checkout → patch with the chain's own ops → checkin) against the real
// object-verbs.ts grammar; the "blocks without a migration, passes with
// it" adversarial logic already has its own fully-synthetic-schema proof
// in classify.test.ts and needs no re-proving here.
const RETITLE_MIGRATION = {
  objectType: 'page' as const,
  from: 'page.v1',
  to: 'page.v1-migrate-site-test',
  description: 'test-only: uppercase the title',
  migrate: (body: unknown) => ({
    ...(body as Record<string, unknown>),
    title: String((body as { title: string }).title).toUpperCase(),
  }),
  toPatchOps: (_old: unknown, newBody: unknown) => [
    { op: 'set_page_meta', fields: { title: (newBody as { title: string }).title } },
  ],
};

const NON_WRITABLE_MIGRATION = { ...RETITLE_MIGRATION, toPatchOps: undefined };

describe('buildPatchOpsForChain', () => {
  it('threads a body through each hop and collects toPatchOps(old, new) in order', () => {
    const { ops, finalBody } = buildPatchOpsForChain({ title: 'home' }, [RETITLE_MIGRATION]);
    assert.deepStrictEqual(ops, [{ op: 'set_page_meta', fields: { title: 'HOME' } }]);
    assert.deepStrictEqual(finalBody, { title: 'HOME' });
  });

  it('throws when a hop in the chain has no toPatchOps (not writable)', () => {
    assert.throws(() => buildPatchOpsForChain({ title: 'home' }, [NON_WRITABLE_MIGRATION]), /has no toPatchOps/);
  });
});

// ─── in-memory ObjectVerbStore, matching the object-store-verbs.test.ts pattern ───
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
  };
};

const AGENT: Principal = { kind: 'agent', agent_name: 'migrate-site-test', auth: 'mcp_token' };

const seedPage = async (store: ReturnType<typeof createMemoryStore>) => {
  const res = await handleObjectVerb(
    store as unknown as ObjectVerbStore,
    { action: 'create', object_type: 'page', site: 'site_test', body: validPageBody() } as ObjectVerbRequest,
    AGENT
  );
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const record = res.body.record as { object_id: string };
  return record.object_id;
};

describe('applyRecordMigration', () => {
  it('applies the migration through checkout -> patch -> checkin and the stored body reflects the migrated shape', async () => {
    const store = createMemoryStore();
    const objectId = await seedPage(store);

    const outcome = await applyRecordMigration({
      store: store as unknown as ObjectVerbStore,
      principal: AGENT,
      objectType: 'page',
      objectId,
      chain: [RETITLE_MIGRATION],
    });

    assert.strictEqual(outcome.ok, true, JSON.stringify(outcome));
    assert.strictEqual(outcome.stages.checkout.status, 200);
    assert.strictEqual(outcome.stages.patch.status, 200);
    assert.strictEqual(outcome.stages.checkin.status, 200);
    assert.strictEqual(outcome.stages.republish, undefined, 'a never-published record must not attempt a republish');

    const stored = JSON.parse(store.blobs.get(`objects/page/by-id/${objectId}.json`)!);
    assert.strictEqual(stored.body.title, 'HOME');
    assert.strictEqual(stored.lock, undefined, 'checkin must release the lock');
  });

  it('attempts a best-effort republish (and still reports ok) when the record was already live', async () => {
    const store = createMemoryStore();
    const objectId = await seedPage(store);
    // Simulate an already-published record directly on the store (bypassing
    // the real publish plumbing/committer, which needs credentials this
    // sandbox doesn't have — see home-conversion-roundtrip.mjs's own
    // documented sandbox-publish-block precedent).
    const key = `objects/page/by-id/${objectId}.json`;
    const record = JSON.parse(store.blobs.get(key)!);
    record.publication.published_time = '2026-07-01T00:00:00.000Z';
    store.blobs.set(key, JSON.stringify(record));

    const outcome = await applyRecordMigration({
      store: store as unknown as ObjectVerbStore,
      principal: AGENT,
      objectType: 'page',
      objectId,
      chain: [RETITLE_MIGRATION],
    });

    assert.strictEqual(outcome.ok, true, JSON.stringify(outcome));
    assert.ok(outcome.stages.republish, 'an already-published record must attempt a republish');
    assert.strictEqual(
      outcome.stages.checkin.status,
      200,
      'checkin must still happen even if republish is gated/blocked'
    );
  });

  it('reports a failure (not ok) and still releases the lock when the record does not exist', async () => {
    const store = createMemoryStore();
    const outcome = await applyRecordMigration({
      store: store as unknown as ObjectVerbStore,
      principal: AGENT,
      objectType: 'page',
      objectId: 'page_does_not_exist',
      chain: [RETITLE_MIGRATION],
    });
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.stages.get.status, 404);
    assert.strictEqual(
      outcome.stages.checkout,
      undefined,
      'must not attempt checkout on a record that was never found'
    );
  });
});

describe('runWritePlan', () => {
  it('attempts only migratable+writable records; parses-as-is/blocked/preview-only are skipped untouched', async () => {
    const store = createMemoryStore();
    const objectId = await seedPage(store);

    const report = {
      results: [
        { objectId: 'page_asis', objectType: 'page', disposition: { disposition: 'parses-as-is' } },
        { objectId: 'page_blocked', objectType: 'page', disposition: { disposition: 'blocked', reason: 'no path' } },
        {
          objectId: 'page_preview_only',
          objectType: 'page',
          disposition: { disposition: 'migratable', chain: [RETITLE_MIGRATION], writable: false },
        },
        {
          objectId,
          objectType: 'page',
          disposition: { disposition: 'migratable', chain: [RETITLE_MIGRATION], writable: true },
        },
      ],
    };

    const { attempted, skipped } = await runWritePlan(report as never, {
      store: store as unknown as ObjectVerbStore,
      principal: AGENT,
    });

    assert.strictEqual(attempted.length, 1);
    assert.strictEqual(attempted[0]?.objectId, objectId);
    assert.strictEqual(attempted[0]?.ok, true);

    assert.strictEqual(skipped.length, 3);
    assert.deepStrictEqual(
      skipped.map((s) => s.objectId).sort(),
      ['page_asis', 'page_blocked', 'page_preview_only'].sort()
    );
  });
});
