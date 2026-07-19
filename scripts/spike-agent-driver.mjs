#!/usr/bin/env node
/**
 * T9.12 SPIKE — THROWAWAY driver. Deleted by T9.13.
 *
 * Exercises the deployed spike endpoints end-to-end:
 *   send → poll (since_seq) → [approve when asked] → poll → idle.
 *
 * Usage:
 *   SPIKE_BASE_URL=https://<deploy>.netlify.app \
 *   SPIKE_IDENTITY_TOKEN=<netlify-identity-bearer> \
 *   node scripts/spike-agent-driver.mjs "Change the About hero heading to X" obj:page_about
 *
 * The identity token must belong to an ADMIN_EMAILS member (same wall as
 * admin-object). Requires the deploy to carry the spike functions.
 */
const base = process.env.SPIKE_BASE_URL;
const token = process.env.SPIKE_IDENTITY_TOKEN;
const text = process.argv[2] ?? 'What is the About page called?';
const chatId = process.argv[3] ?? 'obj:page_about';
if (!base || !token) {
  console.error('Set SPIKE_BASE_URL and SPIKE_IDENTITY_TOKEN.');
  process.exit(1);
}

const call = async (body) => {
  const res = await fetch(`${base}/.netlify/functions/spike-agent-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  console.log(`→ send "${text}" to ${chatId}`);
  const send = await call({ action: 'send', chat_id: chatId, text });
  console.log('send:', send.status, JSON.stringify(send.body));
  if (send.status !== 200) process.exit(1);

  let since = 0;
  const startedAt = Date.now();
  for (;;) {
    await sleep(1500);
    const poll = await call({ action: 'get_chat', chat_id: chatId, since_seq: since });
    if (poll.status !== 200) {
      console.error('poll failed:', poll.status, JSON.stringify(poll.body));
      process.exit(1);
    }
    for (const event of poll.body.events ?? []) {
      since = Math.max(since, event.seq);
      console.log(`  [${event.seq}] ${event.type}`, JSON.stringify(event.detail ?? {}));
      if (event.type === 'tool_approval_required') {
        const callId = event.detail?.call_id;
        console.log(`→ pausing 65s to prove the pause survives, then approving ${callId}`);
        await sleep(65_000); // acceptance: pause ≥ 60s
        const approve = await call({ action: 'approve_tool', chat_id: chatId, call_id: callId });
        console.log('approve:', approve.status, JSON.stringify(approve.body));
      }
    }
    if (poll.body.status === 'idle' || poll.body.status === 'error') {
      console.log(`✓ run reached ${poll.body.status} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
      break;
    }
    if (Date.now() - startedAt > 10 * 60_000) {
      console.error('driver timeout');
      process.exit(1);
    }
  }
};

await main();
