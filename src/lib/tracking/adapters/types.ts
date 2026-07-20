/**
 * Provider adapter interface (W13, 12-plan §4). An adapter is PURE:
 * `(providerConfig, context) → { head, cspHosts }` — a fixed, pre-minified
 * snippet template into which ONLY regex-revalidated IDs are interpolated.
 * The write-AND-render double enforcement (the checkBrandTokenValue law
 * extended to scripts): the body schema pinned the ID at write; the adapter
 * RE-ASSERTS the same regex at build and THROWS on mismatch — a drifted or
 * hand-edited export can never smuggle script/URL text into a page.
 *
 * `advertising`-class snippets are emitted by the component as
 * `<script type="text/plain" data-trk-gate="advertising">` and activated by
 * the consent bootstrap (T13.6) on region-clear or grant.
 */

export type AdapterCspHosts = {
  script: string[];
  connect: string[];
  img: string[];
  frame: string[];
};

export type AdapterResult = {
  /** Raw HTML for the <head>; '' renders nothing. Pre-minified. */
  head: string;
  cspHosts: AdapterCspHosts;
};

export class AdapterIdError extends Error {}

/** Re-assert the write-time regex at render; throw at build on mismatch. */
export const reassertId = (provider: string, field: string, value: unknown, pattern: RegExp): string => {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new AdapterIdError(
      `${provider}.${field} ${JSON.stringify(value)} fails ${String(pattern)} at render — refusing to emit the snippet (write+render double enforcement).`
    );
  }
  return value;
};

export const NO_CSP_HOSTS: AdapterCspHosts = { script: [], connect: [], img: [], frame: [] };
