import { timingSafeEqual } from 'node:crypto';

import { getAdminStateFromEvent, getHeader } from '../lib/admin-auth.js';

type LambdaEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type GitHubRef = {
  object: {
    sha: string;
  };
};

type GitHubCommit = {
  tree: {
    sha: string;
  };
};

type GitHubBlob = {
  sha: string;
};

type GitHubTree = {
  sha: string;
};

type GitHubAuthor = {
  name: string;
  email: string;
};

type PublishFile = {
  base64?: unknown;
  name?: unknown;
  type?: unknown;
};

type AgentImageInput = {
  base64?: unknown;
  content?: unknown;
  encoding?: unknown;
  name?: unknown;
  repoPath?: unknown;
  type?: unknown;
};

type PublishInput = {
  articlePath?: unknown;
  author?: unknown;
  category?: unknown;
  content?: unknown;
  ctaLink?: unknown;
  ctaText?: unknown;
  draft?: unknown;
  excerpt?: unknown;
  files?: unknown;
  featuredImage?: unknown;
  existingFeaturedImagePath?: unknown;
  images?: unknown;
  markdown?: unknown;
  overwrite?: unknown;
  publishDate?: unknown;
  seoDescription?: unknown;
  slug?: unknown;
  tags?: unknown;
  title?: unknown;
  commitMessage?: unknown;
  videoLink?: unknown;
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const repoContentRoot = 'src/data/post';
const uploadRoot = 'src/assets/images/uploads';
const githubApiRoot = 'https://api.github.com';

class PublishError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'PublishError';
    this.statusCode = statusCode;
  }
}

type MediaEntry = {
  content: string;
  displayPath: string;
  encoding: 'base64' | 'utf-8';
  path: string;
};

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

const sanitizeFilename = (value: string) => {
  const normalized = value
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || undefined;
};

const escapeYaml = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

const toBooleanValue = (value: unknown) => value === true || value === 'true' || value === 'on';

const secretsMatch = (provided: string, expected: string) => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
};

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

const isExpectedArticlePath = (path: string, slug: string) => path === `${repoContentRoot}/${slug}.md`;

const isValidUploadedImagePath = (path: string) => {
  const prefix = `${uploadRoot}/`;
  return path.startsWith(prefix) && path.length > prefix.length && !path.endsWith('/');
};

const isValidImagePath = (path: string, slug: string) => {
  const prefix = `${uploadRoot}/${slug}/`;
  return isValidUploadedImagePath(path) && path.startsWith(prefix) && path.length > prefix.length;
};

const normalizeExistingFeaturedImagePath = (value: unknown) => {
  const rawPath = toStringValue(value);
  if (!rawPath) return undefined;

  const repoPath = rawPath.startsWith('~/assets/images/uploads/')
    ? rawPath.replace('~/assets/images/uploads/', `${uploadRoot}/`)
    : rawPath.startsWith('/src/assets/images/uploads/')
      ? rawPath.slice(1)
      : rawPath.startsWith(`${uploadRoot}/`)
        ? rawPath
        : undefined;

  const normalizedPath = repoPath ? normalizeRepoPath(repoPath) : undefined;

  if (!normalizedPath || !isValidUploadedImagePath(normalizedPath)) {
    throw new PublishError(403, `existingFeaturedImagePath must be under ${uploadRoot}/ and include a filename.`);
  }

  return normalizedPath.replace(`${uploadRoot}/`, '~/assets/images/uploads/');
};

const hasFrontmatter = (markdown: string) => markdown.trimStart().startsWith('---');

const parseTags = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((tag) => toStringValue(tag)).filter((tag): tag is string => Boolean(tag));
  }

  const tags = toStringValue(value);
  return tags
    ? tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
};

const verifyPublisher = async (event: LambdaEvent) => {
  const publishKey = getHeader(event.headers, 'x-publish-key').trim();

  if (publishKey) {
    const publishSecret = process.env.PUBLISH_SECRET;

    if (!publishSecret) {
      return jsonResponse(401, {
        error: 'Service publishing is not configured. Set PUBLISH_SECRET in Netlify.',
      });
    }

    if (secretsMatch(publishKey, publishSecret)) {
      return undefined;
    }

    console.warn('Rejected publish request with invalid x-publish-key. Falling back to Clerk auth.');
  }

  const adminState = await getAdminStateFromEvent(event);

  if (!adminState.authenticated) {
    const statusCode = adminState.error === 'Clerk authentication is not configured.' ? 500 : 401;
    const error =
      adminState.error === 'A valid Clerk session token is required.'
        ? 'A valid x-publish-key header or Clerk session token is required to publish articles.'
        : adminState.error || 'A valid x-publish-key header or Clerk session token is required to publish articles.';

    return jsonResponse(statusCode, { error });
  }

  if (!adminState.isAdmin) {
    return jsonResponse(403, { error: 'This Clerk user is not authorized to publish articles.' });
  }

  return undefined;
};

const parseBody = (event: LambdaEvent): PublishInput | undefined => {
  if (!event.body) return undefined;

  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  const contentType = getHeader(event.headers, 'content-type');

  if (contentType.includes('application/json')) {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as PublishInput) : undefined;
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(body);
    return Object.fromEntries(params.entries()) as PublishInput;
  }

  return undefined;
};

const buildFrontmatter = ({
  author,
  category,
  content,
  ctaLink,
  ctaText,
  draft,
  excerpt,
  imagePath,
  publishDate,
  seoDescription,
  tags,
  title,
  videoLink,
}: {
  author?: string;
  category?: string;
  content: string;
  ctaLink?: string;
  ctaText?: string;
  draft?: boolean;
  excerpt?: string;
  imagePath?: string;
  publishDate: string;
  seoDescription?: string;
  tags: string[];
  title: string;
  videoLink?: string;
}) => {
  const lines = [
    '---',
    `publishDate: ${publishDate}`,
    `title: "${escapeYaml(title)}"`,
    ...(draft ? ['draft: true'] : []),
    ...(excerpt ? [`excerpt: "${escapeYaml(excerpt)}"`] : []),
    ...(imagePath ? [`image: "${escapeYaml(imagePath)}"`] : []),
    ...(videoLink ? [`video: "${escapeYaml(videoLink)}"`] : []),
    ...(ctaLink ? [`ctaLink: "${escapeYaml(ctaLink)}"`] : []),
    ...(ctaText ? [`ctaText: "${escapeYaml(ctaText)}"`] : []),
    ...(category ? [`category: "${escapeYaml(category)}"`] : []),
    ...(tags.length ? ['tags:', ...tags.map((tag) => `  - "${escapeYaml(tag)}"`)] : []),
    ...(author ? [`author: "${escapeYaml(author)}"`] : []),
    ...(seoDescription ? ['metadata:', `  description: "${escapeYaml(seoDescription)}"`] : []),
    '---',
    '',
  ];

  return `${lines.join('\n')}${content.trim()}\n`;
};

const githubRequest = async <T>(path: string, token: string, init: RequestInit = {}) => {
  const response = await fetch(`${githubApiRoot}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'dr-lurie-netlify-publisher',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new PublishError(
      response.status === 401 || response.status === 403 ? 403 : 500,
      `GitHub API ${response.status} for ${path}: ${body}`
    );
  }

  return (await response.json()) as T;
};

const githubExists = async (repo: string, branch: string, path: string, token: string) => {
  const response = await fetch(
    `${githubApiRoot}/repos/${repo}/contents/${encodeURIComponent(path).replaceAll('%2F', '/')}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'dr-lurie-netlify-publisher',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );

  if (response.status === 404) return false;
  if (response.ok) return true;

  const body = await response.text();
  throw new PublishError(
    response.status === 401 || response.status === 403 ? 403 : 500,
    `GitHub API ${response.status} while checking ${path}: ${body}`
  );
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

const getMediaEntries = (input: PublishInput, slug: string): MediaEntry[] => {
  const files = Array.isArray(input.files) ? (input.files as PublishFile[]) : [];
  const uploadedFiles = files
    .map((file) => ({
      base64: toStringValue(file.base64),
      name: toStringValue(file.name),
      type: toStringValue(file.type),
    }))
    .filter((file): file is { base64: string; name: string; type: string | undefined } =>
      Boolean(file.base64 && file.name)
    );

  const adminEntries = uploadedFiles.map((file) => {
    const filename = sanitizeFilename(file.name);

    if (!filename) {
      throw new PublishError(400, `Invalid upload filename: ${file.name}`);
    }

    return {
      content: file.base64,
      displayPath: `~/assets/images/uploads/${slug}/${filename}`,
      encoding: 'base64' as const,
      path: `${uploadRoot}/${slug}/${filename}`,
    };
  });

  const images = Array.isArray(input.images) ? (input.images as AgentImageInput[]) : [];
  const agentEntries = images.map((image) => {
    const repoPath = toStringValue(image.repoPath);
    const filename = toStringValue(image.name);
    const normalizedPath = repoPath ? normalizeRepoPath(repoPath) : undefined;
    const path = normalizedPath ?? (filename ? `${uploadRoot}/${slug}/${sanitizeFilename(filename) ?? ''}` : undefined);

    if (!path || !isValidImagePath(path, slug)) {
      throw new PublishError(403, `Image repoPath values must be under ${uploadRoot}/${slug}/ and include a filename.`);
    }

    const content = toStringValue(image.base64) ?? toStringValue(image.content);

    if (!content) {
      throw new PublishError(400, `Image content is required for ${path}.`);
    }

    return {
      content,
      displayPath: path.replace(`${uploadRoot}/`, '~/assets/images/uploads/'),
      encoding: toStringValue(image.encoding) === 'utf-8' ? ('utf-8' as const) : ('base64' as const),
      path,
    };
  });

  return [...adminEntries, ...agentEntries];
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const authResponse = await verifyPublisher(event);

  if (authResponse) {
    return authResponse;
  }

  let input: PublishInput | undefined;

  try {
    input = parseBody(event);
  } catch {
    return jsonResponse(400, {
      error: 'Invalid request body. Send JSON from the publishing form or Agent Builder.',
    });
  }

  if (!input) {
    return jsonResponse(400, { error: 'Missing request body.' });
  }

  const rawSlug = toStringValue(input.slug);
  const slug = rawSlug ? slugify(rawSlug) : undefined;
  const markdownInput = toStringValue(input.markdown);
  const content = toStringValue(input.content);
  const title = toStringValue(input.title);
  const publishDate = toStringValue(input.publishDate) ?? new Date().toISOString();
  const isAgentPayload = Boolean(markdownInput || input.articlePath || input.images || input.commitMessage);
  const missing = [
    !slug ? 'slug' : undefined,
    !markdownInput && !content ? (isAgentPayload ? 'markdown' : 'content') : undefined,
    !markdownInput && !isAgentPayload && !title ? 'title' : undefined,
    !isAgentPayload && !publishDate ? 'publishDate' : undefined,
  ].filter(Boolean);

  if (missing.length) {
    return jsonResponse(400, {
      error: `Missing required field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
    });
  }

  if (!isAgentPayload && Number.isNaN(Date.parse(publishDate))) {
    return jsonResponse(400, { error: 'publishDate must be a valid date string.' });
  }

  const rawArticlePath = toStringValue(input.articlePath) ?? `${repoContentRoot}/${slug}.md`;
  const articlePath = normalizeRepoPath(rawArticlePath);

  if (!slug || !articlePath || !isExpectedArticlePath(articlePath, slug)) {
    return jsonResponse(403, {
      error: `articlePath must be ${repoContentRoot}/{slug}.md.`,
      articlePath: rawArticlePath,
    });
  }

  const token = process.env.GITHUB_CONTENT_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH ?? process.env.BRANCH ?? 'main';

  if (!token || !repo) {
    return jsonResponse(500, {
      error: 'Publishing is not configured. Set GITHUB_CONTENT_TOKEN and GITHUB_REPOSITORY in Netlify.',
    });
  }

  const overwrite = input.overwrite === true || input.overwrite === 'true';
  let publishImagePaths: string[] = [];

  try {
    const duplicateArticle = await githubExists(repo, branch, articlePath, token);

    if (duplicateArticle && !overwrite) {
      return jsonResponse(409, {
        error: `An article already exists at ${articlePath}. Enable overwrite to replace it.`,
        articlePath,
        path: articlePath,
      });
    }

    const mediaEntries = getMediaEntries(input, slug);
    publishImagePaths = mediaEntries.map((entry) => entry.path);
    const featuredImage = toStringValue(input.featuredImage);
    const selectedFeatured = featuredImage ? sanitizeFilename(featuredImage) : undefined;
    const uploadedImagePath = selectedFeatured
      ? mediaEntries.find((entry) => entry.path.endsWith(`/${selectedFeatured}`))?.displayPath
      : undefined;
    const existingFeaturedImage = uploadedImagePath
      ? undefined
      : normalizeExistingFeaturedImagePath(toStringValue(input.existingFeaturedImagePath) ?? featuredImage);
    const imagePath = uploadedImagePath ?? existingFeaturedImage;
    const markdown = markdownInput
      ? hasFrontmatter(markdownInput)
        ? markdownInput
        : buildFrontmatter({
            author: toStringValue(input.author),
            category: toStringValue(input.category),
            content: markdownInput,
            ctaLink: toStringValue(input.ctaLink),
            ctaText: toStringValue(input.ctaText),
            draft: toBooleanValue(input.draft),
            excerpt: toStringValue(input.excerpt) ?? toStringValue(input.seoDescription),
            imagePath,
            publishDate,
            seoDescription: toStringValue(input.seoDescription),
            tags: parseTags(input.tags),
            title: title ?? slug,
            videoLink: toStringValue(input.videoLink),
          })
      : buildFrontmatter({
          author: toStringValue(input.author),
          category: toStringValue(input.category),
          content: content ?? '',
          ctaLink: toStringValue(input.ctaLink),
          ctaText: toStringValue(input.ctaText),
          draft: toBooleanValue(input.draft),
          excerpt: toStringValue(input.excerpt) ?? toStringValue(input.seoDescription),
          imagePath,
          publishDate,
          seoDescription: toStringValue(input.seoDescription),
          tags: parseTags(input.tags),
          title: title ?? slug,
          videoLink: toStringValue(input.videoLink),
        });

    const ref = await githubRequest<GitHubRef>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
    const commit = await githubRequest<GitHubCommit>(`/repos/${repo}/git/commits/${ref.object.sha}`, token);
    const markdownBlob = await githubRequest<GitHubBlob>(`/repos/${repo}/git/blobs`, token, {
      method: 'POST',
      body: JSON.stringify({ content: markdown, encoding: 'utf-8' }),
    });
    const mediaBlobs = await Promise.all(
      mediaEntries.map(async (entry) => ({
        ...entry,
        blob: await githubRequest<GitHubBlob>(`/repos/${repo}/git/blobs`, token, {
          method: 'POST',
          body: JSON.stringify({ content: entry.content, encoding: entry.encoding }),
        }),
      }))
    );
    const tree = await githubRequest<GitHubTree>(`/repos/${repo}/git/trees`, token, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: commit.tree.sha,
        tree: [
          { path: articlePath, mode: '100644', type: 'blob', sha: markdownBlob.sha },
          ...mediaBlobs.map((entry) => ({
            path: entry.path,
            mode: '100644',
            type: 'blob',
            sha: entry.blob.sha,
          })),
        ],
      }),
    });
    const authorName = process.env.GITHUB_COMMIT_AUTHOR_NAME ?? 'Dr. Lurié Publisher';
    const authorEmail = process.env.GITHUB_COMMIT_AUTHOR_EMAIL ?? 'publisher@drlurie.local';
    const author: GitHubAuthor = { name: authorName, email: authorEmail };
    const commitMessage =
      toStringValue(input.commitMessage) ??
      `${overwrite && duplicateArticle ? 'Update' : 'Publish'} article: ${title ?? slug}`;
    const newCommit = await githubRequest<{ sha: string }>(`/repos/${repo}/git/commits`, token, {
      method: 'POST',
      body: JSON.stringify({
        author,
        committer: author,
        message: commitMessage,
        parents: [ref.object.sha],
        tree: tree.sha,
      }),
    });

    await githubRequest(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ force: false, sha: newCommit.sha }),
    });

    const imagePaths = publishImagePaths;
    const message = `Article publish queued for ${articlePath}.`;

    return jsonResponse(201, {
      success: true,
      articlePath,
      imagePaths,
      deployStatus: 'queued',
      message,
      commit: newCommit.sha,
      media: imagePaths,
      ok: true,
      path: articlePath,
    });
  } catch (error) {
    console.error('Failed to publish article.', {
      articlePath,
      slug,
      imagePaths: publishImagePaths,
      error,
    });

    if (error instanceof PublishError) {
      return jsonResponse(error.statusCode, { error: error.message });
    }

    if (error instanceof PublishError) {
      return jsonResponse(error.statusCode, { error: error.message });
    }

    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Article could not be published.',
    });
  }
};
