import { useCallback, useEffect, useMemo, useState } from 'react';

import { AdminShell } from './AdminShell';
import { Badge, Button, Card, EmptyState, Skeleton } from './primitives';
import { useToast } from './overlays';
import { IconAlertTriangle, IconExternalLink, IconRocket } from './icons';
import type { SiteIdentity } from '@core/lib/site-identity';
import { fetchInventoryRows } from '@core/lib/admin/library-client';
import { listChats, type ChatSummaryView } from '@core/lib/admin/chat-client';
import {
  fetchReleaseOverview,
  triggerProductionRelease,
  type ReleaseDeployState,
  type ReleaseObjectView,
  type ReleaseOverview,
  type ReleaseResultView,
} from '@core/lib/admin/release-client';
import { chatWorkLabel, getWorkSummary } from '@core/lib/admin/work-summary';
import type { LibraryRow } from '@core/lib/admin/library-logic';

async function getToken(): Promise<string> {
  const auth = await import('@core/lib/admin/goTrueClient');
  return (await auth.getAccessToken()) ?? '';
}

const objectHref = (item: { object_id: string; object_type: string }) =>
  `/admin/content/${encodeURIComponent(item.object_id)}?type=${item.object_type}`;

const deployCopy: Record<
  ReleaseDeployState,
  { label: string; message: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  unavailable: {
    label: 'Release status unavailable',
    message: 'Production deploy lookup is not configured for this publication.',
    tone: 'warning',
  },
  idle: { label: 'No release yet', message: 'Production has not reported a confirmed release.', tone: 'neutral' },
  queued: { label: 'Release queued', message: 'The production build is waiting to start.', tone: 'info' },
  building: { label: 'Building', message: 'The production release is being built.', tone: 'info' },
  ready: {
    label: 'Production live',
    message: 'The latest confirmed production deployment is healthy.',
    tone: 'success',
  },
  ready_not_published: {
    label: 'Built, not live',
    message: 'The build completed but production still serves an older release. Publishing may be locked in Netlify.',
    tone: 'warning',
  },
  failed: {
    label: 'Release failed',
    message: 'The latest production build failed. Review the deploy log before retrying.',
    tone: 'danger',
  },
  stalled: {
    label: 'Release stalled',
    message: 'The build has not made progress within the expected window. Check Netlify before retrying.',
    tone: 'danger',
  },
};

function ObjectList({ items, empty }: { items: ReleaseObjectView[]; empty?: string }) {
  if (!items.length) {
    return empty ? <p className="text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">{empty}</p> : null;
  }
  return (
    <div className="divide-y divide-[var(--adm-border)]">
      {items.map((item) => (
        <a
          key={item.object_id}
          href={objectHref(item)}
          className="adm-focusable flex items-center justify-between gap-3 rounded px-1 py-3 hover:text-[var(--adm-accent)]"
        >
          <span className="min-w-0 truncate font-medium">{item.display_name}</span>
          <IconExternalLink size={15} />
        </a>
      ))}
    </div>
  );
}

function WorkList({ chats, empty }: { chats: ChatSummaryView[]; empty: string }) {
  if (!chats.length) return <p className="text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">{empty}</p>;
  return (
    <div className="divide-y divide-[var(--adm-border)]">
      {chats.map((chat) => {
        const content = (
          <>
            <span className="min-w-0 truncate font-medium">{chat.title}</span>
            <Badge tone={chat.status === 'error' ? 'danger' : chat.status.startsWith('awaiting') ? 'warning' : 'info'}>
              {chatWorkLabel(chat)}
            </Badge>
          </>
        );
        return chat.object_id && chat.object_type ? (
          <a
            key={chat.chat_id}
            href={objectHref({ object_id: chat.object_id, object_type: chat.object_type })}
            className="adm-focusable flex items-center justify-between gap-3 rounded px-1 py-3 hover:text-[var(--adm-accent)]"
          >
            {content}
          </a>
        ) : (
          <div key={chat.chat_id} className="flex items-center justify-between gap-3 py-3">
            {content}
          </div>
        );
      })}
    </div>
  );
}

function ReleaseWorkspaceContent() {
  const { toast } = useToast();
  const [overview, setOverview] = useState<ReleaseOverview>();
  const [chats, setChats] = useState<ChatSummaryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string>();
  const [lastResult, setLastResult] = useState<ReleaseResultView>();

  const refresh = useCallback(async () => {
    try {
      const [nextOverview, rows, chatResult] = await Promise.all([
        fetchReleaseOverview(getToken),
        fetchInventoryRows(getToken, { force: true }),
        listChats(getToken).catch((): { chats: ChatSummaryView[] } => ({ chats: [] })),
      ]);
      setOverview(nextOverview);
      setChats(chatResult.chats);
      setError(undefined);
      return rows;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Release state could not be loaded.');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const [rows, setRows] = useState<LibraryRow[]>([]);
  useEffect(() => {
    void refresh().then(setRows);
  }, [refresh]);

  useEffect(() => {
    if (!overview || !['queued', 'building', 'ready_not_published'].includes(overview.deploy.state)) return;
    const timer = window.setInterval(() => void refresh().then(setRows), 6000);
    return () => window.clearInterval(timer);
  }, [overview?.deploy.state, refresh]);

  const work = useMemo(() => getWorkSummary(rows, chats), [rows, chats]);
  const waiting = overview?.objects.filter((object) => object.state === 'published') ?? [];
  const approvals = overview?.objects.filter((object) => object.review_state === 'open') ?? [];
  const deploy = overview ? deployCopy[overview.deploy.state] : undefined;

  const release = async () => {
    setReleasing(true);
    try {
      const result = await triggerProductionRelease(getToken);
      setLastResult(result);
      toast({
        title: result.released ? 'Release is live' : 'Release started',
        description: result.reason,
        tone: result.released ? 'success' : 'info',
      });
      setRows(await refresh());
    } catch (reason) {
      toast({
        title: 'Release could not start',
        description: reason instanceof Error ? reason.message : undefined,
        tone: 'danger',
      });
    } finally {
      setReleasing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[length:var(--adm-text-2xl)] font-semibold text-[var(--adm-text-heading)]">Release</h1>
          <p className="mt-1 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
            Publish objects first, then send the accumulated changes live in one production build.
          </p>
        </div>
        <Button
          leftIcon={<IconRocket size={16} />}
          onClick={() => void release()}
          loading={releasing}
          disabled={loading || waiting.length === 0}
        >
          Release to production
        </Button>
      </header>

      {loading ? (
        <Skeleton variant="rect" height={420} />
      ) : error || !overview || !deploy ? (
        <EmptyState icon={<IconAlertTriangle size={26} />} title="Release unavailable" message={error} />
      ) : (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone={deploy.tone}>{deploy.label}</Badge>
                {overview.deploy.published?.production_url ? (
                  <a
                    href={overview.deploy.published.production_url}
                    target="_blank"
                    rel="noreferrer"
                    className="adm-focusable rounded text-[length:var(--adm-text-xs)] font-medium text-[var(--adm-accent)] hover:underline"
                  >
                    View publication
                  </a>
                ) : null}
              </div>
              <p className="mt-2 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">{deploy.message}</p>
              {lastResult ? (
                <p className="mt-2 text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
                  {lastResult.reason}
                </p>
              ) : null}
            </div>
            <p className="text-right text-[length:var(--adm-text-lg)] font-semibold text-[var(--adm-text-heading)]">
              {waiting.length} published change{waiting.length === 1 ? '' : 's'} waiting to go live
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-[var(--adm-text-heading)]">Published, waiting for release</h2>
                <Badge tone={waiting.length ? 'warning' : 'success'}>{waiting.length}</Badge>
              </div>
              <ObjectList items={waiting} empty="Everything published is already live." />
            </Card>
            <Card>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-[var(--adm-text-heading)]">Pending approvals</h2>
                <Badge tone={approvals.length ? 'warning' : 'neutral'}>{approvals.length}</Badge>
              </div>
              <ObjectList items={approvals} empty="No object is waiting for an approval decision." />
            </Card>
            <Card>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-[var(--adm-text-heading)]">Needs you</h2>
                <Badge tone={work.needsYouCount ? 'warning' : 'neutral'}>{work.needsYouCount}</Badge>
              </div>
              <WorkList chats={work.needsYouChats} empty="No agent work needs a decision." />
              <ObjectList
                items={approvals.filter(
                  (approval) => !work.needsYouChats.some((chat) => chat.object_id === approval.object_id)
                )}
              />
            </Card>
            <Card>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-[var(--adm-text-heading)]">Working</h2>
                <Badge tone={work.workingCount ? 'info' : 'neutral'}>{work.workingCount}</Badge>
              </div>
              <WorkList chats={work.working} empty="No agent work is running." />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export default function ReleaseWorkspace({ identity }: { identity: SiteIdentity }) {
  return (
    <AdminShell currentPath="/admin/release" title="Release" identity={identity}>
      <ReleaseWorkspaceContent />
    </AdminShell>
  );
}
