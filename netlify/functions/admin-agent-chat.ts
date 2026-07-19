/**
 * Function name: Admin_Agent_Chat (T9.13)
 * Required method: POST
 * Auth: Netlify Identity (admin allowlist) — the chat runtime's interactive
 *       half. Verbs: create_chat / list_chats / get_chat / send /
 *       approve_tool / deny_tool / cancel.
 *
 * `send` verifies identity, captures the human Principal into the run record
 * SERVER-SIDE, resolves the object's dedicated agent profile (object → type →
 * site default, plan §4a) and the frozen autonomy map (defaults + governance
 * chat_tools + profile overrides), stamps both into the run, and enqueues the
 * background hop with a one-shot trigger token. Approve executes the STORED
 * pending call (or a human-edited, re-validated variant) — client args are
 * never trusted on a plain resume.
 *
 * SECURITY INVARIANT (A§1.2): this identity path never reads or forwards the
 * publish key in any form.
 */
import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
import type { ArtifactIndexStore } from '../lib/artifact-index.js';
import { getArtifactIndexBlobStore, getSiteObjectsBlobStore } from '../lib/blob-store.js';
import { getGovernanceBlobStore, resolveActivePolicies } from '../lib/governance-store.js';
import type { ObjectVerbStore } from '../lib/object-verbs.js';
import { resolveRolesForPrincipalAsync } from '../lib/roles.js';
import { getUsersBlobStore, getUserRecord } from '../lib/users-store.js';
import { buildToolContext } from '../lib/agent/context.js';
import {
  approvePendingTool,
  cancelRun,
  denyPendingTool,
  startRun,
} from '../lib/agent/loop.js';
import {
  getAgentChatBlobStore,
  listChatDocs,
  loadChatDoc,
  mintFreeChatId,
  objectChatId,
  saveChatDoc,
  type ChatDoc,
} from '../lib/agent/chat-store.js';
import { getAgentProfilesBlobStore, getProfilesDoc, resolveProfile } from '../lib/agent/profiles.js';
import { resolveAutonomy, type ToolAutonomy } from '../lib/agent/tools.js';
import { objectTypeSchema, type Principal } from '../../src/schema/object-record-v1.js';
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
  z.object({
    action: z.literal('create_chat'),
    kind: z.enum(['object', 'free']),
    object_type: objectTypeSchema.optional(),
    object_id: z.string().min(1).optional(),
    title: z.string().min(1).max(200).optional(),
  }),
  z.object({ action: z.literal('list_chats') }),
  z.object({
    action: z.literal('get_chat'),
    chat_id: z.string().min(1),
    since_seq: z.number().int().nonnegative().optional(),
  }),
  z.object({ action: z.literal('send'), chat_id: z.string().min(1), text: z.string().min(1).max(20_000) }),
  z.object({
    action: z.literal('approve_tool'),
    chat_id: z.string().min(1),
    call_id: z.string().min(1),
    /** Edit-and-approve: HUMAN-edited args, re-validated against the tool schema. */
    edited_args: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal('deny_tool'),
    chat_id: z.string().min(1),
    call_id: z.string().min(1),
    reason: z.string().max(2000).optional(),
  }),
  z.object({ action: z.literal('cancel'), chat_id: z.string().min(1) }),
]);

/** Fire-and-forget background trigger; a lost POST leaves the doc queued and
 *  recoverable via the stale-takeover path (send/cancel after STALE_RUN_MS). */
const triggerBackground = async (chatId: string, triggerToken: string): Promise<void> => {
  const base = process.env.URL;
  if (!base) return;
  try {
    await fetch(`${base}/.netlify/functions/admin-agent-chat-run-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, trigger_token: triggerToken }),
    });
  } catch (error) {
    console.error('agent chat background trigger failed', { chatId, error });
  }
};

const chatSummary = (doc: ChatDoc) => ({
  chat_id: doc.chat_id,
  kind: doc.kind,
  ...(doc.object_type ? { object_type: doc.object_type } : {}),
  ...(doc.object_id ? { object_id: doc.object_id } : {}),
  title: doc.title,
  status: doc.status,
  updated_at: doc.updated_at,
  last_outcome: doc.runs[doc.runs.length - 1] ?? null,
  ...(doc.run
    ? {
        agent: {
          profile_id: doc.run.profile.profile_id,
          name: doc.run.profile.name,
          provider: doc.run.profile.provider,
          model: doc.run.profile.model,
          ...(doc.run.profile.avatar_artifact ? { avatar_artifact: doc.run.profile.avatar_artifact } : {}),
        },
      }
    : {}),
});

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

  const caller = { id: adminState.userId ?? '', email: adminState.email ?? '' };
  const nowIso = () => new Date().toISOString();

  try {
    const chatStore = await getAgentChatBlobStore(event);

    switch (request.data.action) {
      case 'create_chat': {
        if (request.data.kind === 'object') {
          if (!request.data.object_type || !request.data.object_id) {
            return jsonResponse(400, { error: 'object chats need object_type and object_id.' });
          }
          const chatId = objectChatId(request.data.object_id);
          const existing = await loadChatDoc(chatStore, chatId);
          if (existing) return jsonResponse(200, { chat: chatSummary(existing), existed: true });
          const doc: ChatDoc = {
            schema_version: 'agent-chat.v1',
            chat_id: chatId,
            kind: 'object',
            object_type: request.data.object_type,
            object_id: request.data.object_id,
            title: request.data.title ?? request.data.object_id,
            created_by: caller.email,
            created_at: nowIso(),
            updated_at: nowIso(),
            status: 'idle',
            seq: 0,
            events: [],
            runs: [],
          };
          await saveChatDoc(chatStore, doc);
          return jsonResponse(200, { chat: chatSummary(doc), existed: false });
        }
        const doc: ChatDoc = {
          schema_version: 'agent-chat.v1',
          chat_id: mintFreeChatId(),
          kind: 'free',
          title: request.data.title ?? 'New conversation',
          created_by: caller.email,
          created_at: nowIso(),
          updated_at: nowIso(),
          status: 'idle',
          seq: 0,
          events: [],
          runs: [],
        };
        await saveChatDoc(chatStore, doc);
        return jsonResponse(200, { chat: chatSummary(doc), existed: false });
      }

      case 'list_chats': {
        const docs = await listChatDocs(chatStore);
        return jsonResponse(200, { chats: docs.map(chatSummary) });
      }

      case 'get_chat': {
        const doc = await loadChatDoc(chatStore, request.data.chat_id);
        if (!doc) return jsonResponse(404, { error: 'chat not found' });
        const since = request.data.since_seq ?? 0;
        return jsonResponse(200, {
          ...chatSummary(doc),
          seq: doc.seq,
          events: doc.events.filter((eventItem) => eventItem.seq > since),
          ...(doc.status === 'awaiting_approval' && doc.run?.pending
            ? {
                pending: {
                  call_id: doc.run.pending.call_id,
                  tool: doc.run.pending.tool,
                  args: doc.run.pending.args,
                  ...(doc.run.pending.dry_run ? { dry_run: doc.run.pending.dry_run } : {}),
                },
              }
            : {}),
        });
      }

      case 'send': {
        const doc = await loadChatDoc(chatStore, request.data.chat_id);
        if (!doc) return jsonResponse(404, { error: 'chat not found — create_chat first.' });

        // §4a: resolve the dedicated agent AT SEND TIME and stamp it into the run.
        const profilesDoc = await getProfilesDoc(await getAgentProfilesBlobStore(event), nowIso());
        const profile = resolveProfile(profilesDoc, {
          objectId: doc.object_id,
          objectType: doc.object_type,
        });
        const { chat_tools } = await resolveActivePolicies(await getGovernanceBlobStore(event));
        const autonomy = resolveAutonomy(
          chat_tools as Record<string, ToolAutonomy> | undefined,
          profile.tool_autonomy_overrides
        );

        // Title generation: a fresh default-titled chat adopts its first message.
        if (doc.runs.length === 0 && (doc.title === 'New conversation' || doc.title === doc.object_id)) {
          const line = request.data.text.split('\n')[0] ?? '';
          if (doc.kind === 'free') doc.title = line.length > 80 ? `${line.slice(0, 77)}…` : line;
        }

        const principal: Principal = { kind: 'human', ...caller };
        const objectStore = (await getSiteObjectsBlobStore(event)) as unknown as ObjectVerbStore;
        const roles = await resolveRolesForPrincipalAsync(principal, {
          getUserRecord: async (email) => getUserRecord(await getUsersBlobStore(event), email),
        });
        const toolContext = buildToolContext({
          objectStore,
          governanceStore: await getGovernanceBlobStore(event),
          artifactIndexStore: (await getArtifactIndexBlobStore(event).catch(() => undefined)) as unknown as
            | ArtifactIndexStore
            | undefined,
          principal,
          roles,
        });
        const result = await startRun(
          { chatStore, toolContext },
          doc,
          request.data.text,
          caller,
          {
            profile_id: profile.profile_id,
            name: profile.name,
            provider: profile.provider,
            model: profile.model,
            ...(profile.avatar_artifact ? { avatar_artifact: profile.avatar_artifact } : {}),
            system_prompt: profile.system_prompt,
          },
          autonomy
        );
        if (result.resume) await triggerBackground(request.data.chat_id, result.resume.triggerToken);
        return jsonResponse(result.status, result.body);
      }

      case 'approve_tool':
      case 'deny_tool': {
        const doc = await loadChatDoc(chatStore, request.data.chat_id);
        if (!doc?.run) return jsonResponse(404, { error: 'chat not found' });
        // Execution happens NOW, under the RUN's principal (the human who owns
        // the run) — the approver is recorded on the event. Roles are
        // re-resolved fresh so a demotion takes effect on the next write.
        const runPrincipal: Principal = doc.run.principal;
        const objectStore = (await getSiteObjectsBlobStore(event)) as unknown as ObjectVerbStore;
        const roles = await resolveRolesForPrincipalAsync(runPrincipal, {
          getUserRecord: async (email) => getUserRecord(await getUsersBlobStore(event), email),
        });
        const toolContext = buildToolContext({
          objectStore,
          governanceStore: await getGovernanceBlobStore(event),
          artifactIndexStore: (await getArtifactIndexBlobStore(event).catch(() => undefined)) as unknown as
            | ArtifactIndexStore
            | undefined,
          principal: runPrincipal,
          roles,
        });
        const result =
          request.data.action === 'approve_tool'
            ? await approvePendingTool(
                { chatStore, toolContext },
                request.data.chat_id,
                request.data.call_id,
                caller,
                request.data.edited_args
              )
            : await denyPendingTool(
                { chatStore, toolContext },
                request.data.chat_id,
                request.data.call_id,
                caller,
                request.data.reason
              );
        if (result.resume) await triggerBackground(request.data.chat_id, result.resume.triggerToken);
        return jsonResponse(result.status, result.body);
      }

      case 'cancel': {
        const objectStore = (await getSiteObjectsBlobStore(event)) as unknown as ObjectVerbStore;
        const toolContext = buildToolContext({
          objectStore,
          principal: { kind: 'human', ...caller },
          roles: [],
        });
        const result = await cancelRun({ chatStore, toolContext }, request.data.chat_id);
        return jsonResponse(result.status, result.body);
      }
    }
  } catch (error) {
    console.error('Admin_Agent_Chat request failed.', error);
    return jsonResponse(500, { error: 'Agent chat request could not be processed.' });
  }
};
