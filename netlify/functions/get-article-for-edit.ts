import { Buffer } from 'node:buffer';

import { getAdminStateFromEvent } from '../lib/admin-auth.js';

type LambdaEvent = {
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
};

type GitHubContentFile = {
  content?: string;
  encoding?: string;
  path?: string;
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const repoContentRoot = 'src/data/post';
const githubApiRoot = 'https://api.github.com';

class EditArticleError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'EditArticleError';
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

const parseScalar = (value: string) => {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^['"](.*)['"]$/s);
  return quoted ? quoted[1].replace(/\\([\\"])/g, '$1') : trimmed;
};

const parseFrontmatter = (markdown: string) => {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { data: {} as Record<string, unknown>, content: markdown };

  const data: Record<string, unknown> = {};
  const lines = match[1].split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;

    const [, key, rawValue] = pair;

    if (rawValue === '') {
      const nested: Record<string, string> = {};
      const list: string[] = [];

      while (
        index + 1 < lines.length &&
        (/^\s+/.test(lines[index + 1]) || lines[index + 1].trimStart().startsWith('-'))
      ) {
        index += 1;
        const child = lines[index].trim();
        const listItem = child.match(/^-\s*(.*)$/);
        const nestedPair = child.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);

        if (listItem) {
          list.push(parseScalar(listItem[1]));
        } else if (nestedPair) {
          nested[nestedPair[1]] = parseScalar(nestedPair[2]);
        }
      }

      data[key] = list.length ? list : nested;
    } else if (rawValue === 'true' || rawValue === 'false') {
      data[key] = rawValue === 'true';
    } else {
      data[key] = parseScalar(rawValue);
    }
  }

  return {
    data,
    content: markdown.slice(match[0].length),
  };
};

const githubRequest = async <T>(path: string, token: string) => {
  const response = await fetch(`${githubApiRoot}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'dr-lurie-netlify-editor',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (response.status === 404) {
    throw new EditArticleError(404, 'Article not found.');
  }

  if (!response.ok) {
    const body = await response.text();
    throw new EditArticleError(
      response.status === 401 || response.status === 403 ? 403 : 500,
      `GitHub API ${response.status} for ${path}: ${body}`
    );
  }

  return (await response.json()) as T;
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
    return jsonResponse(403, { error: 'This Clerk user is not authorized to edit articles.' });
  }

  const rawSlug = toStringValue(event.queryStringParameters?.slug);
  const slug = rawSlug ? slugify(rawSlug) : undefined;

  if (!slug) {
    return jsonResponse(400, { error: 'A valid slug query parameter is required.' });
  }

  const token = process.env.GITHUB_CONTENT_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH ?? process.env.BRANCH ?? 'main';

  if (!token || !repo) {
    return jsonResponse(500, {
      error: 'Article editing is not configured. Set GITHUB_CONTENT_TOKEN and GITHUB_REPOSITORY in Netlify.',
    });
  }

  const articlePath = `${repoContentRoot}/${slug}.md`;

  try {
    const file = await githubRequest<GitHubContentFile>(
      `/repos/${repo}/contents/${encodeURIComponent(articlePath).replaceAll('%2F', '/')}?ref=${encodeURIComponent(branch)}`,
      token
    );

    if (file.encoding !== 'base64' || !file.content) {
      return jsonResponse(500, { error: 'Article content could not be decoded.' });
    }

    const markdown = Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8');
    const { data, content } = parseFrontmatter(markdown);
    const metadata =
      data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {};

    return jsonResponse(200, {
      article: {
        slug,
        title: toStringValue(data.title) ?? '',
        excerpt: toStringValue(data.excerpt) ?? '',
        publishDate: toStringValue(data.publishDate) ?? '',
        author: toStringValue(data.author) ?? '',
        category: toStringValue(data.category) ?? '',
        tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        draft: data.draft === true,
        content,
        featuredImage: toStringValue(data.image) ?? '',
        videoLink: toStringValue(data.video) ?? '',
        ctaLink: toStringValue(data.ctaLink) ?? '',
        ctaText: toStringValue(data.ctaText) ?? '',
        seoDescription: toStringValue(metadata.description) ?? '',
        markdown,
        articlePath,
      },
    });
  } catch (error) {
    console.error('Failed to load article for editing.', { articlePath, slug, error });

    if (error instanceof EditArticleError) {
      return jsonResponse(error.statusCode, { error: error.message });
    }

    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Article could not be loaded for editing.',
    });
  }
};
