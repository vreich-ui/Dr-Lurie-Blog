/**
 * Marginalia (W15 S4, MVP) — blob-store-backed thread/comment CRUD.
 *
 * Pure against an INJECTED store (the same shape blob-store.ts's
 * getMarginaliaBlobStore returns) so this is unit-testable with a fake store,
 * exactly like agent-learning-trail.ts / object-verbs.ts's own test harness
 * (agent-learning-patch.test.ts's makeStore). No CAS/locking anywhere here —
 * every write is an unconditional setJSON, resolve/dismiss included:
 * last-write-wins is an accepted, documented tradeoff for a comment thread's
 * stakes (comments must be postable by multiple people concurrently without
 * taking the content object's edit lock).
 */
import { randomUUID } from 'node:crypto';

import { collectBlobListItems, type BlobListResponse } from './blob-list.js';
import {
  MARGINALIA_INDEX_MARKER_VALUE,
  marginaliaCommentKey,
  marginaliaCommentsPrefix,
  marginaliaThreadIndexKey,
  marginaliaThreadIndexPrefix,
  marginaliaThreadKey,
} from './marginalia-store-keys.js';
import type { ObjectType, Principal } from '../../schema/object-record-v1.js';
import type {
  MarginaliaComment,
  MarginaliaThread,
  MarginaliaThreadStatus,
  MarginaliaThreadWithComments,
} from '../../schema/marginalia-v1.js';

export type MarginaliaStore = {
  get(key: string): Promise<string | null | undefined>;
  setJSON(key: string, value: unknown): Promise<void | { modified: boolean; etag?: string }>;
  list(options: { prefix: string; directories?: boolean; paginate?: boolean }): Promise<BlobListResponse>;
};

const loadJson = async <T>(store: MarginaliaStore, key: string): Promise<T | undefined> => {
  const raw = await store.get(key);
  return raw ? (JSON.parse(raw) as T) : undefined;
};

export type ThreadAnchorInput = {
  sectionId?: string;
  nodeId?: string;
  field?: string;
  selectedText?: string;
};

export type CreateThreadParams = {
  objectType: ObjectType;
  objectId: string;
  anchor: ThreadAnchorInput;
  body: string;
  author: Principal;
  at: string;
  /** The object's content_revision at post time — provenance on the first comment. */
  contentRevision: number;
  /** Injectable for deterministic tests; mints a fresh id via randomUUID otherwise. */
  threadId?: string;
  commentId?: string;
};

export type CreateThreadResult = { thread: MarginaliaThread; comment: MarginaliaComment };

export const createMarginaliaThread = async (
  store: MarginaliaStore,
  params: CreateThreadParams
): Promise<CreateThreadResult> => {
  const threadId = params.threadId ?? `mgt_${randomUUID()}`;
  const commentId = params.commentId ?? `mgc_${randomUUID()}`;

  const thread: MarginaliaThread = {
    id: threadId,
    anchor: {
      objectType: params.objectType,
      objectId: params.objectId,
      ...(params.anchor.sectionId !== undefined ? { sectionId: params.anchor.sectionId } : {}),
      ...(params.anchor.nodeId !== undefined ? { nodeId: params.anchor.nodeId } : {}),
      ...(params.anchor.field !== undefined ? { field: params.anchor.field } : {}),
      ...(params.anchor.selectedText !== undefined ? { selectedText: params.anchor.selectedText } : {}),
    },
    status: 'open',
    created_at: params.at,
    created_by: params.author,
  };
  const comment: MarginaliaComment = {
    id: commentId,
    at: params.at,
    author: params.author,
    body: params.body,
    at_content_revision: params.contentRevision,
  };

  await store.setJSON(marginaliaThreadKey(params.objectType, params.objectId, threadId), thread);
  await store.setJSON(marginaliaCommentKey(params.objectType, params.objectId, threadId, commentId), comment);
  await store.setJSON(
    marginaliaThreadIndexKey(params.objectType, params.objectId, threadId),
    MARGINALIA_INDEX_MARKER_VALUE
  );

  return { thread, comment };
};

export type AddCommentParams = {
  objectType: ObjectType;
  objectId: string;
  threadId: string;
  body: string;
  author: Principal;
  at: string;
  contentRevision: number;
  parentCommentId?: string;
  commentId?: string;
};

export type AddCommentResult = { ok: true; comment: MarginaliaComment } | { ok: false; error: 'thread_not_found' };

export const addMarginaliaComment = async (
  store: MarginaliaStore,
  params: AddCommentParams
): Promise<AddCommentResult> => {
  const thread = await loadJson<MarginaliaThread>(
    store,
    marginaliaThreadKey(params.objectType, params.objectId, params.threadId)
  );
  if (!thread) return { ok: false, error: 'thread_not_found' };

  const commentId = params.commentId ?? `mgc_${randomUUID()}`;
  const comment: MarginaliaComment = {
    id: commentId,
    at: params.at,
    author: params.author,
    body: params.body,
    at_content_revision: params.contentRevision,
    ...(params.parentCommentId !== undefined ? { parentCommentId: params.parentCommentId } : {}),
  };
  await store.setJSON(marginaliaCommentKey(params.objectType, params.objectId, params.threadId, commentId), comment);
  return { ok: true, comment };
};

export const listMarginaliaThreads = async (
  store: MarginaliaStore,
  objectType: ObjectType,
  objectId: string
): Promise<MarginaliaThreadWithComments[]> => {
  const indexItems = await collectBlobListItems(
    await store.list({ prefix: marginaliaThreadIndexPrefix(objectType, objectId), directories: false, paginate: true })
  );
  const threads: MarginaliaThreadWithComments[] = [];
  for (const item of indexItems) {
    const threadId = item.key.split('/').at(-1);
    if (!threadId) continue;
    const thread = await loadJson<MarginaliaThread>(store, marginaliaThreadKey(objectType, objectId, threadId));
    if (!thread) continue; // index marker outlived its thread header — skip rather than throw

    const commentItems = await collectBlobListItems(
      await store.list({
        prefix: marginaliaCommentsPrefix(objectType, objectId, threadId),
        directories: false,
        paginate: true,
      })
    );
    const comments: MarginaliaComment[] = [];
    for (const commentItem of commentItems) {
      const comment = await loadJson<MarginaliaComment>(store, commentItem.key);
      if (comment) comments.push(comment);
    }
    comments.sort((a, b) => a.at.localeCompare(b.at));
    threads.push({ ...thread, comments });
  }
  threads.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return threads;
};

export type SetThreadStatusParams = {
  objectType: ObjectType;
  objectId: string;
  threadId: string;
  status: MarginaliaThreadStatus;
};

export type SetThreadStatusResult = { ok: true; thread: MarginaliaThread } | { ok: false; error: 'thread_not_found' };

export const setMarginaliaThreadStatus = async (
  store: MarginaliaStore,
  params: SetThreadStatusParams
): Promise<SetThreadStatusResult> => {
  const key = marginaliaThreadKey(params.objectType, params.objectId, params.threadId);
  const thread = await loadJson<MarginaliaThread>(store, key);
  if (!thread) return { ok: false, error: 'thread_not_found' };
  const next: MarginaliaThread = { ...thread, status: params.status };
  await store.setJSON(key, next);
  return { ok: true, thread: next };
};
