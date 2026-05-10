import { verifyToken } from '@clerk/backend';

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

type PublishInput = {
  author?: unknown;
  category?: unknown;
  content?: unknown;
  ctaLink?: unknown;
  ctaText?: unknown;
  draft?: unknown;
  excerpt?: unknown;
  files?: unknown;
  featuredImage?: unknown;
  overwrite?: unknown;
  publishDate?: unknown;
  seoDescription?: unknown;
  slug?: unknown;
  tags?: unknown;
  title?: unknown;
  videoLink?: unknown;
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const repoContentRoot = 'src/data/post';
const uploadRoot = 'src/assets/images/uploads';
const githubApiRoot = 'https://api.github.com';

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

const getHeader = (headers: LambdaEvent['headers'], name: string) => {
  const normalizedName = name.toLowerCase();
  const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);

  return match?.[1] ?? '';
};

const getBearerToken = (authorization: string) => {
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
};

const verifyClerkSession = async (event: LambdaEvent) => {
  const token = getBearerToken(getHeader(event.headers, 'authorization'));

  if (!token) {
    return jsonResponse(401, { error: 'A Clerk session token is required to publish articles.' });
  }

  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!secretKey) {
    return jsonResponse(500, { error: 'Publishing authentication is not configured.' });
  }

  try {
    const verifiedToken = await verifyToken(token, { secretKey });

    if (!verifiedToken.sub) {
      return jsonResponse(401, { error: 'Invalid Clerk session token.' });
    }
  } catch (error) {
    console.warn('Rejected publish request with invalid Clerk session token.', error);
    return jsonResponse(401, { error: 'Invalid Clerk session token.' });
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
    throw new Error(`GitHub API ${response.status} for ${path}: ${body}`);
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
  throw new Error(`GitHub API ${response.status} while checking ${path}: ${body}`);
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const authResponse = await verifyClerkSession(event);

  if (authResponse) {
    return authResponse;
  }

  let input: PublishInput | undefined;

  try {
    input = parseBody(event);
  } catch {
    return jsonResponse(400, { error: 'Invalid request body. Send JSON from the publishing form.' });
  }

  if (!input) {
    return jsonResponse(400, { error: 'Missing request body.' });
  }

  const title = toStringValue(input.title);
  const rawSlug = toStringValue(input.slug);
  const content = toStringValue(input.content);
  const slug = rawSlug ? slugify(rawSlug) : undefined;
  const publishDate = toStringValue(input.publishDate) ?? new Date().toISOString();
  const missing = [
    !title ? 'title' : undefined,
    !slug ? 'slug' : undefined,
    !content ? 'content' : undefined,
    !publishDate ? 'publishDate' : undefined,
  ].filter(Boolean);

  if (missing.length) {
    return jsonResponse(400, {
      error: `Missing required field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
    });
  }

  if (Number.isNaN(Date.parse(publishDate))) {
    return jsonResponse(400, { error: 'publishDate must be a valid date string.' });
  }

  const token = process.env.GITHUB_CONTENT_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH ?? process.env.BRANCH ?? 'main';

  if (!token || !repo) {
    return jsonResponse(500, {
      error: 'Publishing is not configured. Set GITHUB_CONTENT_TOKEN and GITHUB_REPOSITORY in Netlify.',
    });
  }

  const articlePath = `${repoContentRoot}/${slug}.md`;
  const overwrite = input.overwrite === true || input.overwrite === 'true';

  try {
    const duplicateArticle = await githubExists(repo, branch, articlePath, token);

    if (duplicateArticle && !overwrite) {
      return jsonResponse(409, {
        error: `An article already exists at ${articlePath}. Enable overwrite to replace it.`,
        path: articlePath,
      });
    }

    const files = Array.isArray(input.files) ? (input.files as PublishFile[]) : [];
    const uploadedFiles = files
      .map((file) => ({
        base64: toStringValue(file.base64),
        name: toStringValue(file.name),
        type: toStringValue(file.type),
      }))
      .filter((file): file is { base64: string; name: string; type?: string } =>
        Boolean(file.base64 && file.name)
      );

    const mediaEntries = uploadedFiles.map((file) => {
      const filename = sanitizeFilename(file.name);

      if (!filename) {
        throw new Error(`Invalid upload filename: ${file.name}`);
      }

      return {
        content: file.base64,
        displayPath: `~/assets/images/uploads/${slug}/${filename}`,
        path: `${uploadRoot}/${slug}/${filename}`,
      };
    });

    const featuredImage = toStringValue(input.featuredImage);
    const selectedFeatured = featuredImage ? sanitizeFilename(featuredImage) : undefined;
    const imagePath = selectedFeatured
      ? mediaEntries.find((entry) => entry.path.endsWith(`/${selectedFeatured}`))?.displayPath
      : undefined;
    const markdown = buildFrontmatter({
      author: toStringValue(input.author),
      category: toStringValue(input.category),
      content,
      ctaLink: toStringValue(input.ctaLink),
      ctaText: toStringValue(input.ctaText),
      draft: toBooleanValue(input.draft),
      excerpt: toStringValue(input.excerpt) ?? toStringValue(input.seoDescription),
      imagePath,
      publishDate,
      seoDescription: toStringValue(input.seoDescription),
      tags: parseTags(input.tags),
      title,
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
          body: JSON.stringify({ content: entry.content, encoding: 'base64' }),
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
    const newCommit = await githubRequest<{ sha: string }>(`/repos/${repo}/git/commits`, token, {
      method: 'POST',
      body: JSON.stringify({
        author,
        committer: author,
        message: `${overwrite && duplicateArticle ? 'Update' : 'Publish'} article: ${title}`,
        parents: [ref.object.sha],
        tree: tree.sha,
      }),
    });

    await githubRequest(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ force: false, sha: newCommit.sha }),
    });

    return jsonResponse(201, {
      commit: newCommit.sha,
      media: mediaEntries.map((entry) => entry.path),
      ok: true,
      path: articlePath,
    });
  } catch (error) {
    console.error('Failed to publish article.', error);

    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'Article could not be published.',
    });
  }
};
