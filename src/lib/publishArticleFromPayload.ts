export type PublishArticlePayload = {
  slug: string;
  title?: string;
  markdown?: string;
  content?: string;
  publishDate?: string;
  requestId?: string;
  request_id?: string;
  lock_token?: string;
  author?: string;
  category?: string;
  tags?: string[] | string;
  excerpt?: string;
  overwrite?: boolean;
  images?: unknown[];
  mediaEntries?: unknown[];
  artifactReferences?: unknown[];
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

const toText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeTags = (tags: PublishArticlePayload['tags']) => {
  if (Array.isArray(tags)) return tags.map((tag) => toText(tag)).filter(Boolean);
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
};

import { getAccessToken } from '~/utils/goTrueClient';

export const publishArticleFromPayload = async (payload: PublishArticlePayload): Promise<PublishArticleResult> => {
  const slug = toText(payload.slug);
  if (!slug) {
    return { ok: false, status: 400, body: { error: 'slug is required.' } };
  }

  const publishDate = toText(payload.publishDate) || new Date().toISOString();
  const markdown = toText(payload.markdown);

  const requestBody = {
    ...payload,
    slug,
    markdown,
    publishDate,
    tags: normalizeTags(payload.tags),
  };

  try {
    const token = await getAccessToken();
    if (!token) {
      return { ok: false, status: 401, body: { error: 'Could not retrieve an identity token. Please sign in.' } };
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
