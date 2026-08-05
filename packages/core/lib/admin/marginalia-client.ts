/**
 * Marginalia (W15 S4, MVP) — the thin browser client over the four
 * marginalia_* object-verb actions, mirroring edit-mode/verbs-client.ts's
 * wrapper style: `callObjectVerb` is the SAME transport every other admin
 * surface already uses (admin-object.ts, Netlify Identity bearer token) — this
 * file adds no new transport, just typed request/response shapes for the four
 * actions. Shared by both the canvas panel (edit-mode/marginalia-panel.ts)
 * and the library/workspace tab (admin/MarginaliaThreadList.tsx) — the ONE
 * client this system needs regardless of which surface is calling it.
 */
import { callObjectVerb, type GetToken } from '../edit-mode/verbs-client.js';
import type {
  MarginaliaComment,
  MarginaliaThreadStatus,
  MarginaliaThreadWithComments,
} from '../../schema/marginalia-v1.js';

export type MarginaliaAnchorInput = {
  sectionId?: string;
  nodeId?: string;
  field?: string;
  selectedText?: string;
};

export type MarginaliaResult<T extends Record<string, unknown>> = { status: number; error?: string } & T;

/** Open a new thread with its first comment. No lock required. */
export const createMarginaliaThread = async (
  getToken: GetToken,
  objectType: string,
  objectId: string,
  body: string,
  anchor: MarginaliaAnchorInput = {}
): Promise<MarginaliaResult<{ thread?: MarginaliaThreadWithComments }>> => {
  const result = await callObjectVerb(getToken, {
    action: 'marginalia_create',
    object_type: objectType,
    object_id: objectId,
    body,
    ...(anchor.sectionId !== undefined ? { section_id: anchor.sectionId } : {}),
    ...(anchor.nodeId !== undefined ? { node_id: anchor.nodeId } : {}),
    ...(anchor.field !== undefined ? { field: anchor.field } : {}),
    ...(anchor.selectedText !== undefined ? { selected_text: anchor.selectedText } : {}),
  });
  return {
    status: result.status,
    thread: result.body.thread as MarginaliaThreadWithComments | undefined,
    error: result.body.error as string | undefined,
  };
};

/** Reply to an existing thread. No lock required. */
export const replyToMarginaliaThread = async (
  getToken: GetToken,
  objectType: string,
  objectId: string,
  threadId: string,
  body: string,
  parentCommentId?: string
): Promise<MarginaliaResult<{ comment?: MarginaliaComment }>> => {
  const result = await callObjectVerb(getToken, {
    action: 'marginalia_reply',
    object_type: objectType,
    object_id: objectId,
    thread_id: threadId,
    body,
    ...(parentCommentId !== undefined ? { parent_comment_id: parentCommentId } : {}),
  });
  return {
    status: result.status,
    comment: result.body.comment as MarginaliaComment | undefined,
    error: result.body.error as string | undefined,
  };
};

/** Every thread (with its full comment list, oldest first) for one object. */
export const listMarginaliaThreads = async (
  getToken: GetToken,
  objectType: string,
  objectId: string
): Promise<MarginaliaResult<{ threads: MarginaliaThreadWithComments[] }>> => {
  const result = await callObjectVerb(getToken, {
    action: 'marginalia_list',
    object_type: objectType,
    object_id: objectId,
  });
  return {
    status: result.status,
    threads: Array.isArray(result.body.threads) ? (result.body.threads as MarginaliaThreadWithComments[]) : [],
    error: result.body.error as string | undefined,
  };
};

/** resolved | dismissed | open (re-opens). One status flag per thread. */
export const setMarginaliaThreadStatus = async (
  getToken: GetToken,
  objectType: string,
  objectId: string,
  threadId: string,
  status: MarginaliaThreadStatus
): Promise<MarginaliaResult<{ thread?: MarginaliaThreadWithComments }>> => {
  const result = await callObjectVerb(getToken, {
    action: 'marginalia_resolve',
    object_type: objectType,
    object_id: objectId,
    thread_id: threadId,
    status,
  });
  return {
    status: result.status,
    thread: result.body.thread as MarginaliaThreadWithComments | undefined,
    error: result.body.error as string | undefined,
  };
};
