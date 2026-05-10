type LambdaEvent = {
  body?: string | null;
  httpMethod?: string;
};

type UploadFile = {
  path?: string;
  content?: string;
  encoding?: string;
};

type PublishPayload = {
  slug?: string;
  postPath?: string;
  markdown?: string;
  postImage?: string;
  overwrite?: boolean;
  files?: UploadFile[];
};

type GitHubContentResponse = {
  sha?: string;
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const branch = 'main';

const safeContentPathPattern = /^(src\/data\/post\/[a-z0-9-]+\.md|public\/images\/uploads\/[a-z0-9-]+\/[a-z0-9][a-z0-9.-]*)$/;

const respond = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

const encodeBase64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');

const getRepository = () => {
  const repository = process.env.GITHUB_REPOSITORY;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (repository && /^[^/]+\/[^/]+$/.test(repository)) return repository;
  if (owner && repo) return `${owner}/${repo}`;

  return '';
};

const getToken = () => process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const parsePayload = (event: LambdaEvent): PublishPayload | undefined => {
  if (!event.body) return undefined;

  try {
    return JSON.parse(event.body) as PublishPayload;
  } catch (error) {
    return undefined;
  }
};

const isSafePath = (path: string) => safeContentPathPattern.test(path);

const githubRequest = async <T>(repository: string, path: string, init: RequestInit = {}) => {
  const token = getToken();
  const [contentPath, query] = path.split('?');
  const contentUrl = `https://api.github.com/repos/${repository}/contents/${encodeURIComponent(contentPath).replaceAll('%2F', '/')}`;
  const response = await fetch(`${contentUrl}${query ? `?${query}` : ''}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });

  if (response.status === 404) return { response, data: undefined as T | undefined };

  let data: T | undefined;
  try {
    data = (await response.json()) as T;
  } catch (error) {
    data = undefined;
  }

  return { response, data };
};

const getExistingSha = async (repository: string, path: string) => {
  const { response, data } = await githubRequest<GitHubContentResponse>(
    repository,
    `${path}?ref=${encodeURIComponent(branch)}`,
    { method: 'GET' }
  );

  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Unable to inspect ${path}.`);

  return data?.sha;
};

const putFile = async ({
  repository,
  path,
  content,
  message,
  sha,
}: {
  repository: string;
  path: string;
  content: string;
  message: string;
  sha?: string;
}) => {
  const { response, data } = await githubRequest<GitHubContentResponse>(repository, path, {
    method: 'PUT',
    body: JSON.stringify({
      branch,
      content,
      message,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!response.ok) throw new Error(`Unable to write ${path}.`);

  return data;
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const repository = getRepository();
  const token = getToken();

  if (!repository || !token) {
    return respond(500, { error: 'GitHub publishing is not configured.' });
  }

  const payload = parsePayload(event);

  if (!payload?.slug || !payload.postPath || !payload.markdown) {
    return respond(400, { error: 'A slug, postPath, and markdown body are required.' });
  }

  if (!isSafePath(payload.postPath)) {
    return respond(400, { error: 'The requested post path is not allowed.' });
  }

  const files = Array.isArray(payload.files) ? payload.files : [];

  for (const file of files) {
    if (!file.path || !file.content || file.encoding !== 'base64' || !isSafePath(file.path)) {
      return respond(400, { error: 'One or more uploaded files are invalid.' });
    }
  }

  try {
    const existingPostSha = await getExistingSha(repository, payload.postPath);

    if (existingPostSha && !payload.overwrite) {
      return respond(409, { error: 'A post with this slug already exists.', path: payload.postPath });
    }

    const writtenFiles = [];

    for (const file of files) {
      const existingFileSha = await getExistingSha(repository, file.path as string);
      await putFile({
        repository,
        path: file.path as string,
        content: file.content as string,
        message: `Upload ${file.path}`,
        sha: existingFileSha,
      });
      writtenFiles.push(file.path);
    }

    await putFile({
      repository,
      path: payload.postPath,
      content: encodeBase64(payload.markdown),
      message: `${existingPostSha ? 'Update' : 'Publish'} ${payload.slug}`,
      sha: existingPostSha,
    });

    return respond(200, {
      branch,
      ok: true,
      path: payload.postPath,
      postImage: payload.postImage || undefined,
      files: writtenFiles,
    });
  } catch (error) {
    console.error('Failed to publish post to GitHub.', error);
    return respond(500, { error: error instanceof Error ? error.message : 'Post could not be published.' });
  }
};
