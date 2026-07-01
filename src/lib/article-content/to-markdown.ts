import { type ArticleBodyV1, type ArticleBodyNode } from '../../schema/article-content-v1.js';

const pdfArtifactBlobKeyPattern = /^(?:artifacts\/)?pdf\/[a-z0-9._-]+\/[a-f0-9]{64}\.pdf$/i;
const publicPdfPathPattern = /\/pdf\/([a-z0-9._-]+\/[a-f0-9]{64}\.pdf)$/i;
const ctaButtonClass =
  'inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-base font-semibold text-white shadow-sm shadow-slate-900/10 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950';

const htmlEscapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => htmlEscapeMap[character]);

function renderCtaButton(href: string, label: string): string {
  return `<p class="not-prose my-7">\n  <a class="${ctaButtonClass}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>\n</p>`;
}

export function getPublicPdfUrlForArtifactBlobKey(value: string): string | undefined {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/^\/+/, '').replace(/^artifacts\//, '');
  if (pdfArtifactBlobKeyPattern.test(normalized)) return `/${normalized.replace(/^artifacts\//, '')}`;

  const publicPath = trimmed.match(publicPdfPathPattern);
  return publicPath ? `/pdf/${publicPath[1]}` : undefined;
}

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

// TODO: Review structured article-body rendering parity for commercial.rel/sponsored affiliate links,
// offerInline/offerCard, adSlot/chatInvite presentations, and non-inline document/PDF media behavior.
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
  // public.media is also used to select the article featured image. Only render it
  // inside the Markdown body when the node explicitly opts in to inline placement.
  if (node.public?.media && node.rendering?.placement === 'inline') {
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
      const displayUrl = getPublicPdfUrlForArtifactBlobKey(url) ?? url.replace(/^src\/assets\//, '~/assets/');
      const mediaType = typeof media === 'object' && media !== null ? media.type : undefined;

      if (mediaType === 'document') {
        const filename = displayUrl.split('/').pop() || 'document';
        const linkText =
          typeof media === 'object' && media !== null
            ? media.title || node.public.title || filename
            : node.public.title || filename;
        parts.push(`[${linkText}](${displayUrl})`);
      } else {
        const altText =
          typeof media === 'object' && media !== null ? media.alt || node.public.title || '' : node.public.title || '';
        parts.push(`![${altText}](${displayUrl})`);
      }
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
  const ctaLink = node.public?.ctaLink
    ? (getPublicPdfUrlForArtifactBlobKey(node.public.ctaLink) ?? node.public.ctaLink)
    : undefined;
  if (ctaLink) {
    parts.push(renderCtaButton(ctaLink, node.public?.ctaText || 'Learn more'));
  }

  return parts.join('\n\n');
}
