import assert from 'node:assert/strict';
import test from 'node:test';

import { imageDimensionsAtBreakpoint } from '../../packages/core/app/utils/image-dimensions.js';

test('scales both dimensions for public and remote image breakpoints', () => {
  assert.deepEqual(imageDimensionsAtBreakpoint(400, 1600, 900), { width: 400, height: 225 });
  assert.deepEqual(imageDimensionsAtBreakpoint(720, 720, 405), { width: 720, height: 405 });
});

test('leaves height absent when source dimensions are unavailable', () => {
  assert.deepEqual(imageDimensionsAtBreakpoint(400), { width: 400 });
  assert.deepEqual(imageDimensionsAtBreakpoint(400, 1600), { width: 400 });
});
