import type { ArticleBodyV1, ArticleNodeV1 } from '../../schema/article-content-v1';

/**
 * Serializes a structured article body into Markdown.
 * Excludes internal/hidden nodes and private metadata.
 */
export function articleBodyToMarkdown(body: ArticleBodyV1): string {
  if (!body || !Array.isArray(body.nodes)) return '';

  return body.nodes
    .filter((node) => node.visibility === 'public')
    .map(renderNodeToMarkdown)
    .filter(Boolean)
    .join('\n\n');
}

function renderNodeToMarkdown(node: ArticleNodeV1): string {
  const parts: string[] = [];

  // Title rendering (if present)
  if (node.public?.title) {
    // Determine level based on presentation
    const level = node.rendering?.presentation === 'section' ? '##' : '###';
    parts.push(`${level} ${node.public.title}`);
  }

  // Items rendering (list)
  if (Array.isArray(node.public?.items) && node.public.items.length > 0) {
    node.public.items.forEach((item) => {
      parts.push(`- ${item}`);
    });
  }

  // Body rendering
  if (node.public?.body) {
    parts.push(node.public.body);
  }

  // CTA rendering
  if (node.public?.ctaText && node.public?.ctaLink) {
    parts.push(`[${node.public.ctaText}](${node.public.ctaLink})`);
  } else if (node.public?.ctaLink) {
    parts.push(`<${node.public.ctaLink}>`);
  }

  // Label (ad_slot etc)
  if (node.public?.label) {
    parts.push(`<!-- ${node.public.label} -->`);
  }

  return parts.join('\n\n');
}
