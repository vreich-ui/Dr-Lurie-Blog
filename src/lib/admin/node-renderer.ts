/**
 * Client-side renderer: ArticleBodyNode → HTMLElement.
 * Mirrors the public blog's block styling so the admin view looks like the live site.
 * Output is purely for display/read mode; TipTap overlays this in edit mode.
 */

import type { ArticleBodyNode } from '../../schema/article-content-v1.ts';

// ─── helpers ──────────────────────────────────────────────────────────────────

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (HTMLElement | Text | string)[]
): HTMLElementTagNameMap[K] => {
  const elem = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) elem.setAttribute(k, v);
  for (const child of children) {
    elem.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return elem;
};

// Simple plain-text → paragraph set; newlines become <br> inside a <p>.
const textToParagraphs = (text: string): HTMLElement => {
  const wrapper = el('div', { class: 'dl-node-body prose dark:prose-invert max-w-none' });
  const paragraphs = text.split(/\n{2,}/);
  for (const para of paragraphs) {
    if (!para.trim()) continue;
    const p = el('p');
    const lines = para.split('\n');
    lines.forEach((line, i) => {
      p.append(document.createTextNode(line));
      if (i < lines.length - 1) p.append(el('br'));
    });
    wrapper.append(p);
  }
  return wrapper;
};

// ─── safe HTML renderer for TipTap-saved body content ─────────────────────────
// Only allows the tags TipTap can produce; strips everything else (keeps children).
// Links: only http/https href, forced target+rel.

const TIPTAP_ALLOWED = new Set(['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h2', 'h3']);
const SAFE_HREF_RE = /^https?:\/\//i;

function sanitizeChildren(src: ParentNode, dst: Element | DocumentFragment): void {
  for (const child of Array.from(src.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      dst.append(child.cloneNode(false));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const srcEl = child as Element;
    const tag = srcEl.tagName.toLowerCase();
    if (TIPTAP_ALLOWED.has(tag)) {
      const out = document.createElement(tag);
      if (tag === 'a') {
        const href = srcEl.getAttribute('href') ?? '';
        if (SAFE_HREF_RE.test(href)) {
          out.setAttribute('href', href);
          out.setAttribute('target', '_blank');
          out.setAttribute('rel', 'noopener noreferrer');
        }
      }
      sanitizeChildren(srcEl, out);
      dst.append(out);
    } else {
      // Unknown tag: drop it but recurse into its children
      sanitizeChildren(srcEl, dst);
    }
  }
}

function sanitizeHtmlBody(html: string): HTMLElement {
  const wrapper = el('div', { class: 'dl-node-body prose dark:prose-invert max-w-none' });
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  sanitizeChildren(tpl.content, wrapper);
  return wrapper;
}

// Detect TipTap HTML output (starts with a tag) vs stored plain text.
const LOOKS_LIKE_HTML_RE = /^\s*</;

function renderBody(body: string): HTMLElement {
  return LOOKS_LIKE_HTML_RE.test(body) ? sanitizeHtmlBody(body) : textToParagraphs(body);
}

// ─── artifact-ref detection ───────────────────────────────────────────────────
// Major Key artifact references (image/{id}/{sha256}.{ext}) cannot be resolved
// to a real URL in the browser — show a descriptive placeholder instead.
const ARTIFACT_REF_RE = /^image\/[^/]+\/[0-9a-f]{64}\.[a-z]+$/i;

const isArtifactRef = (src: string) => ARTIFACT_REF_RE.test(src.trim());

// External link icon (inline SVG for accessibility)
const externalLinkIcon = (): SVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'dl-ext-icon inline-block ml-0.5 opacity-60 align-middle');
  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path1.setAttribute('d', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6');
  const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path2.setAttribute('d', 'M15 3h6v6');
  const path3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path3.setAttribute('d', 'M10 14 21 3');
  svg.append(path1, path2, path3);
  return svg;
};

// ─── source item helpers ──────────────────────────────────────────────────────

const SECTION_IS_SOURCE_RE = /\b(source|further reading)\b/i;

function isSourceSection(node: ArticleBodyNode): boolean {
  return SECTION_IS_SOURCE_RE.test(node.public.title ?? '') || SECTION_IS_SOURCE_RE.test(node.public.eyebrow ?? '');
}

type ParsedSourceItem = { title: string; url: string | null };

function parseSourceItem(item: string): ParsedSourceItem {
  // "Title — https://..." or "Title - https://..." or "Title: https://..."
  const withSep = item.match(/^(.+?)\s*[-–—:|]\s*(https?:\/\/\S+)$/);
  if (withSep) return { title: withSep[1].trim(), url: withSep[2].trim() };
  // Bare URL
  if (/^https?:\/\//.test(item.trim())) {
    try {
      return { title: new URL(item.trim()).hostname, url: item.trim() };
    } catch {
      return { title: item, url: null };
    }
  }
  return { title: item, url: null };
}

function renderSourceItem(item: string): HTMLElement {
  const { title, url } = parseSourceItem(item);
  const li = el('li', {});
  if (url) {
    const a = el('a', {
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
      class: 'dl-source-link text-accent hover:underline',
      'aria-label': `${title} (opens in new tab)`,
    });
    a.append(document.createTextNode(title));
    a.append(externalLinkIcon());
    li.append(a);
  } else {
    li.append(document.createTextNode(title));
  }
  return li;
}

// ─── image placeholder ────────────────────────────────────────────────────────

function renderImagePlaceholder(label: string, note?: string): HTMLElement {
  const wrap = el('div', {
    class:
      'dl-node-img-placeholder w-full rounded-md aspect-video bg-gray-100 dark:bg-slate-800 border-2 border-dashed border-gray-300 dark:border-slate-600 flex flex-col items-center justify-center gap-2',
    role: 'img',
    'aria-label': label || 'Image placeholder',
  });
  const icon = el('span', { class: 'text-2xl opacity-30', 'aria-hidden': 'true' });
  icon.innerHTML = '&#128444;'; // 🖼 picture frame
  const text = el('span', { class: 'text-xs text-muted opacity-60 text-center px-4' }, label || 'Image placeholder');
  wrap.append(icon, text);
  if (note) {
    const noteEl = el('span', { class: 'text-xs text-orange-500 dark:text-orange-400 opacity-80 text-center px-4' }, note);
    wrap.append(noteEl);
  }
  return wrap;
}

// ─── per-presentation renderers ───────────────────────────────────────────────

function renderSection(node: ArticleBodyNode): HTMLElement {
  const isSrc = isSourceSection(node);
  const section = el('section', { class: `dl-node dl-node-section${isSrc ? ' dl-node-sources' : ''}` });

  // Eyebrow
  const eyebrowText = isSrc ? 'Sources' : (node.public.eyebrow ?? '');
  if (eyebrowText) {
    section.append(
      el('p', { class: 'dl-node-eyebrow text-xs font-bold uppercase tracking-widest text-accent mb-1' }, eyebrowText)
    );
  }

  // Title — rename "Further reading" to "Sources"
  if (node.public.title) {
    const displayTitle = isSrc ? node.public.title.replace(/further reading/gi, 'Sources') : node.public.title;
    section.append(
      el('h2', { class: 'dl-node-title font-heading text-2xl font-bold leading-tight mb-3' }, displayTitle)
    );
  }

  // Source sections render only items (as titled links). Skip body to avoid
  // emitting raw URLs as plain text — source content belongs in items.
  if (!isSrc && node.public.body) section.append(renderBody(node.public.body));

  if (node.public.items?.length) {
    if (isSrc) {
      // Source items: render as accessible links
      const ul = el('ul', { class: 'dl-source-list list-none pl-0 space-y-1.5' });
      for (const item of node.public.items) ul.append(renderSourceItem(item));
      section.append(ul);
    } else {
      const ul = el('ul', { class: 'dl-node-items list-disc pl-5 space-y-1' });
      for (const item of node.public.items) ul.append(el('li', {}, item));
      section.append(ul);
    }
  }
  return section;
}

function renderPlain(node: ArticleBodyNode): HTMLElement {
  const div = el('div', { class: 'dl-node dl-node-plain' });
  if (node.public.body) div.append(renderBody(node.public.body));
  return div;
}

function renderCallout(node: ArticleBodyNode): HTMLElement {
  const aside = el('aside', {
    class: 'dl-node dl-node-callout border-l-4 border-accent bg-accent/5 rounded-r-xl px-5 py-4 my-2',
  });
  if (node.public.title) {
    aside.append(el('p', { class: 'font-bold mb-1' }, node.public.title));
  }
  if (node.public.body) aside.append(renderBody(node.public.body));
  return aside;
}

function renderImage(node: ArticleBodyNode): HTMLElement {
  const figure = el('figure', { class: 'dl-node dl-node-image my-2' });
  const media = node.public.media;

  const srcRaw = media?.src ?? '';
  const isArtifact = isArtifactRef(srcRaw);

  // Artifact references cannot be resolved to a browser URL in admin mode
  if (isArtifact) {
    const label = media?.alt || node.public.title || 'Image';
    figure.append(
      renderImagePlaceholder(label, `Artifact reference — admin preview not available (${srcRaw.slice(0, 40)}…)`)
    );
    if (media?.caption || node.public.body) {
      figure.append(
        el('figcaption', { class: 'text-sm text-muted mt-2 text-center' }, media?.caption || node.public.body || '')
      );
    }
    return figure;
  }

  const hasSrc = Boolean(srcRaw.trim()) && !srcRaw.startsWith('data:') && srcRaw !== 'null' && srcRaw !== 'undefined';

  if (media && hasSrc) {
    const img = el('img', {
      class: 'w-full rounded-md aspect-video object-cover bg-gray-200 dark:bg-slate-700',
      src: srcRaw,
      alt: media.alt || node.public.title || '',
      loading: 'lazy',
    });
    // Swap to placeholder if the image actually fails to load
    img.addEventListener('error', () => {
      const placeholder = renderImagePlaceholder(
        media.alt || node.public.title || 'Image unavailable',
        'Image failed to load'
      );
      img.replaceWith(placeholder);
    });
    figure.append(img);
    if (media.caption || node.public.body) {
      figure.append(
        el('figcaption', { class: 'text-sm text-muted mt-2 text-center' }, media.caption || node.public.body || '')
      );
    }
  } else {
    const placeholderLabel = media?.alt || node.public.title || 'Image placeholder';
    figure.append(renderImagePlaceholder(placeholderLabel));
    if (media?.caption || node.public.body) {
      figure.append(
        el('figcaption', { class: 'text-sm text-muted mt-2 text-center' }, media?.caption || node.public.body || '')
      );
    }
  }

  return figure;
}

function renderSoftAction(node: ArticleBodyNode): HTMLElement {
  const div = el('div', { class: 'dl-node dl-node-cta flex flex-col items-start gap-3 py-2' });
  if (node.public.body) div.append(renderBody(node.public.body));
  if (node.public.ctaText) {
    const link = el(
      'a',
      {
        class:
          'btn-primary inline-flex items-center justify-center rounded-full px-5 py-2 font-bold text-sm no-underline',
        href: node.public.ctaLink || '#',
        rel: 'noopener',
      },
      node.public.ctaText
    );
    div.append(link);
  }
  return div;
}

function renderOfferInline(node: ArticleBodyNode): HTMLElement {
  const div = el('div', {
    class: 'dl-node dl-node-offer-inline rounded-xl border border-accent/30 bg-accent/5 px-5 py-4 my-2',
  });
  if (node.public.body) div.append(renderBody(node.public.body));
  if (node.public.ctaText) {
    const link = el(
      'a',
      {
        class:
          'btn-primary inline-flex items-center justify-center rounded-full px-5 py-2 font-bold text-sm no-underline mt-2',
        href: node.public.ctaLink || '#',
        rel: 'noopener noreferrer',
      },
      node.public.ctaText
    );
    div.append(link);
  }
  return div;
}

function renderOfferCard(node: ArticleBodyNode): HTMLElement {
  const card = el('div', {
    class:
      'dl-node dl-node-offer-card rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-6 my-2',
  });
  if (node.public.title) {
    card.append(el('h3', { class: 'font-heading text-xl font-bold mb-2' }, node.public.title));
  }
  if (node.public.body) card.append(renderBody(node.public.body));
  if (node.public.ctaText) {
    const link = el(
      'a',
      {
        class:
          'btn-primary inline-flex items-center justify-center rounded-full px-5 py-2 font-bold text-sm no-underline mt-3',
        href: node.public.ctaLink || '#',
        rel: 'noopener noreferrer',
      },
      node.public.ctaText
    );
    card.append(link);
  }
  return card;
}

function renderSummary(node: ArticleBodyNode): HTMLElement {
  const section = el('section', {
    class:
      'dl-node dl-node-summary rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 px-5 py-4 my-2',
  });
  if (node.public.title) {
    section.append(el('p', { class: 'font-bold mb-2' }, node.public.title));
  }
  if (node.public.items?.length) {
    const ul = el('ul', { class: 'list-disc pl-5 space-y-1' });
    for (const item of node.public.items) ul.append(el('li', {}, item));
    section.append(ul);
  }
  if (node.public.body) section.append(renderBody(node.public.body));
  return section;
}

function renderFaq(node: ArticleBodyNode): HTMLElement {
  const section = el('section', { class: 'dl-node dl-node-faq' });
  if (node.public.title) {
    section.append(el('h3', { class: 'font-heading text-xl font-bold mb-3' }, node.public.title));
  }
  const dl = el('dl', { class: 'space-y-3' });
  if (node.public.items?.length) {
    for (let i = 0; i < node.public.items.length; i += 2) {
      const q = node.public.items[i];
      const a = node.public.items[i + 1] ?? '';
      const dt = el('dt', { class: 'font-semibold' }, q);
      const dd = el('dd', { class: 'text-muted pl-4 mt-0.5' }, a);
      dl.append(dt, dd);
    }
  }
  section.append(dl);
  if (node.public.body) section.append(renderBody(node.public.body));
  return section;
}

function renderChatInvite(node: ArticleBodyNode): HTMLElement {
  const div = el('div', {
    class:
      'dl-node dl-node-chat-invite rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 flex flex-col gap-2 my-2',
  });
  if (node.public.title) {
    div.append(el('p', { class: 'font-bold' }, node.public.title));
  }
  if (node.public.body) {
    div.append(el('p', { class: 'text-sm text-muted' }, node.public.body));
  }
  div.append(
    el(
      'button',
      { class: 'btn-primary self-start rounded-full px-4 py-2 text-sm font-bold', type: 'button', disabled: 'true' },
      'Chat (preview)'
    )
  );
  return div;
}

function renderAdSlot(node: ArticleBodyNode): HTMLElement {
  const div = el('div', {
    class:
      'dl-node dl-node-ad-slot rounded border-2 border-dashed border-gray-300 dark:border-slate-600 text-center text-muted text-xs py-4',
  });
  div.append(document.createTextNode(node.public.label || 'Ad Slot'));
  return div;
}

// ─── public API ───────────────────────────────────────────────────────────────

/** Maps a node to its rendered HTMLElement for display in read/preview mode. */
export function renderNode(node: ArticleBodyNode): HTMLElement {
  const presentation = node.rendering?.presentation;
  const kind = node.kind;

  if (presentation === 'callout') return renderCallout(node);
  if (presentation === 'plain') return renderPlain(node);
  if (presentation === 'offerInline') return renderOfferInline(node);
  if (presentation === 'offerCard') return renderOfferCard(node);
  if (presentation === 'summary') return renderSummary(node);
  if (presentation === 'faq') return renderFaq(node);
  if (presentation === 'chatInvite') return renderChatInvite(node);
  if (presentation === 'adSlot') return renderAdSlot(node);
  if (presentation === 'inline' && kind === 'action') return renderSoftAction(node);
  if (presentation === 'card') return renderOfferCard(node);

  // Image nodes
  if (node.public.media || (presentation === 'section' && node.public.media)) return renderImage(node);

  // Default: section or unrecognised presentation
  return renderSection(node);
}

/** Wraps a rendered node in a data-attributed container that the editor uses. */
export function wrapNode(node: ArticleBodyNode, rendered: HTMLElement): HTMLElement {
  const wrapper = el('div', {
    'data-node-id': node.id,
    'data-node-kind': node.kind,
    'data-node-presentation': node.rendering?.presentation ?? 'section',
    class: 'dl-node-wrapper relative group',
  });
  wrapper.append(rendered);
  return wrapper;
}
