/**
 * T13.8 — the native-platform adapters (meta_pixel/taboola/outbrain/mgid,
 * 12-plan §7) + their bridge fan-in. Pins: every native snippet is ALWAYS
 * consent-gated; IDs re-assert the write-time regex at render (drift fails
 * the BUILD); disabled providers emit nothing; nativeCalls builds the
 * provider-correct conversion shapes (deduped, enabled-only, value in
 * currency units); the tracker core fans out to nativePush under the same
 * released-ads consent gate as gtag; the assembled head includes enabled
 * natives; the client config carries their ids.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { metaPixelAdapter } from '../../packages/core/lib/tracking/adapters/meta-pixel.js';
import { mgidAdapter } from '../../packages/core/lib/tracking/adapters/mgid.js';
import { outbrainAdapter } from '../../packages/core/lib/tracking/adapters/outbrain.js';
import { taboolaAdapter } from '../../packages/core/lib/tracking/adapters/taboola.js';
import { AdapterIdError } from '../../packages/core/lib/tracking/adapters/types.js';
import {
  assembleAdapterHeads,
  buildTrackerClientConfig,
  parseTrackingExport,
} from '../../packages/core/lib/tracking/assemble.js';
import { nativeCalls, type GoalMapLike } from '../../packages/core/lib/tracking/loader/bridge.js';
import { createTracker, type TrackerEnv } from '../../packages/core/lib/tracking/loader/core.js';

// ═══ adapters ═════════════════════════════════════════════════════════════════

test('all four native adapters: always gated, ID-validated, empty when disabled', () => {
  const meta = metaPixelAdapter({ enabled: true, pixel_id: '123456789012345' });
  assert.ok(meta.head.startsWith('<script type="text/plain" data-trk-gate="advertising">'));
  assert.match(meta.head, /fbq\('init','123456789012345'\);fbq\('track','PageView'\)/);
  assert.deepEqual(meta.cspHosts.script, ['https://connect.facebook.net']);

  const taboola = taboolaAdapter({ enabled: true, account_id: '1234567' });
  assert.ok(taboola.head.includes('data-trk-gate="advertising"'));
  assert.match(taboola.head, /unip\/1234567\/tfa\.js/);
  assert.match(taboola.head, /name:'page_view',id:1234567/);

  const outbrain = outbrainAdapter({ enabled: true, account_id: '00abcdef1234' });
  assert.ok(outbrain.head.includes('data-trk-gate="advertising"'));
  assert.match(outbrain.head, /obApi\('track','PAGE_VIEW'\)/);
  assert.match(outbrain.head, /amplify\.outbrain\.com\/cp\/obtp\.js/);

  const mgid = mgidAdapter({ enabled: true, account_id: '654321' });
  assert.ok(mgid.head.includes('data-trk-gate="advertising"'));
  assert.match(mgid.head, /a\.mgid\.com\/mgsensor\.js/);
  assert.ok(!mgid.head.includes('654321'), 'mgid never interpolates the id (dashboard-resolved)');

  for (const adapter of [metaPixelAdapter, taboolaAdapter, outbrainAdapter, mgidAdapter] as const) {
    assert.equal(adapter(undefined).head, '');
    assert.equal(adapter({ enabled: false, pixel_id: '123456789012345', account_id: '1234567' } as never).head, '');
  }
  assert.throws(() => metaPixelAdapter({ enabled: true, pixel_id: 'evil"><script>' }), AdapterIdError);
  assert.throws(() => taboolaAdapter({ enabled: true, account_id: '12/../evil' }), AdapterIdError);
  assert.throws(() => outbrainAdapter({ enabled: true, account_id: 'nope!' }), AdapterIdError);
  assert.throws(() => mgidAdapter({ enabled: true, account_id: 'x' }), AdapterIdError);
});

// ═══ bridge fan-in ════════════════════════════════════════════════════════════

const NATIVE_PROVIDERS = {
  meta_pixel: { id: '123456789012345' },
  taboola: { id: '1234567' },
  outbrain: { id: '00abcdef1234' },
  mgid: { id: '654321' },
};

const BINDINGS = [
  {
    goal: 'purchase',
    on: 'buy_click',
    conversions: [
      { provider: 'meta_pixel', label: 'Purchase', value_cents: 4900, currency: 'EUR' },
      { provider: 'taboola', label: 'purchase' },
      { provider: 'outbrain', label: 'Purchase' },
      { provider: 'mgid', label: 'purchase' },
      { provider: 'google_ads', label: 'PurchConv_1' },
    ],
  },
];

test('nativeCalls: provider-correct shapes, value in currency units, dedupe, enabled-only', () => {
  const calls = nativeCalls(BINDINGS, NATIVE_PROVIDERS);
  assert.deepEqual(calls, [
    { provider: 'meta_pixel', args: ['track', 'Purchase', { value: 49, currency: 'EUR' }] },
    { provider: 'taboola', args: [{ notify: 'event', name: 'purchase', id: '1234567' }] },
    { provider: 'outbrain', args: ['track', 'Purchase'] },
    { provider: 'mgid', args: [['MgSensorInvoke', 'purchase']] },
  ]);
  assert.deepEqual(nativeCalls([...BINDINGS, ...BINDINGS], NATIVE_PROVIDERS).length, 4, 'per provider+label dedupe');
  assert.deepEqual(nativeCalls(BINDINGS, { meta_pixel: { id: '123456789012345' } }).length, 1, 'enabled-only');
  const valueless = nativeCalls(
    [{ goal: 'opt_in', conversions: [{ provider: 'meta_pixel', label: 'Lead' }] }],
    NATIVE_PROVIDERS
  );
  assert.deepEqual(valueless, [{ provider: 'meta_pixel', args: ['track', 'Lead'] }], 'no value ⇒ no payload object');
});

test('the tracker core fans out natives under the released-ads gate only', () => {
  const GOALS: GoalMapLike = { prod_x: { goals: BINDINGS } };
  const makeCore = () => {
    const native: { provider: string; args: unknown[] }[] = [];
    const env: TrackerEnv = {
      send: () => undefined,
      nativePush: (provider, args) => void native.push({ provider, args }),
      now: () => 1_750_000_000_000,
      uuid: () => '3fb14a1c-0000-4000-8000-00000000abcd',
      random: () => 0.5,
      referrer: null,
      lang: null,
      viewport: () => null,
      gpc: false,
    };
    const tracker = createTracker(
      {
        ingest_path: '/api/t',
        batch: { max_events: 25, max_wait_ms: 10000 },
        sample_rate: 1,
        defaults: { product: ['buy_click'] },
        goals: GOALS,
        providers: NATIVE_PROVIDERS,
      },
      env
    );
    return { tracker, native };
  };

  const held = makeCore();
  held.tracker.pageLoad({ path: '/shop/x', route: null });
  held.tracker.click('buy_click', null, undefined, { object_type: 'product', object_id: 'prod_x' });
  assert.equal(held.native.length, 0, 'denied/held consent ⇒ no native pings');

  const released = makeCore();
  released.tracker.setConsent({ ads: true });
  released.tracker.pageLoad({ path: '/shop/x', route: null });
  released.tracker.click('buy_click', null, undefined, { object_type: 'product', object_id: 'prod_x' });
  assert.equal(released.native.length, 4, 'all four natives fire on the declared goal');
  assert.deepEqual(released.native[0], {
    provider: 'meta_pixel',
    args: ['track', 'Purchase', { value: 49, currency: 'EUR' }],
  });
});

// ═══ assembly + client config ═════════════════════════════════════════════════

const bodyWithNatives = () =>
  parseTrackingExport({
    providers: {
      own: { enabled: true, consent_class: 'essential', ingest_path: '/api/t' },
      meta_pixel: { enabled: true, consent_class: 'advertising', pixel_id: '123456789012345' },
      taboola: { enabled: true, consent_class: 'advertising', account_id: '1234567' },
      outbrain: { enabled: true, consent_class: 'advertising', account_id: '00abcdef1234' },
      mgid: { enabled: true, consent_class: 'advertising', account_id: '654321' },
    },
    consent: { posture: 'geo-adaptive', restricted_regions: ['DE'], honor_gpc: true },
    defaults: {
      page: ['pageview'],
      section: [],
      content_item: [],
      product: ['buy_click'],
      navigation: [],
      taxonomy: [],
      outbound_links: false,
      utm_capture: false,
    },
  });

test('assembled heads include the enabled natives (gated) and the client config carries their ids', () => {
  const heads = assembleAdapterHeads(bodyWithNatives(), 'drlurie.com');
  const joined = heads.map((result) => result.head).join('');
  for (const marker of ['fbevents.js', 'tfa.js', 'obtp.js', 'mgsensor.js']) {
    assert.ok(joined.includes(marker), `assembled head carries ${marker}`);
  }
  assert.equal(
    (joined.match(/data-trk-gate="advertising"/g) ?? []).length,
    4,
    'every native snippet is advertising-gated'
  );
  const config = buildTrackerClientConfig('trk_drlurie', bodyWithNatives(), []);
  assert.deepEqual(config.providers, NATIVE_PROVIDERS);
  for (const forbidden of ['email', 'user_data', 'enhanced']) {
    assert.ok(!joined.includes(forbidden), `native heads carry no ${forbidden}`);
  }
});
