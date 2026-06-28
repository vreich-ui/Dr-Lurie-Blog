/**
 * Article file-path generation from a title.
 * The path is always derived from the title; the request ID is used as a stable
 * suffix when uniqueness cannot be guaranteed from the slug alone.
 */

const SLUG_STRIP_RE = /[^a-z0-9\s_-]/g;
const WHITESPACE_RE = /[\s_]+/g;
const MULTI_DASH_RE = /-{2,}/g;
const TRIM_DASH_RE = /^-|-$/g;
const MAX_SLUG = 80;

export function slugifyTitle(title: string): string {
  const raw = title
    .toLowerCase()
    .replace(SLUG_STRIP_RE, '')
    .replace(WHITESPACE_RE, '-')
    .replace(MULTI_DASH_RE, '-')
    .slice(0, MAX_SLUG)
    .replace(TRIM_DASH_RE, '');
  return raw || 'untitled';
}

export function shortIdFromRequestId(requestId: string): string {
  return requestId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toLowerCase();
}

/**
 * Generate the article .md file path from a title.
 * Pass `forceId = true` when the admin detects a slug collision to append
 * the request ID and guarantee uniqueness.
 */
export function generateArticlePath(title: string, requestId = '', forceId = false): string {
  const slug = slugifyTitle(title.trim());
  if (forceId && requestId) {
    const id = shortIdFromRequestId(requestId);
    if (id) return `src/data/post/${slug}-${id}.md`;
  }
  return `src/data/post/${slug}.md`;
}
