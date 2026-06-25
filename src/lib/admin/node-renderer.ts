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
// We intentionally do NOT parse markdown here — body text is rendered as
// pre-formatted prose in read mode. TipTap handles rich parsing in edit mode.
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

// ─── per-presentation renderers ───────────────────────────────────────────────

function renderSection(node: ArticleBodyNode): HTMLElement {
  const section = el('section', { class: 'dl-node dl-node-section' });
  if (node.public.eyebrow) {
    section.append(el('p', { class: 'dl-node-eyebrow text-xs font-bold uppercase tracking-widest text-accent mb-1' }, node.public.eyebrow));
  }
  if (node.public.title) {
    section.append(el('h2', { class: 'dl-node-title font-heading text-2xl font-bold leading-tight mb-3' }, node.public.title));
  }
  if (node.public.body) section.append(textToParagraphs(node.public.body));
  if (node.public.items?.length) {
    const ul = el('ul', { class: 'dl-node-items list-disc pl-5 space-y-1' });
    for (const item of node.public.items) ul.append(el('li', {}, item));
    section.append(ul);
  }
  return section;
}

function renderPlain(node: ArticleBodyNode): HTMLElement {
  const div = el('div', { class: 'dl-node dl-node-plain' });
  if (node.public.body) div.append(textToParagraphs(node.public.body));
  return div;
}

function renderCallout(node: ArticleBodyNode): HTMLElement {
  const aside = el('aside', {
    class: 'dl-node dl-node-callout border-l-4 border-accent bg-accent/5 rounded-r-xl px-5 py-4 my-2',
  });
  if (node.public.title) {
    aside.append(el('p', { class: 'font-bold mb-1' }, node.public.title));
  }
  if (node.public.body) aside.append(textToParagraphs(node.public.body));
  return aside;
}

function renderImage(node: ArticleBodyNode): HTMLElement {
  const figure = el('figure', { class: 'dl-node dl-node-image my-2' });
  if (node.public.media) {
    const media = node.public.media;
    const img = el('img', {
      class: 'w-full rounded-md aspect-video object-cover bg-gray-200 dark:bg-slate-700',
      src: media.src || '',
      alt: media.alt || node.public.title || '',
      loading: 'lazy',
    });
    figure.append(img);
    if (media.caption || node.public.body) {
      figure.append(
        el('figcaption', { class: 'text-sm text-muted mt-2 text-center' }, media.caption || node.public.body || '')
      );
    }
  } else if (node.public.title) {
    const placeholder = el('div', {
      class: 'w-full rounded-md aspect-video bg-gray-200 dark:bg-slate-700 flex items-center justify-center text-muted text-sm',
    }, node.public.title);
    figure.append(placeholder);
  }
  return figure;
}

function renderSoftAction(node: ArticleBodyNode): HTMLElement {
  const div = el('div', { class: 'dl-node dl-node-cta flex flex-col items-start gap-3 py-2' });
  if (node.public.body) div.append(textToParagraphs(node.public.body));
  if (node.public.ctaText) {
    const link = el(
      'a',
      {
        class: 'btn-primary inline-flex items-center justify-center rounded-full px-5 py-2 font-bold text-sm no-underline',
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
  if (node.public.body) div.append(textToParagraphs(node.public.body));
  if (node.public.ctaText) {
    const link = el(
      'a',
      {
        class: 'btn-primary inline-flex items-center justify-center rounded-full px-5 py-2 font-bold text-sm no-underline mt-2',
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
    class: 'dl-node dl-node-offer-card rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm p-6 my-2',
  });
  if (node.public.title) {
    card.append(el('h3', { class: 'font-heading text-xl font-bold mb-2' }, node.public.title));
  }
  if (node.public.body) card.append(textToParagraphs(node.public.body));
  if (node.public.ctaText) {
    const link = el(
      'a',
      {
        class: 'btn-primary inline-flex items-center justify-center rounded-full px-5 py-2 font-bold text-sm no-underline mt-3',
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
    class: 'dl-node dl-node-summary rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 px-5 py-4 my-2',
  });
  if (node.public.title) {
    section.append(el('p', { class: 'font-bold mb-2' }, node.public.title));
  }
  if (node.public.items?.length) {
    const ul = el('ul', { class: 'list-disc pl-5 space-y-1' });
    for (const item of node.public.items) ul.append(el('li', {}, item));
    section.append(ul);
  }
  if (node.public.body) section.append(textToParagraphs(node.public.body));
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
  if (node.public.body) section.append(textToParagraphs(node.public.body));
  return section;
}

function renderChatInvite(node: ArticleBodyNode): HTMLElement {
  const div = el('div', {
    class: 'dl-node dl-node-chat-invite rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 flex flex-col gap-2 my-2',
  });
  if (node.public.title) {
    div.append(el('p', { class: 'font-bold' }, node.public.title));
  }
  if (node.public.body) {
    div.append(el('p', { class: 'text-sm text-muted' }, node.public.body));
  }
  div.append(
    el('button', { class: 'btn-primary self-start rounded-full px-4 py-2 text-sm font-bold', type: 'button', disabled: 'true' }, 'Chat (preview)')
  );
  return div;
}

function renderAdSlot(node: ArticleBodyNode): HTMLElement {
  const div = el('div', {
    class: 'dl-node dl-node-ad-slot rounded border-2 border-dashed border-gray-300 dark:border-slate-600 text-center text-muted text-xs py-4',
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
  if (node.public.media || presentation === 'section' && node.public.media) return renderImage(node);

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
