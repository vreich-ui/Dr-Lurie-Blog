/**
 * meta_pixel adapter (W13 T13.8, 12-plan §7) — init + PageView, ALWAYS
 * consent-gated (`type="text/plain" data-trk-gate="advertising"`; the
 * T13.6 runtime activates on region-clear or grant). The pixel id is
 * re-asserted against the write-time regex at render (write+render double
 * enforcement — a drifted export fails the BUILD). Goal-map conversions
 * arrive through the T13.7 bridge as `fbq('track', <label>, …)` — the
 * conversion LABEL is the Meta standard event name (Purchase/Lead/
 * Contact…). CAPI is a recorded later-seam (`tracking_event.event_id` is
 * the designed dedup key); no user_data is ever configured (enhanced
 * matching OFF — raw email exists only in order records by house rule).
 */
import { PROVIDER_ID_RES } from '../../../schema/bodies/tracking-config-v1.js';
import { reassertId, NO_CSP_HOSTS, type AdapterResult } from './types.js';

export const META_PIXEL_CSP_HOSTS = {
  script: ['https://connect.facebook.net'],
  connect: ['https://www.facebook.com'],
  img: ['https://www.facebook.com'],
  frame: [],
} as const;

// The standard fbq bootstrap, pre-minified; only the regex-pinned id is
// interpolated.
const FBQ_BOOTSTRAP =
  `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
  `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
  `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
  `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}` +
  `(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');`;

export const metaPixelAdapter = (config: { enabled?: boolean; pixel_id?: string } | undefined): AdapterResult => {
  if (config?.enabled !== true) return { head: '', cspHosts: NO_CSP_HOSTS };
  const pixelId = reassertId('meta_pixel', 'pixel_id', config.pixel_id, PROVIDER_ID_RES.meta_pixel);
  return {
    head:
      `<script type="text/plain" data-trk-gate="advertising">` +
      FBQ_BOOTSTRAP +
      `fbq('init','${pixelId}');fbq('track','PageView');</script>`,
    cspHosts: {
      script: [...META_PIXEL_CSP_HOSTS.script],
      connect: [...META_PIXEL_CSP_HOSTS.connect],
      img: [...META_PIXEL_CSP_HOSTS.img],
      frame: [],
    },
  };
};
