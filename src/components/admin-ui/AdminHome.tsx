/**
 * AdminHome (T9.3) — the workspace home island. Renders inside AdminShell and
 * replaces the old link grid with an attention-first layout: quick actions, a
 * working Release card, and placeholder slots for the T9.11 inbox/activity
 * widgets (no data yet — that's T9.11).
 *
 * Release flow: call admin-release once, then POLL deploy-status until the
 * production deploy is confirmed live. A first `build_not_confirmed_live` is
 * expected (the build is still running) — we poll, we never re-fire the
 * release.
 */
import { useEffect, useRef, useState } from 'react';

import { AdminShell } from './AdminShell';
import { Button, Card, EmptyState, StatCard } from './primitives';
import { useToast } from './overlays';
import { IconRocket, IconFilePlus, IconSparkles, IconLibrary, IconClock, IconInfo } from './icons';

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
      description: 'Draft and publish a Markdown article',
      href: '/admin/publish',
      icon: IconFilePlus,
    },
    {
      label: 'AI publisher',
      description: 'Prepare a payload with the assistant',
      href: '/admin/agent-admin',
      icon: IconSparkles,
    },
    {
      label: 'Content library',
      description: 'Browse published articles and drafts',
      href: '/admin/library',
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

export default function AdminHome() {
  return (
    <AdminShell currentPath="/admin" title="Workspace home">
      <div className="flex flex-col gap-6">
        <QuickActions />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <Card kicker="Attention" title="Needs your attention">
              <EmptyState
                icon={<IconInfo size={26} />}
                title="Nothing needs your attention"
                message="Pending reviews, unpublished changes, and held locks will surface here once the inbox is wired up."
              />
            </Card>

            <Card kicker="Activity" title="Recent activity">
              <EmptyState
                icon={<IconClock size={26} />}
                title="No activity yet"
                message="A live audit feed of publishes, edits, and reviews lands here in a later step."
              />
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <ReleaseCard />
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Published" value="—" />
              <StatCard label="In review" value="—" />
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
