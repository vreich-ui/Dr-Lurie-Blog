/**
 * Mirror-replay core (W13 T13.9, 12-plan §5.4) — the PURE half of
 * scripts/tracking-mirror-replay.mjs, so the batching/dedupe/dry-run laws
 * are unit-testable without a network or a blob store.
 *
 * The mirror keys events at `events/<yyyy-mm-dd>/<compactTs>-<event_id>.json`
 * (netlify/lib/tracking-events.ts trackingEventKey). Replay reads a date
 * range, dedupes within the run on `event_id` (the mirror itself is
 * append-only-unique, but a range can be replayed twice), and POSTs NDJSON
 * batches with Bearer auth — the sink's `event_id UNIQUE` column makes the
 * whole operation idempotent end-to-end (re-running is safe by design).
 */

/** Inclusive yyyy-mm-dd range → the mirror's per-date prefixes. */
export const datesInRange = (from, to) => {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new Error(`datesInRange: dates must be yyyy-mm-dd (got ${from}..${to})`);
  }
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    throw new Error(`datesInRange: invalid range ${from}..${to}`);
  }
  const dates = [];
  for (let ts = start; ts <= end; ts += 86_400_000) {
    dates.push(new Date(ts).toISOString().slice(0, 10));
  }
  if (dates.length > 366) throw new Error('datesInRange: refusing a range longer than a year');
  return dates;
};

/** Drop malformed entries and in-run duplicates; preserve mirror order. */
export const dedupeEvents = (events) => {
  const seen = new Set();
  const kept = [];
  let dropped = 0;
  let duplicates = 0;
  for (const event of events) {
    const id = event && typeof event === 'object' ? event.event_id : undefined;
    if (typeof id !== 'string' || id.length === 0) {
      dropped += 1;
      continue;
    }
    if (seen.has(id)) {
      duplicates += 1;
      continue;
    }
    seen.add(id);
    kept.push(event);
  }
  return { kept, dropped, duplicates };
};

/** Slice into POST-sized batches (order-preserving). */
export const planBatches = (events, batchSize) => {
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 100;
  const batches = [];
  for (let index = 0; index < events.length; index += size) {
    batches.push(events.slice(index, index + size));
  }
  return batches;
};

export const toNdjson = (events) => events.map((event) => JSON.stringify(event)).join('\n') + '\n';

/**
 * Replay `events` to a sink. `post(body, batch)` is injected (the CLI wires
 * fetch; tests wire a recorder) and must resolve `{ ok, status }` — a
 * non-202/200 response aborts the run (at-most-once forwarding, mirror data
 * is never at risk). Dry-run performs NO posts and reports the plan.
 */
export const replayEvents = async (events, { post, batchSize = 100, dryRun = true }) => {
  const { kept, dropped, duplicates } = dedupeEvents(events);
  const batches = planBatches(kept, batchSize);
  const summary = { events: kept.length, dropped, duplicates, batches: batches.length, posted: 0, dryRun };
  if (dryRun) return summary;
  for (const batch of batches) {
    const response = await post(toNdjson(batch), batch);
    if (!response || (response.status !== 202 && response.status !== 200)) {
      throw new Error(
        `replay aborted: sink answered ${response ? response.status : 'nothing'} after ${summary.posted} posted batch(es) — ` +
          `re-run when the sink is healthy; event_id idempotency makes the re-run safe.`
      );
    }
    summary.posted += 1;
  }
  return summary;
};
