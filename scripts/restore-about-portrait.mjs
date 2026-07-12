/**
 * One-shot remediation: restore the /about bio portrait after the 2026-07-12
 * canvas incident, where an AI copy edit silently swapped `portrait.src` on
 * `sec_about_intro` for a hallucinated CDN URL and it was published/released,
 * breaking the About image.
 *
 * This sets the portrait back to the working local file via the normal object
 * lifecycle (checkout → patch → publish → release) against the DEPLOYED MCP
 * endpoint — the same path scripts/home-conversion-roundtrip.mjs uses. It only
 * touches `sec_about_intro`'s `portrait` field; everything else is unchanged
 * (update_section_data deep-merges, so `alt` is preserved and only `src` moves).
 *
 * Run from a credentialed machine:
 *   PUBLISH_SECRET=<the publish key> node scripts/restore-about-portrait.mjs
 * Optional env:
 *   MCP_ENDPOINT         (default https://drluriescience.netlify.app/.netlify/functions/mcp)
 *   MCP_HTTP_AUTH_TOKEN  (if the endpoint sets one; sent as Bearer)
 *   SKIP_RELEASE=1       (publish only — commit the export without deploying)
 *
 * Idempotent: if the portrait already points at the correct file it publishes
 * a no-op and exits 0.
 */

const OBJECT_TYPE = 'section';
const OBJECT_ID = 'sec_about_intro';
const SECTION_ID = 's_intro'; // the inner bio instance inside the shared section
const CORRECT_PORTRAIT = {
  alt: 'Portrait of Dr. Leonid Lurie',
  src: '/images/dr-lurie-portrait4.jpeg', // committed at public/images/dr-lurie-portrait4.jpeg
};

const AGENT_NAME = 'about-portrait-restore';
const endpoint = process.env.MCP_ENDPOINT || 'https://drluriescience.netlify.app/.netlify/functions/mcp';
const publishSecret = process.env.PUBLISH_SECRET;
if (!publishSecret) {
  console.error(
    'PUBLISH_SECRET is required. Keep it server-side only:\n  PUBLISH_SECRET=… node scripts/restore-about-portrait.mjs'
  );
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

let rpcId = 0;
const callTool = async (name, toolArgs) => {
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
const structured = (result) => result.structuredContent ?? {};
const isToolError = (result) => Boolean(result.isError);

const currentPortraitSrc = (record) => record?.body?.section?.data?.portrait?.src;

const main = async () => {
  const got = await callTool('object_get', { object_type: OBJECT_TYPE, object_id: OBJECT_ID });
  if (isToolError(got)) throw new Error(`object_get: ${JSON.stringify(structured(got))}`);
  const record = structured(got).record;
  if (!record) throw new Error('object_get returned no record');
  console.log(`current portrait.src = ${currentPortraitSrc(record)}`);
  if (currentPortraitSrc(record) === CORRECT_PORTRAIT.src) {
    console.log('Already correct — nothing to patch. (Publish/release below only if you re-run intentionally.)');
  }

  const checkout = await callTool('object_checkout', { object_type: OBJECT_TYPE, object_id: OBJECT_ID });
  if (isToolError(checkout)) throw new Error(`checkout: ${JSON.stringify(structured(checkout))}`);
  const { lockToken, record_version } = structured(checkout);
  console.log(`checked out (lock held, record_version ${record_version})`);

  try {
    const patched = await callTool('object_patch', {
      object_type: OBJECT_TYPE,
      object_id: OBJECT_ID,
      lock_token: lockToken,
      expected_record_version: record_version,
      ops: [{ op: 'update_section_data', section_id: SECTION_ID, fields: { portrait: CORRECT_PORTRAIT } }],
    });
    if (isToolError(patched)) throw new Error(`patch: ${JSON.stringify(structured(patched))}`);
    console.log('patched: portrait.src ->', CORRECT_PORTRAIT.src);

    const published = await callTool('object_publish', {
      object_type: OBJECT_TYPE,
      object_id: OBJECT_ID,
      lock_token: lockToken,
    });
    if (isToolError(published)) throw new Error(`publish: ${JSON.stringify(structured(published))}`);
    console.log('published (export committed with [skip netlify])');
  } finally {
    const checkin = await callTool('object_checkin', {
      object_type: OBJECT_TYPE,
      object_id: OBJECT_ID,
      lock_token: lockToken,
    });
    if (isToolError(checkin)) console.warn('warn: checkin failed (the lease will expire on its own).');
  }

  if (process.env.SKIP_RELEASE === '1') {
    console.log('SKIP_RELEASE=1 — publish only. Run release_to_production (or the admin "Release" button) to deploy.');
    return;
  }
  const released = await callTool('release_to_production', { timeout_seconds: 15 });
  const releaseInfo = structured(released);
  console.log('release_to_production ->', JSON.stringify(releaseInfo));
  console.log(
    releaseInfo.status === 'released'
      ? 'DONE — the About portrait is restored and live.'
      : 'Release did not confirm ready within the wait budget; re-check deploy_status (the build may still be running).'
  );
};

main().catch((error) => {
  console.error('RESTORE FAILED:', error.message);
  process.exit(1);
});
