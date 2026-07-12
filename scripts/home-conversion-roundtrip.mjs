#!/usr/bin/env node
/**
 * Object-conversion round-trip driver — the STANDING proof that an object
 * family is agent-editable end-to-end via MCP (conversion criteria 2 + 3,
 * docs/cms-architecture/conversion-playbook.md). Replaces the throwaway
 * per-session driver scripts called out in object-inventory.md "Why only nav
 * is converted" (root cause 4: no standing round-trip verification).
 *
 * The family comes from a SEED MODULE (--seeds, default the home-page family
 * in scripts/lib/page-home-seed-data.mjs). A seed module exports:
 *   CONVERSION_SEEDS  ordered array of { objectType: 'page'|'section'|'template',
 *                     objectId, body } — every referenced object BEFORE the
 *                     object that references it;
 *   SEED_SITE         the owning site id (e.g. 'site_drlurie').
 * (The home module's PAGE_HOME_SEEDS / PAGE_HOME_SEED_SITE names are accepted
 * as a fallback.) The driver drills page, section, template, taxonomy, and
 * site/product types — extend drillOps/reconcileOps/materialize dispatch when another
 * type's family converts. Template families additionally get an instantiate proof: an
 * object_instantiate_template dry_run per template (W2.5), which builds and
 * validates the would-be page WITHOUT persisting — so production runs leave no
 * probe pages behind.
 *
 * For every object in the family it drives, through the REAL MCP handler:
 *
 *   1. ensure   — object_get; object_create when missing; when present with a
 *                 drifted body, reconcile back to the seed with real patch ops
 *                 (scripts/lib/roundtrip-reconcile.mjs — this is how the
 *                 broken production page_home record was healed). An object
 *                 that fails ensure is NEVER drilled or published.
 *   2. drill    — checkout → one batch exercising EVERY patch op the contract
 *                 permits for the type (page: set_page_meta, upsert_section,
 *                 update_section_data, move_section, set_section_visibility,
 *                 remove_section; section: upsert_section, update_section_data,
 *                 set_section_visibility), ending byte-identical to the seed →
 *                 object_validate (zero blockers) → object_publish →
 *                 object_checkin.
 *   3. contract — object_contract must advertise exactly the ops the drill
 *                 exercised (criterion 4: no permitted action without a tool).
 *   4. inventory— object_inventory must return every object (criterion 2).
 *
 * Modes:
 *   --seeds <path>  Seed module for the family under conversion (relative to
 *                 the repo root or absolute). Default: the home-page family.
 *   --local       (default) Drive the compiled handler in-process against an
 *                 isolated file-backed store (.tmp/home-roundtrip-blobs).
 *                 Compile first: rm -rf .tmp/ci-test && npx tsc -p tsconfig.test.json
 *                 Publish is EXPECTED to block at export_commit_failed /
 *                 not_configured — that is the sandbox success signal
 *                 (playbook trap 8). Reference targets (the three navigation
 *                 objects) are seeded from their committed exports first
 *                 (playbook trap 3); add further reference targets to the seed
 *                 module itself, ordered before their referrers.
 *   --write-exports  (local only) After the drill, materialize each object
 *                 with the real materializers and write the derived exports
 *                 into src/data/site/ — the committed-export half of the
 *                 conversion.
 *   --production  Drive the DEPLOYED MCP endpoint over HTTPS. Requires:
 *                   MCP_ENDPOINT     (default https://drluriescience.netlify.app/.netlify/functions/mcp)
 *                   PUBLISH_SECRET   (sent as x-publish-key; keep server-side)
 *                   MCP_HTTP_AUTH_TOKEN (if the endpoint sets one; sent as Bearer)
 *                 Publish must SUCCEED here (the server commits exports via
 *                 its own GITHUB_CONTENT_TOKEN). Run from a machine that holds
 *                 the secrets — never paste them into chats or commit them.
 *                 ⚠ Only run after the schema/code the seeds rely on is MERGED
 *                 AND DEPLOYED — the endpoint validates against what is live
 *                 (the seed scripts' schema-vintage gate, generalized).
 *   --release     (production only) After the family publishes, fire the
 *                 build hook once, then confirm with short read-only polls.
 *   --verify-only Prove the family still round-trips (ensure + every permitted
 *                 op + validate + contract + inventory) but NEVER publish or
 *                 release — for re-checking already-converted objects with no
 *                 export churn and no build minutes. Works with --local or
 *                 --production; incompatible with --release.
 *
 * Exit codes: 0 = every step proven; 1 = any failure (the report says which);
 * 2 = usage error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { reconcileOps } from './lib/roundtrip-reconcile.mjs';
import { drillOpsForSeed } from './lib/roundtrip-drill.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const args = new Set();
let seedsPathArg;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--seeds') {
    seedsPathArg = argv[i + 1];
    i += 1;
  } else {
    args.add(argv[i]);
  }
}
const seedsPath = seedsPathArg
  ? path.resolve(repoRoot, seedsPathArg)
  : path.join(repoRoot, 'scripts', 'lib', 'page-home-seed-data.mjs');
if (!fs.existsSync(seedsPath)) {
  console.error(`[roundtrip] seed module not found: ${seedsPath}`);
  process.exit(2);
}
const seedModule = await import(pathToFileURL(seedsPath).href);
const PAGE_HOME_SEEDS = seedModule.CONVERSION_SEEDS ?? seedModule.PAGE_HOME_SEEDS;
const PAGE_HOME_SEED_SITE = seedModule.SEED_SITE ?? seedModule.PAGE_HOME_SEED_SITE;
if (!Array.isArray(PAGE_HOME_SEEDS) || PAGE_HOME_SEEDS.length === 0 || !PAGE_HOME_SEED_SITE) {
  console.error(`[roundtrip] ${seedsPath} must export CONVERSION_SEEDS (non-empty array) and SEED_SITE.`);
  process.exit(2);
}
const SUPPORTED_SEED_TYPES = new Set(['page', 'section', 'template', 'taxonomy', 'site', 'product']);
const unsupported = PAGE_HOME_SEEDS.filter((seed) => !SUPPORTED_SEED_TYPES.has(seed.objectType));
if (unsupported.length > 0) {
  console.error(
    `[roundtrip] the driver drills page/section/template/taxonomy/site/product objects only; extend drillOps for: ${unsupported
      .map((seed) => `${seed.objectId} (${seed.objectType})`)
      .join(', ')}`
  );
  process.exit(2);
}
const production = args.has('--production');
const writeExports = args.has('--write-exports');
const release = args.has('--release');
// --verify-only: prove the family still round-trips (ensure + every permitted op
// + validate + contract + inventory) WITHOUT publishing or releasing — for
// re-checking already-converted objects with no export churn and no build
// minutes. It still exercises real ops, so it bumps content_revision.
const verifyOnly = args.has('--verify-only');
const AGENT_NAME = 'object-conversion-roundtrip';

if (writeExports && production) {
  console.error('[roundtrip] --write-exports is a local-mode flag; a production publish commits exports itself.');
  process.exit(2);
}
if (release && !production) {
  console.error('[roundtrip] --release only makes sense with --production.');
  process.exit(2);
}
if (verifyOnly && release) {
  console.error('[roundtrip] --verify-only cannot be combined with --release (release needs published objects).');
  process.exit(2);
}

// ─── The MCP call layer: one JSON-RPC shape, two transports ─────────────────

let rpcId = 0;
let callTool;
let compiledRoot; // set in local mode; used for the materializers

if (production) {
  const endpoint = process.env.MCP_ENDPOINT || 'https://drluriescience.netlify.app/.netlify/functions/mcp';
  const publishSecret = process.env.PUBLISH_SECRET;
  if (!publishSecret) {
    console.error('[roundtrip] PUBLISH_SECRET is required with --production. Keep it server-side only.');
    process.exit(2);
  }
  const headers = {
    'Content-Type': 'application/json',
    'x-publish-key': publishSecret,
    ...(process.env.MCP_HTTP_AUTH_TOKEN
      ? {
          authorization: `Bearer ${process.env.MCP_HTTP_AUTH_TOKEN}`,
          'x-mcp-auth-token': process.env.MCP_HTTP_AUTH_TOKEN,
        }
      : {}),
  };
  callTool = async (name, toolArgs) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: (rpcId += 1),
        method: 'tools/call',
        params: { name, arguments: { agent_name: AGENT_NAME, ...toolArgs } },
      }),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${name}: non-JSON response (${response.status}): ${text.slice(0, 400)}`);
    }
    if (parsed.error) throw new Error(`${name}: rpc error ${JSON.stringify(parsed.error)}`);
    return parsed.result ?? {};
  };
} else {
  // Local mode: the compiled handler + isolated file-backed store (playbook driver).
  compiledRoot = path.join(repoRoot, '.tmp', 'ci-test');
  const handlerPath = path.join(compiledRoot, 'netlify', 'functions', 'mcp.js');
  if (!fs.existsSync(handlerPath)) {
    console.error('[roundtrip] compiled handler missing. Run first:');
    console.error('  rm -rf .tmp/ci-test && npx tsc -p tsconfig.test.json');
    process.exit(2);
  }
  for (const key of [
    'NETLIFY',
    'NETLIFY_SITE_ID',
    'NETLIFY_BLOBS_TOKEN',
    'NETLIFY_AUTH_TOKEN',
    'SITE_ID',
    'MCP_HTTP_AUTH_TOKEN',
  ]) {
    delete process.env[key];
  }
  process.env.PUBLISH_SECRET = 'local-roundtrip-secret';
  const { handler } = await import(handlerPath);
  const { setLocalBlobsRootForTesting } = await import(path.join(compiledRoot, 'netlify', 'lib', 'local-blobs.js'));
  const blobsRoot = path.join(repoRoot, '.tmp', 'home-roundtrip-blobs');
  fs.rmSync(blobsRoot, { recursive: true, force: true });
  setLocalBlobsRootForTesting(blobsRoot);
  callTool = async (name, toolArgs) => {
    const response = await handler({
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: (rpcId += 1),
        method: 'tools/call',
        params: { name, arguments: { agent_name: AGENT_NAME, ...toolArgs } },
      }),
    });
    const parsed = JSON.parse(response.body);
    if (parsed.error) throw new Error(`${name}: rpc error ${JSON.stringify(parsed.error)}`);
    return parsed.result ?? {};
  };
}

const structured = (result) => result.structuredContent ?? {};
const isToolError = (result) => Boolean(result.isError);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const stableStringify = (value) => {
  const sort = (node) => {
    if (Array.isArray(node)) return node.map(sort);
    if (node && typeof node === 'object')
      return Object.fromEntries(
        Object.keys(node)
          .sort()
          .map((key) => [key, sort(node[key])])
      );
    return node;
  };
  return JSON.stringify(sort(value));
};
const sameBody = (a, b) => stableStringify(a) === stableStringify(b);

const failures = [];
const step = (label, ok, detail = '') => {
  const mark = ok ? 'ok  ' : 'FAIL';
  console.info(`[roundtrip] ${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ''}`);
  return ok;
};

const getRecord = async (objectType, objectId) => {
  const result = await callTool('object_get', { object_type: objectType, object_id: objectId });
  if (isToolError(result)) return undefined;
  return structured(result).record;
};

// ─── Local mode: seed the navigation reference targets (playbook trap 3) ─────

const stripGenerated = (exported) => {
  const body = { ...exported };
  delete body.__generated;
  return body;
};

if (!production) {
  for (const navId of ['nav_header', 'nav_footer', 'nav_footer_home']) {
    const exportPath = path.join(repoRoot, 'src', 'data', 'site', 'navigation', `${navId}.json`);
    const body = stripGenerated(JSON.parse(fs.readFileSync(exportPath, 'utf8')));
    const result = await callTool('object_create', {
      object_type: 'navigation',
      site: PAGE_HOME_SEED_SITE,
      requested_id: navId,
      body,
    });
    step(
      `seed reference target ${navId}`,
      !isToolError(result),
      isToolError(result) ? JSON.stringify(structured(result)) : ''
    );
  }
}

// ─── ensure: create-or-reconcile each object to its seed body ────────────────
// Reconcile-op construction lives in scripts/lib/roundtrip-reconcile.mjs
// (unit-tested; encodes playbook trap 2 — deep-merge strays must be nulled).

const withLock = async (objectType, objectId, run) => {
  const checkout = await callTool('object_checkout', { object_type: objectType, object_id: objectId });
  if (isToolError(checkout)) throw new Error(`checkout ${objectId}: ${JSON.stringify(structured(checkout))}`);
  const { lockToken, record_version } = structured(checkout);
  try {
    return await run(lockToken, record_version);
  } finally {
    const checkin = await callTool('object_checkin', {
      object_type: objectType,
      object_id: objectId,
      lock_token: lockToken,
    });
    if (isToolError(checkin)) console.warn(`[roundtrip] warn: checkin ${objectId} failed (lease will expire).`);
  }
};

const ensureFailed = new Set();

for (const seed of PAGE_HOME_SEEDS) {
  const existing = await getRecord(seed.objectType, seed.objectId);
  if (!existing) {
    const created = await callTool('object_create', {
      object_type: seed.objectType,
      site: PAGE_HOME_SEED_SITE,
      requested_id: seed.objectId,
      body: seed.body,
    });
    if (
      !step(
        `ensure ${seed.objectId}: created`,
        !isToolError(created),
        isToolError(created) ? JSON.stringify(structured(created)) : ''
      )
    ) {
      ensureFailed.add(seed.objectId);
    }
    continue;
  }
  if (sameBody(existing.body, seed.body)) {
    step(`ensure ${seed.objectId}: already matches the seed`, true, `version ${existing.version}`);
    continue;
  }
  // Drifted (e.g. the broken production page_home record): reconcile with real ops.
  const ops = reconcileOps(seed, existing.body);
  const reconciled = await withLock(seed.objectType, seed.objectId, async (lockToken, recordVersion) => {
    const patched = await callTool('object_patch', {
      object_type: seed.objectType,
      object_id: seed.objectId,
      lock_token: lockToken,
      expected_record_version: recordVersion,
      ops,
    });
    if (isToolError(patched)) return `patch failed: ${JSON.stringify(structured(patched))}`;
    const after = await getRecord(seed.objectType, seed.objectId);
    return sameBody(after?.body, seed.body) ? true : 'reconciled body still differs from the seed';
  });
  if (
    !step(
      `ensure ${seed.objectId}: reconciled drifted body (${ops.length} ops)`,
      reconciled === true,
      reconciled === true ? '' : reconciled
    )
  ) {
    ensureFailed.add(seed.objectId);
  }
}

// ─── drill: exercise EVERY permitted op, end byte-identical, publish ─────────
// Drill-op construction (type-generic probe field, cloned-inline-section page
// probe, collision-free probe id, original-visibility restore) lives in
// scripts/lib/roundtrip-drill.mjs — unit-tested and safe for strict per-type
// schemas, not just the home family's shapes.

const publishOutcome = async (seed, lockToken) => {
  const published = await callTool('object_publish', {
    object_type: seed.objectType,
    object_id: seed.objectId,
    lock_token: lockToken,
  });
  const payload = structured(published);
  if (!isToolError(published)) return { ok: true, detail: 'published' };
  const text = JSON.stringify(payload);
  // Sandbox boundary (playbook trap 8): everything through validate→materialize
  // ran; only the production git commit needs credentials. Expected locally.
  if (!production && text.includes('export_commit_failed')) {
    return { ok: true, detail: 'blocked at export_commit_failed — the expected sandbox boundary' };
  }
  // Review-gated types (product, shop-plan §0.4): an agent-executed publish is
  // DENIED until a human approves — that denial is the drill's expected
  // terminal signal, in the sandbox AND in production. The human approves in
  // /admin/objects and the approved publish is re-executed; the driver must
  // never work around the gate.
  if (text.includes('approval_required')) {
    return {
      ok: true,
      detail: 'blocked at approval_required — the review-required gate; a human approves in /admin/objects',
    };
  }
  return { ok: false, detail: text };
};

const exercisedByType = new Map();

for (const seed of PAGE_HOME_SEEDS) {
  if (ensureFailed.has(seed.objectId)) {
    // Never drill/publish a record we could not bring to its intended body —
    // publishing propagates the wrong content to the exports and the site.
    step(`drill ${seed.objectId}`, false, 'skipped — ensure failed, refusing to publish a wrong body');
    continue;
  }
  const before = await getRecord(seed.objectType, seed.objectId);
  let drill;
  try {
    drill = drillOpsForSeed(seed);
  } catch (error) {
    step(`drill ${seed.objectId}`, false, error.message);
    continue;
  }
  const { expected, ops } = drill;
  // UNION per type: a mixed family (e.g. fixed + pwyw + free products) may
  // legally exercise different op subsets per seed; the contract check needs
  // the family-wide union.
  exercisedByType.set(seed.objectType, [...new Set([...(exercisedByType.get(seed.objectType) ?? []), ...expected])]);

  const result = await withLock(seed.objectType, seed.objectId, async (lockToken, recordVersion) => {
    const patched = await callTool('object_patch', {
      object_type: seed.objectType,
      object_id: seed.objectId,
      lock_token: lockToken,
      expected_record_version: recordVersion,
      ops,
    });
    if (isToolError(patched)) return `drill patch failed: ${JSON.stringify(structured(patched))}`;

    const after = await getRecord(seed.objectType, seed.objectId);
    if (!sameBody(after?.body, before?.body)) return 'drill did not restore the body byte-identically';

    const validated = await callTool('object_validate', {
      object_type: seed.objectType,
      object_id: seed.objectId,
      candidate_patch: [],
    });
    const summary = structured(validated).summary;
    if (isToolError(validated) || !summary || summary.eligible !== true) {
      return `validate reported blockers: ${JSON.stringify(summary?.blockers ?? structured(validated))}`;
    }

    if (verifyOnly) {
      console.info(`[roundtrip]      ${seed.objectId}: verify-only — round-trip proven, publish skipped`);
      return true;
    }
    const publish = await publishOutcome(seed, lockToken);
    if (!publish.ok) return `publish failed: ${publish.detail}`;
    console.info(`[roundtrip]      ${seed.objectId}: ${publish.detail}`);
    return true;
  });
  step(
    `drill ${seed.objectId}: every permitted op (${expected.join(', ')}) + validate${verifyOnly ? ' (verify-only, no publish)' : ' + publish'}`,
    result === true,
    result === true ? '' : result
  );
}

// ─── instantiate proof (templates only): recipe → valid page, dry-run ────────
// Instantiation is a VERB, not a patch op, so the drill above cannot cover it.
// dry_run builds the would-be page, validates it through the full create
// pipeline, and persists NOTHING — safe against production (no probe pages).

for (const seed of PAGE_HOME_SEEDS) {
  if (seed.objectType !== 'template') continue;
  if (ensureFailed.has(seed.objectId)) {
    step(`instantiate ${seed.objectId} (dry_run)`, false, 'skipped — ensure failed');
    continue;
  }
  const result = await callTool('object_instantiate_template', {
    template_id: seed.objectId,
    site: PAGE_HOME_SEED_SITE,
    route: `/rt-instantiate-probe-${seed.objectId.replace(/^tpl_/, '')}`,
    title: 'Round-trip instantiate probe',
    dry_run: true,
  });
  const payload = structured(result);
  const eligible = payload?.summary?.eligible === true;
  const provenance = payload?.body?.template?.ref === seed.objectId;
  const requiredSlots = (seed.body.slots ?? []).filter((slot) => slot.required).length;
  const sectionCount = Array.isArray(payload?.body?.sections) ? payload.body.sections.length : 0;
  const filled = sectionCount >= requiredSlots;
  step(
    `instantiate ${seed.objectId}: dry_run builds a valid page (${sectionCount} section(s))`,
    !isToolError(result) && eligible && provenance && filled,
    isToolError(result)
      ? JSON.stringify(payload).slice(0, 300)
      : !eligible
        ? `validation blockers: ${JSON.stringify(payload?.summary?.blockers ?? payload).slice(0, 300)}`
        : !provenance
          ? 'body.template.ref does not point back at the template'
          : !filled
            ? `only ${sectionCount} section(s) for ${requiredSlots} required slot(s)`
            : ''
  );
}

// ─── contract: advertised ops === exercised ops (criterion 4) ────────────────

for (const [objectType, exercised] of exercisedByType) {
  const contract = structured(await callTool('object_contract', { object_type: objectType }));
  const advertised = (contract.patch_ops ?? contract.contract?.patch_ops ?? []).map((op) => op.op ?? op.name);
  const missingTool = advertised.filter((name) => !exercised.includes(name));
  const missingContract = exercised.filter((name) => !advertised.includes(name));
  step(
    `contract ${objectType}: advertised ops all exercised`,
    missingTool.length === 0 && missingContract.length === 0,
    missingTool.length || missingContract.length
      ? `advertised-but-not-exercised: [${missingTool}] exercised-but-not-advertised: [${missingContract}]`
      : `${advertised.length} ops`
  );
}

// ─── inventory: every object is store-backed (criterion 2) ───────────────────

const inventory = structured(await callTool('object_inventory', {}));
const inventoryIds = new Set((inventory.objects ?? []).map((entry) => entry.object_id ?? entry.id));
for (const seed of PAGE_HOME_SEEDS) {
  step(`inventory returns ${seed.objectId}`, inventoryIds.has(seed.objectId));
}

// ─── local mode: materialize the derived exports (playbook step 5) ───────────

if (writeExports) {
  const { materializePage } = await import(path.join(compiledRoot, 'netlify', 'lib', 'materializers', 'page.js'));
  const { materializeSection } = await import(path.join(compiledRoot, 'netlify', 'lib', 'materializers', 'section.js'));
  const { materializeTemplate } = await import(
    path.join(compiledRoot, 'netlify', 'lib', 'materializers', 'template.js')
  );
  const { materializeTaxonomy } = await import(
    path.join(compiledRoot, 'netlify', 'lib', 'materializers', 'taxonomy.js')
  );
  const { materializeSite } = await import(path.join(compiledRoot, 'netlify', 'lib', 'materializers', 'site.js'));
  const { materializeProduct } = await import(path.join(compiledRoot, 'netlify', 'lib', 'materializers', 'product.js'));
  const materializerByType = {
    page: materializePage,
    section: materializeSection,
    template: materializeTemplate,
    taxonomy: materializeTaxonomy,
    site: materializeSite,
    product: materializeProduct,
  };
  for (const seed of PAGE_HOME_SEEDS) {
    const record = await getRecord(seed.objectType, seed.objectId);
    const meta = { at: new Date().toISOString(), record_version: record.version };
    const file = materializerByType[seed.objectType](seed.objectId, record.body, meta);
    fs.mkdirSync(path.dirname(path.join(repoRoot, file.path)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, file.path), file.content);
    step(`materialize ${seed.objectId} → ${file.path}`, true, `record_version ${record.version}`);
  }
}

// ─── production release ──────────────────────────────────────────────────────
// One long release_to_production call gets killed by intermediary gateways
// ("Inactivity Timeout" 504 — hit for real on 2026-07-10) because the server
// polls deploy receipts for minutes. Instead: fire the build hook ONCE with a
// short server-side wait, then confirm with repeated short, read-only calls
// (force_build:false — never re-fires the hook), tolerating transient
// gateway/network errors between polls.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (release) {
  // Track whether the build hook has actually been fired. The initial call
  // fires it (force_build defaults true) — but if THAT call throws before the
  // server reaches the hook, no build was triggered and pure force_build:false
  // polls would wait forever. So a throw leaves hookFired=false and the first
  // poll re-fires the hook; every successful call sets hookFired=true so we
  // never fire a redundant second build.
  let hookFired = false;
  let releaseResult;
  try {
    releaseResult = structured(await callTool('release_to_production', { timeout_seconds: 15 }));
    hookFired = true;
  } catch (error) {
    console.warn(`[roundtrip] warn: release trigger call failed transiently (${error.message}); confirming by poll.`);
    releaseResult = {};
  }
  let released = releaseResult.released === true;
  const targetCommit = releaseResult.commit;
  const POLL_INTERVAL_MS = 20_000;
  const POLL_BUDGET_MS = 10 * 60_000;
  const deadline = Date.now() + POLL_BUDGET_MS;
  while (!released && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const poll = structured(
        await callTool('release_to_production', {
          force_build: !hookFired, // fire once if the initial call never confirmed a build
          timeout_seconds: 15,
          ...(targetCommit ? { commit: targetCommit } : {}),
        })
      );
      hookFired = true;
      releaseResult = poll;
      released = poll.released === true;
      console.info(`[roundtrip]      release poll: ${poll.status ?? JSON.stringify(poll).slice(0, 120)}`);
    } catch (error) {
      console.warn(`[roundtrip] warn: release poll failed transiently (${error.message}); retrying.`);
    }
  }
  step(
    'release_to_production',
    released,
    released
      ? `live at commit ${releaseResult.commit ?? targetCommit ?? '(unreported)'}`
      : `not confirmed within ${POLL_BUDGET_MS / 60000} min: ${JSON.stringify(releaseResult).slice(0, 300)} — check the Netlify deploys dashboard (Auto Publishing must be unlocked)`
  );
}

// ─── report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n[roundtrip] FAILED — ${failures.length} step(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.info(
  verifyOnly
    ? '\n[roundtrip] SUCCESS (verify-only) — every object round-trips every permitted op and validates clean; nothing was published or released.'
    : production
      ? '\n[roundtrip] SUCCESS — the object family is store-backed, round-trips every permitted op, and published.'
      : '\n[roundtrip] SUCCESS (local rehearsal) — the full lifecycle ran against the file-backed store; publish blocked only at the expected credential boundary. Run with --production from a credentialed machine to convert for real.'
);
