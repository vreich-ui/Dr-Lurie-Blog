/**
 * content_item node renderer (W7.3, 08-articles-plan §2.3) — the ONE renderer
 * for object-backed article bodies: the public build consumes it via
 * src/utils/blog.ts; admin/canvas previews reuse it so what an editor sees is
 * what a reader gets (bug ⑦ — the dual-renderer drift class — dies here).
 *
 * THE LEAK RULE (the preservation directive's other half): only `public`
 * fields of PUBLIC-visibility nodes reach HTML. `node.private`
 * (strategy/intent/agentNotes), commercial internals, envelope judge/score
 * data — never serialized. The single sanctioned commercial surface is the
 * reader-facing disclosure label + link rel, which exist to be shown.
 * Pinned by the reader-safety projection (object-validate.ts) and tests.
 *
 * Canvas identity: every rendered node is wrapped in a `display:contents`
 * div carrying data-cms-object-id / data-cms-node-id / data-cms-node-kind —
 * the article-body analogue of section-annotations.ts (inert for visitors,
 * the chip anchor for admins).
 *
 * String bodies are PLAIN TEXT: escaped, blank lines split paragraphs,
 * single newlines become <br/>. Rich formatting is rich_text.v1's job
 * (rendered through the W7.1 substrate; embeds are validation-blocked until
 * their resolvers exist, so this renderer passes none).
 */
import { renderRichTextV1Html } from '../richtext/render-html.js';
import type { ContentItemBody, ContentItemNode } from '../../schema/bodies/content-item-v1.js';

export type RenderedArticle = {
  /** The article body HTML (annotated node wrappers included). */
  html: string;
  /** Ceil'd minutes, matching the md pipeline's readingTimeRemarkPlugin. */
  readingTime: number;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Hrefs a rendered link may carry; anything else renders as plain text. */
const SAFE_HREF_RE = /^(https?:\/\/|\/|#|mailto:)/i;

const safeHref = (href: string | undefined): string | undefined => (href && SAFE_HREF_RE.test(href) ? href : undefined);

const plainTextParagraphs = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br/>')}</p>`)
    .join('');

const bodyHtml = (body: ContentItemNode['public']['body']): string => {
  if (body === undefined) return '';
  if (typeof body === 'string') return plainTextParagraphs(body);
  // rich_text.v1 document. No embed resolvers on purpose: embeds are blocked
  // at write until they can render; one slipping through throws loudly here
  // (never-silently-drop) rather than emitting a hole.
  return renderRichTextV1Html(body);
};

const relAttr = (node: ContentItemNode): string => {
  const rel = node.commercial?.rel;
  return rel ? ` rel="${escapeHtml(rel)}"` : '';
};

const ctaHtml = (node: ContentItemNode, prominent: boolean): string => {
  const { ctaText, ctaLink } = node.public;
  if (!ctaText) return '';
  const href = safeHref(ctaLink);
  if (!href) return `<p><strong>${escapeHtml(ctaText)}</strong></p>`;
  // `not-prose` + `font-sans`: inside the article's editorial-prose wrap the
  // typography plugin's prose-a color beats .btn-primary's text-white (an
  // invisible label on the filled button) and the serif body font leaks into
  // the label — buttons must render exactly like the site's own.
  const cls = prominent ? 'btn btn-primary font-sans' : 'btn font-sans';
  return `<p class="article-node-cta not-prose"><a class="${cls}" href="${escapeHtml(href)}"${relAttr(node)}>${escapeHtml(ctaText)}</a></p>`;
};

const mediaHtml = (node: ContentItemNode): string => {
  const media = node.public.media;
  if (!media) return '';
  const src = safeHref(media.src);
  if (!src) return '';
  const caption = media.caption ? `<figcaption>${escapeHtml(media.caption)}</figcaption>` : '';
  if (media.type === 'image') {
    return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(media.alt ?? '')}" loading="lazy" decoding="async" />${caption}</figure>`;
  }
  // Non-image media has no inline player yet — render an honest link, never
  // a silent drop.
  const label = media.title ?? media.src.split('/').pop() ?? media.type;
  return `<p><a href="${escapeHtml(src)}"${relAttr(node)}>${escapeHtml(label)}</a></p>${caption}`;
};

const disclosureHtml = (node: ContentItemNode): string => {
  const disclosure = node.commercial?.disclosure;
  if (!disclosure?.required) return '';
  return `<p class="article-node-disclosure text-sm text-muted uppercase tracking-wide">${escapeHtml(disclosure.label ?? 'Sponsored')}</p>`;
};

const headerHtml = (node: ContentItemNode): string => {
  const { eyebrow, title } = node.public;
  const eyebrowHtml = eyebrow
    ? `<p class="article-node-eyebrow text-sm uppercase tracking-wide text-muted">${escapeHtml(eyebrow)}</p>`
    : '';
  const titleHtml = title ? `<h2>${escapeHtml(title)}</h2>` : '';
  return eyebrowHtml + titleHtml;
};

const itemsHtml = (node: ContentItemNode): string => {
  const items = node.public.items;
  if (!items || items.length === 0) return '';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
};

/** One node's inner HTML (no wrapper). Public-visibility nodes only. */
const nodeHtml = (node: ContentItemNode): string => {
  switch (node.kind) {
    case 'content':
      return (
        disclosureHtml(node) +
        headerHtml(node) +
        bodyHtml(node.public.body) +
        itemsHtml(node) +
        mediaHtml(node) +
        ctaHtml(node, false)
      );
    case 'action':
      return disclosureHtml(node) + headerHtml(node) + bodyHtml(node.public.body) + ctaHtml(node, true);
    case 'placement': {
      const presentation = node.rendering?.presentation;
      if (presentation === 'offerInline' || presentation === 'offerCard') {
        const inner =
          disclosureHtml(node) + headerHtml(node) + bodyHtml(node.public.body) + itemsHtml(node) + ctaHtml(node, true);
        return presentation === 'offerCard'
          ? `<aside class="article-node-offer not-prose border rounded-lg p-6 my-6">${inner}</aside>`
          : `<aside class="article-node-offer my-6">${inner}</aside>`;
      }
      // adSlot and friends: no ad runtime exists — nothing renders (the
      // wrapper still emits, so the canvas can address the node).
      return '';
    }
    case 'interactive': {
      // No public chat runtime on articles yet; the invitation text is the
      // one reader-facing field.
      const invitation = node.chat?.invitationText;
      return invitation
        ? `<aside class="article-node-chat my-6"><p><em>${escapeHtml(invitation)}</em></p></aside>`
        : '';
    }
  }
};

const WORDS_PER_MINUTE = 200;

export const renderArticleNodes = (objectId: string, body: ContentItemBody): RenderedArticle => {
  const rendered: string[] = [];
  for (const node of body.nodes) {
    if ((node.visibility ?? 'public') !== 'public') continue; // never-render-private
    rendered.push(
      `<div style="display:contents" data-cms-object-id="${escapeHtml(objectId)}" data-cms-node-id="${escapeHtml(node.id)}" data-cms-node-kind="${escapeHtml(node.kind)}">${nodeHtml(node)}</div>`
    );
  }
  const html = rendered.join('');
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = text ? text.split(' ').length : 0;
  return { html, readingTime: Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) };
};
