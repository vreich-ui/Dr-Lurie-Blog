/**
 * Preview derivation (T9.10) — pure, leak-safe helpers behind ObjectPreview.
 *
 * THE LEAK RULE (render-nodes.ts): the content_item preview reuses the ONE
 * public renderer (`renderArticleNodes`), which already strips node.private
 * (strategy/intent/agentNotes) and every envelope-internal field. This module
 * only reads PUBLIC top-level fields (title/deck/description/hero) beyond that —
 * never editorial / emotional_strategy / scores / claims / compliance / sources.
 * Pinned by preview-logic.test.ts so the workspace preview can never leak what
 * the reader render doesn't.
 */
import { renderArticleNodes } from '../article-object/render-nodes.js';
import { objectDisplayName } from './display-name.js';
import type { ContentItemBody } from '../../../packages/core/schema/bodies/content-item-v1.js';
import type { ObjectRecord } from '../../../packages/core/schema/object-record-v1.js';

const asBag = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Only URLs / site-absolute / mailto hrefs render as an <img> src; artifact refs (image/…) can't be resolved in a pure preview. */
const RESOLVABLE_SRC = /^(https?:\/\/|\/)/i;

export interface ContentItemPreview {
  title: string;
  deck?: string;
  description?: string;
  image?: { src: string; alt?: string };
  /** Leak-safe body HTML from the shared public renderer. */
  bodyHtml: string;
  readingTime: number;
  /** Set when the body was too malformed to render (draft in progress). */
  error?: string;
}

/**
 * Derive the leak-safe content_item preview. Body render failures degrade to an
 * error note rather than throwing — a half-written draft still previews its
 * title/deck.
 */
export function contentItemPreview(
  record: Pick<ObjectRecord, 'object_id' | 'object_type' | 'body'>
): ContentItemPreview {
  const body = asBag(record.body);
  const image = asBag(body.image);
  const imageSrc = str(image.src);

  let bodyHtml = '';
  let readingTime = 0;
  let error: string | undefined;
  try {
    // Reuse the ONE public renderer — leak stripping happens here.
    const rendered = renderArticleNodes(record.object_id, record.body as ContentItemBody);
    bodyHtml = rendered.html;
    readingTime = rendered.readingTime;
  } catch (err) {
    error = err instanceof Error ? err.message : 'This draft body can’t be rendered yet.';
  }

  return {
    title: str(body.title) ?? objectDisplayName(record),
    deck: str(body.deck),
    description: str(body.description),
    image: imageSrc && RESOLVABLE_SRC.test(imageSrc) ? { src: imageSrc, alt: str(image.alt) } : undefined,
    bodyHtml,
    readingTime,
    error,
  };
}

// ─── theme / site token swatches (public brand tokens only) ────────────────────

export interface Swatch {
  name: string;
  value: string;
}

/** Extract color swatches from a theme/site brandTokens `colors` record. */
export function tokenSwatches(tokens: unknown): Swatch[] {
  const colors = asBag(asBag(tokens).colors);
  return Object.entries(colors)
    .filter(([, value]) => typeof value === 'string')
    .map(([name, value]) => ({ name, value: value as string }));
}

/** Extract the font specimen (sans / serif / heading) from brandTokens `fonts`. */
export function tokenFonts(tokens: unknown): Swatch[] {
  const fonts = asBag(asBag(tokens).fonts);
  return Object.entries(fonts)
    .filter(([, value]) => typeof value === 'string')
    .map(([name, value]) => ({ name, value: value as string }));
}

// ─── product commerce summary (display fields only) ────────────────────────────

export interface ProductPreview {
  title: string;
  excerpt?: string;
  image?: { src: string; alt?: string };
  mode?: string;
  priceLabel?: string;
  gate?: string;
}

const centsToLabel = (cents: unknown, currency: unknown): string | undefined => {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return undefined;
  const code = typeof currency === 'string' ? currency.toUpperCase() : 'USD';
  return `${(cents / 100).toFixed(2)} ${code}`;
};

export function productPreview(record: Pick<ObjectRecord, 'object_id' | 'object_type' | 'body'>): ProductPreview {
  const body = asBag(record.body);
  const presentation = asBag(body.presentation);
  const commerce = asBag(body.commerce);
  const price = asBag(commerce.price);
  const pwyw = asBag(commerce.pwyw);
  const images = Array.isArray(presentation.images) ? presentation.images : [];
  const firstImage = asBag(images[0]);
  const imgSrc = str(firstImage.src);

  const mode = str(commerce.mode);
  let priceLabel: string | undefined;
  if (mode === 'fixed') priceLabel = centsToLabel(price.amount_cents, price.currency);
  else if (mode === 'pwyw')
    priceLabel = `Pay what you want (min ${centsToLabel(pwyw.min_cents, pwyw.currency) ?? '—'})`;
  else if (mode === 'free') priceLabel = 'Free';

  const gate = asBag(body.gate);
  const gateLabel = str(gate.kind) ? `Gated: ${str(gate.kind)}` : undefined;

  return {
    title: str(presentation.title) ?? objectDisplayName(record),
    excerpt: str(presentation.excerpt),
    image: imgSrc && RESOLVABLE_SRC.test(imgSrc) ? { src: imgSrc, alt: str(firstImage.alt) } : undefined,
    mode,
    priceLabel,
    gate: gateLabel,
  };
}
