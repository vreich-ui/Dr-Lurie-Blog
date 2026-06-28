/**
 * Admin-authenticated single-node write-back.
 * Requires an active workflow lock held by the caller.
 * Updates only node.public fields; increments record version; preserves the lock.
 *
 * POST body: { requestId, lockToken, nodeId, updatedPublicFields }
 */
import { z } from 'zod';

import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { getWorkflowBlobStore } from '../lib/blob-store.js';
import type { ArticleBodyNode } from '../../src/schema/article-content-v1.js';
import type { WorkflowRecord } from '../../src/schema/schema-v1.js';

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const updatedPublicFieldsSchema = z
  .object({
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    items: z.array(z.string()).optional(),
    ctaText: z.string().optional(),
    ctaLink: z.string().optional(),
    label: z.string().optional(),
    media: z
      .object({
        type: z.enum(['image', 'video', 'audio', 'embed']),
        src: z.string(),
        alt: z.string().optional(),
        caption: z.string().optional(),
      })
      .optional(),
  })
  .strict();

const bodySchema = z
  .object({
    requestId: z.string().min(1),
    lockToken: z.string().min(1),
    nodeId: z.string().regex(/^n_[a-zA-Z0-9]+$/),
    updatedPublicFields: updatedPublicFieldsSchema,
  })
  .strict();

type LambdaEvent = {
  blobs?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const recordKey = (requestId: string) => `workflows/by-id/${requestId}.json`;

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const adminState = await getAdminStateFromEvent(event);
  if (!adminState.authenticated) return jsonResponse(401, { error: adminState.error ?? 'Unauthorized' });
  if (!adminState.isAdmin) return jsonResponse(403, { error: 'Admin access required' });

  let rawBody: unknown;
  try {
    const text =
      event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : (event.body ?? '');
    rawBody = JSON.parse(text);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return jsonResponse(400, { error: 'Invalid request', issues: parsed.error.issues });

  const { requestId, lockToken, nodeId, updatedPublicFields } = parsed.data;

  try {
    const store = await getWorkflowBlobStore(event);
    const raw = await store.get(recordKey(requestId));
    if (!raw) return jsonResponse(404, { error: 'Workflow record not found', not_found: true });

    const record = JSON.parse(raw) as WorkflowRecord;
    const nowMs = Date.now();

    if (!record.lock) return jsonResponse(423, { error: 'lock_expired', lock_expired: true });
    if (record.lock.token !== lockToken)
      return jsonResponse(423, {
        error: 'lock_mismatch',
        locked: true,
        lock: {
          owner_id: record.lock.owner_id,
          owner_label: record.lock.owner_label,
          expires_at: record.lock.expires_at,
        },
      });
    if (Date.parse(record.lock.expires_at) <= nowMs)
      return jsonResponse(423, { error: 'lock_expired', lock_expired: true });

    const nodes = record.input.content?.article_body?.nodes as ArticleBodyNode[] | undefined;
    if (!nodes) return jsonResponse(404, { error: 'Article body not found in workflow record' });

    const nodeIndex = nodes.findIndex((n) => n.id === nodeId);
    if (nodeIndex === -1) return jsonResponse(404, { error: `Node ${nodeId} not found` });

    const existing = nodes[nodeIndex];
    const updated: ArticleBodyNode = {
      ...existing,
      public: { ...existing.public, ...updatedPublicFields },
    };

    const updatedNodes = [...nodes.slice(0, nodeIndex), updated, ...nodes.slice(nodeIndex + 1)];

    const timestamp = new Date().toISOString();

    // Snapshot: store only the fields that changed (previous and next values).
    const changedKeys = Object.keys(updatedPublicFields) as (keyof typeof updatedPublicFields)[];
    const previousPublic: Record<string, unknown> = {};
    const nextPublic: Record<string, unknown> = {};
    for (const k of changedKeys) {
      previousPublic[k] = existing.public[k as keyof typeof existing.public];
      nextPublic[k] = updatedPublicFields[k];
    }

    const nextRecord: WorkflowRecord = {
      ...record,
      updated_at: timestamp,
      input: {
        ...record.input,
        content: {
          ...record.input.content,
          article_body: {
            ...record.input.content!.article_body!,
            nodes: updatedNodes,
          },
        },
      },
      history: [
        ...record.history,
        {
          at: timestamp,
          action: 'admin_update_node',
          details: {
            nodeId,
            updated_by: adminState.userId,
            updated_by_email: adminState.email,
            previousPublic,
            nextPublic,
          },
        },
      ],
      version: record.version + 1,
    };

    await store.setJSON(recordKey(requestId), nextRecord);

    return jsonResponse(200, { node: updated, version: nextRecord.version });
  } catch (error) {
    console.error('admin-update-node failed', { requestId, nodeId, error });
    return jsonResponse(500, { error: 'Failed to update node' });
  }
};
