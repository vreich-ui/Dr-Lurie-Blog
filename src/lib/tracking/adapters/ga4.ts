/**
 * ga4 adapter (W13 T13.7, 12-plan §7) — the OPTIONAL analytics-class slot.
 * `send_page_view:false` always: the own loader owns navigation truth and
 * emits the manual `page_view` on astro:page-load (the bridge); goals are
 * mirrored as ga4 events by the same bridge.
 *
 * Gating follows the block's consent_class: `advertising` ships the
 * snippets consent-gated exactly like google_ads; `analytics`/`essential`
 * ship live — in restricted regions the T13.6 bootstrap's denied Consent
 * Mode defaults still precede this head, so gtag runs in cookieless-ping
 * mode there (the §8 aggressive-but-legal middle). The measurement id is
 * re-asserted at render (write+render double enforcement).
 */
import { PROVIDER_ID_RES } from '../../../schema/bodies/tracking-config-v1.js';
import { gtagLoaderHead } from './google-ads.js';
import { reassertId, NO_CSP_HOSTS, type AdapterResult } from './types.js';

export const GA4_CSP_HOSTS = {
  script: ['https://www.googletagmanager.com'],
  connect: ['https://www.google-analytics.com', 'https://analytics.google.com', 'https://www.googletagmanager.com'],
  img: ['https://www.google-analytics.com'],
  frame: [],
} as const;

export const ga4Adapter = (
  config: { enabled?: boolean; consent_class?: string; measurement_id?: string } | undefined,
  context: { includeLoader: boolean }
): AdapterResult => {
  if (config?.enabled !== true) return { head: '', cspHosts: NO_CSP_HOSTS };
  const measurementId = reassertId('ga4', 'measurement_id', config.measurement_id, PROVIDER_ID_RES.ga4);
  const gated = config.consent_class === 'advertising';
  const openTag = gated ? '<script type="text/plain" data-trk-gate="advertising">' : '<script>';
  const loader = context.includeLoader ? gtagLoaderHead(measurementId, gated) : '';
  const head =
    loader +
    `${openTag}window.dataLayer=window.dataLayer||[];` +
    `function gtag(){dataLayer.push(arguments)}gtag('js',new Date());` +
    `gtag('config','${measurementId}',{send_page_view:false});</script>`;
  return {
    head,
    cspHosts: {
      script: [...GA4_CSP_HOSTS.script],
      connect: [...GA4_CSP_HOSTS.connect],
      img: [...GA4_CSP_HOSTS.img],
      frame: [],
    },
  };
};
