import { Buffer } from 'node:buffer';

import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';
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
  articleExists: boolean;
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
  recordStatus:
    | 'published'
    | 'published_saved_json'
    | 'saved_json_only'
    | 'draft_workflow'
    | 'unpublished_changes'
    | 'mcp_workflow_record';
  lifecycleStatus?: 'saved' | 'published' | 'modified';
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

const getPublishedTime = (record: WorkflowRecord) => toText(record.input.publication?.published_time);

const hasLivePublishedTime = (record: WorkflowRecord) => {
  const value = getPublishedTime(record);
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) && ms <= Date.now();
};

const getSavedMetadata = (record: WorkflowRecord, author: string) => {
  const savedEntry = getLastHistoryEntry(record, 'admin_save_draft');
  const details = savedEntry ? getHistoryDetails(savedEntry) : {};
  return {
    savedAt: savedEntry?.at || record.updated_at,
    savedBy: toText(details.owner_label) || (details.created_by_admin ? 'Admin' : '') || author || 'Unknown',
  };
};

const getCommitMetadata = (details: Record<string, unknown>) =>
  details.commit_metadata && typeof details.commit_metadata === 'object'
    ? (details.commit_metadata as Record<string, unknown>)
    : {};

const getMarkedPublishedMetadata = (record: WorkflowRecord, author: string) => {
  const publishedEntry = getLastHistoryEntry(record, 'set_published_time');
  const details = publishedEntry ? getHistoryDetails(publishedEntry) : {};
  const commitMetadata = getCommitMetadata(details);
  const articlePath = toText(commitMetadata.articlePath) || toText(commitMetadata.article_path);
  const commit = toText(commitMetadata.commit) || toText(commitMetadata.sha);
  const reliable = Boolean(publishedEntry?.at && (articlePath || commit));

  return {
    date: reliable ? publishedEntry?.at || '' : '',
    by: reliable ? toText(details.owner_label) || author || 'Unknown' : '',
    reliable,
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
    return {
      exists: hasLivePublishedTime(record) || marked.reliable,
      date: marked.date,
      by: marked.by,
      articlePath,
      articleExists: false,
    };
  }

  try {
    const file = await githubRequest<GitHubContentFile>(
      `/repos/${repo}/contents/${encodeURIComponent(articlePath).replaceAll('%2F', '/')}?ref=${encodeURIComponent(branch)}`,
      token
    );

    if (!file || file.encoding !== 'base64' || !file.content) {
      return {
        exists: hasLivePublishedTime(record) || marked.reliable,
        date: marked.date,
        by: marked.by,
        articlePath,
        articleExists: false,
      };
    }

    const markdown = Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8');
    return {
      exists: true,
      date: marked.date || parseFrontmatterScalar(markdown, 'publishDate'),
      by: marked.by || parseFrontmatterScalar(markdown, 'author') || author || 'Unknown',
      articlePath,
      articleExists: true,
    };
  } catch (error) {
    console.warn('Published article metadata could not be loaded for JSON draft status.', { articlePath, error });
    return {
      exists: hasLivePublishedTime(record) || marked.reliable,
      date: marked.date,
      by: marked.by,
      articlePath,
      articleExists: false,
    };
  }
};

const isNewerIsoDate = (left: string, right: string) => {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime > rightTime;
};

const getRecordStatus = (
  _record: WorkflowRecord,
  savedAt: string,
  published: PublishedSummary,
  isAdminRecord: boolean
): DraftSummary['recordStatus'] => {
  if (published.exists && savedAt && published.date && isNewerIsoDate(savedAt, published.date))
    return 'unpublished_changes';
  if (published.articleExists) return 'published_saved_json';
  if (published.exists) return 'published';
  if (isAdminRecord) return 'draft_workflow';
  if (!isAdminRecord) return 'mcp_workflow_record';
  return 'saved_json_only';
};

const getLifecycleStatus = (recordStatus: DraftSummary['recordStatus']): DraftSummary['lifecycleStatus'] => {
  if (recordStatus === 'unpublished_changes') return 'modified';
  if (recordStatus === 'published' || recordStatus === 'published_saved_json') return 'published';
  return 'saved';
};

const getPayload = (_input: ContentSourceV1) => undefined as Record<string, unknown> | undefined;

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
  return Boolean(
    record.request_id.startsWith('admin-draft-') || record.history.some((entry) => entry.action === 'admin_save_draft')
  );
};

const toDraftSummary = async (key: string, record: WorkflowRecord): Promise<DraftSummary> => {
  const { author, markdown, slug, title } = getDraftFields(record);
  const { savedAt, savedBy } = getSavedMetadata(record, author);
  const published = await getPublishedArticleMetadata(slug, record, author);
  const adminRecord = isAdminDraftRecord(record);
  const recordStatus = getRecordStatus(record, savedAt, published, adminRecord);
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
    recordStatus,
    lifecycleStatus: getLifecycleStatus(recordStatus),
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

      return record ? await toDraftSummary(key, record) : undefined;
    })
  );

  return records
    .filter((record): record is DraftSummary => Boolean(record))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
};

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const adminState = await getAdminStateFromEvent(event, context);
  if (!adminState.authenticated) {
    return jsonResponse(401, {
      error: adminState.error || 'Authentication is required.',
    });
  }

  if (!adminState.isAdmin) {
    return jsonResponse(403, { error: 'This user is not authorized to list JSON drafts.' });
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
