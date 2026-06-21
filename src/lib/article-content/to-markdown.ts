import type { ArticleBodyNode, ArticleBodyV1 } from '../../schema/article-content-v1.js';

/**
 * Converts a structured article body to a stable markdown string.
 */
export function articleBodyToMarkdown(articleBody: ArticleBodyV1): string {
  if (!Array.isArray(articleBody.nodes)) return '';

  return articleBody.nodes
    .map((node) => nodeToMarkdown(node))
    .filter((md) => md.length > 0)
    .join('\n\n');
}

/**
 * Converts a single article node to its markdown representation.
 * Respects visibility rules and excludes private metadata.
 */
export function nodeToMarkdown(node: ArticleBodyNode): string {
  // 1. Check Visibility
  if (node.visibility === 'hidden' || node.visibility === 'internal') {
    return '';
  }

  const lines: string[] = [];

  // 2. Handle Title/Heading
  if (node.public.title) {
    const level = node.rendering?.presentation === 'plain' ? '##' : '###';
    lines.push(`${level} ${node.public.title}`);
  }

  // 3. Handle Eyebrow
  if (node.public.eyebrow) {
    lines.push(`*${node.public.eyebrow}*`);
  }

  // 4. Handle Body Text
  if (node.public.body) {
    lines.push(node.public.body);
  }

  // 5. Handle Items (List)
  if (Array.isArray(node.public.items) && node.public.items.length > 0) {
    node.public.items.forEach((item) => {
      lines.push(`- ${item}`);
    });
  }

  // 6. Handle Media
  if (node.public.media) {
    const { type, src, alt, caption } = node.public.media;
    if (type === 'image') {
      lines.push(`![${alt || ''}](${src})`);
      if (caption) lines.push(`*${caption}*`);
    } else {
      lines.push(`[View ${type}](${src})`);
    }
  }

  // 7. Handle Action / CTA
  if (node.kind === 'action' && node.public.ctaText && node.public.ctaLink) {
    lines.push(`**[${node.public.ctaText}](${node.public.ctaLink})**`);
  }

  // 8. Handle Commercial / Disclosure
  if (node.commercial) {
    const { disclosure, offer, adSlot } = node.commercial;

    // Disclosure logic
    if (disclosure?.required) {
      const label = disclosure.label || 'Sponsored Content';
      if (disclosure.mode === 'inline') {
        lines.push(`(${label})`);
      } else {
        lines.push(`--- \n*${label}*`);
      }
    }

    // Offer details
    if (offer) {
      if (node.rendering?.presentation === 'offerCard') {
        lines.push('> ### Offer Details');
        if (offer.couponCode) lines.push(`> **Code**: \`${offer.couponCode}\``);
        if (offer.expiresAt) lines.push(`> **Expires**: ${offer.expiresAt}`);
        if (offer.terms) lines.push(`> \n> ${offer.terms}`);
      } else if (node.rendering?.presentation === 'offerInline' && offer.couponCode) {
        lines.push(`Use code **${offer.couponCode}** to save!`);
      }
    }

    // Ad Slot placeholder
    if (adSlot) {
      lines.push(`[Advertisement: ${adSlot.provider || 'Ad Slot'}]`);
    }
  }

  // 9. Handle Chat Invitation
  if (node.chat) {
    if (node.chat.invitationText) {
      lines.push(`> ${node.chat.invitationText}`);
    }
    if (node.chat.suggestedQuery) {
      lines.push(`Ask me: "*${node.chat.suggestedQuery}*"`);
    }
  }

  return lines.join('\n\n');
}

/**
 * Wraps legacy markdown content into a structured ArticleBodyV1.
 */
export function normalizeArticleBodyFromLegacy(markdown: string, title?: string): ArticleBodyV1 {
  return {
    schema_version: 'article_body.v1',
    nodes: [
      {
        id: `n_legacy_${Math.random().toString(36).substring(2, 9)}`,
        kind: 'content',
        public: {
          title,
          body: markdown,
        },
        visibility: 'public',
      },
    ],
  };
}
