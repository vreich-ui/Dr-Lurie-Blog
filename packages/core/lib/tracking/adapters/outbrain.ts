/**
 * outbrain adapter (W13 T13.8, 12-plan §7) — the OB pixel (obApi queue +
 * obtp loader), ALWAYS consent-gated; marketer id re-asserted at render.
 * Conversions arrive through the T13.7 bridge as `obApi('track', <label>)`.
 */
import { PROVIDER_ID_RES } from '../../../schema/bodies/tracking-config-v1.js';
import { reassertId, NO_CSP_HOSTS, type AdapterResult } from './types.js';

export const OUTBRAIN_CSP_HOSTS = {
  script: ['https://amplify.outbrain.com'],
  connect: ['https://tr.outbrain.com'],
  img: ['https://tr.outbrain.com'],
  frame: [],
} as const;

export const outbrainAdapter = (config: { enabled?: boolean; account_id?: string } | undefined): AdapterResult => {
  if (config?.enabled !== true) return { head: '', cspHosts: NO_CSP_HOSTS };
  const marketerId = reassertId('outbrain', 'account_id', config.account_id, PROVIDER_ID_RES.outbrain);
  return {
    head:
      `<script type="text/plain" data-trk-gate="advertising">` +
      `!function(w,d){var i='${marketerId}';if(w.obApi){var c=function(t){return '[object Array]'===` +
      `Object.prototype.toString.call(t)?t:[t]};w.obApi.marketerId=c(w.obApi.marketerId).concat(c(i));return}` +
      `var a=w.obApi=function(){a.dispatch?a.dispatch.apply(a,arguments):a.queue.push(arguments)};` +
      `a.version='1.1';a.loaded=!0;a.marketerId=i;a.queue=[];var t=d.createElement('script');` +
      `t.async=!0;t.src='https://amplify.outbrain.com/cp/obtp.js';t.type='text/javascript';` +
      `var s=d.getElementsByTagName('script')[0];s.parentNode.insertBefore(t,s)}(window,document);` +
      `obApi('track','PAGE_VIEW');</script>`,
    cspHosts: {
      script: [...OUTBRAIN_CSP_HOSTS.script],
      connect: [...OUTBRAIN_CSP_HOSTS.connect],
      img: [...OUTBRAIN_CSP_HOSTS.img],
      frame: [],
    },
  };
};
