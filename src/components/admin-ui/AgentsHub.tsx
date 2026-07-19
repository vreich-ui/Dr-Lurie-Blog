/**
 * CMS Agents hub (T9.17, plan §2) — cross-object conversations: the surface
 * for work not scoped to one existing object. Session list with human titles
 * and outcome chips (never raw chat ids), resume, and new-chat starters that
 * walk the §4 creation tools conversationally — dry-run-first, REUSE-FIRST,
 * results landing as normal governed objects with a one-click route to the
 * new object's workspace.
 */
import { useEffect, useMemo, useState } from 'react';

import { AdminShell } from './AdminShell';
import { Badge, Button, Card, EmptyState, Skeleton, StatusPill } from './primitives';
import { AgentChip, ChatComposer, ChatThread, useChat } from './chat';
import { IconExternalLink, IconFilePlus, IconPalette, IconPencil, IconPlus, IconSparkles } from './icons';
import { createFreeChat, listChats, type ChatStatus, type ChatSummaryView } from '../../lib/admin/chat-client';

async function getToken(): Promise<string> {
  const m = await import('../../utils/goTrueClient');
  return (await m.getAccessToken()) ?? '';
}

interface Starter {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  prompt: string;
  ownerOnly?: boolean;
}

const STARTERS: Starter[] = [
  {
    key: 'article',
    label: 'New article',
    description: 'Draft a content item from an idea — outline, nodes, taxonomy from the registry.',
    icon: <IconPencil size={18} />,
    prompt:
      'I want a new article. Ask me for the topic and angle, check the taxonomy registry for the right category and tags, then draft it as a content_item (create_object) with a clear node structure. Keep it as a draft — no publishing yet.',
  },
  {
    key: 'page',
    label: 'New page from template',
    description: 'REUSE-FIRST: browse the template recipes, preview, then instantiate.',
    icon: <IconFilePlus size={18} />,
    prompt:
      'I want a new page. First list the template recipes in the inventory (REUSE FIRST) and recommend one based on its description/whenToUse. Then propose instantiate_template — I will see the dry-run preview on the approval card before anything is created.',
  },
  {
    key: 'section-template',
    label: 'New section template',
    description: 'Mint a reusable section recipe with the required metadata trio.',
    icon: <IconPlus size={18} />,
    prompt:
      'I want a new section template (stpl_*). Check the existing recipes in the inventory first so we do not duplicate one. Then draft the blueprint and the REQUIRED description/whenToUse/scope metadata, and propose create_object.',
  },
  {
    key: 'retheme',
    label: 'Retheme',
    description: 'Owner-only: preview a theme apply as an exact-token diff, then apply.',
    icon: <IconPalette size={18} />,
    prompt:
      'I want to look at retheming the site. List the theme objects, then propose apply_theme with a dry run so I can see the exact brandTokens diff before deciding. Do not apply anything without my approval.',
    ownerOnly: true,
  },
];

const STATUS_TONE: Record<ChatStatus, 'success' | 'info' | 'warning' | 'neutral'> = {
  idle: 'neutral',
  queued: 'info',
  running: 'info',
  awaiting_approval: 'warning',
  error: 'warning',
  cancelled: 'neutral',
};

function HubBody() {
  const [chats, setChats] = useState<ChatSummaryView[] | null>(null);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [owner, setOwner] = useState(false);
  const [pendingStarter, setPendingStarter] = useState<string | undefined>(undefined);
  const chat = useChat(getToken, activeId);

  const reloadList = async () => {
    try {
      const { chats: list } = await listChats(getToken);
      setChats(list);
    } catch {
      setChats([]);
    }
  };

  useEffect(() => {
    void reloadList();
    (async () => {
      try {
        const { fetchMe } = await import('../../lib/admin/users-client');
        const me = await fetchMe(getToken);
        setOwner(me.roles.includes('owner'));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Keep the list fresh while a run is live (titles/outcomes update server-side).
  useEffect(() => {
    if (chat.status === 'idle' || chat.status === 'error' || chat.status === 'cancelled') void reloadList();
  }, [chat.status]);

  const startConversation = async (starter: Starter) => {
    setPendingStarter(starter.key);
    try {
      const { chat: created } = await createFreeChat(getToken, starter.label);
      setActiveId(created.chat_id);
      // Seed the conversation once the chat exists.
      const { sendChatMessage } = await import('../../lib/admin/chat-client');
      await sendChatMessage(getToken, created.chat_id, starter.prompt);
      await reloadList();
    } finally {
      setPendingStarter(undefined);
    }
  };

  /** Creation results carry object_id/object_type — route to the workspace. */
  const createdObjects = useMemo(
    () =>
      chat.events
        .filter((event) => event.type === 'tool_result' && !event.detail?.is_error && event.detail?.object_id)
        .map((event) => ({
          id: String(event.detail!.object_id),
          type: event.detail!.object_type ? String(event.detail!.object_type) : undefined,
        })),
    [chat.events]
  );

  const active = chats?.find((item) => item.chat_id === activeId);

  return (
    <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      {/* Left: starters + session list */}
      <div className="flex min-h-0 flex-col gap-4">
        <Card kicker="Start something" title="New conversation">
          <div className="grid gap-2">
            {STARTERS.filter((starter) => !starter.ownerOnly || owner).map((starter) => (
              <button
                key={starter.key}
                type="button"
                onClick={() => void startConversation(starter)}
                disabled={pendingStarter !== undefined}
                className="adm-focusable flex items-start gap-3 rounded-[var(--adm-radius-md)] border border-[var(--adm-border)] bg-[var(--adm-surface)] px-3 py-2.5 text-left hover:border-[var(--adm-accent)]"
              >
                <span className="mt-0.5 text-[var(--adm-accent)]">{starter.icon}</span>
                <span className="min-w-0">
                  <span className="block text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text)]">
                    {starter.label}
                    {pendingStarter === starter.key ? '…' : ''}
                  </span>
                  <span className="block text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
                    {starter.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card kicker="Conversations" title="Recent sessions" className="min-h-0 flex-1 overflow-auto">
          {chats === null ? (
            <Skeleton variant="rect" height={120} />
          ) : chats.length === 0 ? (
            <EmptyState
              icon={<IconSparkles size={24} />}
              title="No conversations yet"
              message="Start one above, or open any object's workspace — every object has its own agent."
            />
          ) : (
            <ul className="flex flex-col">
              {chats.map((item) => (
                <li key={item.chat_id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(item.chat_id)}
                    className={`adm-focusable w-full border-b border-[var(--adm-border)] px-2 py-2.5 text-left last:border-0 hover:bg-[var(--adm-surface-sunken)] ${
                      item.chat_id === activeId ? 'bg-[var(--adm-surface-sunken)]' : ''
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text)]">
                        {item.title}
                      </span>
                      <StatusPill
                        status={item.status}
                        tone={STATUS_TONE[item.status]}
                        label={item.status.replaceAll('_', ' ')}
                      />
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {item.kind === 'object' ? <Badge tone="info">object</Badge> : null}
                      {(item.last_outcome?.chips ?? []).map((chip) => (
                        <Badge key={chip} tone="neutral">
                          {chip}
                        </Badge>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Right: the active conversation */}
      <Card className="flex min-h-[30rem] flex-col lg:max-h-[calc(100vh-14rem)]">
        {activeId ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--adm-border)] pb-3">
              <AgentChip agent={chat.agent} />
              {active?.kind === 'object' && active.object_id ? (
                <a
                  href={`/admin/content/${encodeURIComponent(active.object_id)}?type=${encodeURIComponent(active.object_type ?? '')}`}
                  className="adm-focusable inline-flex items-center gap-1.5 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)] hover:text-[var(--adm-text)]"
                >
                  <IconExternalLink size={16} /> Open workspace
                </a>
              ) : null}
            </div>
            {createdObjects.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {createdObjects.map((created) => (
                  <Button
                    key={created.id}
                    size="sm"
                    variant="secondary"
                    leftIcon={<IconExternalLink size={14} />}
                    onClick={() =>
                      window.location.assign(
                        `/admin/content/${encodeURIComponent(created.id)}${created.type ? `?type=${encodeURIComponent(created.type)}` : ''}`
                      )
                    }
                  >
                    Open {created.id}
                  </Button>
                ))}
              </div>
            ) : null}
            <ChatThread
              events={chat.events}
              status={chat.status}
              pending={chat.pending}
              busy={chat.busy}
              onApprove={(editedArgs) => chat.pending && void chat.approve(chat.pending.call_id, editedArgs)}
              onDeny={(reason) => chat.pending && void chat.deny(chat.pending.call_id, reason)}
            />
            {chat.error ? (
              <p className="mt-2 text-[length:var(--adm-text-xs)] text-[var(--adm-danger)]">{chat.error}</p>
            ) : null}
            <div className="mt-3 border-t border-[var(--adm-border)] pt-3">
              <ChatComposer
                status={chat.status}
                busy={chat.busy}
                onSend={(text) => void chat.send(text)}
                onCancel={() => void chat.cancel()}
              />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<IconSparkles size={26} />}
            title="CMS Agents"
            message="Pick a conversation, or use a starter — create articles, pages from templates, section recipes, or preview a retheme. Every write shows an approval card first."
          />
        )}
      </Card>
    </div>
  );
}

export default function AgentsHub() {
  return (
    <AdminShell currentPath="/admin/agents" title="CMS Agents">
      <HubBody />
    </AdminShell>
  );
}
