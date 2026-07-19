/**
 * TrackingScripts assembly (W13, 12-plan §4) — the PURE half of the render
 * seam, so the component stays a thin shell and every decision here is
 * unit-tested: the `#trk-config` client JSON (project id from the
 * trk_<project> id convention, batch/sampling knobs, the defaults matrix,
 * the consent block, and the goal map aggregated from every collection's
 * `tracking` fields), plus the enabled-adapter head assembly.
 *
 * The goal map carries ONLY objects that need it (goals present or
 * enabled:false) — goal keys/labels are public by construction (§2), but
 * nothing else from `tracking` (label/tags NEVER leave the export).
 */
import { trackingConfigBodySchema, type TrackingConfigBody } from '../../schema/bodies/tracking-config-v1.js';
import { ownAdapter } from './adapters/own.js';
import { plausibleAdapter } from './adapters/plausible.js';
import type { AdapterResult } from './adapters/types.js';

export type GoalSource = {
  object_id: string;
  tracking?: {
    enabled?: boolean;
    goals?: { goal: string; on?: string }[];
  } | null;
};

export type TrackerGoalMap = Record<string, { enabled?: false; goals?: { goal: string; on?: string }[] }>;

/** {object_id → goals/off} — only entries that change loader behavior. */
export const buildGoalMap = (sources: readonly GoalSource[]): TrackerGoalMap => {
  const map: TrackerGoalMap = {};
  for (const source of sources) {
    const tracking = source.tracking;
    if (!tracking) continue;
    const entry: TrackerGoalMap[string] = {};
    if (tracking.enabled === false) entry.enabled = false;
    if (Array.isArray(tracking.goals) && tracking.goals.length > 0) {
      entry.goals = tracking.goals.map((goal) => ({ goal: goal.goal, ...(goal.on ? { on: goal.on } : {}) }));
    }
    if (Object.keys(entry).length > 0) map[source.object_id] = entry;
  }
  return map;
};

export type TrackerClientConfig = {
  project: string;
  ingest_path: string;
  batch: { max_events: number; max_wait_ms: number };
  sample_rate: number;
  defaults: TrackingConfigBody['defaults'];
  consent: { posture: string; regions: string[]; gpc: boolean };
  goals: TrackerGoalMap;
};

/**
 * Parse the committed export body (marker already stripped) — THROWS on a
 * present-but-invalid export (drift must be loud, the site-object stance).
 */
export const parseTrackingExport = (raw: unknown): TrackingConfigBody => trackingConfigBodySchema.parse(raw);

export const buildTrackerClientConfig = (
  objectId: string,
  body: TrackingConfigBody,
  goalSources: readonly GoalSource[]
): TrackerClientConfig => ({
  // trk_<project> — the site_/tax_ naming convention IS the project id.
  project: objectId.replace(/^trk_/, ''),
  ingest_path: body.providers.own?.ingest_path ?? '/api/t',
  batch: body.providers.own?.batch ?? { max_events: 20, max_wait_ms: 10000 },
  sample_rate: body.providers.own?.sample_rate ?? 1,
  defaults: body.defaults,
  consent: {
    posture: body.consent.posture,
    regions: body.consent.restricted_regions,
    gpc: body.consent.honor_gpc,
  },
  goals: buildGoalMap(goalSources),
});

/** Enabled adapters only, in emission order (own first, natives via T13.7/8). */
export const assembleAdapterHeads = (body: TrackingConfigBody, siteHost: string): AdapterResult[] => {
  const results: AdapterResult[] = [];
  results.push(ownAdapter(body.providers.own));
  results.push(plausibleAdapter(body.providers.plausible, { siteHost }));
  return results.filter((result) => result.head !== '' || result.cspHosts.script.length > 0);
};
