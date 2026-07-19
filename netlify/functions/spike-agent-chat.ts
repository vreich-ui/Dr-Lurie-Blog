/**
 * T9.12 SPIKE — THROWAWAY. Deleted by T9.13.
 *
 * Interactive half of the spike: create/send/poll/approve/deny. Netlify
 * Identity (admin allowlist) auth — same wall as admin-object.ts. The
 * background half is spike-agent-run-background.ts, triggered by POST with a
 * one-shot token minted here.
 */
import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
import { getNetlifyBlobStore, getSiteObjectsBlobStore } from '../lib/blob-store.js';
import type { ObjectVerbStore } from '../lib/object-verbs.js';
import {
  approveSpikeCall,
  denySpikeCall,
  loadSpikeChat,
  startSpikeRun,
  type SpikeChatStore,
} from '../lib/spike-agent.js';
import { z } from 'zod';

type LambdaEvent = {
  httpMethod?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
};

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const jsonResponse = (status: number, body: Record<string, unknown>) => ({
  statusCode: status,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: status >= 200 && status < 300, status, ...body }),
});

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), chat_id: z.string().min(1), text: z.string().min(1) }),
  z.object({ action: z.literal('get_chat'), chat_id: z.string().min(1), since_seq: z.number().int().nonnegative().optional() }),
  z.object({ action: z.literal('approve_tool'), chat_id: z.string().min(1), call_id: z.string().min(1) }),
  z.object({
    action: z.literal('deny_tool'),
    chat_id: z.string().min(1),
    call_id: z.string().min(1),
    reason: z.string().optional(),
  }),
]);

const getSpikeChatStore = (event: unknown): Promise<SpikeChatStore> =>
  getNetlifyBlobStore({ name: 'spike-agent-chats', consistency: 'strong' }, event) as unknown as Promise<SpikeChatStore>;

/** Fire-and-forget trigger of the background hop. Failure leaves the doc queued. */
const triggerBackground = async (chatId: string, triggerToken: string): Promise<void> => {
  const base = process.env.URL;
  if (!base) return;
  try {
    await fetch(`${base}/.netlify/functions/spike-agent-run-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, trigger_token: triggerToken }),
    });
  } catch (error) {
    console.error('spike background trigger failed', error);
  }
};

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  const adminState = await getAdminStateFromEvent(event, context);
  if (!adminState.authenticated) return jsonResponse(401, { error: adminState.error ?? 'Unauthorized' });
  if (!adminState.isAdmin) return jsonResponse(403, { error: 'Admin access required' });

  let parsedBody: unknown;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
    parsedBody = JSON.parse(raw);
  } catch {
    return jsonResponse(400, { error: 'Invalid request body.' });
  }
  const request = requestSchema.safeParse(parsedBody);
  if (!request.success) return jsonResponse(400, { error: 'Invalid request fields.', issues: request.error.issues });

  const chatStore = await getSpikeChatStore(event);
  const objectStore = (await getSiteObjectsBlobStore(event)) as unknown as ObjectVerbStore;
  const deps = { chatStore, objectStore };
  const principal = { id: adminState.userId ?? '', email: adminState.email ?? '' };

  try {
    switch (request.data.action) {
      case 'send': {
        const result = await startSpikeRun(deps, request.data.chat_id, request.data.text, principal);
        if (result.resume) await triggerBackground(request.data.chat_id, result.resume.triggerToken);
        return jsonResponse(result.status, result.body);
      }
      case 'get_chat': {
        const doc = await loadSpikeChat(chatStore, request.data.chat_id);
        if (!doc) return jsonResponse(404, { error: 'chat not found' });
        const since = request.data.since_seq ?? 0;
        return jsonResponse(200, {
          chat_id: doc.chat_id,
          status: doc.status,
          seq: doc.seq,
          events: doc.events.filter((eventItem) => eventItem.seq > since),
        });
      }
      case 'approve_tool': {
        const result = await approveSpikeCall(deps, request.data.chat_id, request.data.call_id, principal);
        if (result.resume) await triggerBackground(request.data.chat_id, result.resume.triggerToken);
        return jsonResponse(result.status, result.body);
      }
      case 'deny_tool': {
        const result = await denySpikeCall(
          deps,
          request.data.chat_id,
          request.data.call_id,
          principal,
          request.data.reason
        );
        if (result.resume) await triggerBackground(request.data.chat_id, result.resume.triggerToken);
        return jsonResponse(result.status, result.body);
      }
    }
  } catch (error) {
    console.error('spike-agent-chat failed', error);
    return jsonResponse(500, { error: 'Spike chat request failed.' });
  }
};
