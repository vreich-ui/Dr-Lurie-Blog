/**
 * T10.2 — token axes: validation, apply semantics, contract surfacing.
 *
 * The axis apply drill on top of T10.1's schema/renderer work: site_apply_theme
 * exact-replace extends to the layout/shape/type axes (theme axis present →
 * copied; theme axis/group absent → site axis UNSET, defaults win), the
 * inverse restores the pre-apply record byte-exactly, dry_run reflects the
 * axes, validation mirrors the enum bounds with readable copy (and warns
 * inert on unknown axis keys), and object_contract advertises the axis keys —
 * derived from THEME_AXES, never hand-written.
 */
import '../../src/config/policy-bindings.js'; // W11 T11.2: register providers for tests hitting active*/getSiteIdentity
import assert from 'node:assert/strict';
import test from 'node:test';

import { handleObjectVerb, type ObjectVerbRequest, type ObjectVerbStore } from '../../packages/core/server/lib/object-verbs.js';
import { buildStoreValidationContext } from '../../packages/core/server/lib/object-validation-context.js';
import { objectRecordKey } from '../../packages/core/server/lib/object-store-keys.js';
import { checkTheme, summarizeValidation, validateObject } from '../../packages/core/server/lib/object-validate.js';
import { applyPatchOps, derivePatchInverse, type PatchOpCapture } from '../../packages/core/lib/object-patch-apply.js';
import { buildObjectContract } from '../../packages/core/lib/registry/object-contract.js';
import { THEME_AXIS_KEYS } from '../../packages/core/lib/registry/theme-tokens.js';
import type { PatchOp } from '../../packages/core/schema/object-patch-ops.js';
import type { ThemeBody } from '../../packages/core/schema/bodies/theme-v1.js';
import type { SiteBody } from '../../packages/core/schema/bodies/site-v1.js';
import type { ObjectRecord, Principal } from '../../packages/core/schema/object-record-v1.js';
import { siteBody } from '../../scripts/lib/site-seed-data.mjs';

const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const AGENT: Principal = { kind: 'agent', agent_name: 'axis-test', auth: 'publish_key' };

const createMemoryStore = () => {
  const blobs = new Map<string, string>();
  return {
    blobs,
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown) {
      blobs.set(key, JSON.stringify(value));
    },
    async list({ prefix }: { prefix: string }) {
      return { blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
};
type Store = ReturnType<typeof createMemoryStore>;

const call = async (store: Store, request: ObjectVerbRequest, principal: Principal = AGENT) => {
  const verbStore = store as unknown as ObjectVerbStore;
  const validationContext = await buildStoreValidationContext(verbStore);
  return handleObjectVerb(verbStore, request, principal, { nowMs: NOW, validationContext });
};

const seedObject = async (store: Store, objectType: 'theme' | 'site' | 'navigation', id: string, body: unknown) => {
  const res = await call(store, {
    action: 'create',
    object_type: objectType,
    site: 'site_drlurie',
    body,
    requested_id: id,
  });
  assert.equal(res.status, 200, `${id}: ${JSON.stringify(res.body)}`);
  return res.body.record as ObjectRecord;
};

const seedSite = async (store: Store, overrides?: Partial<SiteBody['brandTokens']>) => {
  const navBody = (role: 'header' | 'footer') => ({
    role,
    groups: [{ id: 'g_main', items: [{ id: 'i_home', label: 'Home', target: { kind: 'route', href: '/' } }] }],
  });
  await seedObject(store, 'navigation', 'nav_header', navBody('header'));
  await seedObject(store, 'navigation', 'nav_footer', navBody('footer'));
  const body = overrides ? { ...siteBody, brandTokens: { ...siteBody.brandTokens, ...overrides } } : siteBody;
  return seedObject(store, 'site', 'site_drlurie', body);
};

const checkoutSite = async (store: Store) => {
  const res = await call(store, { action: 'checkout', object_type: 'site', object_id: 'site_drlurie' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { lockToken: res.body.lockToken as string, recordVersion: res.body.record_version as number };
};

const loadSite = (store: Store): ObjectRecord =>
  JSON.parse(store.blobs.get(objectRecordKey('site', 'site_drlurie'))!) as ObjectRecord;

// Total palette (every consumed key) so apply passes the totality gate; the
// axis payload varies per test.
const themeWith = (axes: Partial<Pick<SiteBody['brandTokens'], 'layout' | 'shape' | 'type'>>): ThemeBody => ({
  name: 'Axis preset',
  tokens: {
    colors: { ...siteBody.brandTokens.colors },
    fonts: { ...siteBody.brandTokens.fonts },
    ...axes,
  },
});

const applyTheme = async (store: Store, themeId: string) => {
  const { lockToken, recordVersion } = await checkoutSite(store);
  const res = await call(store, {
    action: 'apply_theme',
    theme_id: themeId,
    site_id: 'site_drlurie',
    lock_token: lockToken,
    expected_record_version: recordVersion,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res;
};

// ═══ apply semantics ══════════════════════════════════════════════════════════

test('apply with axes replaces exactly: theme axes in, stale site axes unset within the group', async () => {
  const store = createMemoryStore();
  // Site starts with BOTH shape axes set; the theme carries only one of them
  // plus a layout group the site lacks.
  await seedSite(store, { shape: { radius: 'pill', shadow: 'elevated' }, type: { scale: 'compact' } });
  await seedObject(
    store,
    'theme',
    'thm_axes',
    themeWith({ shape: { radius: 'sharp' }, layout: { sectionRhythm: 'airy' } })
  );
  await applyTheme(store, 'thm_axes');

  const tokens = (loadSite(store).body as SiteBody).brandTokens;
  assert.deepEqual(tokens.shape, { radius: 'sharp' }, 'theme axis copied; the stale shadow axis is UNSET');
  assert.deepEqual(tokens.layout, { sectionRhythm: 'airy' }, 'a group the site lacked is set from the theme');
  assert.equal(tokens.type, undefined, 'a group the theme lacks is unset entirely — defaults win');
});

test('apply of an axis-less theme restores defaults (all site axes unset)', async () => {
  const store = createMemoryStore();
  await seedSite(store, {
    layout: { containerWidth: 'wide' },
    shape: { radius: 'sharp', buttonShape: 'rect' },
    type: { headingWeight: 'regular' },
  });
  await seedObject(store, 'theme', 'thm_plain', themeWith({}));
  await applyTheme(store, 'thm_plain');

  const tokens = (loadSite(store).body as SiteBody).brandTokens;
  assert.equal(tokens.layout, undefined);
  assert.equal(tokens.shape, undefined);
  assert.equal(tokens.type, undefined);
  assert.deepEqual(tokens.colors, siteBody.brandTokens.colors, 'colors ride the same exact-replace unchanged');
});

test('the inverse restores the pre-apply record byte-exactly (axes included)', async () => {
  const store = createMemoryStore();
  await seedSite(store, { shape: { radius: 'soft' }, layout: { containerWidth: 'narrow' } });
  const before = loadSite(store);
  await seedObject(store, 'theme', 'thm_flip', themeWith({ type: { scale: 'editorial' } }));
  await applyTheme(store, 'thm_flip');

  const applied = loadSite(store);
  const appliedTokens = (applied.body as SiteBody).brandTokens;
  assert.deepEqual(appliedTokens.type, { scale: 'editorial' });
  assert.equal(appliedTokens.shape, undefined);

  const entry = applied.history.at(-1)!;
  assert.equal(entry.action, 'set_site_brand_tokens');
  const inverse = derivePatchInverse(entry.details!.op as PatchOp, entry.details!.capture as PatchOpCapture);
  const reverted = applyPatchOps(applied, [inverse as PatchOp], {
    actor: { kind: 'agent', agent_name: 'discard', auth: 'publish_key' },
    at: new Date(0).toISOString(),
    privilegedOps: ['set_site_brand_tokens'],
  });
  assert.deepEqual(
    (reverted.record.body as SiteBody).brandTokens,
    (before.body as SiteBody).brandTokens,
    'inverse restores the pre-apply brandTokens byte-exactly — axes, colors, fonts'
  );
});

test('dry_run reflects the axes in the computed op without persisting', async () => {
  const store = createMemoryStore();
  await seedSite(store, { shape: { radius: 'pill' } });
  await seedObject(store, 'theme', 'thm_dry', themeWith({ layout: { containerWidth: 'wide' } }));

  const res = await call(store, {
    action: 'apply_theme',
    theme_id: 'thm_dry',
    site_id: 'site_drlurie',
    dry_run: true,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.dry_run, true);
  const op = res.body.op as { fields: { brandTokens: Record<string, unknown> } };
  assert.deepEqual(op.fields.brandTokens.layout, { containerWidth: 'wide' });
  assert.equal(op.fields.brandTokens.shape, null, 'the group the theme lacks is unset in the computed op');
  assert.equal(res.body.eligible, true, JSON.stringify(res.body.validation));

  const tokens = (loadSite(store).body as SiteBody).brandTokens;
  assert.deepEqual(tokens.shape, { radius: 'pill' }, 'dry_run persisted nothing');
});

// ═══ validation ═══════════════════════════════════════════════════════════════

test('validation: a valid axis set is complete; an invalid enum value blocks with readable copy', () => {
  const good = checkTheme({ name: 'ok', tokens: themeWith({ shape: { radius: 'sharp' } }).tokens }, false);
  const axisCriterion = good.find((criterion) => criterion.id === 'brand_token_axes');
  assert.ok(axisCriterion);
  assert.equal(axisCriterion.status, 'complete');

  const bad = checkTheme({ name: 'bad', tokens: { ...themeWith({}).tokens, shape: { radius: 'blob' } } }, false);
  const badCriterion = bad.find((criterion) => criterion.id === 'brand_token_axes');
  assert.ok(badCriterion);
  assert.equal(badCriterion.status, 'missing');
  assert.match(badCriterion.message, /tokens\.shape\.radius/);
  assert.match(badCriterion.message, /sharp \| soft \| round \| pill/);
});

test('validation: unknown axis keys warn inert (theme AND site); the site check carries the axis criteria', () => {
  const theme = checkTheme(
    { name: 'legacy', tokens: { ...themeWith({}).tokens, layout: { gutterWidth: 'wide' } } },
    false
  );
  const unknown = theme.find((criterion) => criterion.id === 'brand_token_axis_unknown_keys');
  assert.ok(unknown, 'unknown axis key criterion present');
  assert.equal(unknown.status, 'warning');
  assert.match(unknown.message, /tokens\.layout\.gutterWidth/);
  const axes = theme.find((criterion) => criterion.id === 'brand_token_axes');
  assert.equal(axes?.status, 'complete', 'unknown keys warn — they do not block the axis criterion');

  const site = validateObject(
    {
      objectType: 'site',
      objectId: 'site_drlurie',
      body: { ...siteBody, brandTokens: { ...siteBody.brandTokens, type: { scale: 'imaginary' } } },
    },
    {}
  );
  const summary = summarizeValidation(site);
  assert.ok(
    summary.blockers.some((blocker) => blocker.message.includes('brandTokens.type.scale')),
    `site axis enum violations block: ${JSON.stringify(summary.blockers)}`
  );
});

// ═══ contract ═════════════════════════════════════════════════════════════════

test('object_contract advertises the axis keys on theme AND site — derived from THEME_AXES', () => {
  for (const objectType of ['theme', 'site'] as const) {
    const contract = buildObjectContract(objectType) as unknown as {
      constraints: { id: string; description: string }[];
      workflow: unknown;
    };
    const constraint = contract.constraints.find((entry) => entry.id === 'brand_token_axes');
    assert.ok(constraint, `${objectType} carries the brand_token_axes constraint`);
    for (const key of THEME_AXIS_KEYS) {
      assert.ok(constraint.description.includes(key), `${objectType} constraint names ${key}`);
    }
    const workflowText = JSON.stringify(contract.workflow);
    assert.ok(workflowText.includes('site_apply_theme'), `${objectType} workflow mentions the apply verb`);
  }
  // The theme body schema the contract serves picks the axes up from the
  // shared schema (derivation, not hand-writing).
  const theme = buildObjectContract('theme') as unknown as { body_schema: unknown };
  const schemaText = JSON.stringify(theme.body_schema);
  for (const fragment of ['containerWidth', 'sectionRhythm', 'buttonShape', 'headingWeight']) {
    assert.ok(schemaText.includes(fragment), `theme body_schema advertises ${fragment}`);
  }
});
