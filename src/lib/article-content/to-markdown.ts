import { type ArticleBodyV1, type ArticleBodyNode } from '../../schema/article-content-v1.js';

/**
 * Serializes a structured article body into Markdown.
 * Excludes internal/hidden nodes and private metadata.
 * Skips rendering node.private entirely.
 */
export function articleBodyToMarkdown(body: ArticleBodyV1): string {
  if (!body || !Array.isArray(body.nodes)) return '';

  return body.nodes
    .filter((node) => !node.visibility || node.visibility === 'public')
    .map(renderNodeToMarkdown)
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Normalizes legacy markdown content into a single-node article body structure.
 */
export function normalizeArticleBodyFromLegacy(markdown: string): ArticleBodyV1 {
  return {
    schema_version: 'article_body.v1',
    nodes: [
      {
        id: `n_legacy${Math.random().toString(36).substring(2, 9)}`,
        kind: 'content',
        public: {
          body: markdown.trim(),
        },
        visibility: 'public',
      },
    ],
  };
}

function renderNodeToMarkdown(node: ArticleBodyNode): string {
  const parts: string[] = [];

  // 1. Visible commercial disclosure if required
  if (node.commercial?.disclosure?.required) {
    const label = node.commercial.disclosure.label || 'Sponsored Content';
    parts.push(`*${label}*`);
  }

  // 1.5 Eyebrow rendering
  if (node.public?.eyebrow) {
    parts.push(`*${node.public.eyebrow}*`);
  }

  // 2. Title rendering (if present)
  if (node.public?.title) {
    // Determine level based on presentation
    const level = node.rendering?.presentation === 'section' ? '##' : '###';
    parts.push(`${level} ${node.public.title}`);
  }

  // 2.5 Media rendering
  if (node.public?.media) {
    const media = node.public.media;
    let url = '';
    if (typeof media === 'string') {
      url = media;
    } else if (typeof media === 'object' && media !== null) {
      // For Markdown publishing, we prefer a local path or ~/ assets path
      const ref = media as Record<string, unknown>;
      const rawUrl = ref.src || ref.repoPath || ref.path || ref.blobKey;
      url = typeof rawUrl === 'string' ? rawUrl : '';
    }

    if (url) {
      // Normalize src/assets paths to ~/assets for Astro component compatibility
      const displayUrl = url.replace(/^src\/assets\//, '~/assets/');
      parts.push(`![${node.public.title || ''}](${displayUrl})`);
    }
  }

  // 3. Items rendering (list)
  if (Array.isArray(node.public?.items) && node.public.items.length > 0) {
    const list = node.public.items.map((item) => `- ${item}`).join('\n');
    parts.push(list);
  }

  // 4. Body rendering
  if (node.public?.body) {
    parts.push(node.public.body);
  }

  // 5. CTA rendering
  if (node.public?.ctaText && node.public?.ctaLink) {
    parts.push(`[${node.public.ctaText}](${node.public.ctaLink})`);
  } else if (node.public?.ctaLink) {
    parts.push(`<${node.public.ctaLink}>`);
  }

  return parts.join('\n\n');
}
