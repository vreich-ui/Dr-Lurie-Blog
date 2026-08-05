/**
 * MarginaliaThreadList (W15 S4, MVP) — the library/workspace "Comments" tab.
 *
 * Object-level anchor only (no section/node sub-anchoring — the workspace has
 * no sub-object addressing UI). This tab alone gives 12/12 object-type
 * coverage: it is the surface that makes the client's hard "cover every
 * object type" requirement true even for the eight types with no canvas
 * presence (site, theme, template, section_template, product, taxonomy,
 * tracking_config, editorial_voice).
 *
 * Flat list, no reply-threading UI (parentCommentId exists in the data model
 * but stays unused by this MVP client — same as the canvas panel).
 */
import { useEffect, useState } from 'react';

import { Badge, Button, EmptyState } from './primitives';
import { Textarea } from './forms';
import { useToast } from './overlays';
import { principalName } from '@core/lib/admin/display-name';
import {
  createMarginaliaThread,
  listMarginaliaThreads,
  replyToMarginaliaThread,
  setMarginaliaThreadStatus,
} from '@core/lib/admin/marginalia-client';
import type { MarginaliaThreadStatus, MarginaliaThreadWithComments } from '@core/schema/marginalia-v1';
import type { ObjectType } from '@core/schema/object-record-v1';

async function getToken(): Promise<string> {
  const m = await import('@core/lib/admin/goTrueClient');
  return (await m.getAccessToken()) ?? '';
}

function statusTone(status: MarginaliaThreadStatus): 'success' | 'info' | 'neutral' {
  if (status === 'open') return 'info';
  if (status === 'resolved') return 'success';
  return 'neutral';
}

function ThreadCard({
  thread,
  onReply,
  onSetStatus,
}: {
  thread: MarginaliaThreadWithComments;
  onReply: (threadId: string, body: string) => Promise<void>;
  onSetStatus: (threadId: string, status: MarginaliaThreadStatus) => Promise<void>;
}) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const runStatus = (status: MarginaliaThreadStatus) => {
    setBusy(true);
    void onSetStatus(thread.id, status).finally(() => setBusy(false));
  };

  const runReply = () => {
    const body = reply.trim();
    if (!body) return;
    setBusy(true);
    void onReply(thread.id, body)
      .then(() => setReply(''))
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Badge tone={statusTone(thread.status)}>{thread.status}</Badge>
        <div className="flex gap-2">
          {thread.status === 'open' ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => runStatus('resolved')} disabled={busy}>
                Resolve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => runStatus('dismissed')} disabled={busy}>
                Dismiss
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => runStatus('open')} disabled={busy}>
              Reopen
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {thread.comments.map((comment) => (
          <div key={comment.id} className="text-[length:var(--adm-text-sm)]">
            <div className="text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
              <span className="font-medium text-[var(--adm-text)]">{principalName(comment.author)}</span>{' '}
              {new Date(comment.at).toLocaleString()}
            </div>
            <p className="whitespace-pre-wrap text-[var(--adm-text)]">{comment.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <Textarea
          rows={2}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Reply…"
          className="flex-1"
        />
        <Button size="sm" onClick={runReply} disabled={busy || !reply.trim()}>
          Reply
        </Button>
      </div>
    </div>
  );
}

export function MarginaliaThreadList({ objectType, objectId }: { objectType: ObjectType; objectId: string }) {
  const { toast } = useToast();
  const [threads, setThreads] = useState<MarginaliaThreadWithComments[] | null>(null);
  const [composer, setComposer] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const result = await listMarginaliaThreads(getToken, objectType, objectId);
    if (result.status === 200) setThreads(result.threads);
    else toast({ title: 'Could not load comments', description: result.error, tone: 'danger' });
  };

  useEffect(() => {
    // objectType/objectId identify which object's thread list to load — a
    // change to either means a different object, so the effect must re-run.
    void load();
  }, [objectType, objectId]);

  const create = async () => {
    const body = composer.trim();
    if (!body) return;
    setBusy(true);
    try {
      const result = await createMarginaliaThread(getToken, objectType, objectId, body);
      if (result.status === 200) {
        setComposer('');
        await load();
      } else {
        toast({ title: 'Could not post comment', description: result.error, tone: 'danger' });
      }
    } finally {
      setBusy(false);
    }
  };

  const reply = async (threadId: string, body: string) => {
    const result = await replyToMarginaliaThread(getToken, objectType, objectId, threadId, body);
    if (result.status === 200) await load();
    else toast({ title: 'Could not post reply', description: result.error, tone: 'danger' });
  };

  const setStatus = async (threadId: string, status: MarginaliaThreadStatus) => {
    const result = await setMarginaliaThreadStatus(getToken, objectType, objectId, threadId, status);
    if (result.status === 200) await load();
    else toast({ title: 'Could not update thread', description: result.error, tone: 'danger' });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <Textarea
          rows={2}
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          placeholder="Start a new comment thread…"
          className="flex-1"
        />
        <Button size="sm" onClick={() => void create()} disabled={busy || !composer.trim()}>
          Comment
        </Button>
      </div>
      {threads === null ? null : threads.length === 0 ? (
        <EmptyState title="No comments yet" message="Start a thread above." />
      ) : (
        <div className="flex flex-col gap-3">
          {threads.map((thread) => (
            <ThreadCard key={thread.id} thread={thread} onReply={reply} onSetStatus={setStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

export default MarginaliaThreadList;
