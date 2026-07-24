/**
 * Function name: Admin_Agent_Chat_Run (T9.13) — Netlify BACKGROUND function
 * (`-background` suffix: 202 to the caller, 15-minute budget).
 *
 * One hop of the agent loop. Authorization is the one-shot trigger token
 * minted into the chat doc by send/approve/deny — consumed on start, so
 * replays and forged POSTs are inert (T9.12 mechanic). The provider adapter
 * comes from the RUN's stamped profile (provider/model never hardcoded);
 * writes execute under the run's HUMAN principal with freshly-resolved roles.
 */
import '../../src/config/policy-bindings.js'; // W11: register site policy/identity providers before core server use
import { getHeader } from '../../packages/core/server/lib/admin-auth.js';
import type { ArtifactIndexStore } from '../../packages/core/server/lib/artifact-index.js';
import { getArtifactIndexBlobStore, getSiteObjectsBlobStore } from '../../packages/core/server/lib/blob-store.js';
import { getGovernanceBlobStore } from '../../packages/core/server/lib/governance-store.js';
import type { ObjectVerbStore } from '../../packages/core/server/lib/object-verbs.js';
import { resolveRolesForPrincipalAsync } from '../../packages/core/server/lib/roles.js';
import { getUsersBlobStore, getUserRecord } from '../../packages/core/server/lib/users-store.js';
import { getAgentChatBlobStore, loadChatDoc } from '../../packages/core/server/lib/agent/chat-store.js';
import { buildToolContext } from '../../packages/core/server/lib/agent/context.js';
import { runAgentLoop } from '../../packages/core/server/lib/agent/loop.js';
import { adapterForProfile } from '../../packages/core/server/lib/agent/provider.js';
import { z } from 'zod';

type LambdaEvent = {
  httpMethod?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
};
type LambdaContext = { getRemainingTimeInMillis?: () => number };

const bodySchema = z.object({ chat_id: z.string().min(1), trigger_token: z.string().min(1) });

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!getHeader(event.headers, 'content-type').includes('application/json')) {
    return { statusCode: 415, body: 'application/json required' };
  }
  let parsed: z.infer<typeof bodySchema>;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
    parsed = bodySchema.parse(JSON.parse(raw));
  } catch {
    return { statusCode: 400, body: 'Invalid body' };
  }

  const chatStore = await getAgentChatBlobStore(event);
  const doc = await loadChatDoc(chatStore, parsed.chat_id);
  if (!doc?.run) return { statusCode: 404, body: 'chat not found' };

  const principal = doc.run.principal;
  const roles = await resolveRolesForPrincipalAsync(principal, {
    getUserRecord: async (email) => getUserRecord(await getUsersBlobStore(event), email),
  });
  const toolContext = buildToolContext({
    objectStore: (await getSiteObjectsBlobStore(event)) as unknown as ObjectVerbStore,
    governanceStore: await getGovernanceBlobStore(event),
    artifactIndexStore: (await getArtifactIndexBlobStore(event).catch(() => undefined)) as unknown as
      | ArtifactIndexStore
      | undefined,
    principal,
    roles,
  });

  const result = await runAgentLoop(
    {
      chatStore,
      toolContext,
      adapter: adapterForProfile(doc.run.profile),
      ...(context?.getRemainingTimeInMillis ? { remainingMs: () => context.getRemainingTimeInMillis!() } : {}),
    },
    parsed.chat_id,
    parsed.trigger_token
  );
  console.info('agent chat hop finished', { chat_id: parsed.chat_id, ...result });
  return { statusCode: result.ok ? 200 : 409, body: JSON.stringify(result) };
};
