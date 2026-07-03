import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isObjectIdWithinCeiling,
  isSectionInstanceId,
  validateObjectIdForType,
  validateSectionInstanceId,
  type ObjectIdValidationResult,
} from './object-ids.js';
import { validateRequestId } from './agents-naming.js';
import type { ObjectType } from '../schema/object-record-v1.js';

const expectValid = (result: ObjectIdValidationResult, value: string) => {
  assert.deepStrictEqual(result, { ok: true, value });
};

const validObjectIds: Array<[ObjectType, string]> = [
  ['site', 'site_drlurie'],
  ['page', 'page_home'],
  ['section', 'sec_newsletter_signup'],
  ['navigation', 'nav_footer_home'],
  ['taxonomy', 'tax_drlurie'],
  ['template', 'tpl_home'],
  ['content_item', 'req_smoke_pdf_cta_20260630_01'],
];

const invalidObjectIds: Array<[ObjectType, string]> = [
  ['site', 'page_home'],
  ['page', 'page-Home'],
  ['section', 's_hero'],
  ['navigation', 'nav_'],
  ['taxonomy', 'tax_drlurie!'],
  ['template', 'template_home'],
  ['content_item', 'req_foo'],
];

describe('object ID validators', () => {
  it('checks the D§3.1 ceiling regex', () => {
    assert.strictEqual(isObjectIdWithinCeiling('page_home'), true);
    assert.strictEqual(isObjectIdWithinCeiling('req_smoke_pdf_cta_20260630_01'), true);
    assert.strictEqual(isObjectIdWithinCeiling('s_hero'), false);
    assert.strictEqual(isObjectIdWithinCeiling('page-home'), false);
  });

  it('accepts valid IDs for every object type', () => {
    for (const [objectType, value] of validObjectIds) {
      assert.strictEqual(validateObjectIdForType(objectType, value).ok, true, `${objectType}:${value}`);
    }
  });

  it('rejects malformed IDs for every object type', () => {
    for (const [objectType, value] of invalidObjectIds) {
      assert.strictEqual(validateObjectIdForType(objectType, value).ok, false, `${objectType}:${value}`);
    }
  });

  it('delegates content_item validation to validateRequestId verbatim', () => {
    const knownBad = 'req_foo';
    const valid = 'req_smoke_pdf_cta_20260630_01';

    assert.deepStrictEqual(validateObjectIdForType('content_item', knownBad), validateRequestId(knownBad));
    assert.deepStrictEqual(validateObjectIdForType('content_item', valid), validateRequestId(valid));
  });

  it('validates section-instance IDs with no underscores inside the suffix', () => {
    expectValid(validateSectionInstanceId('s_hero'), 's_hero');
    assert.strictEqual(isSectionInstanceId('s_startgrid'), true);
    assert.strictEqual(validateSectionInstanceId('s_start_grid').ok, false);
    assert.strictEqual(validateSectionInstanceId('sec_newsletter_signup').ok, false);
  });
});
