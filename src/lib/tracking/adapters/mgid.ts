/**
 * mgid adapter (W13 T13.8, 12-plan §7) — the MGID sensor (`_mgq` queue +
 * mgsensor loader), ALWAYS consent-gated. The account id is re-asserted at
 * render for config completeness (digits-only regex) but is NOT
 * interpolated into the snippet — the sensor resolves the account
 * dashboard-side. Conversions arrive through the T13.7 bridge as
 * `_mgq.push(['MgSensorInvoke', <label>])`.
 *
 * VERIFY BEFORE ENABLING (recorded for T13.11): the sensor URL and invoke
 * verb must be re-checked against MGID's current pixel docs when the
 * provider is first enabled — the adapter ships disabled in-repo and the
 * hosts-drift test forces the netlify.toml CSP edit to ride that same
 * change, so the verification has a natural checkpoint.
 */
import { PROVIDER_ID_RES } from '../../../schema/bodies/tracking-config-v1.js';
import { reassertId, NO_CSP_HOSTS, type AdapterResult } from './types.js';

export const MGID_CSP_HOSTS = {
  script: ['https://a.mgid.com'],
  connect: ['https://a.mgid.com', 'https://c.mgid.com'],
  img: ['https://c.mgid.com'],
  frame: [],
} as const;

export const mgidAdapter = (config: { enabled?: boolean; account_id?: string } | undefined): AdapterResult => {
  if (config?.enabled !== true) return { head: '', cspHosts: NO_CSP_HOSTS };
  reassertId('mgid', 'account_id', config.account_id, PROVIDER_ID_RES.mgid);
  return {
    head:
      `<script type="text/plain" data-trk-gate="advertising">` +
      `window._mgq=window._mgq||[];` +
      `!function(d){var t=d.createElement('script');t.async=!0;` +
      `t.src='https://a.mgid.com/mgsensor.js';` +
      `var s=d.getElementsByTagName('script')[0];s.parentNode.insertBefore(t,s)}(document);</script>`,
    cspHosts: {
      script: [...MGID_CSP_HOSTS.script],
      connect: [...MGID_CSP_HOSTS.connect],
      img: [...MGID_CSP_HOSTS.img],
      frame: [],
    },
  };
};
