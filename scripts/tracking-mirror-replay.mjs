/**
 * tracking-mirror-replay — backfill the `tracking-events` blob mirror into
 * an owner sink (W13 T13.9, 12-plan §5.4).
 *
 * The mirror catches events whenever the sink was absent or unhealthy
 * (blob_mirror 'fallback') or always (blob_mirror 'always'). This script
 * reads a date range from the mirror and POSTs NDJSON batches to the sink;
 * the sink's `event_id UNIQUE` (schema.sql, ON CONFLICT DO NOTHING) makes
 * replay idempotent — re-running a range never duplicates rows.
 *
 * Usage (DRY-RUN by default — prints the plan, posts nothing):
 *   node scripts/tracking-mirror-replay.mjs --from 2026-07-19 [--to 2026-07-20]
 *     [--sink https://db.example.com/ingest] [--token-env TRACKING_SINK_TOKEN]
 *     [--batch-size 100] [--execute]
 *
 * Compile first: rm -rf .tmp/ci-test && npx tsc -p tsconfig.test.json
 * (the script reads the mirror through the compiled netlify/lib blob client,
 * the exact code the ingest function runs). Blob access needs the Netlify
 * env of the site (NETLIFY_SITE_ID + NETLIFY_AUTH_TOKEN / blobs token) or a
 * local file-backed store for rehearsal. The token ENV NAME (never a value)
 * follows the OQ-W13-6 contract; the sink URL is an argument because replay
 * is an operator action, not config.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { datesInRange, replayEvents } from './lib/tracking-replay.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const options = { from: null, to: null, sink: null, tokenEnv: 'TRACKING_SINK_TOKEN', batchSize: 100, execute: false };
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--from') options.from = argv[++index];
  else if (arg === '--to') options.to = argv[++index];
  else if (arg === '--sink') options.sink = argv[++index];
  else if (arg === '--token-env') options.tokenEnv = argv[++index];
  else if (arg === '--batch-size') options.batchSize = Number(argv[++index]);
  else if (arg === '--execute') options.execute = true;
  else {
    console.error(`[replay] unknown argument: ${arg}`);
    process.exit(2);
  }
}
if (!options.from) {
  console.error('[replay] --from yyyy-mm-dd is required (--to defaults to --from).');
  process.exit(2);
}
options.to = options.to ?? options.from;

const compiledRoot = path.join(repoRoot, '.tmp', 'ci-test');
if (!fs.existsSync(path.join(compiledRoot, 'netlify', 'lib', 'blob-store.js'))) {
  console.error('[replay] compiled blob client missing. Run first:');
  console.error('  rm -rf .tmp/ci-test && npx tsc -p tsconfig.test.json');
  process.exit(2);
}
const { getTrackingEventsBlobStore } = await import(path.join(compiledRoot, 'netlify', 'lib', 'blob-store.js'));
const { collectBlobListItems } = await import(path.join(compiledRoot, 'netlify', 'lib', 'blob-list.js'));

const store = await getTrackingEventsBlobStore(undefined);
const events = [];
let unreadable = 0;
for (const date of datesInRange(options.from, options.to)) {
  const items = await collectBlobListItems(await store.list({ prefix: `events/${date}/` }));
  // Mirror keys embed the compact timestamp — lexicographic = chronological.
  items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const item of items) {
    const raw = await store.get(item.key);
    if (raw === null) continue;
    try {
      events.push(JSON.parse(raw));
    } catch {
      unreadable += 1; // an unreadable mirror entry is reported, never fatal
    }
  }
  console.log(`[replay] ${date}: ${items.length} mirrored event(s)`);
}
if (unreadable > 0) console.log(`[replay] WARNING: ${unreadable} unreadable mirror entr(ies) skipped`);

if (options.execute && !options.sink) {
  console.error('[replay] --execute needs --sink <url>.');
  process.exit(2);
}
const token = options.sink ? process.env[options.tokenEnv]?.trim() : undefined;
if (options.execute && !token) {
  console.log(`[replay] NOTE: ${options.tokenEnv} is unset — posting without Authorization.`);
}

const post = async (body) => {
  const response = await fetch(options.sink, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-ndjson',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  return { ok: response.ok, status: response.status };
};

const summary = await replayEvents(events, {
  post,
  batchSize: options.batchSize,
  dryRun: !options.execute,
});
console.log(
  `[replay] ${summary.dryRun ? 'DRY-RUN' : 'DONE'} — ${summary.events} event(s) in ${summary.batches} batch(es)` +
    `${summary.dryRun ? ' (no posts made; add --execute --sink <url> to send)' : `, ${summary.posted} posted`}` +
    `${summary.duplicates > 0 ? `; ${summary.duplicates} in-run duplicate(s) skipped` : ''}` +
    `${summary.dropped > 0 ? `; ${summary.dropped} id-less entr(ies) dropped` : ''}`
);
