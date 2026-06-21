import type { ContentSourceV1 } from './schema-v1.js';
import type { ArticleBodyV1 } from './article-content-v1.js';

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
 * Returns the preferred markdown/content source based on the requested precedence:
 * 1. content.article_body.nodes (concatenated public.body)
 * 2. publication.publish_payload.markdown
 * 3. publication.publish_payload.content
 * 4. editorial.draft_markdown
 * 5. content.blocks where block_type === "markdown"
 */
export function getPreferredArticleMarkdownSource(input: ContentSourceV1): string | undefined {
  // 1. Structured Article Body
  if (hasStructuredArticleBody(input)) {
    const nodes = input.content!.article_body!.nodes;
    const contentParts = nodes
      .filter((node) => node.public.body)
      .map((node) => node.public.body);

    if (contentParts.length > 0) {
      return contentParts.join('\n\n');
    }
  }

  // 2. Publication Payload Markdown
  if (input.publication?.publish_payload?.markdown) {
    return input.publication.publish_payload.markdown;
  }

  // 3. Publication Payload Content
  if (input.publication?.publish_payload?.content) {
    return input.publication.publish_payload.content;
  }

  // 4. Editorial Draft Markdown
  if (input.editorial?.draft_markdown) {
    return input.editorial.draft_markdown;
  }

  // 5. Content Blocks
  if (Array.isArray(input.content?.blocks)) {
    const markdownBlocks = input.content!.blocks!
      .filter((block) => block.block_type === 'markdown' && typeof block.payload === 'string')
      .map((block) => block.payload as string);

    if (markdownBlocks.length > 0) {
      return markdownBlocks.join('\n\n');
    }
  }

  return undefined;
}
