-- Tracking sink — Postgres reference schema (W13 T13.9, 12-plan §5.4).
-- The owner's "DB listening to triggers", verbatim: one events table with
-- idempotent inserts, and an AFTER INSERT trigger firing pg_notify so any
-- LISTENing worker reacts to events in real time.
--
-- The column set mirrors `tracking_event.v1` (src/schema/tracking-event-v1.ts
-- is the contract; the receiver validated shape before insert). Evolution is
-- ADDITIVE-ONLY (the commerce_event.v1 rules): new optional fields land in
-- the jsonb columns first; promote to real columns only when queries need
-- indexes on them.

CREATE TABLE IF NOT EXISTS tracking_events (
  event_id      uuid        NOT NULL,
  project_id    text        NOT NULL,
  ts            timestamptz NOT NULL,
  event         text        NOT NULL,
  url_path      text        NOT NULL,
  url_route     text,
  -- object identity (nullable — not every event carries every ref)
  object_type   text,
  object_id     text,
  section_id    text,
  section_type  text,
  node_id       text,          -- the strategy JOIN key (see node_strategy)
  node_kind     text,
  term_id       text,
  -- visitor identity (cookieless by default; vhash rotates daily by design)
  visitor_mode  text        NOT NULL,
  visitor_vid   uuid,
  vhash         text        NOT NULL,
  shash         text        NOT NULL,
  -- bounded structured payloads (allowlisted at ingest)
  consent       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  props         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  context       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  received_at   timestamptz NOT NULL DEFAULT now(),

  -- `event_id UNIQUE` is the idempotency law: the mirror-replay script (and
  -- any sink retry) can re-send freely; ON CONFLICT DO NOTHING at insert.
  CONSTRAINT tracking_events_event_id_key UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS tracking_events_project_ts_idx
  ON tracking_events (project_id, ts);
CREATE INDEX IF NOT EXISTS tracking_events_project_object_ts_idx
  ON tracking_events (project_id, object_id, ts);
CREATE INDEX IF NOT EXISTS tracking_events_project_event_ts_idx
  ON tracking_events (project_id, event, ts);
CREATE INDEX IF NOT EXISTS tracking_events_props_gin_idx
  ON tracking_events USING gin (props);

-- ─── the trigger ─────────────────────────────────────────────────────────────
-- pg_notify payloads are capped (~8KB); notify the IDENTITY of the new row,
-- not the row itself — listeners fetch what they need.

CREATE OR REPLACE FUNCTION notify_tracking_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'tracking_events',
    json_build_object(
      'event_id',   NEW.event_id,
      'project_id', NEW.project_id,
      'event',      NEW.event,
      'object_id',  NEW.object_id,
      'ts',         NEW.ts
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tracking_events_notify ON tracking_events;
CREATE TRIGGER tracking_events_notify
  AFTER INSERT ON tracking_events
  FOR EACH ROW EXECUTE FUNCTION notify_tracking_event();

-- ─── the reference insert (receiver-side) ────────────────────────────────────
-- INSERT INTO tracking_events (event_id, project_id, ts, event, url_path,
--   url_route, object_type, object_id, section_id, section_type, node_id,
--   node_kind, term_id, visitor_mode, visitor_vid, vhash, shash, consent,
--   props, context)
-- VALUES (...)
-- ON CONFLICT (event_id) DO NOTHING;

-- ─── the strategy dimension (OQ-W13-5: the JOIN is blessed) ─────────────────
-- Events carry node_id ONLY (leak-safe by construction). The owner ingests
-- the committed article exports (src/data/site/articles/*.json — exports
-- round-trip private fields by design) into this dimension; engagement ×
-- strategy is then a plain JOIN on (object_id, node_id). The README's
-- "strategy join" section documents the ingest recipe.

CREATE TABLE IF NOT EXISTS node_strategy (
  project_id  text NOT NULL,
  object_id   text NOT NULL,
  node_id     text NOT NULL,
  strategy    text,
  intent      text,
  node_kind   text,
  position    integer,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, object_id, node_id)
);

-- Example: engagement by strategy
-- SELECT ns.strategy,
--        count(*) FILTER (WHERE e.event = 'node_impression') AS impressions,
--        sum((e.props->>'dwell_ms')::bigint)                 AS dwell_ms
--   FROM tracking_events e
--   JOIN node_strategy ns
--     ON ns.project_id = e.project_id
--    AND ns.object_id  = e.object_id
--    AND ns.node_id    = e.node_id
--  GROUP BY ns.strategy;
