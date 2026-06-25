import { Buffer } from 'node:buffer';

import { getAdminStateFromEvent, type LambdaContext } from '../lib/admin-auth.js';

type LambdaEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type ToggleInput = {
  published_time?: unknown;
  slug?: unknown;
};

type GitHubContentFile = {
  content?: string;
  encoding?: string;
  path?: string;
  sha?: string;
};

type GitHubContentUpdate = {
  commit?: {
    sha?: string;
  };
  content?: {
    path?: string;
  };
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const repoContentRoot = 'src/data/post';
const githubApiRoot = 'https://api.github.com';

class TogglePublishError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'TogglePublishError';
    this.statusCode = statusCode;
  }
}

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

const toStringValue = (value: unknown) => {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeRepoPath = (value: string) => {
  if (value.startsWith('/') || value.includes('\\')) return undefined;

  const normalized = value.split('/').reduce<string[]>((parts, part) => {
    if (!part || part === '.') return parts;
    if (part === '..') {
      parts.pop();
      return parts;
    }
    parts.push(part);
    return parts;
  }, []);

  const path = normalized.join('/');
  return path === value && !path.startsWith('../') ? path : undefined;
};

const isExpectedArticlePath = (path: string | undefined, slug: string) => path === `${repoContentRoot}/${slug}.md`;

const parseBody = (event: LambdaEvent): ToggleInput | undefined => {
  if (!event.body) return undefined;

  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const parsed = JSON.parse(body) as unknown;

  return parsed && typeof parsed === 'object' ? (parsed as ToggleInput) : undefined;
};

const updatePublishedTimeFrontmatter = (markdown: string, publishedTime: string | null) => {
  const frontmatterMatch = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  const line = publishedTime === null ? 'published_time: null' : `published_time: ${publishedTime}`;

  if (!frontmatterMatch) {
    return `---\n${line}\n---\n\n${markdown}`;
  }

  const block = frontmatterMatch[1];
  const lineEnding = block.includes('\r\n') ? '\r\n' : '\n';
  const lines = block.split(/\r?\n/);
  let sawPublishedTime = false;
  const nextLines = lines.reduce<string[]>((accumulator, existingLine) => {
    if (/^published_time\s*:/i.test(existingLine.trim())) {
      sawPublishedTime = true;
      accumulator.push(line);
      return accumulator;
    }

    if (/^draft\s*:/i.test(existingLine.trim())) return accumulator;

    accumulator.push(existingLine);
    return accumulator;
  }, []);

  if (!sawPublishedTime) {
    const publishDateIndex = nextLines.findIndex((existingLine) => /^publishDate\s*:/i.test(existingLine.trim()));
    const insertIndex = publishDateIndex >= 0 ? publishDateIndex + 1 : nextLines.length;
    nextLines.splice(insertIndex, 0, line);
  }

  const frontmatter = `---${lineEnding}${nextLines.join(lineEnding)}${lineEnding}---${lineEnding}`;
  return `${frontmatter}${markdown.slice(frontmatterMatch[0].length)}`;
};

const githubRequest = async <T>(path: string, token: string, init: RequestInit = {}) => {
  const response = await fetch(`${githubApiRoot}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'dr-lurie-netlify-publish-toggle',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  });

  if (response.status === 404) {
    throw new TogglePublishError(404, 'Article not found.');
  }

  if (!response.ok) {
    const body = await response.text();
    throw new TogglePublishError(
      response.status === 401 || response.status === 403 ? 403 : 500,
      `GitHub API ${response.status} for ${path}: ${body}`
    );
  }

  return (await response.json()) as T;
};

export const handler = async (event: LambdaEvent, context?: LambdaContext) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const adminState = await getAdminStateFromEvent(event, context);

  if (!adminState.authenticated) {
    return jsonResponse(401, {
      error: adminState.error || 'Authentication is required.',
    });
  }

  if (!adminState.isAdmin) {
    return jsonResponse(403, { error: 'This user is not authorized to update article publish status.' });
  }

  let input: ToggleInput | undefined;

  try {
    input = parseBody(event);
  } catch {
    return jsonResponse(400, { error: 'Invalid request body. Send JSON with slug and published_time.' });
  }

  const rawSlug = toStringValue(input?.slug);
  const slug = rawSlug ? slugify(rawSlug) : undefined;

  const publishedTime = input?.published_time === null ? null : toStringValue(input?.published_time);
  if (!slug || (publishedTime !== null && (!publishedTime || Number.isNaN(Date.parse(publishedTime))))) {
    return jsonResponse(400, { error: 'A valid slug and published_time value are required.' });
  }

  const token = process.env.GITHUB_CONTENT_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH ?? process.env.BRANCH ?? 'main';

  if (!token || !repo) {
    return jsonResponse(500, {
      error: 'Article publish toggles are not configured. Set GITHUB_CONTENT_TOKEN and GITHUB_REPOSITORY in Netlify.',
    });
  }

  const articlePath = normalizeRepoPath(`${repoContentRoot}/${slug}.md`);

  if (!articlePath || !isExpectedArticlePath(articlePath, slug)) {
    return jsonResponse(403, { error: `slug must resolve to ${repoContentRoot}/{slug}.md.` });
  }

  try {
    const encodedPath = encodeURIComponent(articlePath).replaceAll('%2F', '/');
    const file = await githubRequest<GitHubContentFile>(
      `/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
      token
    );

    if (!isExpectedArticlePath(file.path, slug)) {
      return jsonResponse(403, {
        error: `GitHub returned an unexpected path. Expected ${repoContentRoot}/${slug}.md.`,
        path: file.path,
      });
    }

    if (file.encoding !== 'base64' || !file.content || !file.sha) {
      return jsonResponse(500, { error: 'Article content could not be decoded.' });
    }

    const markdown = Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8');
    const nextMarkdown = updatePublishedTimeFrontmatter(markdown, publishedTime);

    if (nextMarkdown === markdown) {
      return jsonResponse(200, {
        ok: true,
        slug,
        published_time: publishedTime,
        articlePath,
        commit: null,
      });
    }

    const result = await githubRequest<GitHubContentUpdate>(`/repos/${repo}/contents/${encodedPath}`, token, {
      method: 'PUT',
      body: JSON.stringify({
        branch,
        content: Buffer.from(nextMarkdown, 'utf8').toString('base64'),
        message: `Update publish state: ${slug}`,
        sha: file.sha,
      }),
    });

    return jsonResponse(200, {
      ok: true,
      slug,
      published_time: publishedTime,
      articlePath,
      commit: result.commit?.sha ?? null,
    });
  } catch (error) {
    console.error('Failed to update article publish status.', { articlePath, slug, error });

    if (error instanceof TogglePublishError) {
      return jsonResponse(error.statusCode, { error: error.message });
    }

    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Article publish status could not be updated.',
    });
  }
};
