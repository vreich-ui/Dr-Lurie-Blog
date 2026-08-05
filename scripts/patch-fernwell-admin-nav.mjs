#!/usr/bin/env node
/**
 * Fernwell's header nav is missing the admin-only nav group, so a signed-in
 * admin has no visible link into /admin (the route itself works fine).
 * Adds the standard admin group — same shape as site_platform's and
 * site_drlurie's `g_admin` — via one `upsert_group` patch op at position 1,
 * then publishes and releases to production.
 *
 * PRE-FLIGHT: before taking the lock, this script fetches the live
 * `nav_header` record and checks whether `g_admin` is already present
 * (scripts/lib/fernwell-admin-nav-patch.mjs). Idempotent: --execute skips
 * straight to the release step if the group already exists, rather than
 * re-patching or erroring.
 *
 * Usage (credentialed machine):
 *   export PUBLISH_SECRET='…'
 *   node scripts/patch-fernwell-admin-nav.mjs                # dry run
 *   node scripts/patch-fernwell-admin-nav.mjs --verify        # READ-ONLY:
 *       report whether nav_header currently has the admin group.
 *   node scripts/patch-fernwell-admin-nav.mjs --execute       # patch + publish + release
 *
 * Env: PUBLISH_SECRET (required for --execute/--verify), MCP_BASE_URL
 * (default https://kugel-fernwell.netlify.app).
 *
 * Exit codes: 0 = already-live or healed + published + released; 1 = any
 * step failed; 2 = PUBLISH_SECRET missing.
 */
import { createObjectStoreClient } from './lib/object-store-client.mjs';
import { NAV_HEADER_OBJECT_ID, FERNWELL_ADMIN_NAV_OPS, hasAdminGroup } from './lib/fernwell-admin-nav-patch.mjs';

const AGENT_NAME = 'fernwell-admin-nav-group';
const BASE_URL = process.env.MCP_BASE_URL || 'https://kugel-fernwell.netlify.app';

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const verify = args.has('--verify');

if (!execute && !verify) {
  console.info('[fernwell-admin-nav] Dry run. Op --execute would submit for nav_header:');
  console.log(JSON.stringify(FERNWELL_ADMIN_NAV_OPS, null, 2));
  console.info(
    '\n[fernwell-admin-nav] Re-run with --execute (PUBLISH_SECRET + MCP_BASE_URL set) to patch + publish + release,'
  );
  console.info('[fernwell-admin-nav] or --verify to read-only report whether nav_header already has g_admin.');
  process.exit(0);
}

const publishSecret = process.env.PUBLISH_SECRET;
if (!publishSecret) {
  console.error('[fernwell-admin-nav] PUBLISH_SECRET is required. Keep it server-side only.');
  process.exit(2);
}

const call = createObjectStoreClient({ baseUrl: BASE_URL, publishSecret, agentName: AGENT_NAME });
const fail = (label, detail) => {
  console.error(`[fernwell-admin-nav] FAIL ${label}: ${JSON.stringify(detail).slice(0, 400)}`);
  process.exit(1);
};

const got = await call({ action: 'get', object_type: 'navigation', object_id: NAV_HEADER_OBJECT_ID });
if (got.status !== 200) fail('get', got.body);
const record = got.body.record ?? {};
const already = hasAdminGroup(record.body);

if (verify) {
  console.info(
    `[fernwell-admin-nav] nav_header ${already ? 'ALREADY HAS' : 'is missing'} g_admin ` +
      `(version ${record.version}, content_revision ${record.content_revision}, lock ${record.lock ? 'HELD' : 'free'}).`
  );
  process.exit(0);
}

// ─── --execute ────────────────────────────────────────────────────────────

if (already) {
  console.info('[fernwell-admin-nav] g_admin already present — skipping patch, going straight to release.');
} else {
  const checkout = await call({ action: 'checkout', object_type: 'navigation', object_id: NAV_HEADER_OBJECT_ID });
  if (checkout.status !== 200) fail('checkout', checkout.body);
  const { lockToken, record_version } = checkout.body;

  const patched = await call({
    action: 'patch',
    object_type: 'navigation',
    object_id: NAV_HEADER_OBJECT_ID,
    lock_token: lockToken,
    expected_record_version: record_version,
    ops: FERNWELL_ADMIN_NAV_OPS,
  });
  if (patched.status !== 200) {
    await call({ action: 'checkin', object_type: 'navigation', object_id: NAV_HEADER_OBJECT_ID, lock_token: lockToken });
    fail('patch', patched.body);
  }
  console.info(
    `[fernwell-admin-nav] patched (version ${patched.body.version}, content_revision ${patched.body.content_revision}).`
  );

  const published = await call({
    action: 'publish',
    object_type: 'navigation',
    object_id: NAV_HEADER_OBJECT_ID,
    lock_token: lockToken,
  });
  if (published.status !== 200) fail('publish (the corrected export must commit)', published.body);
  console.info('[fernwell-admin-nav] published — export committed.');

  const checkin = await call({
    action: 'checkin',
    object_type: 'navigation',
    object_id: NAV_HEADER_OBJECT_ID,
    lock_token: lockToken,
  });
  if (checkin.status !== 200) fail('checkin', checkin.body);
}

// Release: fire the build hook once, then confirm with short read-only polls
// (the driver's proven pattern — one long call gets killed by gateways).
let rpcId = 0;
const mcpCall = async (name, callArgs) => {
  const response = await fetch(`${BASE_URL}/.netlify/functions/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publish-key': publishSecret },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: (rpcId += 1),
      method: 'tools/call',
      params: { name, arguments: { agent_name: AGENT_NAME, ...callArgs } },
    }),
  });
  const parsed = JSON.parse(await response.text());
  if (parsed.error) throw new Error(JSON.stringify(parsed.error));
  return parsed.result?.structuredContent ?? {};
};

let hookFired = false;
let releaseResult = {};
try {
  releaseResult = await mcpCall('release_to_production', { timeout_seconds: 15 });
  hookFired = true;
} catch (error) {
  console.warn(`[fernwell-admin-nav] release trigger failed transiently (${error.message}); confirming by poll.`);
}
let released = releaseResult.released === true;
const deadline = Date.now() + 10 * 60_000;
while (!released && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  try {
    releaseResult = await mcpCall('release_to_production', { force_build: !hookFired, timeout_seconds: 15 });
    hookFired = true;
    released = releaseResult.released === true;
    console.info(`[fernwell-admin-nav] release poll: ${releaseResult.status}`);
  } catch (error) {
    console.warn(`[fernwell-admin-nav] release poll failed transiently (${error.message}); retrying.`);
  }
}
if (!released) fail('release', releaseResult);
console.info(
  `[fernwell-admin-nav] SUCCESS — released at commit ${releaseResult.commit ?? '(unreported)'}. ` +
    'The Admin nav group is now live in the header for signed-in admins.'
);
