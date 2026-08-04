#!/usr/bin/env node
/**
 * `migrate-site` — the W11 T11.9 schema-migration CLI: the executable half of
 * the migration harness (packages/core/server/migrations/registry.js +
 * classify.js). Scans a site's COMMITTED exports (sites/<site>/data/site/**),
 * classifies every record's `schema_version` against the head schemas + the
 * registered migration chain, and reports per-record disposition:
 *
 *   parses-as-is  the export already satisfies the head schema — nothing to do.
 *   migratable    a registered chain reaches the head schema; `writable`
 *                 reports whether every hop carries `toPatchOps` (a real
 *                 write is possible) or the chain is preview-only.
 *   blocked       no path, or a chain exists but the migrated body still
 *                 doesn't parse (a broken migration) — this is the CI gate's
 *                 failure signal (a failing site blocks merge, per the brief).
 *
 * `--dry-run` (default) never touches a store — it is pure disk + the
 * registry, safe to run in CI on every PR. `--write` applies migratable +
 * writable records through the STANDARD verb path (checkout → patch with
 * the migration's own `toPatchOps` → best-effort republish when the record
 * was already live → checkin) — never a raw blob write, the same boundary
 * every other write path in this codebase respects (object-verbs.ts).
 *
 * Today `MIGRATIONS` (registry.js) ships empty — no real schema bump exists
 * yet (T11.9's own non-goal). Every site's exports are all `<type>.v1`
 * against a head that is ALSO `<type>.v1` (CURRENT_SCHEMA_VERSIONS below is
 * the one place a real bump updates), so `--dry-run` trivially reports 100%
 * parses-as-is for every real site today — this is the harness proving it
 * doesn't break anything, not a weak test. The adversarial "blocks without
 * a migration, passes with it" case is proven against a wholly synthetic
 * schema pair in packages/core/server/migrations/classify.test.ts; this
 * CLI's own tests exercise the disk-scan + report plumbing and the write
 * orchestration (checkout/patch/checkin sequencing) against an in-memory
 * store with a synthetic migration compatible with the real store grammar.
 *
 * Committed exports carry NO `schema_version` field at all (materializers
 * only emit `{__generated, ...body}` — see materializers/site.ts) — there is
 * no live per-record version tag to read today. `scanSiteExports` therefore
 * assumes every scanned record's declared version is CURRENT_SCHEMA_VERSIONS
 * for its type — correct as long as nothing has drifted (true today; a real
 * historical-version-detection scheme is out of scope, see the brief's
 * non-goals). A record whose body genuinely fails the head schema with
 * schemaVersion === currentSchemaVersion is reported blocked with a
 * "migration ... ran but still does not parse" message even though no real
 * migration ran (a no-op from===to chain) — a known, harmless cosmetic edge
 * case (recorded here rather than silently glossed over) that cannot occur
 * while every committed export actually validates (which the `build`/`check`
 * CI jobs already require).
 *
 * W15 S2 added a SECOND, independent dimension: ADMIN PARITY
 * (`--admin-parity`). Schema migration covers a site's DATA; admin parity
 * covers its WIRING — the function shims, canonical redirects (incl. the S1
 * `/admin/content/:objectId` rewrite), keepalive schedule, and reader route
 * loaders an older scaffold may predate. `--admin-parity` alone reports the
 * full audit (packages/core/cli/admin-parity.mjs, the same checks
 * scripts/audit-site-admin-parity.mjs prints); `--admin-parity --write`
 * applies the AUTOMATABLE fixes onto the site tree — additive and
 * idempotent: missing shims/loaders/redirect rules are added, the one known
 * stale form (the pre-S1 admin splat) is replaced, existing files are never
 * overwritten, and a second run finds nothing to do. Human-gated
 * requirements (Identity enablement, ADMIN_EMAILS, secret values) are
 * reported, never synthesized.
 *
 * Usage:
 *   node packages/core/cli/migrate-site.mjs --site sites/acme --dry-run
 *   node packages/core/cli/migrate-site.mjs --site sites/acme --write --local
 *   node packages/core/cli/migrate-site.mjs --site sites/acme --admin-parity
 *   node packages/core/cli/migrate-site.mjs --site sites/acme --admin-parity --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  computeAdminParity,
  planAdminParityFixes,
  renderParityReport,
  resolveAuditTarget,
} from './admin-parity.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ─── the schema-migration machinery (COMPILED-tree modules) ─────────────────
//
// Everything the schema half needs is TypeScript: on a raw checkout those
// `.js` specifiers do not exist — they resolve only in the compiled test tree
// (.tmp/ci-test, where migrate-site.test.ts and scripts/ci/
// schema-migration-gate.mjs run this module) or a built distribution. The
// W15 S2 `--admin-parity` half, by contrast, is pure `.mjs` + disk and MUST
// work on a raw checkout (that is its whole point: repair an older site tree
// in place). So the TS-bound imports are top-level-awaited but
// FAILURE-TOLERANT: when they cannot resolve, the schema exports stay
// undefined, the schema code paths throw a clear error, and `--admin-parity`
// keeps working.
const loadSchemaMachinery = async () => {
  const [registry, classify, verbs, nav, page, product, section, stpl, theme, tracking, site, tax, tpl, contentItem] =
    await Promise.all([
      import('../server/migrations/registry.js'),
      import('../server/migrations/classify.js'),
      import('../server/lib/object-verbs.js'),
      import('../schema/bodies/navigation-v1.js'),
      import('../schema/bodies/page-v1.js'),
      import('../schema/bodies/product-v1.js'),
      import('../schema/bodies/section-v1.js'),
      import('../schema/bodies/section-template-v1.js'),
      import('../schema/bodies/theme-v1.js'),
      import('../schema/bodies/tracking-config-v1.js'),
      import('../schema/bodies/site-v1.js'),
      import('../schema/bodies/taxonomy-v1.js'),
      import('../schema/bodies/template-v1.js'),
      import('../schema/bodies/content-item-v1.js'),
    ]);
  return {
    MIGRATIONS: registry.MIGRATIONS,
    classifySiteRecords: classify.classifySiteRecords,
    handleObjectVerb: verbs.handleObjectVerb,
    schemas: {
      navigation: nav.navigationBodySchema,
      page: page.pageBodySchema,
      section: section.sectionBodySchema,
      template: tpl.templateBodySchema,
      section_template: stpl.sectionTemplateBodySchema,
      theme: theme.themeBodySchema,
      site: site.siteBodySchema,
      taxonomy: tax.taxonomyBodySchema,
      product: product.productBodySchema,
      content_item: contentItem.contentItemBodySchema,
      tracking_config: tracking.trackingConfigBodySchema,
    },
  };
};

let machinery;
try {
  machinery = await loadSchemaMachinery();
} catch {
  machinery = undefined; // raw checkout — only --admin-parity is available
}

const requireMachinery = () => {
  if (!machinery) {
    throw new Error(
      'the schema-migration half needs the COMPILED core modules (run via npm test / the schema-migration gate, ' +
        'which compile to .tmp/ci-test first) — on a raw checkout only --admin-parity is available.'
    );
  }
  return machinery;
};

// ─── head schemas + versions (the ONE place a real schema bump updates) ─────
// Mirrors object-verbs.ts's `schema_version: \`${objectType}.v1\`` hardcode
// (object-verbs.ts:643) — today every type is at v1 and BODY_SCHEMAS
// (object-validate.ts) is unversioned, so this map and that hardcode must
// move together whenever a real bump ships a v2 for some type.
// (undefined on a raw checkout — see the machinery note above.)
export const CURRENT_SCHEMAS = machinery?.schemas;

export const CURRENT_SCHEMA_VERSIONS = machinery
  ? Object.fromEntries(Object.keys(CURRENT_SCHEMAS).map((objectType) => [objectType, `${objectType}.v1`]))
  : undefined;

// ─── directory -> objectType mapping for a site's committed export tree ────
// (sites/<site>/data/site/** — see SiteBinding.dataRoot / T11.6). Single
// files (site.json, taxonomy.json) sit directly under data/site/; every
// other type lives one level down in its own plural-ish directory.
const DIR_OBJECT_TYPES = {
  pages: 'page',
  sections: 'section',
  navigation: 'navigation',
  products: 'product',
  'section-templates': 'section_template',
  templates: 'template',
  themes: 'theme',
  articles: 'content_item',
  'tracking-configs': 'tracking_config',
};
const SINGLE_FILE_OBJECT_TYPES = {
  'site.json': 'site',
  'taxonomy.json': 'taxonomy',
};

/**
 * Scans a site's committed export tree into SiteScanRecord[] (classify.js's
 * input shape). Skips `.gitkeep` and any non-`.json` file. `objectId` is the
 * filename minus `.json`; `body` is the file's JSON minus the `__generated`
 * materializer-provenance envelope (never part of the real object body).
 */
export const scanSiteExports = (siteDir) => {
  const dataRoot = path.join(siteDir, 'data', 'site');
  const records = [];

  if (!fs.existsSync(dataRoot)) return records;

  for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })) {
    if (entry.isFile() && SINGLE_FILE_OBJECT_TYPES[entry.name]) {
      const objectType = SINGLE_FILE_OBJECT_TYPES[entry.name];
      records.push(readExportRecord(path.join(dataRoot, entry.name), objectType, entry.name.replace(/\.json$/, '')));
      continue;
    }
    if (!entry.isDirectory()) continue;
    const objectType = DIR_OBJECT_TYPES[entry.name];
    if (!objectType) continue; // an export dir this scanner doesn't know about yet — not silently included as unknown
    const dir = path.join(dataRoot, entry.name);
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue;
      records.push(readExportRecord(path.join(dir, file.name), objectType, file.name.replace(/\.json$/, '')));
    }
  }

  return records;
};

/**
 * The real object id, `objects/<type>/by-id/<id>.json`'s basename — the
 * single-file exports (site.json, taxonomy.json) don't encode the id in
 * their own filename (there is exactly one site/taxonomy per site), so
 * `__generated.from` is the one place that is actually always right;
 * falling back to the file's own basename covers a record with no
 * `__generated` block at all (e.g. a hand-authored fixture in a test).
 */
const readExportRecord = (filePath, objectType, fallbackObjectId) => {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const { __generated: generated, ...body } = raw;
  const objectId =
    generated && typeof generated.from === 'string'
      ? path.basename(generated.from).replace(/\.json$/, '')
      : fallbackObjectId;
  return {
    objectType,
    objectId,
    // See the module header: exports carry no real version tag today — the
    // current head version is the only honest default to assume.
    schemaVersion: CURRENT_SCHEMA_VERSIONS?.[objectType] ?? `${objectType}.v1`,
    body,
  };
};

/** Classifies every record scanned from `siteDir` against the head schemas + registry. */
export const buildDryRunReport = (siteDir, { migrations = requireMachinery().MIGRATIONS } = {}) => {
  const { classifySiteRecords } = requireMachinery();
  const records = scanSiteExports(siteDir);
  const { results, gatePasses } = classifySiteRecords(records, {
    currentSchema: (objectType) => CURRENT_SCHEMAS[objectType],
    currentSchemaVersion: (objectType) => CURRENT_SCHEMA_VERSIONS[objectType] ?? `${objectType}.v1`,
    migrations,
  });
  return { siteDir, recordCount: records.length, results, gatePasses };
};

export const renderReport = (report) => {
  const counts = { 'parses-as-is': 0, migratable: 0, blocked: 0 };
  for (const r of report.results) counts[r.disposition.disposition] += 1;
  const lines = [
    `[migrate-site] ${report.siteDir}: ${report.recordCount} record(s) scanned`,
    `  parses-as-is: ${counts['parses-as-is']}   migratable: ${counts.migratable}   blocked: ${counts.blocked}`,
  ];
  for (const r of report.results) {
    if (r.disposition.disposition === 'blocked') {
      lines.push(`  BLOCKED  ${r.objectType}/${r.objectId}: ${r.disposition.reason}`);
    } else if (r.disposition.disposition === 'migratable') {
      const chainDesc = r.disposition.chain.map((m) => `${m.from}→${m.to}`).join(', ') || '(no-op)';
      lines.push(
        `  migratable ${r.objectType}/${r.objectId}: ${chainDesc} (${r.disposition.writable ? 'writable' : 'preview-only'})`
      );
    }
  }
  lines.push(report.gatePasses ? '  GATE: PASS' : '  GATE: FAIL (at least one blocked record)');
  return lines.join('\n');
};

// ─── the write path — STANDARD verb path only, never a raw blob write ──────

/**
 * Builds the ops for one record's migration chain by threading the body
 * through each hop's `migrate()` and collecting that hop's `toPatchOps`
 * (old, new) ops in order. Throws if any hop lacks `toPatchOps` — callers
 * must have already confirmed `writable` via classifyRecord/classifySiteRecords.
 */
export const buildPatchOpsForChain = (oldBody, chain) => {
  let current = oldBody;
  const ops = [];
  for (const migration of chain) {
    if (typeof migration.toPatchOps !== 'function') {
      throw new Error(`migration '${migration.from} -> ${migration.to}' has no toPatchOps — not writable.`);
    }
    const next = migration.migrate(current);
    ops.push(...migration.toPatchOps(current, next));
    current = next;
  }
  return { ops, finalBody: current };
};

/**
 * Applies ONE record's migration chain via the standard verb path:
 * get (current body + publish state) → checkout → patch (the chain's own
 * ops) → best-effort republish (only when the record was already live —
 * preserves publish state, never publishes something that wasn't already
 * published) → checkin (always attempted, even after a failure, so a lock
 * is never left stuck). Returns a per-record outcome; never throws — every
 * failure mode is a reported stage, matching how the rest of this codebase's
 * verb callers treat handleObjectVerb's { status, body } results.
 */
export const applyRecordMigration = async ({ store, principal, objectType, objectId, chain, nowMs = undefined }) => {
  const { handleObjectVerb } = requireMachinery();
  const call = (request) => handleObjectVerb(store, request, principal, nowMs !== undefined ? { nowMs } : {});
  const outcome = { objectType, objectId, ok: false, stages: {} };

  const got = await call({ action: 'get', object_type: objectType, object_id: objectId });
  outcome.stages.get = { status: got.status };
  if (got.status !== 200) return { ...outcome, reason: 'record not found' };
  const record = got.body.record;

  const checkout = await call({ action: 'checkout', object_type: objectType, object_id: objectId });
  outcome.stages.checkout = { status: checkout.status };
  if (checkout.status !== 200) return { ...outcome, reason: 'checkout failed (locked or not found)' };
  const lockToken = checkout.body.lockToken;
  const expectedVersion = checkout.body.record_version;

  try {
    const { ops } = buildPatchOpsForChain(record.body, chain);
    const patch = await call({
      action: 'patch',
      object_type: objectType,
      object_id: objectId,
      lock_token: lockToken,
      expected_record_version: expectedVersion,
      ops,
    });
    outcome.stages.patch = { status: patch.status, body: patch.status === 200 ? undefined : patch.body };
    if (patch.status !== 200) return { ...outcome, reason: 'patch failed (see stages.patch)' };

    if (record.publication?.published_time) {
      const republish = await call({
        action: 'publish_by_time',
        object_type: objectType,
        object_id: objectId,
        lock_token: lockToken,
        published_time: record.publication.published_time,
      });
      outcome.stages.republish = {
        status: republish.status,
        body: republish.status === 200 ? undefined : republish.body,
      };
      // Not fatal: a governed type may be approval-gated (Wolf-gated per
      // policy, per the brief) — the store body is already migrated either
      // way; a blocked republish just means the export commit needs a human
      // to carry it the rest of the way, exactly like any other governed
      // publish.
    }

    outcome.ok = true;
    return outcome;
  } finally {
    const checkin = await call({
      action: 'checkin',
      object_type: objectType,
      object_id: objectId,
      lock_token: lockToken,
    });
    outcome.stages.checkin = { status: checkin.status };
  }
};

/**
 * Runs the write path for every migratable+writable record in a dry-run
 * report. Records that are parses-as-is, blocked, or migratable-but-preview-
 * only are left untouched and reported as skipped (never attempted).
 */
export const runWritePlan = async (report, { store, principal, nowMs = undefined }) => {
  const attempted = [];
  const skipped = [];
  for (const r of report.results) {
    if (r.disposition.disposition !== 'migratable') {
      skipped.push({ objectType: r.objectType, objectId: r.objectId, reason: r.disposition.disposition });
      continue;
    }
    if (!r.disposition.writable) {
      skipped.push({ objectType: r.objectType, objectId: r.objectId, reason: 'preview-only (no toPatchOps)' });
      continue;
    }
    // Serialized deliberately (each record's checkout/patch/checkin holds its own lock).
    const outcome = await applyRecordMigration({
      store,
      principal,
      objectType: r.objectType,
      objectId: r.objectId,
      chain: r.disposition.chain,
      nowMs,
    });
    attempted.push(outcome);
  }
  return { attempted, skipped };
};

// ─── CLI plumbing ────────────────────────────────────────────────────────────

const parseArgs = (argv) => {
  const opts = { write: false, local: false, adminParity: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--site') {
      opts.site = argv[i + 1];
      i += 1;
    } else if (arg === '--write') {
      opts.write = true;
    } else if (arg === '--dry-run') {
      opts.write = false;
    } else if (arg === '--local') {
      opts.local = true;
    } else if (arg === '--admin-parity') {
      opts.adminParity = true;
    }
  }
  return opts;
};

/**
 * The `--admin-parity` mode: audit (always) + the automatable fixes
 * (`--write`). Pure disk — no store, no network — so it is safe to run in CI
 * and on any checkout. Returns the audit's gap count AFTER any write, so the
 * exit code reflects the state the tree was left in.
 */
export const runAdminParity = (siteDirArg, { write = false, log = console.log } = {}) => {
  const { target, fixes } = planAdminParityFixes(siteDirArg, { write });
  if (fixes.length === 0) {
    log(`[migrate-site] --admin-parity: ${target.label} — nothing automatable to fix.`);
  } else {
    log(
      `[migrate-site] --admin-parity: ${target.label} — ${write ? 'applied' : 'would apply'} ${fixes.length} fix(es):`
    );
    for (const fix of fixes) log(`  ${write ? '+' : '~'} [${fix.id}] ${fix.action}  (${fix.path})`);
    if (!write) log('[migrate-site] re-run with --write to apply.');
  }
  const checks = computeAdminParity(resolveAuditTarget(siteDirArg));
  log('');
  log(renderParityReport(target.label, checks));
  return { fixes, checks, gaps: checks.filter((c) => c.status === 'GAP').length };
};

export const main = async (argv) => {
  const opts = parseArgs(argv);
  if (!opts.site) {
    console.error('[migrate-site] --site <path> is required (e.g. --site sites/acme)');
    process.exitCode = 2;
    return;
  }
  const siteDir = path.isAbsolute(opts.site) ? opts.site : path.join(repoRoot, opts.site);

  if (opts.adminParity) {
    // Admin parity is a wiring pass, deliberately independent of the schema
    // scan: it must work on a site whose data/site tree is empty or absent
    // (exactly the older-scaffold case it exists for).
    const { gaps, fixes } = runAdminParity(siteDir, { write: opts.write });
    // Dry-run exits 1 while automatable fixes are pending, so CI can gate on
    // it; after --write only non-automatable gaps (if any) keep it red.
    process.exitCode = gaps === 0 && (opts.write || fixes.length === 0) ? 0 : 1;
    return;
  }

  const report = buildDryRunReport(siteDir);
  console.log(renderReport(report));

  if (!opts.write) {
    process.exitCode = report.gatePasses ? 0 : 1;
    return;
  }

  const migratableWritable = report.results.filter(
    (r) => r.disposition.disposition === 'migratable' && r.disposition.writable
  );
  if (migratableWritable.length === 0) {
    console.log('[migrate-site] --write: nothing migratable+writable — nothing to do.');
    process.exitCode = report.gatePasses ? 0 : 1;
    return;
  }
  if (!opts.local) {
    console.error(
      '[migrate-site] --write requires a store target: pass --local for a scratch local-file-backed run, or wire ' +
        'real Netlify Blobs credentials in-process (this CLI has no --netlify-token path — a live production ' +
        "migration is a per-migration, human-decided act per the T11.9 brief's non-goals; run it from an " +
        'environment already holding those credentials).'
    );
    process.exitCode = 2;
    return;
  }
  console.error(
    '[migrate-site] --write --local: no local store wired into the CLI entrypoint yet — this path is exercised by ' +
      'migrate-site.test.ts against an in-memory store; wire a real local-blob-backed store here when a real ' +
      'migration ships.'
  );
  process.exitCode = 2;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[migrate-site] FAILED: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
