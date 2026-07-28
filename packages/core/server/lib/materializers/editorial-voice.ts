/**
 * Editorial voice materializer — 'editorial_voice.v1' →
 * `<exportRoot>/voice/{voice_id}.json` (D1, 2026-07-28).
 *
 * The one materializer whose output no Astro route reads. It exists so a voice
 * is a COMMITTED, diffable fact in the site tree like every other governed
 * object: a voice change shows up in the same publish commit history a page
 * change does, and `git log` answers "when did this publication's claim policy
 * change, and who approved it". The engine reads the voice through the live
 * object surface (object_get), not from this file — the export is the audit
 * trail, not the transport.
 *
 * Pure, like every sibling: same body in, byte-identical file out.
 */
import { editorialVoiceBodySchema } from '../../../schema/bodies/editorial-voice-v1.js';
import { exportPath, renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeEditorialVoice = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = editorialVoiceBodySchema.parse(body);
  return {
    path: exportPath(meta, 'voice', `${objectId}.json`),
    content: renderExport('editorial_voice', objectId, parsed, meta),
  };
};
