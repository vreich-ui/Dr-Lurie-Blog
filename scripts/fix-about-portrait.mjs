#!/usr/bin/env node
/**
 * One-off heal (2026-07-11): sec_about_intro's portrait URL tripped Netlify's
 * secrets scanner and BLOCKED ALL PRODUCTION DEPLOYS.
 *
 * An agent set `portrait.src` to an images.weserv.nl proxy of
 * raw.githubusercontent.com/<repo>/... — that URL contains the repo slug,
 * which is the value of the secret-marked GITHUB_REPOSITORY env var, so the
 * post-build secrets scan fails every deploy (playbook trap 14). The fix goes
 * through the STORE (the export is derived — hand-editing it would be
 * clobbered by the next publish): one deep-merge patch of portrait.src, then
 * publish (server commits the corrected export) and release.
 *
 * Everything else the agent wrote on the section (heading/body/trustNotes,
 * record_version 25) is deliberately kept — this touches ONE field.
 *
 * Usage (credentialed machine):
 *   export PUBLISH_SECRET='…'
 *   node scripts/fix-about-portrait.mjs                # heal to the original site-asset portrait
 *   node scripts/fix-about-portrait.mjs <image-url>    # heal to a specific URL, e.g.
 *                                                      #   /images/dr-lurie-portrait4.jpeg
 *                                                      #   (only AFTER the PR shipping that file is live)
 *
 * Exit codes: 0 = healed + published + released; 1 = any step failed.
 */
import { createObjectStoreClient } from './lib/object-store-client.mjs';

const BASE_URL = process.env.MCP_BASE_URL || 'https://drluriescience.netlify.app';
const publishSecret = process.env.PUBLISH_SECRET;
if (!publishSecret) {
  console.error('[fix-portrait] PUBLISH_SECRET is required.');
  process.exit(1);
}
const targetSrc = process.argv[2] || 'https://kugelmedia.netlify.app/drlurieblog/dr-lurie-portrait.jpg';
if (/githubusercontent|weserv/.test(targetSrc)) {
  console.error('[fix-portrait] refusing: that URL family is exactly what broke the deploys.');
  process.exit(1);
}

const call = createObjectStoreClient({ baseUrl: BASE_URL, publishSecret, agentName: 'fix-about-portrait' });
const fail = (label, detail) => {
  console.error(`[fix-portrait] FAIL ${label}: ${JSON.stringify(detail).slice(0, 400)}`);
  process.exit(1);
};

const got = await call({ action: 'get', object_type: 'section', object_id: 'sec_about_intro' });
if (got.status !== 200) fail('get', got.body);
const currentSrc = got.body.record?.body?.section?.data?.portrait?.src;
console.info(`[fix-portrait] current portrait.src: ${currentSrc}`);
if (currentSrc === targetSrc) {
  console.info('[fix-portrait] already healed — skipping to release.');
} else {
  const checkout = await call({ action: 'checkout', object_type: 'section', object_id: 'sec_about_intro' });
  if (checkout.status !== 200) fail('checkout', checkout.body);
  const { lockToken, record_version } = checkout.body;

  const patched = await call({
    action: 'patch',
    object_type: 'section',
    object_id: 'sec_about_intro',
    lock_token: lockToken,
    expected_record_version: record_version,
    ops: [{ op: 'update_section_data', section_id: 's_intro', fields: { portrait: { src: targetSrc } } }],
  });
  if (patched.status !== 200) fail('patch', patched.body);
  console.info(`[fix-portrait] patched portrait.src → ${targetSrc}`);

  const published = await call({
    action: 'publish',
    object_type: 'section',
    object_id: 'sec_about_intro',
    lock_token: lockToken,
  });
  if (published.status !== 200) fail('publish (the corrected export must commit)', published.body);
  console.info('[fix-portrait] published — corrected export committed.');

  await call({ action: 'checkin', object_type: 'section', object_id: 'sec_about_intro', lock_token: lockToken });
}

// Release: fire the build hook once, then confirm with short read-only polls
// (the driver's proven pattern — one long call gets killed by gateways).
let rpcId = 0;
const mcpCall = async (name, args) => {
  const response = await fetch(`${BASE_URL}/.netlify/functions/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publish-key': publishSecret },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: (rpcId += 1),
      method: 'tools/call',
      params: { name, arguments: { agent_name: 'fix-about-portrait', ...args } },
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
  console.warn(`[fix-portrait] release trigger failed transiently (${error.message}); confirming by poll.`);
}
let released = releaseResult.released === true;
const deadline = Date.now() + 10 * 60_000;
while (!released && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  try {
    releaseResult = await mcpCall('release_to_production', { force_build: !hookFired, timeout_seconds: 15 });
    hookFired = true;
    released = releaseResult.released === true;
    console.info(`[fix-portrait] release poll: ${releaseResult.status}`);
  } catch (error) {
    console.warn(`[fix-portrait] release poll failed transiently (${error.message}); retrying.`);
  }
}
if (!released) fail('release', releaseResult);
console.info(
  `[fix-portrait] SUCCESS — released at commit ${releaseResult.commit ?? '(unreported)'}. Deploys unblocked.`
);
