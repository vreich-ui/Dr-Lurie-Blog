/**
 * T9.12 SPIKE — THROWAWAY (deleted with the spike by T9.13).
 *
 * Local proof of the four spike mechanics against the in-memory store with a
 * scripted provider adapter — everything except deploy-level timing, which the
 * findings note defers to the T9.16 production drive:
 *   1. a provider turn drives the loop (adapter contract);
 *   2. the event log advances seq and serves since_seq slices;
 *   3. a read tool executes via handleObjectVerb without approval;
 *   4. an ask-gated write PAUSES the run across invocations, resumes on
 *      approve, executes under the run's HUMAN principal (object history
 *      attribution), and a forged/mismatched resume is rejected.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { handleObjectVerb, type ObjectVerbStore } from '../../netlify/lib/object-verbs.js';
import { objectRecordKey } from '../../netlify/lib/object-store-keys.js';
import {
  approveSpikeCall,
  denySpikeCall,
  loadSpikeChat,
  runSpikeLoop,
  spikeArgsHash,
  saveSpikeChat,
  startSpikeRun,
  type SpikeProviderAdapter,
} from '../../netlify/lib/spike-agent.js';
import type { ObjectRecord, Principal } from '../../src/schema/object-record-v1.js';

const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const HUMAN = { id: 'identity-wolf', email: 'wolf@example.com' };
const AGENT_SEED: Principal = { kind: 'agent', agent_name: 'seed', auth: 'publish_key' };

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
type Store = ReturnType<typeof createMemoryStore>;

const validPageBody = () => ({
  route: '/',
  pageType: 'home',
  title: 'Spike Page',
  seo: { description: 'Spike fixture.' },
  sections: [
    { id: 's_hero', type: 'hero', data: { heading: 'Before', actions: [] } },
    { id: 's_bio', type: 'bio', data: { heading: 'Bio', body: '<p>Biophysicist.</p>', trustNotes: ['PhD'] } },
  ],
});

const seedPage = async (store: Store): Promise<string> => {
  const res = await handleObjectVerb(
    store as unknown as ObjectVerbStore,
    { action: 'create', object_type: 'page', site: 'site_drlurie', body: validPageBody(), requested_id: 'page_spike' },
    AGENT_SEED,
    { nowMs: NOW }
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return 'page_spike';
};

/** Scripted adapter: returns each canned turn in order. */
const scriptedAdapter = (turns: Awaited<ReturnType<SpikeProviderAdapter>>[]): SpikeProviderAdapter => {
  let index = 0;
  return async () => {
    const turn = turns[index] ?? { toolCalls: [], outputTokens: 1, text: '(script exhausted)' };
    index += 1;
    return turn;
  };
};

const deps = (store: Store, adapter: SpikeProviderAdapter) => ({
  chatStore: store,
  objectStore: store as unknown as ObjectVerbStore,
  adapter,
  nowIso: () => new Date(NOW).toISOString(),
});

test('read tool auto-executes; run finishes; event log serves since_seq slices', async () => {
  const store = createMemoryStore();
  await seedPage(store);
  const adapter = scriptedAdapter([
    { toolCalls: [{ id: 'call_1', name: 'get_object', args: { object_type: 'page', object_id: 'page_spike' } }], outputTokens: 5 },
    { text: 'The page is titled "Spike Page".', toolCalls: [], outputTokens: 7 },
  ]);
  const d = deps(store, adapter);

  const send = await startSpikeRun(d, 'obj:page_spike', 'What is this page called?', HUMAN);
  assert.equal(send.status, 200);
  const hop = await runSpikeLoop(d, 'obj:page_spike', send.resume!.triggerToken);
  assert.equal(hop.ok, true);
  assert.equal(hop.status, 'idle');

  const doc = (await loadSpikeChat(store, 'obj:page_spike'))!;
  const types = doc.events.map((event) => event.type);
  assert.deepEqual(types, ['user_message', 'run_started', 'tool_call', 'tool_result', 'assistant_text', 'run_finished']);
  // since_seq slice: only events after the tool_result (seq 4).
  const tail = doc.events.filter((event) => event.seq > 4).map((event) => event.type);
  assert.deepEqual(tail, ['assistant_text', 'run_finished']);
  // usage accounting flowed from the adapter.
  assert.equal(doc.run!.output_tokens_used, 12);
});

test('ask-gated write pauses across invocations; approve resumes, writes under the HUMAN principal', async () => {
  const store = createMemoryStore();
  await seedPage(store);
  const writeCall = {
    id: 'call_w1',
    name: 'propose_patch',
    args: {
      object_type: 'page',
      object_id: 'page_spike',
      ops: [{ op: 'update_section_data', section_id: 's_hero', fields: { heading: 'After approval' } }],
    },
  };
  const adapter = scriptedAdapter([
    { text: 'I will update the hero heading.', toolCalls: [writeCall], outputTokens: 9 },
    { text: 'Done — the hero now reads "After approval".', toolCalls: [], outputTokens: 6 },
  ]);
  const d = deps(store, adapter);

  const send = await startSpikeRun(d, 'obj:page_spike', 'Change the hero heading.', HUMAN);
  const hop1 = await runSpikeLoop(d, 'obj:page_spike', send.resume!.triggerToken);
  assert.equal(hop1.status, 'awaiting_approval'); // ← the pause

  // The pause SURVIVES: state is only in the store; a fresh "invocation" reads it back.
  const paused = (await loadSpikeChat(store, 'obj:page_spike'))!;
  assert.equal(paused.status, 'awaiting_approval');
  assert.equal(paused.run!.pending!.call_id, 'call_w1');
  assert.equal(paused.run!.pending!.args_hash, spikeArgsHash(writeCall.args));
  // The consumed trigger token is gone — a replay of hop 1 is inert.
  const replay = await runSpikeLoop(d, 'obj:page_spike', send.resume!.triggerToken);
  assert.equal(replay.ok, false);

  // Approve → executes stored args → re-arms → hop 2 finishes the turn.
  const approve = await approveSpikeCall(d, 'obj:page_spike', 'call_w1', HUMAN);
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(approve.body.is_error, false);
  const hop2 = await runSpikeLoop(d, 'obj:page_spike', approve.resume!.triggerToken);
  assert.equal(hop2.status, 'idle');

  // The write LANDED, attributed to the human principal in object history.
  const record = JSON.parse(store.blobs.get(objectRecordKey('page', 'page_spike'))!) as ObjectRecord;
  const hero = (record.body as ReturnType<typeof validPageBody>).sections[0]!;
  assert.equal((hero.data as { heading: string }).heading, 'After approval');
  const patchEntry = record.history.find((entry) => entry.action === 'update_section_data');
  assert.ok(patchEntry, 'patch history entry exists');
  assert.deepEqual(patchEntry!.actor, { kind: 'human', ...HUMAN });
  // Lock cycle completed (checkin sets lock: undefined) — no live lock left behind.
  assert.equal(record.lock, undefined, 'lock released after the approved write');
});

test('forged resume is rejected: wrong call_id, tampered stored args, and non-pending state', async () => {
  const store = createMemoryStore();
  await seedPage(store);
  const writeCall = {
    id: 'call_w2',
    name: 'propose_patch',
    args: {
      object_type: 'page',
      object_id: 'page_spike',
      ops: [{ op: 'update_section_data', section_id: 's_hero', fields: { heading: 'Legit' } }],
    },
  };
  const adapter = scriptedAdapter([{ toolCalls: [writeCall], outputTokens: 3 }]);
  const d = deps(store, adapter);
  const send = await startSpikeRun(d, 'obj:page_spike', 'Edit it.', HUMAN);
  await runSpikeLoop(d, 'obj:page_spike', send.resume!.triggerToken);

  // (a) wrong call_id.
  const wrongId = await approveSpikeCall(d, 'obj:page_spike', 'call_FORGED', HUMAN);
  assert.equal(wrongId.status, 409);
  assert.equal(wrongId.body.code, 'forged_resume');

  // (b) stored args tampered without recomputing the hash → re-verification fails.
  const doc = (await loadSpikeChat(store, 'obj:page_spike'))!;
  (doc.run!.pending!.args.ops as Record<string, unknown>[])[0]!.fields = { heading: 'EVIL' };
  await saveSpikeChat(store, doc);
  const tampered = await approveSpikeCall(d, 'obj:page_spike', 'call_w2', HUMAN);
  assert.equal(tampered.status, 409);
  assert.equal(tampered.body.code, 'forged_resume');

  // Nothing was written either way.
  const record = JSON.parse(store.blobs.get(objectRecordKey('page', 'page_spike'))!) as ObjectRecord;
  const hero = (record.body as ReturnType<typeof validPageBody>).sections[0]!;
  assert.equal((hero.data as { heading: string }).heading, 'Before');

  // (c) after denial (state leaves awaiting_approval) an approve is a 409 too.
  const deny = await denySpikeCall(d, 'obj:page_spike', 'call_w2', HUMAN, 'not now');
  // pending was already invalidated by the tamper test? No — deny checks call_id against pending, which still matches.
  assert.equal(deny.status, 200);
  const late = await approveSpikeCall(d, 'obj:page_spike', 'call_w2', HUMAN);
  assert.equal(late.status, 409);
});

test('deny feeds a refusal tool-result back to the model and the run continues', async () => {
  const store = createMemoryStore();
  await seedPage(store);
  const writeCall = {
    id: 'call_w3',
    name: 'propose_patch',
    args: {
      object_type: 'page',
      object_id: 'page_spike',
      ops: [{ op: 'update_section_data', section_id: 's_hero', fields: { heading: 'Nope' } }],
    },
  };
  let sawDenialInTranscript = false;
  const adapter: SpikeProviderAdapter = async ({ transcript }) => {
    const last = transcript[transcript.length - 1];
    if (transcript.length === 1) return { toolCalls: [writeCall], outputTokens: 2 };
    if (last?.role === 'tool' && last.is_error && last.content.includes('denied')) sawDenialInTranscript = true;
    return { text: 'Understood, leaving it as is.', toolCalls: [], outputTokens: 2 };
  };
  const d = deps(store, adapter);
  const send = await startSpikeRun(d, 'obj:page_spike', 'Edit it.', HUMAN);
  await runSpikeLoop(d, 'obj:page_spike', send.resume!.triggerToken);
  const deny = await denySpikeCall(d, 'obj:page_spike', 'call_w3', HUMAN, 'wrong tone');
  assert.equal(deny.status, 200);
  const hop2 = await runSpikeLoop(d, 'obj:page_spike', deny.resume!.triggerToken);
  assert.equal(hop2.status, 'idle');
  assert.equal(sawDenialInTranscript, true);
  const record = JSON.parse(store.blobs.get(objectRecordKey('page', 'page_spike'))!) as ObjectRecord;
  const hero = (record.body as ReturnType<typeof validPageBody>).sections[0]!;
  assert.equal((hero.data as { heading: string }).heading, 'Before');
});
