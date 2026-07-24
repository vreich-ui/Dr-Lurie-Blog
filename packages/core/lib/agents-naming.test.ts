import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeFilename,
  normalizeMachineSafeId,
  normalizeSlug,
  validateFilename,
  validateRequestId,
  validateSlot,
  validateSlug,
  validateTemplateId,
} from './agents-naming.js';

test('validates required agent naming examples', () => {
  assert.deepEqual(validateRequestId('req_smoke_pdf_cta_20260630_01'), {
    ok: true,
    value: 'req_smoke_pdf_cta_20260630_01',
  });
  assert.deepEqual(validateTemplateId('tpl_drlurie_smoke_download_minimal_v1'), {
    ok: true,
    value: 'tpl_drlurie_smoke_download_minimal_v1',
  });
  assert.deepEqual(validateSlot('download_skin_reset_guide'), { ok: true, value: 'download_skin_reset_guide' });
  assert.deepEqual(validateSlot('img_featured_01'), { ok: true, value: 'img_featured_01' });
  assert.deepEqual(validateFilename('skin-reset-guide-20260630.pdf'), {
    ok: true,
    value: 'skin-reset-guide-20260630.pdf',
  });
  assert.deepEqual(validateSlug('skin-reset-guide'), { ok: true, value: 'skin-reset-guide' });
});

test('normalizes IDs, slugs, and filenames deterministically', () => {
  assert.equal(normalizeMachineSafeId('Smoke PDF CTA'), 'smoke_pdf_cta');
  assert.equal(normalizeMachineSafeId('smoke-pdf.cta'), 'smoke_pdf_cta');
  assert.equal(normalizeSlug('Skin Reset Guide'), 'skin-reset-guide');
  assert.equal(normalizeFilename('../Skin Reset Guide 20260630.PDF'), 'skin-reset-guide-20260630.pdf');
});

test('rejects invalid machine-safe IDs and malformed structured names', () => {
  assert.equal(validateRequestId('smoke-pdf-cta').ok, false);
  assert.equal(validateRequestId('req_smoke_pdf_cta_20260630').ok, false);
  assert.equal(validateTemplateId('tpl_drlurie_smoke-download_minimal_v1').ok, true);
  assert.equal(validateTemplateId('drlurie_smoke_download_minimal_v1').ok, false);
  assert.equal(validateSlot('featured').ok, false);
  assert.equal(validateSlot('img_featured_1').ok, false);
  assert.deepEqual(validateSlug('Skin_Reset_Guide'), { ok: true, value: 'skin-reset-guide' });
  assert.deepEqual(validateFilename('skin_reset_guide.pdf'), { ok: true, value: 'skin-reset-guide.pdf' });
});
