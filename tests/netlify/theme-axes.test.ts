/**
 * T10.1 — theme token axes (11-platformization-plan §1.1).
 *
 * Pins: the axis enums are bounded (unknown values reject on site AND theme
 * bodies); site and theme literally share ONE brandTokens schema object (no
 * fork to drift); every axis default maps to the literal the old hardcoded
 * tier compiled to (byte-identity by construction — the tailwind.css var
 * fallbacks quote the same literals); resolveAxisVars emits nothing for
 * absent/default/unknown axes and exactly the registry table for a
 * non-default one; every axis's values map a consistent var-name set.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  THEME_AXES,
  THEME_AXIS_GROUPS,
  THEME_AXIS_KEYS,
  resolveAxisVars,
} from '../../src/lib/registry/theme-tokens.js';
import { brandTokensSchema } from '../../src/schema/bodies/site-v1.js';
import { themeBodySchema } from '../../src/schema/bodies/theme-v1.js';

const baseTokens = {
  colors: { primary: 'rgb(46 111 149)' },
  fonts: { sans: "'Inter Variable'", serif: 'Georgia', heading: 'Georgia' },
};

test('axis enums accept every registered value and reject unknown ones', () => {
  for (const group of THEME_AXIS_GROUPS) {
    for (const [axisKey, spec] of Object.entries(THEME_AXES[group])) {
      for (const value of spec.values) {
        const parsed = brandTokensSchema.safeParse({ ...baseTokens, [group]: { [axisKey]: value } });
        assert.ok(parsed.success, `${group}.${axisKey}=${value} must parse`);
      }
      const rejected = brandTokensSchema.safeParse({ ...baseTokens, [group]: { [axisKey]: 'nope' } });
      assert.ok(!rejected.success, `${group}.${axisKey}=nope must reject`);
    }
  }
  // Unknown axis KEYS reject too (.strict()).
  assert.ok(!brandTokensSchema.safeParse({ ...baseTokens, layout: { gutters: 'wide' } }).success);
  assert.ok(!brandTokensSchema.safeParse({ ...baseTokens, density: 'high' }).success);
});

test('axes are additive-optional: the pre-axis shape still parses unchanged', () => {
  assert.ok(brandTokensSchema.safeParse(baseTokens).success);
});

test('theme.v1 shares the SAME brandTokens schema object as site.v1 (identity, not equivalence)', () => {
  assert.strictEqual(themeBodySchema.shape.tokens, brandTokensSchema);
  const theme = themeBodySchema.safeParse({
    name: 'axis test',
    tokens: { ...baseTokens, shape: { radius: 'sharp' } },
  });
  assert.ok(theme.success, 'theme tokens accept axes');
  const bad = themeBodySchema.safeParse({
    name: 'axis test',
    tokens: { ...baseTokens, shape: { radius: 'blob' } },
  });
  assert.ok(!bad.success, 'theme tokens reject unknown axis values');
});

test('every axis default maps to the literal the old hardcoded tier used', () => {
  assert.deepEqual(THEME_AXES.layout.containerWidth.vars.default, { '--dl-container-max': '72rem' });
  assert.deepEqual(THEME_AXES.layout.sectionRhythm.vars.default, {
    '--dl-section-py': '3.5rem',
    '--dl-section-py-sm': '5rem',
  });
  assert.deepEqual(THEME_AXES.shape.radius.vars.round, {
    '--dl-radius-card': '1rem',
    '--dl-radius-control': '0.375rem',
  });
  assert.deepEqual(THEME_AXES.shape.buttonShape.vars.pill, { '--dl-radius-btn': '9999px' });
  assert.deepEqual(THEME_AXES.shape.shadow.vars.soft, {
    '--dl-shadow-card': '0 1px 2px 0 rgb(15 23 42 / 0.05)',
  });
  assert.deepEqual(THEME_AXES.type.scale.vars.default, {
    '--dl-prose-size': '18px',
    '--dl-prose-size-lg': '20px',
    '--dl-prose-leading': '1.82',
  });
  assert.deepEqual(THEME_AXES.type.headingWeight.vars.bold, { '--dl-heading-weight': '700' });
  // And the default POINTERS name those exact values.
  assert.equal(THEME_AXES.layout.containerWidth.default, 'default');
  assert.equal(THEME_AXES.layout.sectionRhythm.default, 'default');
  assert.equal(THEME_AXES.shape.radius.default, 'round');
  assert.equal(THEME_AXES.shape.buttonShape.default, 'pill');
  assert.equal(THEME_AXES.shape.shadow.default, 'soft');
  assert.equal(THEME_AXES.type.scale.default, 'default');
  assert.equal(THEME_AXES.type.headingWeight.default, 'bold');
});

test('resolveAxisVars: absent, default-valued, and unknown axes emit NOTHING', () => {
  assert.deepEqual(resolveAxisVars(undefined), {});
  assert.deepEqual(resolveAxisVars(baseTokens), {});
  assert.deepEqual(
    resolveAxisVars({
      layout: { containerWidth: 'default', sectionRhythm: 'default' },
      shape: { radius: 'round', buttonShape: 'pill', shadow: 'soft' },
      type: { scale: 'default', headingWeight: 'bold' },
    }),
    {},
    'explicit defaults are byte-identity too'
  );
  assert.deepEqual(resolveAxisVars({ shape: { radius: 'weird' } }), {}, 'unknown values are skipped, never emitted');
});

test('resolveAxisVars: a non-default axis emits exactly its registry var set', () => {
  assert.deepEqual(resolveAxisVars({ shape: { radius: 'sharp' } }), {
    '--dl-radius-card': '0px',
    '--dl-radius-control': '0px',
  });
  assert.deepEqual(resolveAxisVars({ layout: { sectionRhythm: 'airy' }, type: { headingWeight: 'regular' } }), {
    '--dl-section-py': '4.5rem',
    '--dl-section-py-sm': '6.5rem',
    '--dl-heading-weight': '400',
  });
});

test('registry consistency: each axis maps the SAME var names for every value; keys list is complete', () => {
  for (const group of THEME_AXIS_GROUPS) {
    for (const [axisKey, spec] of Object.entries(THEME_AXES[group])) {
      assert.ok(spec.values.includes(spec.default), `${group}.${axisKey} default is a registered value`);
      const referenceNames = Object.keys(spec.vars[spec.default]).sort();
      for (const value of spec.values) {
        assert.deepEqual(
          Object.keys(spec.vars[value]).sort(),
          referenceNames,
          `${group}.${axisKey}=${value} maps the same var names as the default`
        );
      }
    }
  }
  assert.deepEqual(
    [...THEME_AXIS_KEYS].sort(),
    [
      'layout.containerWidth',
      'layout.sectionRhythm',
      'shape.buttonShape',
      'shape.radius',
      'shape.shadow',
      'type.headingWeight',
      'type.scale',
    ].sort()
  );
});
