/**
 * AdminHome (T9.3 · inbox/feed T9.11) — the workspace home island. Renders
 * inside AdminShell with an attention-first layout: quick actions, a working
 * Release card, the "needs me" attention inbox (pending reviews, unpublished
 * changes, held locks) and a live activity feed — all read-only aggregation
 * over admin-audit (T9.11).
 *
 * Release flow: call admin-release once, then POLL deploy-status until the
 * production deploy is confirmed live. A first `build_not_confirmed_live` is
 * expected (the build is still running) — we poll, we never re-fire the
 * release.
 */
import { useEffect, useRef, useState } from 'react';

import { AdminShell } from './AdminShell';
import { Badge, Button, Card, EmptyState, Skeleton, StatCard } from './primitives';
import { useToast } from './overlays';
import {
  IconRocket,
  IconFilePlus,
  IconPalette,
  IconLibrary,
  IconClock,
  IconInfo,
  IconCheck,
  IconLock,
  IconExternalLink,
} from './icons';
import { relativeTimeFromNow } from './logic';
import { objectTypeLabel } from '../../lib/admin/display-name';
import type { ObjectType } from '@core/schema/object-record-v1';
import {
  fetchHomeData,
  objectHref,
  type HomeData,
  type PendingReviewItem,
  type UnpublishedChangeItem,
  type HeldLockItem,
} from '../../lib/admin/audit-client';

const RELEASE_ENDPOINT = '/.netlify/functions/admin-release';
const DEPLOY_STATUS_ENDPOINT = '/.netlify/functions/deploy-status';
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 24; // ~2 minutes before we hand the wait back to the user

async function getToken(): Promise<string> {
  const m = await import('../../utils/goTrueClient');
  return (await m.getAccessToken()) ?? '';
}

const shortCommit = (commit?: string) => (commit ? commit.slice(0, 7) : 'latest');

type ReleasePhase = 'idle' | 'working' | 'building' | 'live' | 'error';

function ReleaseCard() {
  const { toast } = useToast();
  const [phase, setPhase] = useState<ReleasePhase>('idle');
  const [message, setMessage] = useState('');
  const [commit, setCommit] = useState<string | undefined>();
  const [stalled, setStalled] = useState(false);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    []
  );

  const poll = async (targetCommit: string, attempt: number) => {
    if (cancelled.current) return;
    try {
      const token = await getToken();
      const res = await fetch(DEPLOY_STATUS_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit: targetCommit }),
      });
      const receipt = (await res.json().catch(() => ({}))) as { deployStatus?: string };
      const status = receipt.deployStatus;
      if (status === 'ready') {
        setPhase('live');
        setMessage(`Live on ${shortCommit(targetCommit)}.`);
        toast({ title: 'Production is live', description: `Commit ${shortCommit(targetCommit)}.`, tone: 'success' });
        return;
      }
      if (status === 'failed' || status === 'canceled' || status === 'timed_out') {
        setPhase('error');
        setMessage(`The deploy ${status.replace('_', ' ')}. Check Netlify and try again.`);
        return;
      }
    } catch {
      // transient network/API hiccup — keep polling, don't surface it
    }
    if (cancelled.current) return;
    if (attempt >= MAX_POLLS) {
      setStalled(true);
      setMessage('Still building — this is taking longer than usual. Check again in a moment.');
      return;
    }
    window.setTimeout(() => poll(targetCommit, attempt + 1), POLL_INTERVAL_MS);
  };

  const startBuilding = (targetCommit: string) => {
    setPhase('building');
    setStalled(false);
    setCommit(targetCommit);
    setMessage(`Building the production deploy for ${shortCommit(targetCommit)}…`);
    poll(targetCommit, 0);
  };

  const onRelease = async () => {
    setPhase('working');
    setStalled(false);
    setMessage('Forcing a production build…');
    try {
      const token = await getToken();
      if (!token) {
        setPhase('error');
        setMessage('Your session expired — sign in again to release.');
        return;
      }
      const res = await fetch(RELEASE_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = (await res.json().catch(() => ({}))) as {
        result?: { released?: boolean; status?: string; reason?: string; targetCommit?: string };
        error?: string;
      };
      const result = body.result;
      if (!result) {
        setPhase('error');
        setMessage(body.error || 'Release could not be started. Check deploy status.');
        return;
      }
      if (result.released) {
        setPhase('live');
        setMessage(`Live on ${shortCommit(result.targetCommit)}.`);
        toast({ title: 'Production is live', tone: 'success' });
        return;
      }
      if (result.status === 'build_not_confirmed_live' && result.targetCommit) {
        startBuilding(result.targetCommit);
        return;
      }
      // Config problems (build hook / deploy lookup not set, commit unresolved).
      setPhase('error');
      setMessage(result.reason || 'Release could not be completed.');
    } catch {
      setPhase('error');
      setMessage('Release failed. Please try again.');
    }
  };

  const busy = phase === 'working' || (phase === 'building' && !stalled);
  const tone =
    phase === 'live'
      ? 'text-[var(--adm-success)]'
      : phase === 'error'
        ? 'text-[var(--adm-danger)]'
        : 'text-[var(--adm-text-muted)]';

  return (
    <Card kicker="Deploy" title="Release to production">
      <p className="text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
        Object publishes commit to <code>main</code> with <code>[skip netlify]</code> and don&apos;t deploy on their
        own. Release builds the accumulated exports once and waits until the live site is confirmed on the latest
        commit.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          onClick={onRelease}
          loading={busy}
          leftIcon={busy ? undefined : <IconRocket size={18} />}
          disabled={busy}
        >
          {phase === 'building' ? 'Building…' : 'Release to production'}
        </Button>
        {stalled && commit ? (
          <Button variant="secondary" onClick={() => startBuilding(commit)}>
            Check deploy status
          </Button>
        ) : null}
      </div>
      {message ? (
        <p className={`mt-3 text-[length:var(--adm-text-sm)] ${tone}`} aria-live="polite" role="status">
          {message}
        </p>
      ) : null}
    </Card>
  );
}

function QuickActions() {
  const actions = [
    {
      label: 'New article',
      description: 'Start a draft with a CMS Agent',
      href: '/admin/agents',
      icon: IconFilePlus,
    },
    {
      label: 'Studio',
      description: 'Build from a template, theme, or recipe',
      href: '/admin/studio',
      icon: IconPalette,
    },
    {
      label: 'Content library',
      description: 'Browse everything by type',
      href: '/admin/content',
      icon: IconLibrary,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <a
            key={action.label}
            href={action.href}
            className="adm-focusable group flex items-start gap-3 rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)] bg-[var(--adm-surface-raised)] p-4 shadow-[var(--adm-shadow-sm)] transition-colors hover:border-[var(--adm-accent)]"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--adm-radius-md)] bg-[var(--adm-accent-soft)] text-[var(--adm-accent)]">
              <Icon size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-[length:var(--adm-text-sm)] font-semibold text-[var(--adm-text-heading)]">
                {action.label}
              </span>
              <span className="block text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
                {action.description}
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

async function homeToken(): Promise<string> {
  const m = await import('../../utils/goTrueClient');
  return (await m.getAccessToken()) ?? '';
}

/** One row in an inbox section: object link (name + tooltip'd id) + meta + action. */
function InboxRow({
  item,
  meta,
  badge,
  actionLabel,
}: {
  item: { object_id: string; object_type: ObjectType; display_name: string; id_tooltip: string };
  meta?: string;
  badge?: { label: string; tone: 'warning' | 'accent' | 'danger' | 'info' };
  actionLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--adm-border)] px-1 py-2.5 last:border-0">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="rounded-[var(--adm-radius-pill)] bg-[var(--adm-surface-sunken)] px-1.5 py-0.5 text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]"
          title={item.id_tooltip}
        >
          {objectTypeLabel(item.object_type)}
        </span>
        <span
          className="truncate text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text)]"
          title={item.id_tooltip}
        >
          {item.display_name}
        </span>
        {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
      </div>
      <div className="flex items-center gap-3">
        {meta ? <span className="text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">{meta}</span> : null}
        <a
          href={objectHref(item)}
          className="adm-focusable inline-flex items-center gap-1 text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-accent)] hover:underline"
        >
          {actionLabel}
          <IconExternalLink size={14} />
        </a>
      </div>
    </div>
  );
}

function AttentionInboxCard({ data, nowMs }: { data: HomeData; nowMs: number }) {
  const { pending_reviews, unpublished_changes, held_locks } = data.inbox;
  const empty = pending_reviews.length === 0 && unpublished_changes.length === 0 && held_locks.length === 0;

  return (
    <Card kicker="Attention" title="Needs your attention">
      {empty ? (
        <EmptyState
          icon={<IconCheck size={26} />}
          title="You're all caught up"
          message="No pending reviews, unpublished changes, or held locks right now."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {pending_reviews.length > 0 ? (
            <section>
              <h3 className="mb-1 flex items-center gap-2 text-[length:var(--adm-text-sm)] font-semibold text-[var(--adm-text-heading)]">
                <IconInfo size={16} /> Pending reviews
                <Badge tone="info">{pending_reviews.length}</Badge>
              </h3>
              {pending_reviews.map((r: PendingReviewItem) => (
                <InboxRow
                  key={r.object_id}
                  item={r}
                  meta={relativeTimeFromNow(r.updated_at, nowMs)}
                  badge={{
                    label: r.review_state === 'changes_requested' ? 'Changes requested' : 'Open',
                    tone: r.review_state === 'changes_requested' ? 'warning' : 'accent',
                  }}
                  actionLabel="Review"
                />
              ))}
            </section>
          ) : null}

          {unpublished_changes.length > 0 ? (
            <section>
              <h3 className="mb-1 flex items-center gap-2 text-[length:var(--adm-text-sm)] font-semibold text-[var(--adm-text-heading)]">
                <IconRocket size={16} /> Unpublished changes
                <Badge tone="warning">{unpublished_changes.length}</Badge>
              </h3>
              {unpublished_changes.map((c: UnpublishedChangeItem) => (
                <InboxRow
                  key={c.object_id}
                  item={c}
                  meta={relativeTimeFromNow(c.updated_at, nowMs)}
                  badge={c.never_published ? { label: 'Never published', tone: 'info' } : undefined}
                  actionLabel="Open"
                />
              ))}
            </section>
          ) : null}

          {held_locks.length > 0 ? (
            <section>
              <h3 className="mb-1 flex items-center gap-2 text-[length:var(--adm-text-sm)] font-semibold text-[var(--adm-text-heading)]">
                <IconLock size={16} /> Held locks
                <Badge tone="neutral">{held_locks.length}</Badge>
              </h3>
              {held_locks.map((l: HeldLockItem) => (
                <InboxRow
                  key={l.object_id}
                  item={l}
                  meta={`${l.owner_label} · ${relativeTimeFromNow(l.acquired_at, nowMs)}`}
                  actionLabel="Open"
                />
              ))}
            </section>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function ActivityFeedCard({ data, nowMs }: { data: HomeData; nowMs: number }) {
  const { feed } = data;
  return (
    <Card kicker="Activity" title="Recent activity">
      {feed.length === 0 ? (
        <EmptyState
          icon={<IconClock size={26} />}
          title="No activity yet"
          message="Publishes, edits, and reviews will appear here as they happen."
        />
      ) : (
        <ul className="flex flex-col">
          {feed.map((entry, i) => (
            <li
              key={`${entry.object_id}-${entry.at}-${i}`}
              className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 border-b border-[var(--adm-border)] py-2 last:border-0"
            >
              <span className="text-[length:var(--adm-text-sm)] text-[var(--adm-text)]">{entry.actor_phrase}</span>
              <a
                href={objectHref(entry)}
                title={entry.id_tooltip}
                className="adm-focusable text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-accent)] hover:underline"
              >
                {entry.display_name}
              </a>
              <span className="ml-auto text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
                {relativeTimeFromNow(entry.at, nowMs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AdminHome() {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const home = await fetchHomeData(homeToken);
        if (alive) {
          setData(home);
          setNowMs(Date.now());
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load your workspace.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const stats = data?.inbox.stats;

  return (
    <AdminShell currentPath="/admin" title="Workspace home">
      <div className="flex flex-col gap-6">
        <QuickActions />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            {loading ? (
              <>
                <Skeleton variant="rect" height={200} />
                <Skeleton variant="rect" height={200} />
              </>
            ) : error || !data ? (
              <Card kicker="Attention" title="Needs your attention">
                <EmptyState
                  icon={<IconInfo size={26} />}
                  title="Couldn't load your workspace"
                  message={error ?? undefined}
                />
              </Card>
            ) : (
              <>
                <AttentionInboxCard data={data} nowMs={nowMs} />
                <ActivityFeedCard data={data} nowMs={nowMs} />
              </>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <ReleaseCard />
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Published"
                value={stats ? stats.published : '—'}
                hint={stats ? `${stats.total} objects total` : undefined}
              />
              <StatCard
                label="In review"
                value={stats ? stats.in_review : '—'}
                tone={stats && stats.in_review > 0 ? 'accent' : 'neutral'}
                hint={stats && stats.unpublished > 0 ? `${stats.unpublished} unpublished` : undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
