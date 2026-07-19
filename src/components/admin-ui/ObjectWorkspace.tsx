/**
 * ObjectWorkspace (T9.9) — the chat-first single-object surface's forms-parity
 * floor. v1 focuses on the human-centered read + action surface that replaces
 * the machine-centered /admin/objects page: header (display name, badges,
 * unpublished pill), a generated inspector VIEW, readiness (from validate),
 * history (human phrasing), lock banner with an Owner take-over, a read-only
 * Raw tab, and the action bar (publish / submit / discard / edit-on-site /
 * new variant). Chat collapses this into a Details drawer in T9.14.
 *
 * Field-level WRITE editing across the ten discriminated-union schemas is
 * wired through the tested op-builder (inspector-ops.ts, with the trap #2
 * null-out) but its per-type field→op mapping is verified on the deployed site
 * (the brief's scripted per-type drive) — until then the inspector generates a
 * read view and points visual edits at the canvas.
 */
import { useEffect, useMemo, useState } from 'react';

import { AdminShell } from './AdminShell';
import { Badge, Button, Card, EmptyState, StatusPill, Skeleton, IconButton } from './primitives';
import { Tabs } from './menus';
import { ConfirmDialog, Drawer, useToast } from './overlays';
import { LockBanner, HistoryTimeline, ReadinessList } from './data';
import { ObjectPreview } from './ObjectPreview';
import { AgentChip, ChatComposer, ChatThread, useChat } from './chat';
import { createObjectChat } from '../../lib/admin/chat-client';
import { IconAlertTriangle, IconExternalLink, IconPlus, IconRocket, IconWrench } from './icons';
import { objectDisplayName, objectTypeLabel, idTooltip } from '../../lib/admin/display-name';
import type { ObjectType, ObjectRecord, HistoryEntry } from '../../schema/object-record-v1';
import type { ReadinessGroup, CriterionStatus } from '../../lib/admin/readiness-criteria';

async function getToken(): Promise<string> {
  const m = await import('../../utils/goTrueClient');
  return (await m.getAccessToken()) ?? '';
}

type Rec = ObjectRecord<Record<string, unknown>>;

function parseLocation(): { id: string; type: ObjectType | undefined } {
  const segment = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).at(-1) ?? '');
  const type = new URLSearchParams(window.location.search).get('type') as ObjectType | null;
  return { id: segment, type: type ?? undefined };
}

/** Best-effort live URL for the Edit-on-site link. */
function liveUrl(record: Rec): string | undefined {
  const body = record.body ?? {};
  const route = typeof body.route === 'string' ? body.route : undefined;
  const slug = typeof body.slug === 'string' ? body.slug : undefined;
  if (route) return route;
  if (record.object_type === 'content_item' && slug) return `/${slug}`;
  return undefined;
}

function statusOf(record: Rec): { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' } {
  const review = record.review?.state;
  if (review === 'open') return { label: 'In review', tone: 'info' };
  if (review === 'changes_requested') return { label: 'Changes requested', tone: 'warning' };
  if (record.publication?.published_time) return { label: 'Published', tone: 'success' };
  return { label: 'Draft', tone: 'neutral' };
}

function hasUnpublishedChanges(record: Rec): boolean {
  const published = record.publication?.published_time;
  if (!published) return true;
  const receiptRev = (record.publication?.publish_receipt as { content_revision?: number } | undefined)
    ?.content_revision;
  return typeof receiptRev !== 'number' || receiptRev !== record.content_revision;
}

// ─── generated inspector VIEW ─────────────────────────────────────────────────

function FieldValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-[var(--adm-text-muted)]">—</span>;
  if (typeof value === 'boolean') return <Badge tone={value ? 'success' : 'neutral'}>{String(value)}</Badge>;
  if (typeof value === 'string' || typeof value === 'number') {
    return <span className="text-[var(--adm-text)]">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <span className="text-[var(--adm-text-muted)]">
        {value.length} item{value.length === 1 ? '' : 's'} (structured)
      </span>
    );
  }
  return <span className="text-[var(--adm-text-muted)]">structured — edit on site</span>;
}

function GeneratedInspector({ record, onEditOnSite }: { record: Rec; onEditOnSite?: string }) {
  const entries = Object.entries(record.body ?? {}).filter(([key]) => key !== '__generated');
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)]">
        {entries.length === 0 ? (
          <p className="px-4 py-3 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">No body fields.</p>
        ) : (
          entries.map(([key, value]) => (
            <div
              key={key}
              className="flex items-start justify-between gap-4 border-b border-[var(--adm-border)] px-4 py-2.5 last:border-0"
            >
              <span className="text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text-muted)]">{key}</span>
              <span className="min-w-0 text-right text-[length:var(--adm-text-sm)]">
                <FieldValue value={value} />
              </span>
            </div>
          ))
        )}
      </div>
      <p className="text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
        Structured and visual fields are edited on the canvas.
        {onEditOnSite ? (
          <>
            {' '}
            <a className="underline hover:text-[var(--adm-text)]" href={`${onEditOnSite}?edit=1`}>
              Edit on site
            </a>
            .
          </>
        ) : null}
      </p>
    </div>
  );
}

// ─── readiness from validate ──────────────────────────────────────────────────

function readinessFromValidate(body: Record<string, unknown>): ReadinessGroup[] {
  const blockers = Array.isArray(body.blockers) ? (body.blockers as unknown[]) : [];
  const warnings = Array.isArray(body.warnings) ? (body.warnings as unknown[]) : [];
  const criteria = [
    ...blockers.map((b, i) => ({
      id: `b${i}`,
      label: 'Blocker',
      status: 'missing' as CriterionStatus,
      message: String(b),
    })),
    ...warnings.map((w, i) => ({
      id: `w${i}`,
      label: 'Warning',
      status: 'warning' as CriterionStatus,
      message: String(w),
    })),
  ];
  if (criteria.length === 0) {
    criteria.push({
      id: 'ok',
      label: 'Valid',
      status: 'complete' as CriterionStatus,
      message: 'No blockers or warnings.',
    });
  }
  return [{ id: 'validation', label: 'Validation', criteria }];
}

// ─── workspace body ───────────────────────────────────────────────────────────

function WorkspaceBody() {
  const { toast } = useToast();
  const [record, setRecord] = useState<Rec | null>(null);
  const [readiness, setReadiness] = useState<ReadinessGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState(0);
  const [chatId, setChatId] = useState<string | undefined>(undefined);
  const [loc] = useState(() => (typeof window === 'undefined' ? { id: '', type: undefined } : parseLocation()));
  const chat = useChat(getToken, chatId);

  const load = async () => {
    if (!loc.id || !loc.type) {
      setError('This object could not be identified. Open it from the content library.');
      setLoading(false);
      return;
    }
    const { getObjectRecord, callObjectVerb } = await import('../../lib/edit-mode/verbs-client');
    const { record } = await getObjectRecord(getToken, loc.type, loc.id);
    if (!record) {
      setError(`${objectTypeLabel(loc.type)} "${loc.id}" was not found.`);
      setLoading(false);
      return;
    }
    setRecord(record as Rec);
    setLoading(false);
    // readiness (best-effort)
    try {
      const res = await callObjectVerb(getToken, { action: 'validate', object_type: loc.type, object_id: loc.id });
      setReadiness(readinessFromValidate(res.body ?? {}));
    } catch {
      setReadiness(null);
    }
  };

  useEffect(() => {
    setNow(Date.now());
    (async () => {
      try {
        const { fetchMe } = await import('../../lib/admin/users-client');
        const me = await fetchMe(getToken);
        setOwner(me.roles.includes('owner'));
      } catch {
        /* ignore */
      }
    })();
    load().catch((e) => {
      setError(e instanceof Error ? e.message : 'Could not load this object.');
      setLoading(false);
    });
    // Chat-first (T9.14): the per-object conversation opens with the page.
    if (loc.id && loc.type) {
      createObjectChat(getToken, loc.type, loc.id)
        .then(({ chat: created }) => setChatId(created.chat_id))
        .catch(() => setChatId(undefined));
    }
  }, []);

  // Every accepted write refreshes the record — the preview re-renders and
  // readiness re-computes on each approved patch.
  useEffect(() => {
    if (chat.writeStamp > 0) void load();
  }, [chat.writeStamp]);

  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const doPublish = () =>
    runAction(async () => {
      if (!record) return;
      const { EditSession } = await import('../../lib/edit-mode/verbs-client');
      const session = new EditSession(record.object_type, record.object_id, getToken);
      const co = await session.ensureCheckout();
      if (!co.ok) {
        toast({ title: 'Locked', description: co.heldBy ? `Held by ${co.heldBy}.` : undefined, tone: 'warning' });
        return;
      }
      const res = await session.publish();
      await session.checkin();
      if (res.status === 200) {
        toast({ title: 'Published', tone: 'success' });
        await load();
      } else {
        toast({
          title: 'Publish blocked',
          description: String((res.body as { error?: string }).error ?? ''),
          tone: 'danger',
        });
      }
    });

  const doDiscard = () =>
    runAction(async () => {
      if (!record) return;
      const { callObjectVerb } = await import('../../lib/edit-mode/verbs-client');
      const res = await callObjectVerb(getToken, {
        action: 'discard',
        object_type: record.object_type,
        object_id: record.object_id,
      });
      if (res.status === 200) {
        toast({ title: 'Changes discarded', tone: 'success' });
        await load();
      } else {
        toast({
          title: 'Discard failed',
          description: String((res.body as { error?: string }).error ?? ''),
          tone: 'danger',
        });
      }
      setConfirmDiscard(false);
    });

  const doTakeOver = () =>
    runAction(async () => {
      if (!record) return;
      const { callObjectVerb } = await import('../../lib/edit-mode/verbs-client');
      const res = await callObjectVerb(getToken, {
        action: 'checkin',
        object_type: record.object_type,
        object_id: record.object_id,
        force: true,
      });
      if (res.status === 200) {
        toast({ title: 'Lock released', tone: 'success' });
        await load();
      } else {
        toast({
          title: 'Take-over failed',
          description: String((res.body as { error?: string }).error ?? ''),
          tone: 'danger',
        });
      }
    });

  const doNewVariant = () =>
    runAction(async () => {
      if (!record) return;
      const { callObjectVerb } = await import('../../lib/edit-mode/verbs-client');
      const res = await callObjectVerb(getToken, { action: 'create_variant', source_object_id: record.object_id });
      const newId =
        (res.body as { object?: { object_id?: string }; object_id?: string }).object?.object_id ??
        (res.body as { object_id?: string }).object_id;
      if (res.status === 200 && newId) {
        toast({ title: 'Variant created', tone: 'success' });
        window.location.assign(`/admin/content/${encodeURIComponent(newId)}?type=content_item`);
      } else {
        toast({
          title: 'Could not create a variant',
          description: String((res.body as { error?: string }).error ?? ''),
          tone: 'danger',
        });
      }
    });

  const history = useMemo<HistoryEntry[]>(
    () => ((record?.history ?? []) as HistoryEntry[]).slice().reverse(),
    [record]
  );

  // Suggested prompts (plan §4): seeded from missing readiness criteria, with
  // generic starters as the floor.
  const readinessOpenItems = useMemo(
    () =>
      (readiness ?? [])
        .flatMap((group) => group.criteria)
        .filter((criterion) => criterion.status === 'missing' || criterion.status === 'warning').length,
    [readiness]
  );
  const suggestions = useMemo(() => {
    const fromReadiness = (readiness ?? [])
      .flatMap((group) => group.criteria)
      .filter((criterion) => criterion.status === 'missing')
      .slice(0, 2)
      .map((criterion) => `${criterion.label} needs attention — can you take care of it?`);
    return [...fromReadiness, 'Summarize this object and anything that looks off.', 'What would you improve here?'];
  }, [readiness]);

  if (loading) return <Skeleton variant="rect" height={320} />;
  if (error || !record) {
    return (
      <Card>
        <EmptyState
          icon={<IconAlertTriangle size={26} />}
          title="Couldn't open this object"
          message={error ?? undefined}
          action={
            <Button variant="secondary" onClick={() => window.location.assign('/admin/content')}>
              Back to library
            </Button>
          }
        />
      </Card>
    );
  }

  const status = statusOf(record);
  const url = liveUrl(record);
  const lockHeld = Boolean(record.lock && record.lock.token);
  const isContentItem = record.object_type === 'content_item';

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              className="truncate text-[length:var(--adm-text-2xl)] font-semibold text-[var(--adm-text-heading)]"
              title={idTooltip(record.object_id)}
            >
              {objectDisplayName(record)}
            </h1>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge>{objectTypeLabel(record.object_type)}</Badge>
            <StatusPill status={status.label} tone={status.tone} label={status.label} />
            {hasUnpublishedChanges(record) && record.publication?.published_time ? (
              <StatusPill status="unpublished" tone="warning" label="Unpublished changes" />
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {url ? (
            <a
              href={`${url}?edit=1`}
              className="adm-focusable inline-flex items-center gap-1.5 rounded-[var(--adm-radius-md)] border border-[var(--adm-border-strong)] px-3 py-1.5 text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text)] hover:bg-[var(--adm-surface-sunken)]"
            >
              <IconExternalLink size={16} /> Edit on site
            </a>
          ) : null}
          {isContentItem ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<IconPlus size={16} />}
              onClick={doNewVariant}
              disabled={busy}
            >
              New variant
            </Button>
          ) : null}
          <Button size="sm" leftIcon={<IconRocket size={16} />} onClick={doPublish} loading={busy}>
            Publish
          </Button>
        </div>
      </div>

      {/* Lock */}
      {lockHeld ? (
        <LockBanner
          holder={record.lock?.owner_label ?? 'another editor'}
          since={record.lock?.acquired_at}
          now={now || undefined}
          onForceRelease={owner ? doTakeOver : undefined}
        />
      ) : null}

      {/* Chat-first layout (T9.14): conversation center, live preview right,
          the classic forms one click away in the Details drawer. */}
      <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="flex min-h-[28rem] flex-col lg:max-h-[calc(100vh-18rem)]">
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-[var(--adm-border)] pb-3">
            <AgentChip agent={chat.agent} />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<IconWrench size={16} />}
              onClick={() => setDetailsOpen(true)}
            >
              Details
            </Button>
          </div>
          <ChatThread
            events={chat.events}
            status={chat.status}
            pending={chat.pending}
            busy={chat.busy}
            onApprove={(editedArgs) => chat.pending && void chat.approve(chat.pending.call_id, editedArgs)}
            onDeny={(reason) => chat.pending && void chat.deny(chat.pending.call_id, reason)}
            emptyHint={
              <EmptyState
                title={`Talk to ${chat.agent?.name ?? 'the site agent'} about this ${objectTypeLabel(record.object_type).toLowerCase()}`}
                message="It reads the object and its contract, proposes changes, and every write waits for your approval."
              />
            }
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
              suggestions={suggestions}
              above={
                readiness && readinessOpenItems > 0 ? (
                  <details className="rounded-[var(--adm-radius-md)] border border-[var(--adm-border)] bg-[var(--adm-surface-sunken)] px-3 py-2">
                    <summary className="cursor-pointer select-none text-[length:var(--adm-text-xs)] font-medium text-[var(--adm-warning)]">
                      {readinessOpenItems} readiness item{readinessOpenItems === 1 ? '' : 's'} before publish
                    </summary>
                    <div className="mt-2">
                      <ReadinessList groups={readiness} />
                    </div>
                  </details>
                ) : null
              }
            />
          </div>
        </Card>

        <div className="flex min-h-0 flex-col gap-3">
          <Card
            kicker="Live preview"
            title={undefined}
            className="min-h-[20rem] overflow-auto lg:max-h-[calc(100vh-18rem)]"
          >
            <ObjectPreview record={record} />
          </Card>
        </div>
      </div>

      {/* Details drawer — the classic CMS forms, one click away, never gone. */}
      <Drawer open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Details" width={560}>
        <Tabs
          tabs={[
            { id: 'details', label: 'Details', content: <GeneratedInspector record={record} onEditOnSite={url} /> },
            { id: 'history', label: 'History', content: <HistoryTimeline entries={history} now={now || undefined} /> },
            {
              id: 'raw',
              label: 'Raw',
              content: (
                <pre className="max-h-[28rem] overflow-auto rounded-[var(--adm-radius-md)] bg-[var(--adm-surface-sunken)] p-3 text-[length:var(--adm-text-xs)] text-[var(--adm-text)]">
                  {JSON.stringify(record, null, 2)}
                </pre>
              ),
            },
          ]}
        />
      </Drawer>

      {/* Secondary actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--adm-border)] pt-4">
        <Button variant="secondary" onClick={() => setConfirmDiscard(true)} disabled={busy}>
          Discard changes
        </Button>
        <IconButton
          label="Back to library"
          icon={<IconExternalLink size={18} />}
          onClick={() => window.location.assign('/admin/content')}
        />
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={doDiscard}
        title="Discard changes?"
        message="This reverts the working copy to the last published state. This cannot be undone."
        confirmLabel="Discard"
        tone="danger"
      />
    </div>
  );
}

export default function ObjectWorkspace() {
  return (
    <AdminShell currentPath="/admin/content" title="Object workspace">
      <WorkspaceBody />
    </AdminShell>
  );
}
