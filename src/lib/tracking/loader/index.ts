/**
 * Own-tracker loader — the BROWSER binding (W13, 12-plan §5.1). Thin by
 * design: reads `#trk-config`, wires real DOM signals into the core, and
 * owns the View-Transitions lifecycle. Mounted by T13.5's TrackingScripts
 * via an Astro `<script>` import (hashed same-origin asset). ≤4KB min+gzip
 * total (core + dom + this file) — enforced by tests/scripts'
 * loader-size test.
 *
 * Listener discipline: module-scope registration happens ONCE (this module
 * executes once per real page load); per-page observers re-bind on
 * `astro:page-load` and disconnect on `astro:before-swap` (VT navigations
 * never fire pagehide — the flush rides before-swap).
 */
import { createTracker, parseTrackerConfig, type PageContext, type Tracker } from './core.js';
import { classifyClick, trackableRefOf, type ElementLike } from './dom.js';

let tracker: Tracker | null = null;
let observer: IntersectionObserver | null = null;

const readPageContext = (): { context: PageContext; search: string } | null => {
  const element = document.getElementById('trk-config');
  if (!element?.textContent) return null;
  try {
    const raw = JSON.parse(element.textContent) as Record<string, unknown>;
    const context: PageContext = {
      path: location.pathname,
      route: typeof raw.route === 'string' ? raw.route : null,
      object: (raw.object as PageContext['object']) ?? undefined,
      article: (raw.article as PageContext['article']) ?? undefined,
    };
    return { context, search: location.search };
  } catch {
    return null;
  }
};

const send = (path: string, body: string): void => {
  if (!(navigator.sendBeacon && navigator.sendBeacon(path, body))) {
    void fetch(path, { method: 'POST', body, keepalive: true }).catch(() => undefined);
  }
};

const bindPage = (): void => {
  const read = readPageContext();
  if (!read || location.pathname.startsWith('/admin')) return;
  const configElement = document.getElementById('trk-config');
  const config = parseTrackerConfig(configElement?.textContent ? JSON.parse(configElement.textContent) : {});
  if (!tracker) {
    tracker = createTracker(config, {
      send,
      now: () => Date.now(),
      uuid: () => crypto.randomUUID(),
      random: () => Math.random(),
      referrer: document.referrer || null,
      lang: navigator.language || null,
      viewport: () => ({ w: innerWidth, h: innerHeight }),
      gpc: (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true,
    });
  }
  tracker.pageLoad(read.context, read.search);

  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const ref = trackableRefOf(entry.target as unknown as ElementLike);
        if (ref) tracker!.elementVisible(ref, entry.isIntersecting);
      }
    },
    { threshold: 0.5 }
  );
  for (const element of document.querySelectorAll('[data-cms-section-id],[data-cms-node-id]')) {
    observer.observe(element);
  }
};

const onScroll = (): void => {
  if (!tracker) return;
  const height = document.documentElement.scrollHeight;
  if (height > 0) tracker.scroll(Math.round(((scrollY + innerHeight) / height) * 100));
};

export const startTracker = (): void => {
  document.addEventListener('astro:page-load', bindPage);
  document.addEventListener('astro:before-swap', () => tracker?.pageEnd());
  addEventListener('pagehide', () => tracker?.pageEnd());
  document.addEventListener('visibilitychange', () => {
    tracker?.visibility(!document.hidden);
    if (document.hidden) tracker?.flush();
  });
  addEventListener('scroll', onScroll, { passive: true });
  const onClick = (rawEvent: Event): void => {
    if (!tracker) return;
    const target = rawEvent.target as unknown as ElementLike | null;
    if (!target?.closest) return;
    const classified = classifyClick(target, location.hostname);
    if (classified) tracker.click(classified.kind, classified.ref, classified.props, classified.extraObject);
  };
  document.addEventListener('click', onClick);
  document.addEventListener('auxclick', onClick);
  document.addEventListener('trk:goal', (rawEvent) => {
    const detail = (rawEvent as CustomEvent<{ goal?: string; value_cents?: number }>).detail;
    if (detail?.goal) tracker?.goal(detail.goal, detail.value_cents);
  });
  // The module loads after astro:page-load fired for the first page — bind now.
  if (document.readyState !== 'loading') bindPage();
};
