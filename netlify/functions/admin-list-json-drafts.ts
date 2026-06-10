import { Buffer } from 'node:buffer';

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

type PublishedSummary = {
  exists: boolean;
  date: string;
  by: string;
  articlePath: string;
};

type DraftSummary = {
  id: string;
  key: string;
  title: string;
  slug: string;
  author: string;
  updatedAt: string;
  savedAt: string;
  savedBy: string;
  published: PublishedSummary;
  lifecycleStatus: 'saved' | 'published' | 'modified';
  readiness: {
    isReady: boolean;
    missing: string[];
    ready: number;
    total: number;
  };
};

const recordPrefix = 'workflows/by-id/';
const repoContentRoot = 'src/data/post';
const githubApiRoot = 'https://api.github.com';
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object');

const toText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const wordCount = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

const getHistoryDetails = (entry: WorkflowRecord['history'][number]) =>
  entry.details && typeof entry.details === 'object' ? (entry.details as Record<string, unknown>) : {};

const getLastHistoryEntry = (record: WorkflowRecord, action: string) =>
  [...record.history].reverse().find((entry) => entry.action === action);

const getSavedMetadata = (record: WorkflowRecord, author: string) => {
  const savedEntry = getLastHistoryEntry(record, 'admin_save_draft');
  const details = savedEntry ? getHistoryDetails(savedEntry) : {};
  return {
    savedAt: savedEntry?.at || record.updated_at,
    savedBy: toText(details.owner_label) || (details.created_by_admin ? 'Admin' : '') || author || 'Unknown',
  };
};

const getMarkedPublishedMetadata = (record: WorkflowRecord, author: string) => {
  const publishedEntry = getLastHistoryEntry(record, 'mark_published');
  const details = publishedEntry ? getHistoryDetails(publishedEntry) : {};
  return {
    date: publishedEntry?.at || '',
    by: toText(details.owner_label) || author || 'Unknown',
  };
};

const parseFrontmatterScalar = (markdown: string, key: string) => {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return '';
  const line = match[1]
    .split('\n')
    .find((candidate) => candidate.trim().toLowerCase().startsWith(`${key.toLowerCase()}:`));
  if (!line) return '';
  return line
    .slice(line.indexOf(':') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\([\\"])/g, '$1');
};

const githubRequest = async <T>(path: string, token: string) => {
  const response = await fetch(`${githubApiRoot}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'dr-lurie-netlify-json-draft-list',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return (await response.json()) as T;
};

type GitHubContentFile = {
  content?: string;
  encoding?: string;
  path?: string;
};

const getPublishedArticleMetadata = async (slug: string, record: WorkflowRecord, author: string) => {
  const articlePath = `${repoContentRoot}/${slug}.md`;
  const token = process.env.GITHUB_CONTENT_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH ?? process.env.BRANCH ?? 'main';
  const marked = getMarkedPublishedMetadata(record, author);

  if (!slug || !token || !repo) {
    return { exists: false, date: marked.date, by: marked.by, articlePath };
  }

  try {
    const file = await githubRequest<GitHubContentFile>(
      `/repos/${repo}/contents/${encodeURIComponent(articlePath).replaceAll('%2F', '/')}?ref=${encodeURIComponent(branch)}`,
      token
    );

    if (!file || file.encoding !== 'base64' || !file.content) {
      return { exists: false, date: marked.date, by: marked.by, articlePath };
    }

    const markdown = Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8');
    return {
      exists: true,
      date: marked.date || parseFrontmatterScalar(markdown, 'publishDate'),
      by: marked.by || parseFrontmatterScalar(markdown, 'author') || author || 'Unknown',
      articlePath,
    };
  } catch (error) {
    console.warn('Published article metadata could not be loaded for JSON draft status.', { articlePath, error });
    return { exists: false, date: marked.date, by: marked.by, articlePath };
  }
};

const getLifecycleStatus = (savedAt: string, published: PublishedSummary): DraftSummary['lifecycleStatus'] => {
  if (!published.exists) return 'saved';
  if (savedAt && published.date && Date.parse(savedAt) > Date.parse(published.date)) return 'modified';
  return 'published';
};

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

const toDraftSummary = async (key: string, record: WorkflowRecord): Promise<DraftSummary> => {
  const { author, markdown, slug, title } = getDraftFields(record);
  const { savedAt, savedBy } = getSavedMetadata(record, author);
  const published = await getPublishedArticleMetadata(slug, record, author);
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
    savedAt,
    savedBy,
    published,
    lifecycleStatus: getLifecycleStatus(savedAt, published),
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

      return record && isAdminDraftRecord(record) ? await toDraftSummary(key, record) : undefined;
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
