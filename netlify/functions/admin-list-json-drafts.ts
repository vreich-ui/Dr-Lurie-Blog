import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { collectBlobListItems, type BlobListResult } from '../lib/blob-list.js';
import { getWorkflowBlobStore } from '../lib/blob-store.js';
import { getContentSourceMarkdown } from '../../src/lib/contentSourceBody.js';
import type { ContentSourceV1, WorkflowRecord } from '../../src/schema/schema-v1.js';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

type LambdaEvent = {
  blobs?: string;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
};

type WorkflowBlobStore = Awaited<ReturnType<typeof getWorkflowBlobStore>> & {
  list?: (options?: {
    prefix?: string;
    directories?: boolean;
    paginate?: boolean;
  }) => Promise<BlobListResult> | AsyncIterable<BlobListResult>;
};

type DraftSummary = {
  id: string;
  key: string;
  title: string;
  slug: string;
  author: string;
  updatedAt: string;
  readiness: {
    isReady: boolean;
    missing: string[];
    ready: number;
    total: number;
  };
};

const recordPrefix = 'workflows/by-id/';
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object');

const toText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const wordCount = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

const getPayload = (input: ContentSourceV1) => input.publication?.publish_payload;

const getDraftMarkdown = (input: ContentSourceV1) => getContentSourceMarkdown(input);

const getDraftFields = (record: WorkflowRecord) => {
  const payload = getPayload(record.input);
  const title = toText(payload?.title) || toText(record.input.content?.title) || 'Untitled draft';
  const slug = toText(payload?.slug);
  const author = toText(payload?.author);
  const markdown = getDraftMarkdown(record.input);

  return { author, markdown, slug, title };
};

const isAdminDraftRecord = (record: WorkflowRecord) => {
  const payload = getPayload(record.input);

  return Boolean(
    record.request_id.startsWith('admin-draft-') ||
      record.input.publication?.publication_status === 'draft' ||
      payload?.draft === true ||
      record.history.some((entry) => entry.action === 'admin_save_draft')
  );
};

const toDraftSummary = (key: string, record: WorkflowRecord): DraftSummary => {
  const { author, markdown, slug, title } = getDraftFields(record);
  const missing = [
    ...(title && title !== 'Untitled draft' ? [] : ['title']),
    ...(author ? [] : ['author']),
    ...(slugPattern.test(slug) ? [] : ['valid slug']),
    ...(wordCount(markdown) >= 5 ? [] : ['markdown 5+ words']),
  ];
  const total = 4;

  return {
    id: record.request_id,
    key,
    title,
    slug,
    author,
    updatedAt: record.updated_at,
    readiness: {
      isReady: missing.length === 0,
      missing,
      ready: total - missing.length,
      total,
    },
  };
};

const listBlobKeys = async (store: WorkflowBlobStore, prefix: string) => {
  if (typeof store.list !== 'function') {
    throw new Error('Workflow blob store does not support listing draft records.');
  }

  const result = await store.list({ prefix, directories: false, paginate: true });
  const blobs = await collectBlobListItems(result);

  return blobs.map((blob) => blob.key).filter((key) => key.endsWith('.json'));
};

const loadRecord = async (store: WorkflowBlobStore, key: string) => {
  const raw = await store.get(key);
  if (!raw) return undefined;

  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || typeof parsed.request_id !== 'string' || !isRecord(parsed.input)) return undefined;

  return parsed as WorkflowRecord;
};

const listJsonDrafts = async (store: WorkflowBlobStore) => {
  const keys = await listBlobKeys(store, recordPrefix);
  const records = await Promise.all(
    keys.map(async (key) => {
      const record = await loadRecord(store, key);

      return record && isAdminDraftRecord(record) ? toDraftSummary(key, record) : undefined;
    })
  );

  return records
    .filter((record): record is DraftSummary => Boolean(record))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const adminState = await getAdminStateFromEvent(event);
  if (!adminState.authenticated) {
    return jsonResponse(adminState.error === 'Clerk authentication is not configured.' ? 500 : 401, {
      error: adminState.error || 'A valid Clerk session token is required.',
    });
  }

  if (!adminState.isAdmin) {
    return jsonResponse(403, { error: 'This Clerk user is not authorized to list JSON drafts.' });
  }

  try {
    const store = await getWorkflowBlobStore(event);
    const drafts = await listJsonDrafts(store);

    return jsonResponse(200, { drafts });
  } catch (error) {
    console.error('Failed to list admin JSON drafts.', error);

    return jsonResponse(500, { error: 'JSON drafts could not be listed.' });
  }
};
