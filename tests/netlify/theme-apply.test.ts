/**
 * W8.3 — the `theme` type, brand-token safety, and `site_apply_theme`
 * (09-template-system-plan §6 + §7.3).
 *
 * The apply drill: exact-replace semantics (stale site color keys are unset,
 * not left to leak), one atomic op with the theme provenance in history and
 * an exact inverse; the default-theme apply against the untouched seed site
 * is a provable no-op (the W8.4 zero-risk end-to-end proof). Value safety
 * gates BOTH write paths into CustomStyles' inline <style> tag — theme tokens
 * and site.brandTokens.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { handleObjectVerb, type ObjectVerbRequest, type ObjectVerbStore } from '../../netlify/lib/object-verbs.js';
import { buildStoreValidationContext } from '../../netlify/lib/object-validation-context.js';
import { objectRecordKey } from '../../netlify/lib/object-store-keys.js';
import { checkTheme, summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import { applyPatchOps, derivePatchInverse, type PatchOpCapture } from '../../src/lib/object-patch-apply.js';
import { validateObjectIdForType } from '../../src/lib/object-ids.js';
import type { PatchOp } from '../../src/schema/object-patch-ops.js';
import { themeBodySchema, type ThemeBody } from '../../src/schema/bodies/theme-v1.js';
import type { SiteBody } from '../../src/schema/bodies/site-v1.js';
import type { ObjectRecord, Principal } from '../../src/schema/object-record-v1.js';
import { CONVERSION_SEEDS, themeDefaultBody } from '../../scripts/lib/themes-seed-data.mjs';
import { siteBody } from '../../scripts/lib/site-seed-data.mjs';

const NOW = Date.parse('2026-07-14T12:00:00.000Z');
const AGENT: Principal = { kind: 'agent', agent_name: 'theme-test', auth: 'publish_key' };

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

// The site seed's defaultNavigation references must resolve (reference
// integrity is live in these tests), so seed minimal nav objects first.
const seedSite = async (store: Store) => {
  const navBody = (role: 'header' | 'footer') => ({
    role,
    groups: [{ id: 'g_main', items: [{ id: 'i_home', label: 'Home', target: { kind: 'route', href: '/' } }] }],
  });
  await seedObject(store, 'navigation', 'nav_header', navBody('header'));
  await seedObject(store, 'navigation', 'nav_footer', navBody('footer'));
  return seedObject(store, 'site', 'site_drlurie', siteBody);
};

const checkoutSite = async (store: Store, siteId = 'site_drlurie') => {
  const res = await call(store, { action: 'checkout', object_type: 'site', object_id: siteId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { lockToken: res.body.lockToken as string, recordVersion: res.body.record_version as number };
};

const loadSite = (store: Store, siteId = 'site_drlurie'): ObjectRecord =>
  JSON.parse(store.blobs.get(objectRecordKey('site', siteId))!) as ObjectRecord;

// A distinct, safe alternate palette: every consumed key present, one custom
// key deliberately NOT carried by the site seed (proves unknown keys apply
// fine), all values passing the grammar.
const altThemeBody = (): ThemeBody => ({
  name: 'Midnight',
  tokens: {
    colors: {
      primary: '#112233',
      secondary: '#223344',
      accent: '#334455',
      gold: '#c2a878',
      'text-heading': '#0b0d0f',
      'text-default': '#24292e',
      'text-muted': 'rgb(58 65 73 / 76%)',
      'bg-page': '#fcfbf8',
      'bg-surface': '#f7f5f0',
      'bg-page-dark': '#030620',
      'dark:text-heading': '#f7f8f8',
    },
    fonts: { sans: "'Inter Variable'", serif: 'Georgia, serif', heading: "'Playfair Display', serif" },
  },
});

// ═══ seed verification ════════════════════════════════════════════════════════

test('the default theme seed parses, ids validate, and its tokens are byte-identical to the site seed', () => {
  assert.equal(CONVERSION_SEEDS.length, 1);
  const seed = CONVERSION_SEEDS[0]! as { objectType: string; objectId: string; body: ThemeBody };
  assert.equal(seed.objectType, 'theme');
  assert.ok(validateObjectIdForType('theme', seed.objectId).ok);
  assert.ok(themeBodySchema.safeParse(seed.body).success);
  assert.deepEqual(seed.body.tokens, siteBody.brandTokens, 'default theme === production palette (cannot drift)');

  const summary = summarizeValidation(
    validateObject({ objectType: 'theme', objectId: seed.objectId, body: seed.body }, {})
  );
  assert.deepEqual(summary.blockers, [], JSON.stringify(summary.blockers));
});

// ═══ the apply drill ══════════════════════════════════════════════════════════

test('apply replaces brandTokens EXACTLY: theme values in, stale site keys unset, provenance + inverse', async () => {
  const store = createMemoryStore();
  await seedSite(store);
  await seedObject(store, 'theme', 'thm_midnight', altThemeBody());
  const { lockToken, recordVersion } = await checkoutSite(store);

  const res = await call(store, {
    action: 'apply_theme',
    theme_id: 'thm_midnight',
    site_id: 'site_drlurie',
    lock_token: lockToken,
    expected_record_version: recordVersion,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.applied_theme, 'thm_midnight');

  const site = loadSite(store);
  const tokens = (site.body as SiteBody).brandTokens;
  assert.deepEqual(tokens, altThemeBody().tokens, 'site.brandTokens EQUALS the theme tokens — no stale keys');
  assert.equal('dark:bg-surface' in tokens.colors, false, 'a site key the theme does not carry is UNSET, not leaked');

  const entry = site.history.at(-1)!;
  assert.equal(entry.action, 'set_site_brand_tokens');
  assert.equal(entry.details?.applied_theme, 'thm_midnight');

  // Reverting the theme is a Discard: the exact inverse is a set_site_brand_tokens
  // op that re-applies through the PRIVILEGED path (as discardProposal does) —
  // never a raw agent object_patch (that path refuses the privileged op).
  const inverse = derivePatchInverse(entry.details!.op as PatchOp, entry.details!.capture as PatchOpCapture) as {
    op: string;
  };
  assert.equal(inverse.op, 'set_site_brand_tokens', 'the theme inverse is itself the privileged palette op');
  const reverted = applyPatchOps(loadSite(store), [inverse], {
    actor: { kind: 'agent', agent_name: 'discard', auth: 'publish_key' },
    at: new Date(0).toISOString(),
    privilegedOps: ['set_site_brand_tokens'],
  });
  assert.deepEqual(
    (reverted.record.body as SiteBody).brandTokens,
    siteBody.brandTokens,
    'the privileged inverse restores exactly'
  );
});

test('REJECTION: an agent cannot hand-author the privileged palette op via object_patch (the P1 guard)', async () => {
  const store = createMemoryStore();
  await seedSite(store);
  const { lockToken, recordVersion } = await checkoutSite(store);

  // set_site_brand_tokens is NOT in the site allowlist — a direct object_patch is
  // refused op_not_applicable, so the total-theme completeness check in
  // site_apply_theme cannot be bypassed.
  const res = await call(store, {
    action: 'patch',
    object_type: 'site',
    object_id: 'site_drlurie',
    lock_token: lockToken,
    expected_record_version: recordVersion,
    ops: [{ op: 'set_site_brand_tokens', fields: { brandTokens: { colors: { primary: '#112233' } } } }],
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.equal(res.body.code, 'op_not_applicable');
});

test('applying the DEFAULT theme to the untouched site is a no-op (the W8.4 zero-risk proof)', async () => {
  const store = createMemoryStore();
  await seedSite(store);
  await seedObject(store, 'theme', 'thm_drlurie_default', themeDefaultBody);
  const { lockToken, recordVersion } = await checkoutSite(store);

  const before = loadSite(store);
  const res = await call(store, {
    action: 'apply_theme',
    theme_id: 'thm_drlurie_default',
    site_id: 'site_drlurie',
    lock_token: lockToken,
    expected_record_version: recordVersion,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const after = loadSite(store);
  assert.deepEqual((after.body as SiteBody).brandTokens, (before.body as SiteBody).brandTokens);
  assert.equal(
    after.content_revision,
    before.content_revision,
    'a byte-identical apply bumps version, never content_revision'
  );
});

test('dry_run previews the computed exact-replace op (stale keys as null) with NO checkout and NO persistence', async () => {
  const store = createMemoryStore();
  await seedSite(store);
  await seedObject(store, 'theme', 'thm_midnight', altThemeBody());

  const before = JSON.stringify(loadSite(store).body);
  const res = await call(store, {
    action: 'apply_theme',
    theme_id: 'thm_midnight',
    site_id: 'site_drlurie',
    dry_run: true,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.eligible, true);
  const op = res.body.op as { op: string; fields: { brandTokens: { colors: Record<string, unknown> } } };
  assert.equal(op.op, 'set_site_brand_tokens');
  assert.equal(op.fields.brandTokens.colors['dark:bg-surface'], null, 'stale keys are explicit null unsets');
  assert.equal(op.fields.brandTokens.colors.primary, '#112233');
  assert.equal(JSON.stringify(loadSite(store).body), before, 'nothing persisted');
});

test('a real apply REQUIRES the site checkout: missing fields 400, wrong lock 423, stale version 409', async () => {
  const store = createMemoryStore();
  await seedSite(store);
  await seedObject(store, 'theme', 'thm_midnight', altThemeBody());

  const missing = await call(store, { action: 'apply_theme', theme_id: 'thm_midnight', site_id: 'site_drlurie' });
  assert.equal(missing.status, 400);

  const wrongLock = await call(store, {
    action: 'apply_theme',
    theme_id: 'thm_midnight',
    site_id: 'site_drlurie',
    lock_token: 'nope',
    expected_record_version: 1,
  });
  assert.equal(wrongLock.status, 423);

  const { lockToken } = await checkoutSite(store);
  const stale = await call(store, {
    action: 'apply_theme',
    theme_id: 'thm_midnight',
    site_id: 'site_drlurie',
    lock_token: lockToken,
    expected_record_version: 0,
  });
  assert.equal(stale.status, 409);
});

test('REJECTION: an INCOMPLETE theme is not appliable — apply would delete consumed keys from the site', async () => {
  const store = createMemoryStore();
  await seedSite(store);
  const incomplete = altThemeBody();
  delete (incomplete.tokens.colors as Record<string, string>).primary;
  delete (incomplete.tokens.colors as Record<string, string>).gold;
  await seedObject(store, 'theme', 'thm_partial', incomplete);

  // Both the real apply AND the dry_run refuse — a preview of a
  // palette-deleting apply should say so, not validate green.
  const res = await call(store, {
    action: 'apply_theme',
    theme_id: 'thm_partial',
    site_id: 'site_drlurie',
    dry_run: true,
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.deepEqual(res.body.missing_keys, ['primary', 'gold']);
  assert.deepEqual((loadSite(store).body as SiteBody).brandTokens, siteBody.brandTokens, 'site untouched');
});

test('a missing theme is a 404 naming it', async () => {
  const store = createMemoryStore();
  await seedSite(store);
  const res = await call(store, {
    action: 'apply_theme',
    theme_id: 'thm_ghost',
    site_id: 'site_drlurie',
    dry_run: true,
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.theme_id, 'thm_ghost');
});

// ═══ value safety — BOTH write paths into the inline <style> tag ══════════════

test('REJECTION: a theme carrying a CSS-injection value is blocked at write', async () => {
  const store = createMemoryStore();
  const poisoned = altThemeBody();
  poisoned.tokens.colors.primary = 'url(https://evil.example/x)';
  const res = await call(store, {
    action: 'create',
    object_type: 'theme',
    site: 'site_drlurie',
    body: poisoned,
    requested_id: 'thm_poison',
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.ok(
    (res.body.blockers as { id: string }[]).some((blocker) => blocker.id === 'brand_token_values'),
    JSON.stringify(res.body.blockers)
  );
});

test('REJECTION: set_site_fields can no longer touch site.brandTokens at all — theme-only governance (Wolf 2026-07-15)', async () => {
  const store = createMemoryStore();
  await seedSite(store);
  const { lockToken, recordVersion } = await checkoutSite(store);

  // brandTokens is now refused at the GRAMMAR (invalid_op → 400), before any
  // value even reaches the CSS-safety criterion — the palette hole the
  // color-editing agent used is closed for both safe and unsafe values.
  const res = await call(store, {
    action: 'patch',
    object_type: 'site',
    object_id: 'site_drlurie',
    lock_token: lockToken,
    expected_record_version: recordVersion,
    ops: [{ op: 'set_site_fields', fields: { brandTokens: { colors: { primary: 'red; } body { display:none' } } } }],
  });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'invalid_op');
  assert.match(String(res.body.message), /brandTokens.*site_apply_theme/);

  // Even a perfectly SAFE brandTokens value is refused here — the point is the
  // path, not the value: colors change only through a theme.
  const safeValueAttempt = await call(store, {
    action: 'patch',
    object_type: 'site',
    object_id: 'site_drlurie',
    lock_token: lockToken,
    expected_record_version: recordVersion,
    ops: [{ op: 'set_site_fields', fields: { brandTokens: { colors: { primary: '#112233' } } } }],
  });
  assert.equal(safeValueAttempt.status, 400, JSON.stringify(safeValueAttempt.body));

  // A NON-brandTokens set_site_fields still works (logo, chrome, metadata…).
  const nonPalette = await call(store, {
    action: 'patch',
    object_type: 'site',
    object_id: 'site_drlurie',
    lock_token: lockToken,
    expected_record_version: recordVersion,
    ops: [{ op: 'set_site_fields', fields: { logo: { text: 'RENAMED' } } }],
  });
  assert.equal(nonPalette.status, 200, JSON.stringify(nonPalette.body));
});

// ═══ key completeness (checkTheme) ════════════════════════════════════════════

test('a theme missing a consumed color key warns while drafting and blocks at publish; unknown keys warn', () => {
  const body = altThemeBody();
  delete (body.tokens.colors as Record<string, string>).primary;
  (body.tokens.colors as Record<string, string>).sparkle = '#ffffff';

  const draft = checkTheme(body, false);
  assert.equal(draft.find((criterion) => criterion.id === 'theme_token_keys')?.status, 'warning');
  const publish = checkTheme(body, true);
  assert.equal(publish.find((criterion) => criterion.id === 'theme_token_keys')?.status, 'missing');
  assert.equal(publish.find((criterion) => criterion.id === 'theme_token_unknown_keys')?.status, 'warning');
});

// ─── T9.18: verb-level Owner gate on a REAL human apply (§8 matrix) ──────────

test('a REAL apply by a human requires the owner role; dry_run stays open; agents unchanged', async () => {
  const store = createMemoryStore();
  await seedSite(store);
  await seedObject(store, 'theme', 'thm_midnight', altThemeBody());
  const verbStore = store as unknown as ObjectVerbStore;
  const validationContext = await buildStoreValidationContext(verbStore);
  const human: Principal = { kind: 'human', id: 'id-adm', email: 'admin@example.com' };

  // Admin-tier human (no owner role): real apply → 403 BEFORE any lock check.
  const denied = await handleObjectVerb(
    verbStore,
    {
      action: 'apply_theme',
      theme_id: 'thm_midnight',
      site_id: 'site_drlurie',
      lock_token: 'x',
      expected_record_version: 1,
    },
    human,
    { nowMs: NOW, validationContext, roles: ['admin'] }
  );
  assert.equal(denied.status, 403);
  assert.match(String(denied.body.error), /Owner role/);

  // Same human: dry_run is a read — allowed.
  const preview = await handleObjectVerb(
    verbStore,
    { action: 'apply_theme', theme_id: 'thm_midnight', site_id: 'site_drlurie', dry_run: true },
    human,
    { nowMs: NOW, validationContext, roles: ['admin'] }
  );
  assert.equal(preview.status, 200);

  // Owner-tier human: passes the gate (fails later only on lock, which is the point).
  const ownerAttempt = await handleObjectVerb(
    verbStore,
    {
      action: 'apply_theme',
      theme_id: 'thm_midnight',
      site_id: 'site_drlurie',
      lock_token: 'x',
      expected_record_version: 1,
    },
    human,
    { nowMs: NOW, validationContext, roles: ['owner', 'admin'] }
  );
  assert.equal(ownerAttempt.status, 423); // gate passed; lock check speaks

  // Agent principal with no roles: unchanged behavior (423 on bad lock, not 403).
  const agentAttempt = await call(store, {
    action: 'apply_theme',
    theme_id: 'thm_midnight',
    site_id: 'site_drlurie',
    lock_token: 'x',
    expected_record_version: 1,
  });
  assert.equal(agentAttempt.status, 423);
});
