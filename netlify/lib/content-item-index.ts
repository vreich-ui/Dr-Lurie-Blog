/**
 * Content-item index (closes playbook trap 4) — the committed article ids,
 * for validating `content_grid` manual picks and `content_embed` refs.
 *
 * Source of truth per the W3 ruling: COMMITTED FRONTMATTER — i.e. the files
 * under src/data/post on the content branch (never the blob draft
 * aggregation, §5.5). The id is the filename minus its extension: exactly the
 * Astro content-entry id the renderer matches manual picks against
 * (PageObjectRenderer's `post.id`).
 *
 * The server can't read repo files at runtime, so the listing comes from the
 * GitHub contents API using the SAME env contract as the object committer and
 * the release resolver (GITHUB_CONTENT_TOKEN / GITHUB_REPOSITORY /
 * GITHUB_BRANCH). Failure modes degrade, never brick: unconfigured or
 * erroring → `undefined` ("cannot answer" — validation treats the ref as
 * unverifiable rather than missing); a transient error after a successful
 * fetch serves the stale cache. One listing per TTL window, in-flight calls
 * deduplicated.
 */

import { getSiteIdentity } from '../../src/lib/site-identity.js';

const CONTENT_DIR = 'src/data/post';
const GITHUB_API_ROOT = 'https://api.github.com';
const USER_AGENT = `${getSiteIdentity().siteSlug}-content-item-index`;
const TTL_MS = 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** GitHub contents listing → the set of content-item ids (filename minus .md/.mdx). */
export const parseContentItemIds = (listing: unknown): Set<string> =>
  new Set(
    (Array.isArray(listing) ? listing : [])
      .filter(isRecord)
      .filter((entry) => entry.type === 'file' && typeof entry.name === 'string' && /\.(md|mdx)$/i.test(entry.name))
      .map((entry) => (entry.name as string).replace(/\.(md|mdx)$/i, ''))
  );

let cache: { at: number; ids: Set<string> } | undefined;
let inflight: Promise<Set<string> | undefined> | undefined;

export const resetContentItemIndexForTesting = () => {
  cache = undefined;
  inflight = undefined;
};

export const loadContentItemIds = async (fetchImpl: typeof fetch = fetch): Promise<Set<string> | undefined> => {
  const token = process.env.GITHUB_CONTENT_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH ?? process.env.BRANCH ?? 'main';
  if (!token || !repo) return undefined;

  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await fetchImpl(
        `${GITHUB_API_ROOT}/repos/${repo}/contents/${CONTENT_DIR}?ref=${encodeURIComponent(branch)}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': USER_AGENT,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
      if (!response.ok) return cache?.ids; // stale-if-error; undefined when never fetched
      const ids = parseContentItemIds(await response.json());
      cache = { at: Date.now(), ids };
      return ids;
    } catch {
      return cache?.ids;
    } finally {
      inflight = undefined;
    }
  })();
  return inflight;
};
