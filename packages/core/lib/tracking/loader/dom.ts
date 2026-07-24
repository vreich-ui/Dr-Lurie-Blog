/**
 * Own-tracker loader — click classification over a MINIMAL element
 * interface (W13, 12-plan §5.1). Pure: takes the clicked element (anything
 * with closest/getAttribute/textContent/tagName/href), returns the event
 * kind + refs — so the classification matrix is unit-testable with fake
 * elements and the browser binding stays a one-liner.
 *
 * Priority (first match wins): opt-out subtree → nav → buy → term/tag →
 * outbound anchor → section CTA. Labels leave only as bounded slugs.
 */
import { hostOf, slugify, type TrackableRef } from './core.js';

export type ElementLike = {
  closest(selector: string): ElementLike | null;
  getAttribute(name: string): string | null;
  textContent: string | null;
  tagName?: string;
};

export type ClickClassification = {
  kind: 'nav_click' | 'buy_click' | 'tag_click' | 'outbound_click' | 'cta_click';
  ref: TrackableRef | null;
  props?: Record<string, unknown>;
  extraObject?: Record<string, string>;
} | null;

export const classifyClick = (target: ElementLike, pageHost: string): ClickClassification => {
  if (target.closest('[data-cms-track="off"]')) return null;

  const anchor = target.closest('a[href]');
  const label = slugify(target.textContent ?? anchor?.textContent ?? null);

  const nav = target.closest('[data-cms-nav-object]');
  if (nav) {
    const navId = nav.getAttribute('data-cms-nav-object');
    if (navId && (anchor || target.closest('button'))) {
      return {
        kind: 'nav_click',
        ref: null,
        props: label ? { label_slug: label } : undefined,
        extraObject: { object_type: 'navigation', object_id: navId },
      };
    }
  }

  const buy = target.closest('[data-cms-buy-product]');
  if (buy) {
    const productId = buy.getAttribute('data-cms-buy-product');
    if (productId) {
      return {
        kind: 'buy_click',
        ref: null,
        props: label ? { label_slug: label } : undefined,
        extraObject: { object_type: 'product', object_id: productId },
      };
    }
  }

  const term = target.closest('[data-cms-term-id]');
  if (term) {
    const termId = term.getAttribute('data-cms-term-id');
    if (termId) {
      return {
        kind: 'tag_click',
        ref: null,
        props: label ? { label_slug: label } : undefined,
        extraObject: { object_type: 'taxonomy', term_id: termId },
      };
    }
  }

  if (anchor) {
    const href = anchor.getAttribute('href') ?? '';
    const host = hostOf(href);
    if (host && host !== pageHost) {
      return { kind: 'outbound_click', ref: null, props: { href_host: host } };
    }
  }

  const section = target.closest('[data-cms-section-id]');
  if (section && (anchor || target.closest('button'))) {
    const sectionId = section.getAttribute('data-cms-section-id');
    if (sectionId) {
      return {
        kind: 'cta_click',
        ref: {
          kind: 'section',
          section_id: sectionId,
          section_type: section.getAttribute('data-cms-section-type'),
        },
        props: label ? { label_slug: label } : undefined,
      };
    }
  }

  return null;
};

/** Trackable-element discovery refs (the observer targets). */
export const trackableRefOf = (element: ElementLike): TrackableRef | null => {
  if (element.closest('[data-cms-track="off"]')) return null;
  const sectionId = element.getAttribute('data-cms-section-id');
  if (sectionId) {
    return { kind: 'section', section_id: sectionId, section_type: element.getAttribute('data-cms-section-type') };
  }
  const nodeId = element.getAttribute('data-cms-node-id');
  if (nodeId) {
    return { kind: 'node', node_id: nodeId, node_kind: element.getAttribute('data-cms-node-kind') };
  }
  return null;
};
