/**
 * The `own` first-party adapter (W13, 12-plan §4). Deliberately headless:
 * the loader is NOT injected here — TrackingScripts mounts it as a real
 * Astro-bundled `<script>` (hashed same-origin asset, the §5.5 ad-blocker
 * posture), so this adapter only contributes the CSP surface: the relay is
 * same-origin (`connect-src 'self'` covers /api/t) and the loader asset is
 * `script-src 'self'`.
 */
import type { AdapterResult } from './types.js';

export const ownAdapter = (ownConfig: { enabled?: boolean } | undefined): AdapterResult => ({
  head: '',
  cspHosts:
    ownConfig?.enabled === true
      ? { script: ["'self'"], connect: ["'self'"], img: [], frame: [] }
      : { script: [], connect: [], img: [], frame: [] },
});
