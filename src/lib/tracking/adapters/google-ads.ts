/**
 * google_ads adapter (W13 T13.7, 12-plan §7) — main-thread gtag with
 * Consent Mode v2 (the T13.6 bootstrap's denied defaults precede this head
 * by construction; the runtime activates it on region-clear or grant).
 *
 * Snippets are ALWAYS emitted consent-gated (`type="text/plain"
 * data-trk-gate="advertising"`) regardless of the block's declared
 * consent_class: conversion pings are advertising by nature — a config
 * typo can loosen reporting, never the gate. The conversion id is
 * re-asserted against the write-time regex at render (write+render double
 * enforcement — a drifted export fails the BUILD). `send_page_view:false`:
 * the own loader owns navigation truth. Enhanced conversions are OFF in v1
 * — no user_data is ever configured or sent (raw email exists only in
 * order records by house rule).
 */
import { PROVIDER_ID_RES } from '../../../schema/bodies/tracking-config-v1.js';
import { reassertId, NO_CSP_HOSTS, type AdapterResult } from './types.js';

export const GOOGLE_ADS_CSP_HOSTS = {
  script: ['https://www.googletagmanager.com', 'https://www.googleadservices.com'],
  connect: ['https://www.google.com', 'https://googleads.g.doubleclick.net'],
  img: ['https://www.google.com', 'https://googleads.g.doubleclick.net'],
  frame: [],
} as const;

/** The shared gtag.js loader tag (one per page even when ga4 rides along). */
export const gtagLoaderHead = (measurementOrConversionId: string, gated: boolean): string => {
  // The gate string carries its own trailing space; `async` follows directly.
  const gate = gated ? 'type="text/plain" data-trk-gate="advertising" ' : '';
  return `<script ${gate}async src="https://www.googletagmanager.com/gtag/js?id=${measurementOrConversionId}"></script>`;
};

export const googleAdsAdapter = (
  config: { enabled?: boolean; conversion_id?: string } | undefined,
  context: { includeLoader: boolean }
): AdapterResult => {
  if (config?.enabled !== true) return { head: '', cspHosts: NO_CSP_HOSTS };
  const conversionId = reassertId('google_ads', 'conversion_id', config.conversion_id, PROVIDER_ID_RES.google_ads);
  const loader = context.includeLoader ? gtagLoaderHead(conversionId, true) : '';
  const head =
    loader +
    `<script type="text/plain" data-trk-gate="advertising">window.dataLayer=window.dataLayer||[];` +
    `function gtag(){dataLayer.push(arguments)}gtag('js',new Date());` +
    `gtag('config','${conversionId}',{send_page_view:false});</script>`;
  return {
    head,
    cspHosts: {
      script: [...GOOGLE_ADS_CSP_HOSTS.script],
      connect: [...GOOGLE_ADS_CSP_HOSTS.connect],
      img: [...GOOGLE_ADS_CSP_HOSTS.img],
      frame: [],
    },
  };
};
