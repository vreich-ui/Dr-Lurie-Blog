/**
 * taboola adapter (W13 T13.8, 12-plan §7) — the universal pixel (`_tfa`
 * queue + unip loader), ALWAYS consent-gated. The account id is re-asserted
 * against the write-time regex at render AND appears inside the loader URL,
 * which is why the regex is digits-only — no URL text can ride the id.
 * Conversions arrive through the T13.7 bridge as
 * `_tfa.push({notify:'event', name:<label>, id:<account>})`.
 */
import { PROVIDER_ID_RES } from '../../../schema/bodies/tracking-config-v1.js';
import { reassertId, NO_CSP_HOSTS, type AdapterResult } from './types.js';

export const TABOOLA_CSP_HOSTS = {
  script: ['https://cdn.taboola.com'],
  connect: ['https://trc.taboola.com'],
  img: ['https://trc.taboola.com'],
  frame: [],
} as const;

export const taboolaAdapter = (config: { enabled?: boolean; account_id?: string } | undefined): AdapterResult => {
  if (config?.enabled !== true) return { head: '', cspHosts: NO_CSP_HOSTS };
  const accountId = reassertId('taboola', 'account_id', config.account_id, PROVIDER_ID_RES.taboola);
  return {
    head:
      `<script type="text/plain" data-trk-gate="advertising">` +
      `window._tfa=window._tfa||[];window._tfa.push({notify:'event',name:'page_view',id:${accountId}});` +
      `!function(t,f,a,x){if(!document.getElementById(x)){t.async=1;t.src=a;t.id=x;` +
      `f.parentNode.insertBefore(t,f)}}(document.createElement('script'),` +
      `document.getElementsByTagName('script')[0],` +
      `'https://cdn.taboola.com/libtrc/unip/${accountId}/tfa.js','tb_tfa_script');</script>`,
    cspHosts: {
      script: [...TABOOLA_CSP_HOSTS.script],
      connect: [...TABOOLA_CSP_HOSTS.connect],
      img: [...TABOOLA_CSP_HOSTS.img],
      frame: [],
    },
  };
};
