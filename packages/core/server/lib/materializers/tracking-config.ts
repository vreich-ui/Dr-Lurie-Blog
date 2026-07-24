/**
 * Tracking-config materializer — 'tracking_config.v1' →
 * `<exportRoot>/tracking.json` (W13, 12-plan §3; exportRoot parameterized W11
 * T11.6). Singleton-filename convention like site.json / taxonomy.json: one
 * file directly under the export root, NOT a per-type directory. Exported
 * verbatim (the theme/template precedent — the export is a registry
 * snapshot; the T13.5 renderer seam is its build consumer).
 */
import { trackingConfigBodySchema } from '../../../schema/bodies/tracking-config-v1.js';
import { exportPath, renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeTrackingConfig = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = trackingConfigBodySchema.parse(body);
  return {
    path: exportPath(meta, 'tracking.json'),
    content: renderExport('tracking_config', objectId, parsed, meta),
  };
};
