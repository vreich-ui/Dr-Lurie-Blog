#!/usr/bin/env node
/**
 * Home-page conversion round-trip driver — the STANDING proof that the
 * home-page object family is agent-editable end-to-end via MCP (conversion
 * criteria 2 + 3, docs/cms-architecture/conversion-playbook.md). Replaces the
 * throwaway per-session driver scripts called out in object-inventory.md
 * "Why only nav is converted" (root cause 4: no standing round-trip
 * verification).
 *
 * For every object in the family (scripts/lib/page-home-seed-data.mjs:
 * sec_newsletter_signup, sec_home_audience_grid, sec_home_start_grid,
 * page_home) it drives, through the REAL MCP handler:
 *
 *   1. ensure   — object_get; object_create when missing; when present with a
 *                 drifted body, reconcile back to the seed with real patch ops
 *                 (this is how the broken production page_home record heals).
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
 *   --local       (default) Drive the compiled handler in-process against an
 *                 isolated file-backed store (.tmp/home-roundtrip-blobs).
 *                 Compile first: rm -rf .tmp/ci-test && npx tsc -p tsconfig.test.json
 *                 Publish is EXPECTED to block at export_commit_failed /
 *                 not_configured — that is the sandbox success signal
 *                 (playbook trap 8). Reference targets (the three navigation
 *                 objects) are seeded from their committed exports first
 *                 (playbook trap 3).
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
 *   --release     (production only) After all four objects publish, call
 *                 release_to_production once and report the deploy state.
 *
 * Exit codes: 0 = every step proven; 1 = any failure (the report says which).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAGE_HOME_SEEDS, PAGE_HOME_SEED_SITE } from './lib/page-home-seed-data.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const production = args.has('--production');
const writeExports = args.has('--write-exports');
const release = args.has('--release');
const AGENT_NAME = 'home-conversion-roundtrip';

if (writeExports && production) {
  console.error('[roundtrip] --write-exports is a local-mode flag; a production publish commits exports itself.');
  process.exit(2);
}
if (release && !production) {
  console.error('[roundtrip] --release only makes sense with --production.');
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

const reconcileOps = (seed, currentBody) => {
  if (seed.objectType === 'section') {
    // The wrapper holds exactly one instance; upsert replaces it wholesale.
    return [{ op: 'upsert_section', section: seed.body.section }];
  }
  const target = seed.body;
  const current = currentBody ?? {};
  const currentSections = Array.isArray(current.sections) ? current.sections : [];
  const targetIds = new Set(target.sections.map((section) => section.id));
  const ops = [];
  // Meta first, so structure_home_footer sees the footer override immediately.
  const metaFields = {};
  for (const key of ['route', 'pageType', 'title', 'seo', 'navigationOverrides', 'template']) {
    if (target[key] !== undefined) metaFields[key] = target[key];
    else if (current[key] !== undefined) metaFields[key] = null; // delete stray meta
  }
  ops.push({ op: 'set_page_meta', fields: metaFields });
  target.sections.forEach((section, index) => {
    ops.push({ op: 'upsert_section', section, position: index });
  });
  for (const section of currentSections) {
    if (section && typeof section.id === 'string' && !targetIds.has(section.id)) {
      ops.push({ op: 'remove_section', section_id: section.id });
    }
  }
  // upsert leaves pre-existing sections in place — pin the final order explicitly.
  target.sections.forEach((section, index) => {
    ops.push({ op: 'move_section', section_id: section.id, to_index: index });
  });
  return ops;
};

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

for (const seed of PAGE_HOME_SEEDS) {
  const existing = await getRecord(seed.objectType, seed.objectId);
  if (!existing) {
    const created = await callTool('object_create', {
      object_type: seed.objectType,
      site: PAGE_HOME_SEED_SITE,
      requested_id: seed.objectId,
      body: seed.body,
    });
    step(
      `ensure ${seed.objectId}: created`,
      !isToolError(created),
      isToolError(created) ? JSON.stringify(structured(created)) : ''
    );
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
  step(
    `ensure ${seed.objectId}: reconciled drifted body (${ops.length} ops)`,
    reconciled === true,
    reconciled === true ? '' : reconciled
  );
}

// ─── drill: exercise EVERY permitted op, end byte-identical, publish ─────────

const PROBE_SECTION = {
  id: 's_rtprobe',
  type: 'hero',
  data: { heading: 'Round-trip probe — added and removed by the drill', actions: [] },
};

const drillOps = (seed) => {
  if (seed.objectType === 'page') {
    const sectionCount = seed.body.sections.length;
    return {
      expected: [
        'set_page_meta',
        'upsert_section',
        'update_section_data',
        'move_section',
        'set_section_visibility',
        'remove_section',
      ],
      ops: [
        { op: 'set_page_meta', fields: { title: `${seed.body.title} [probe]` } },
        { op: 'set_page_meta', fields: { title: seed.body.title } },
        { op: 'upsert_section', section: PROBE_SECTION, position: sectionCount },
        { op: 'update_section_data', section_id: PROBE_SECTION.id, fields: { kicker: 'probe' } },
        { op: 'set_section_visibility', section_id: PROBE_SECTION.id, visibility: 'hidden' },
        { op: 'move_section', section_id: PROBE_SECTION.id, to_index: 0 },
        { op: 'move_section', section_id: PROBE_SECTION.id, to_index: sectionCount },
        { op: 'remove_section', section_id: PROBE_SECTION.id },
      ],
    };
  }
  const instance = seed.body.section;
  const originalKicker = instance.data.kicker ?? null;
  return {
    expected: ['upsert_section', 'update_section_data', 'set_section_visibility'],
    ops: [
      { op: 'upsert_section', section: instance },
      { op: 'update_section_data', section_id: instance.id, fields: { kicker: 'probe' } },
      { op: 'update_section_data', section_id: instance.id, fields: { kicker: originalKicker } },
      { op: 'set_section_visibility', section_id: instance.id, visibility: 'hidden' },
      { op: 'set_section_visibility', section_id: instance.id, visibility: null },
    ],
  };
};

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
  return { ok: false, detail: text };
};

const exercisedByType = new Map();

for (const seed of PAGE_HOME_SEEDS) {
  const before = await getRecord(seed.objectType, seed.objectId);
  const { expected, ops } = drillOps(seed);
  exercisedByType.set(seed.objectType, expected);

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

    const publish = await publishOutcome(seed, lockToken);
    if (!publish.ok) return `publish failed: ${publish.detail}`;
    console.info(`[roundtrip]      ${seed.objectId}: ${publish.detail}`);
    return true;
  });
  step(
    `drill ${seed.objectId}: every permitted op (${expected.join(', ')}) + validate + publish`,
    result === true,
    result === true ? '' : result
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
  for (const seed of PAGE_HOME_SEEDS) {
    const record = await getRecord(seed.objectType, seed.objectId);
    const meta = { at: new Date().toISOString(), record_version: record.version };
    const file =
      seed.objectType === 'page'
        ? materializePage(seed.objectId, record.body, meta)
        : materializeSection(seed.objectId, record.body, meta);
    fs.writeFileSync(path.join(repoRoot, file.path), file.content);
    step(`materialize ${seed.objectId} → ${file.path}`, true, `record_version ${record.version}`);
  }
}

// ─── production release ──────────────────────────────────────────────────────

if (release) {
  const released = structured(await callTool('release_to_production', {}));
  step('release_to_production', released.released === true, JSON.stringify(released));
}

// ─── report ──────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n[roundtrip] FAILED — ${failures.length} step(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.info(
  production
    ? '\n[roundtrip] SUCCESS — the home-page object family is store-backed, round-trips every permitted op, and published.'
    : '\n[roundtrip] SUCCESS (local rehearsal) — the full lifecycle ran against the file-backed store; publish blocked only at the expected credential boundary. Run with --production from a credentialed machine to convert for real.'
);
