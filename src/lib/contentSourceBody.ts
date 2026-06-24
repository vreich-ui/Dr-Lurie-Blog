import { articleBodyToMarkdown } from './article-content/to-markdown.js';

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object');

/**
 * Returns importable article body markdown from the canonical content.article_body only.
 */
export const getContentSourceMarkdown = (input: unknown) => {
  if (!isRecord(input)) return '';
  const content = isRecord(input.content) ? input.content : undefined;
  const articleBody = isRecord(content?.article_body) ? content.article_body : undefined;

  if (articleBody?.schema_version !== 'article_body.v1') return '';

  return articleBodyToMarkdown(articleBody as never);
};
