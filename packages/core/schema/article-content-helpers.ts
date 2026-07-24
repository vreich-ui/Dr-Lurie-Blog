import type { ContentSourceV1 } from './schema-v1.js';
import type { ArticleBodyV1 } from './article-content-v1.js';
import { articleBodyToMarkdown } from '../lib/article-content/to-markdown.js';

/**
 * Checks if the content source has a structured article body with at least one node.
 */
export function hasStructuredArticleBody(input: ContentSourceV1): boolean {
  const nodes = input.content?.article_body?.nodes;
  return Array.isArray(nodes) && nodes.length > 0;
}

/**
 * Returns the structured article body from the content source if it exists.
 */
export function getArticleBodyFromContentSource(input: ContentSourceV1): ArticleBodyV1 | undefined {
  return input.content?.article_body;
}

/**
 * Creates a structured article body from legacy markdown content.
 */
export function createArticleBodyFromLegacyMarkdown(
  markdown: string,
  options: { id?: string; title?: string } = {}
): ArticleBodyV1 {
  return {
    schema_version: 'article_body.v1',
    nodes: [
      {
        id: options.id || `n_${Math.random().toString(36).substring(2, 9)}`,
        kind: 'content',
        public: {
          title: options.title,
          body: markdown,
        },
      },
    ],
  };
}

/**
 * Returns markdown rendered from the canonical structured article body only.
 */
export function getPreferredArticleMarkdownSource(input: ContentSourceV1): string | undefined {
  if (hasStructuredArticleBody(input)) {
    return articleBodyToMarkdown(input.content!.article_body!);
  }

  return undefined;
}
