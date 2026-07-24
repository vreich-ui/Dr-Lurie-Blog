/**
 * Tracking-config materializer — 'tracking_config.v1' →
 * src/data/site/tracking.json (W13, 12-plan §3). Singleton-filename
 * convention like site.json / taxonomy.json: one file directly under
 * src/data/site, NOT a per-type directory. Exported verbatim (the
 * theme/template precedent — the export is a registry snapshot; the T13.5
 * renderer seam is its build consumer).
 */
import { trackingConfigBodySchema } from '../../../packages/core/schema/bodies/tracking-config-v1.js';
import { renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeTrackingConfig = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = trackingConfigBodySchema.parse(body);
  return {
    path: 'src/data/site/tracking.json',
    content: renderExport('tracking_config', objectId, parsed, meta),
  };
};
