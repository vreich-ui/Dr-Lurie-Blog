/**
 * Plausible adapter (W13, 12-plan §4) — the DORMANT slot (§5: own
 * development preferred; this exists so flipping the provider on is a
 * config change, not a build). Manual mode (`script.manual.js`) per the
 * View-Transitions discipline — the loader’s pageview trigger owns
 * navigation truth. api_host is re-asserted against the bare-https-origin
 * regex at render (no path, no query — never script text from data).
 */
import { PROVIDER_ID_RES } from '../../../schema/bodies/tracking-config-v1.js';
import { reassertId, NO_CSP_HOSTS, type AdapterResult } from './types.js';

export const plausibleAdapter = (
  config: { enabled?: boolean; api_host?: string } | undefined,
  context: { siteHost: string }
): AdapterResult => {
  if (config?.enabled !== true) return { head: '', cspHosts: NO_CSP_HOSTS };
  const apiHost = reassertId('plausible', 'api_host', config.api_host, PROVIDER_ID_RES.plausible_api_host);
  const domain = context.siteHost.replace(/[^a-z0-9.-]/gi, '');
  return {
    head: `<script defer data-domain="${domain}" data-api="${apiHost}/api/event" src="${apiHost}/js/script.manual.js"></script>`,
    cspHosts: { script: [apiHost], connect: [apiHost], img: [], frame: [] },
  };
};
