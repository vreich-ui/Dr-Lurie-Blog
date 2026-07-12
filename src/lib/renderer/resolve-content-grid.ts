/**
 * M-8 content_grid resolution (T3.3) — the pure semantics of
 * manual-primary + query-fallback, extracted so the T3.6 renderer wires it
 * with real lookups and these rules stay unit-testable offline:
 *
 *   1. `query` source: run the query, cap at `limit`.
 *   2. `manual` source: resolve every listed id — an id that does not
 *      resolve to a published content item is SKIPPED with a loud build-log
 *      warning naming it, never silently and never fatally. (Changed
 *      2026-07-11 under the no-pipeline-dead-ends rule: validation now
 *      blocks bad refs at write time — trap 4's resolver — so an unresolved
 *      ref here means TEMPORAL drift, e.g. a post deleted after the grid
 *      published, and a content deletion must never kill every future
 *      build. The declared fallback backfills the freed room.)
 *      Manual picks beyond `limit` are truncated (first `limit` win).
 *   3. Backfill: only when a `fallback` is declared and manual picks leave
 *      room — run the fallback query, drop anything already picked
 *      manually, fill up to `limit`. No fallback declared → no query runs,
 *      however short the manual list (an intentionally short grid is legal).
 *
 * `cards` never reaches here: its curated cells live in the section data and
 * the component renders them directly (only cell links resolve, in resolve.ts).
 */
import type { ContentQuery } from '../../schema/bodies/section-v1.js';

// The structural source shape shared by every M-8 grid (content_grid over
// posts, product_preview over products — S2): the query type is generic, the
// manual/fallback semantics are identical.
export type GridQuerySource<TQuery> = { kind: 'query'; query: TQuery };
export type GridManualSource<TQuery> = {
  kind: 'manual';
  items: string[];
  fallback?: GridQuerySource<TQuery>;
};

export type ContentGridResolvers<TCard, TQuery = ContentQuery> = {
  /** Published content summary for a manual item id; undefined = does not resolve. */
  resolveManualItem: (objectId: string) => TCard | undefined;
  /** Run a content query, best-first, at most `limit` results. */
  runQuery: (query: TQuery, limit: number) => TCard[];
  /** Stable identity for de-duplication between manual picks and query results. */
  idOf: (card: TCard) => string;
};

/** Injectable for tests; production uses console.warn (visible in build logs). */
export type ContentGridWarn = (message: string) => void;

export const resolveContentGridCards = <TCard, TQuery = ContentQuery>(
  source: GridQuerySource<TQuery> | GridManualSource<TQuery>,
  limit: number,
  resolvers: ContentGridResolvers<TCard, TQuery>,
  warn: ContentGridWarn = console.warn
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
  if (unresolved.length > 0) {
    warn(
      `[content_grid] manual item(s) no longer resolve to published content and were SKIPPED: ` +
        `${unresolved.join(', ')} — likely deleted/unpublished after the grid was published. ` +
        'Fix the grid (remove or replace the picks); the fallback query backfills meanwhile.'
    );
  }

  const room = limit - cards.length;
  if (room <= 0 || !source.fallback) return cards;

  const picked = new Set(cards.map((card) => resolvers.idOf(card)));
  // Ask for `limit` (not `room`): the query cannot know which of its best
  // results duplicate the manual picks, and dropping dupes must not shrink
  // the backfill below what is available.
  const backfill = resolvers.runQuery(source.fallback.query, limit).filter((card) => !picked.has(resolvers.idOf(card)));
  return [...cards, ...backfill.slice(0, room)];
};
