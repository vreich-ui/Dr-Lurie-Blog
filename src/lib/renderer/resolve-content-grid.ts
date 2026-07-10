/**
 * M-8 content_grid resolution (T3.3) — the pure semantics of
 * manual-primary + query-fallback, extracted so the T3.6 renderer wires it
 * with real lookups and these rules stay unit-testable offline:
 *
 *   1. `query` source: run the query, cap at `limit`.
 *   2. `manual` source: resolve every listed id — an id that does not
 *      resolve to a published content item is a HARD error (validation
 *      rejects it earlier; render refuses rather than shipping a gap).
 *      Manual picks beyond `limit` are truncated (first `limit` win).
 *   3. Backfill: only when a `fallback` is declared and manual picks leave
 *      room — run the fallback query, drop anything already picked
 *      manually, fill up to `limit`. No fallback declared → no query runs,
 *      however short the manual list (an intentionally short grid is legal).
 *
 * `cards` never reaches here: its curated cells live in the section data and
 * the component renders them directly (only cell links resolve, in resolve.ts).
 */
import type { ContentGridSource, ContentQuery } from '../../schema/bodies/section-v1.js';

export type ContentGridResolvers<TCard> = {
  /** Published content summary for a manual item id; undefined = does not resolve. */
  resolveManualItem: (objectId: string) => TCard | undefined;
  /** Run a content query, best-first, at most `limit` results. */
  runQuery: (query: ContentQuery, limit: number) => TCard[];
  /** Stable identity for de-duplication between manual picks and query results. */
  idOf: (card: TCard) => string;
};

export class ContentGridResolutionError extends Error {
  readonly unresolved: string[];
  constructor(unresolved: string[]) {
    super(
      `content_grid: manual item(s) did not resolve to published content: ${unresolved.join(', ')} — ` +
        'validation should have rejected this record; refusing to render a gap.'
    );
    this.name = 'ContentGridResolutionError';
    this.unresolved = unresolved;
  }
}

export const resolveContentGridCards = <TCard>(
  source: Exclude<ContentGridSource, { kind: 'cards' }>,
  limit: number,
  resolvers: ContentGridResolvers<TCard>
): TCard[] => {
  if (source.kind === 'query') {
    return resolvers.runQuery(source.query, limit).slice(0, limit);
  }

  const manualIds = source.items.slice(0, limit);
  const unresolved: string[] = [];
  const cards: TCard[] = [];
  for (const objectId of manualIds) {
    const card = resolvers.resolveManualItem(objectId);
    if (card === undefined) unresolved.push(objectId);
    else cards.push(card);
  }
  if (unresolved.length > 0) throw new ContentGridResolutionError(unresolved);

  const room = limit - cards.length;
  if (room <= 0 || !source.fallback) return cards;

  const picked = new Set(cards.map((card) => resolvers.idOf(card)));
  // Ask for `limit` (not `room`): the query cannot know which of its best
  // results duplicate the manual picks, and dropping dupes must not shrink
  // the backfill below what is available.
  const backfill = resolvers.runQuery(source.fallback.query, limit).filter((card) => !picked.has(resolvers.idOf(card)));
  return [...cards, ...backfill.slice(0, room)];
};
