/**
 * T9.12 SPIKE — THROWAWAY. Deleted by T9.13.
 *
 * Background half: Netlify runs `-background` functions with a 15-minute
 * budget and returns 202 to the caller immediately. Authorization is the
 * one-shot trigger token minted by spike-agent-chat (send/approve/deny) —
 * consumed on start, so replays and forged POSTs are inert.
 */
import { getNetlifyBlobStore, getSiteObjectsBlobStore } from '../lib/blob-store.js';
import type { ObjectVerbStore } from '../lib/object-verbs.js';
import { anthropicSpikeAdapter, runSpikeLoop, type SpikeChatStore } from '../lib/spike-agent.js';
import { z } from 'zod';

type LambdaEvent = {
  httpMethod?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
};

const bodySchema = z.object({ chat_id: z.string().min(1), trigger_token: z.string().min(1) });

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
    parsed = bodySchema.parse(JSON.parse(raw));
  } catch {
    return { statusCode: 400, body: 'Invalid body' };
  }

  const chatStore = (await getNetlifyBlobStore(
    { name: 'spike-agent-chats', consistency: 'strong' },
    event
  )) as unknown as SpikeChatStore;
  const objectStore = (await getSiteObjectsBlobStore(event)) as unknown as ObjectVerbStore;

  const result = await runSpikeLoop(
    { chatStore, objectStore, adapter: anthropicSpikeAdapter() },
    parsed.chat_id,
    parsed.trigger_token
  );
  console.info('spike run hop finished', { chat_id: parsed.chat_id, ...result });
  return { statusCode: result.ok ? 200 : 409, body: JSON.stringify(result) };
};
