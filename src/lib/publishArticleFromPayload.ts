export type PublishArticlePayload = {
  slug: string;
  title?: string;
  markdown?: string;
  content?: string;
  publishDate?: string;
  draft?: boolean;
  author?: string;
  category?: string;
  tags?: string[] | string;
  excerpt?: string;
  overwrite?: boolean;
  images?: unknown[];
  featuredImage?: string;
  videoLink?: string;
  ctaLink?: string;
  ctaText?: string;
  seoDescription?: string;
  commitMessage?: string;
};

export type PublishArticleResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

const escapeYaml = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const toText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeTags = (tags: PublishArticlePayload['tags']) => {
  if (Array.isArray(tags)) return tags.map((tag) => toText(tag)).filter(Boolean);
  if (typeof tags === 'string')
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  return [];
};

const buildMarkdownFromPayload = (
  payload: PublishArticlePayload,
  publishDate: string,
  bodyContent: string = toText(payload.content)
) => {
  const title = toText(payload.title) || toText(payload.slug);
  const content = bodyContent;
  const tags = normalizeTags(payload.tags);
  const frontmatter = [
    '---',
    `title: "${escapeYaml(title)}"`,
    `publishDate: ${publishDate}`,
    ...(payload.draft ? ['draft: true'] : []),
    ...(toText(payload.excerpt) ? [`excerpt: "${escapeYaml(toText(payload.excerpt))}"`] : []),
    ...(toText(payload.featuredImage) ? [`image: "${escapeYaml(toText(payload.featuredImage))}"`] : []),
    ...(toText(payload.videoLink) ? [`video: "${escapeYaml(toText(payload.videoLink))}"`] : []),
    ...(toText(payload.ctaLink) ? [`ctaLink: "${escapeYaml(toText(payload.ctaLink))}"`] : []),
    ...(toText(payload.ctaText) ? [`ctaText: "${escapeYaml(toText(payload.ctaText))}"`] : []),
    ...(toText(payload.category) ? [`category: "${escapeYaml(toText(payload.category))}"`] : []),
    ...(tags.length ? ['tags:', ...tags.map((tag) => `  - "${escapeYaml(tag)}"`)] : []),
    ...(toText(payload.author) ? [`author: "${escapeYaml(toText(payload.author))}"`] : []),
    ...(toText(payload.seoDescription)
      ? ['metadata:', `  description: "${escapeYaml(toText(payload.seoDescription))}"`]
      : []),
    '---',
    '',
  ];

  return `${frontmatter.join('\n')}${content}\n`;
};

const hasFrontmatter = (markdown: string) => markdown.trimStart().startsWith('---');

type ClerkWindow = Window & {
  Clerk?: {
    session?: {
      getToken?: () => Promise<unknown>;
    };
  };
};

const getClerkSessionToken = async () => {
  const clerk = (window as ClerkWindow).Clerk;
  const token = await clerk?.session?.getToken?.();
  return typeof token === 'string' ? token : '';
};

export const publishArticleFromPayload = async (payload: PublishArticlePayload): Promise<PublishArticleResult> => {
  const slug = toText(payload.slug);
  if (!slug) {
    return { ok: false, status: 400, body: { error: 'slug is required.' } };
  }

  const publishDate = toText(payload.publishDate) || new Date().toISOString();
  const markdownInput = toText(payload.markdown);
  const markdown = markdownInput
    ? hasFrontmatter(markdownInput)
      ? markdownInput
      : buildMarkdownFromPayload(payload, publishDate, markdownInput)
    : buildMarkdownFromPayload(payload, publishDate);

  const requestBody = {
    ...payload,
    slug,
    markdown,
    publishDate,
    tags: normalizeTags(payload.tags),
  };

  try {
    const token = await getClerkSessionToken();
    if (!token) {
      return { ok: false, status: 401, body: { error: 'Could not retrieve a Clerk session token.' } };
    }

    const response = await fetch('/.netlify/functions/publish-article', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify(requestBody),
    });

    const body = await response.json().catch(() => ({ error: `Publish failed with status ${response.status}.` }));
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      body: { error: error instanceof Error ? error.message : 'Article could not be published.' },
    };
  }
};
