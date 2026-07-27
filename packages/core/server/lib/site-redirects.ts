/**
 * SITE REDIRECTS (W14 F6) — the committed, agent-writable redirect table.
 *
 * Wolf's ruling (2026-07-27): "this is dtc sales and publishing project. we
 * can't lose readers. readers should always be redirected." So removing a page
 * is never allowed to produce a bare 404 — the retire that removes an export
 * writes the forwarding rule for its route in the SAME commit.
 *
 * Why a separate export rather than the existing redirect config:
 * `sites/<client>/site.config.ts` also carries `redirects`, but that array is
 * CODE and exists to be diffed against `netlify.toml` (the drift-guard pair for
 * infrastructure routes: /mcp, /img/*, …). Agents do not edit code, and those
 * two files must stay byte-comparable. Content redirects are DATA, they change
 * whenever an agent retires a page, and they belong with the other committed
 * exports under `data/site/`.
 *
 * The build turns this file into a Netlify `_redirects` artifact (see
 * `packages/core/app/routes/_redirects.ts`). Netlify gives `netlify.toml` rules
 * precedence over `_redirects`, which is the ordering we want: infrastructure
 * routing wins, content forwarding fills in behind it.
 */
import { z } from 'zod';

export const siteRedirectSchema = z.object({
  /** The route being forwarded FROM — the retired object's own route. */
  from: z.string().min(1),
  /** Where the reader lands instead. */
  to: z.string().min(1),
  /** 301 by default: a retirement is permanent, and search engines should move the equity. */
  status: z.number().int().min(300).max(399).default(301),
  /** Provenance — which object's retirement created this rule. */
  retired_object_id: z.string().min(1).optional(),
  at: z.string().optional(),
});

export type SiteRedirect = z.infer<typeof siteRedirectSchema>;

export const siteRedirectsSchema = z.array(siteRedirectSchema);

/** `<exportRoot>/redirects.json`, alongside site.json and the per-type folders. */
export const siteRedirectsExportPath = (exportRoot: string): string => `${exportRoot}/redirects.json`;

/**
 * Append or replace by `from`, keeping the table one-rule-per-route. Re-retiring
 * a route (or retiring a route a previous retirement already forwarded) updates
 * the destination instead of stacking a second, unreachable rule.
 */
export const upsertRedirect = (existing: SiteRedirect[], redirect: SiteRedirect): SiteRedirect[] => {
  const kept = existing.filter((entry) => entry.from !== redirect.from);
  // A rule that would forward to itself is dropped: it is a redirect loop.
  const cleaned = kept.filter((entry) => entry.to !== redirect.from || entry.from === redirect.from);
  return [...cleaned, redirect].sort((a, b) => a.from.localeCompare(b.from));
};

/** Netlify `_redirects` line format: `from  to  status`. */
export const toNetlifyRedirectsFile = (redirects: SiteRedirect[]): string =>
  redirects.map((entry) => `${entry.from}  ${entry.to}  ${entry.status ?? 301}`).join('\n');

/**
 * The redirect table is STORE-BACKED, like every other governed thing: the blob
 * store is the source of truth and the committed `redirects.json` is derived
 * from it. That is not ceremony — a retire rewrites the whole export file, so
 * without a readable source of truth each retire would clobber every redirect
 * the previous ones wrote. (Reading the file back out of git before every
 * commit would work too, at the cost of an extra round trip and a race.)
 */
export const SITE_REDIRECTS_DOC_KEY = 'site/redirects.v1.json';

export type SiteRedirectsStore = {
  get: (key: string) => Promise<string | null>;
  setJSON: (key: string, value: unknown) => Promise<unknown>;
};

/** Absent or malformed → an empty table; a retire must never fail on this. */
export const loadSiteRedirects = async (store: SiteRedirectsStore): Promise<SiteRedirect[]> => {
  try {
    const raw = await store.get(SITE_REDIRECTS_DOC_KEY);
    if (!raw) return [];
    const parsed = siteRedirectsSchema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : raw);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};
