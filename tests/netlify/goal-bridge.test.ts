/**
 * T13.7 — google_ads/ga4 adapters + the goal→conversion bridge (12-plan §7).
 * Pins: the mapping rule (a provider fires ONLY declared conversions —
 * object_id×on matching, by-name matching, multi-provider fan-out,
 * disabled-provider and unknown-provider skip, per provider+label dedupe);
 * build-time `product_price` value resolution (never client-guessed);
 * consent-gated ordering (denied state ⇒ no conversion entries; post-grant
 * conversions FOLLOW the Consent Mode defaults in the dataLayer); the
 * adapters' gated emission + write+render ID re-assertion; the single
 * gtag.js loader rule; ga4's manual page_view; and enhanced conversions
 * OFF (no email-shaped data can reach a gtag call).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ga4Adapter } from '../../src/lib/tracking/adapters/ga4.js';
import { googleAdsAdapter, gtagLoaderHead } from '../../src/lib/tracking/adapters/google-ads.js';
import { AdapterIdError } from '../../src/lib/tracking/adapters/types.js';
import {
  assembleAdapterHeads,
  buildGoalMap,
  buildTrackerClientConfig,
  parseTrackingExport,
} from '../../src/lib/tracking/assemble.js';
import {
  EVENT_ACTIVITY,
  matchActivityGoals,
  matchNamedGoals,
  providerCalls,
  type GoalMapLike,
} from '../../src/lib/tracking/loader/bridge.js';
import { createTracker, type TrackerEnv } from '../../src/lib/tracking/loader/core.js';
import { consentRuntime, type ConsentWindowLike } from '../../src/lib/tracking/consent/runtime.js';

const PROVIDERS = { google_ads: { id: 'AW-123456789' }, ga4: { id: 'G-ABCD1234' } };

const GOAL_MAP: GoalMapLike = {
  prod_guide: {
    goals: [
      {
        goal: 'purchase',
        on: 'buy_click',
        conversions: [
          { provider: 'google_ads', label: 'PurchConv_1', value_cents: 4900, currency: 'EUR' },
          { provider: 'ga4', label: 'purchase' },
        ],
      },
    ],
  },
  page_home: { goals: [{ goal: 'opt_in', conversions: [{ provider: 'google_ads', label: 'OptInConv_1' }] }] },
  page_quiet: {
    enabled: false,
    goals: [{ goal: 'never', on: 'view', conversions: [{ provider: 'google_ads', label: 'Nope_1' }] }],
  },
  sec_meta: { goals: [{ goal: 'social', on: 'cta_click', conversions: [{ provider: 'meta_pixel', label: 'Lead' }] }] },
};

// ═══ pure matching ════════════════════════════════════════════════════════════

test('matchActivityGoals: (object_id, on) matching; enabled:false and unmatched activities skip', () => {
  const hit = matchActivityGoals(GOAL_MAP, 'buy_click', ['prod_guide']);
  assert.equal(hit.length, 1);
  assert.equal(hit[0]!.goal, 'purchase');
  assert.deepEqual(matchActivityGoals(GOAL_MAP, 'view', ['prod_guide']), [], 'undeclared activity');
  assert.deepEqual(matchActivityGoals(GOAL_MAP, 'view', ['page_quiet']), [], 'enabled:false object never fires');
  assert.deepEqual(matchActivityGoals(GOAL_MAP, 'buy_click', ['page_missing', undefined]), []);
});

test('matchNamedGoals finds the declaring object; providerCalls dedupes per provider+label', () => {
  assert.equal(matchNamedGoals(GOAL_MAP, 'opt_in').length, 1);
  assert.equal(matchNamedGoals(GOAL_MAP, 'never').length, 0, 'enabled:false object never fires by name either');
  const doubled = providerCalls(
    [...matchNamedGoals(GOAL_MAP, 'opt_in'), ...matchNamedGoals(GOAL_MAP, 'opt_in')],
    PROVIDERS
  );
  assert.equal(doubled.length, 1, 'two declaring matches, one conversion per provider+label');
});

test('providerCalls: google_ads conversion ping with build-resolved value; ga4 mirror; unknown/disabled skip', () => {
  const calls = providerCalls(matchActivityGoals(GOAL_MAP, 'buy_click', ['prod_guide']), PROVIDERS);
  assert.deepEqual(calls, [
    ['event', 'conversion', { send_to: 'AW-123456789/PurchConv_1', value: 49, currency: 'EUR' }],
    ['event', 'purchase', { send_to: 'G-ABCD1234' }],
  ]);
  const valueless = providerCalls(matchNamedGoals(GOAL_MAP, 'opt_in'), PROVIDERS);
  assert.deepEqual(valueless, [['event', 'conversion', { send_to: 'AW-123456789/OptInConv_1' }]]);
  assert.deepEqual(
    providerCalls(matchActivityGoals(GOAL_MAP, 'cta_click', ['sec_meta']), PROVIDERS),
    [],
    'meta_pixel is T13.8 — unknown providers are skipped, never guessed'
  );
  assert.deepEqual(
    providerCalls(matchNamedGoals(GOAL_MAP, 'opt_in'), { ga4: { id: 'G-X1Y2' } }),
    [],
    'a disabled provider never fires'
  );
  assert.equal(EVENT_ACTIVITY.pageview, 'view');
});

// ═══ build-time goal-map resolution ═══════════════════════════════════════════

test('buildGoalMap resolves value_source:product_price from the export price at BUILD', () => {
  const map = buildGoalMap([
    {
      object_id: 'prod_guide',
      price_cents: 4900,
      currency: 'EUR',
      tracking: {
        goals: [
          {
            goal: 'purchase',
            on: 'buy_click',
            provider_conversions: [
              { provider: 'google_ads', label: 'PurchConv_1', value_source: 'product_price' },
              { provider: 'ga4', label: 'purchase' },
            ],
          },
        ],
      },
    },
    {
      object_id: 'page_home',
      tracking: {
        goals: [
          {
            goal: 'opt_in',
            provider_conversions: [{ provider: 'google_ads', label: 'OptInConv_1', value_source: 'product_price' }],
          },
        ],
      },
    },
  ]);
  assert.deepEqual(map.prod_guide!.goals![0]!.conversions, [
    { provider: 'google_ads', label: 'PurchConv_1', value_cents: 4900, currency: 'EUR' },
    { provider: 'ga4', label: 'purchase' },
  ]);
  assert.deepEqual(
    map.page_home!.goals![0]!.conversions,
    [{ provider: 'google_ads', label: 'OptInConv_1' }],
    'product_price on a non-product source resolves to NO value — never guessed'
  );
});

const bodyWith = (providers: Record<string, unknown>) =>
  parseTrackingExport({
    providers: { own: { enabled: true, consent_class: 'essential', ingest_path: '/api/t' }, ...providers },
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

test('client config carries enabled gtag-family providers (and omits the block when none)', () => {
  const config = buildTrackerClientConfig(
    'trk_drlurie',
    bodyWith({
      google_ads: { enabled: true, consent_class: 'advertising', conversion_id: 'AW-123456789' },
      ga4: { enabled: false, consent_class: 'analytics', measurement_id: 'G-ABCD1234' },
    }),
    []
  );
  assert.deepEqual(config.providers, { google_ads: { id: 'AW-123456789' } });
  assert.equal(buildTrackerClientConfig('trk_drlurie', bodyWith({}), []).providers, undefined);
});

// ═══ adapters ═════════════════════════════════════════════════════════════════

test('google_ads adapter: ALWAYS consent-gated, send_page_view:false, ID re-asserted at render', () => {
  const result = googleAdsAdapter({ enabled: true, conversion_id: 'AW-123456789' }, { includeLoader: true });
  assert.match(
    result.head,
    /type="text\/plain" data-trk-gate="advertising" async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=AW-123456789"/
  );
  assert.match(result.head, /gtag\('config','AW-123456789',\{send_page_view:false\}\)/);
  assert.ok(result.cspHosts.script.includes('https://www.googleadservices.com'));
  assert.equal(googleAdsAdapter({ enabled: false, conversion_id: 'AW-123456789' }, { includeLoader: true }).head, '');
  assert.throws(
    () => googleAdsAdapter({ enabled: true, conversion_id: 'AW-1"/><script>' }, { includeLoader: true }),
    AdapterIdError,
    'a drifted id fails the BUILD'
  );
});

test('ga4 adapter: analytics class ships live, advertising class ships gated; ID re-asserted', () => {
  const live = ga4Adapter(
    { enabled: true, consent_class: 'analytics', measurement_id: 'G-ABCD1234' },
    { includeLoader: true }
  );
  assert.ok(!live.head.includes('data-trk-gate'), 'analytics class is ungated (Consent Mode governs it)');
  assert.match(live.head, /gtag\('config','G-ABCD1234',\{send_page_view:false\}\)/);
  const gated = ga4Adapter(
    { enabled: true, consent_class: 'advertising', measurement_id: 'G-ABCD1234' },
    { includeLoader: true }
  );
  assert.ok(gated.head.includes('data-trk-gate="advertising"'));
  assert.throws(
    () => ga4Adapter({ enabled: true, consent_class: 'analytics', measurement_id: 'UA-1' }, { includeLoader: true }),
    AdapterIdError
  );
});

test('exactly ONE gtag.js loader per page, riding the least-gated enabled consumer', () => {
  const loaderCount = (heads: { head: string }[]) =>
    heads
      .map((result) => result.head)
      .join('')
      .split('gtag/js?id=').length - 1;

  const adsOnly = assembleAdapterHeads(
    bodyWith({ google_ads: { enabled: true, consent_class: 'advertising', conversion_id: 'AW-123456789' } }),
    'drlurie.com'
  );
  assert.equal(loaderCount(adsOnly), 1);
  assert.match(
    adsOnly.map((result) => result.head).join(''),
    /data-trk-gate="advertising" async src=/,
    'ads-only loader is gated'
  );

  const both = assembleAdapterHeads(
    bodyWith({
      google_ads: { enabled: true, consent_class: 'advertising', conversion_id: 'AW-123456789' },
      ga4: { enabled: true, consent_class: 'analytics', measurement_id: 'G-ABCD1234' },
    }),
    'drlurie.com'
  );
  assert.equal(loaderCount(both), 1, 'ga4 alongside ads: still one loader');
  const loaderTag = both
    .map((result) => result.head)
    .join('')
    .match(/<script[^>]*gtag\/js[^>]*>/)![0];
  assert.ok(!loaderTag.includes('data-trk-gate'), 'the shared loader rides the UNGATED ga4 (must load immediately)');
  assert.equal(gtagLoaderHead('G-ABCD1234', false).includes('data-trk-gate'), false);
});

// ═══ the bridge in the tracker core ═══════════════════════════════════════════

const CONFIG = {
  ingest_path: '/api/t',
  batch: { max_events: 25, max_wait_ms: 10000 },
  sample_rate: 0, // goals must be exempt from sampling — 0 would drop everything sampled
  defaults: { page: ['pageview'], product: ['buy_click'] },
  goals: GOAL_MAP,
  providers: PROVIDERS,
} as const;

const makeCore = (gpc = false) => {
  const sent: string[] = [];
  const gtagCalls: unknown[][] = [];
  const env: TrackerEnv = {
    send: (_path, body) => void sent.push(body),
    gtagPush: (args) => void gtagCalls.push(args),
    now: () => 1_750_000_000_000,
    uuid: () => '3fb14a1c-0000-4000-8000-00000000abcd',
    random: () => 0.99,
    referrer: null,
    lang: null,
    viewport: () => null,
    gpc,
  };
  const tracker = createTracker(CONFIG, env);
  const queuedEvents = () => {
    tracker.flush();
    return sent.flatMap(
      (body) => (JSON.parse(body) as { events: { event: string; props?: Record<string, unknown> }[] }).events
    );
  };
  return { tracker, gtagCalls, queuedEvents };
};

test('declared buy_click goal: own goal event + provider fan-out with the resolved value (consent released)', () => {
  const { tracker, gtagCalls, queuedEvents } = makeCore();
  tracker.setConsent({ ads: true, analytics: false });
  tracker.pageLoad({ path: '/shop/guide', route: null });
  tracker.click('buy_click', null, undefined, { object_type: 'product', object_id: 'prod_guide' });
  const goalEvents = queuedEvents().filter((event) => event.event === 'goal');
  assert.equal(goalEvents.length, 1, 'the own goal event fires (and is exempt from sampling)');
  assert.deepEqual(goalEvents[0]!.props, { goal: 'purchase', value_cents: 4900 });
  const conversion = gtagCalls.find((call) => call[1] === 'conversion');
  assert.deepEqual(conversion, [
    'event',
    'conversion',
    { send_to: 'AW-123456789/PurchConv_1', value: 49, currency: 'EUR' },
  ]);
  assert.ok(
    gtagCalls.some((call) => call[1] === 'purchase'),
    'ga4 mirrors the goal as an event'
  );
});

test('undeclared activities never call providers; ga4 manual page_view rides pageLoad', () => {
  const { tracker, gtagCalls } = makeCore();
  tracker.setConsent({ ads: true, analytics: false });
  tracker.pageLoad({ path: '/x', route: null, object: { object_type: 'page', object_id: 'page_other' } });
  tracker.click('cta_click', { kind: 'section', section_id: 's_hero', section_type: 'hero' });
  const conversions = gtagCalls.filter((call) => call[1] === 'conversion');
  assert.equal(conversions.length, 0, 'no declared goal — no provider call');
  assert.deepEqual(
    gtagCalls[0],
    ['event', 'page_view', { send_to: 'G-ABCD1234' }],
    'send_page_view:false ⇒ manual page_view'
  );
});

test('denied consent state: the own goal still fires (cookieless pipeline); providers stay silent; GPC absolute', () => {
  const denied = makeCore();
  denied.tracker.pageLoad({ path: '/shop/guide', route: null });
  denied.tracker.click('buy_click', null, undefined, { object_type: 'product', object_id: 'prod_guide' });
  assert.equal(denied.queuedEvents().filter((event) => event.event === 'goal').length, 1);
  assert.equal(
    denied.gtagCalls.filter((call) => call[1] === 'conversion').length,
    0,
    'held region ⇒ no conversion ping'
  );

  const gpc = makeCore(true);
  gpc.tracker.setConsent({ ads: true, analytics: true }); // a grant under GPC is void
  gpc.tracker.pageLoad({ path: '/shop/guide', route: null });
  gpc.tracker.click('buy_click', null, undefined, { object_type: 'product', object_id: 'prod_guide' });
  assert.equal(gpc.gtagCalls.filter((call) => call[1] === 'conversion').length, 0, 'GPC beats grant');
});

test('trk:goal by name (opt_in / purchase surfaces): declared goals convert, undeclared do not', () => {
  const { tracker, gtagCalls, queuedEvents } = makeCore();
  tracker.setConsent({ ads: true, analytics: false });
  tracker.pageLoad({ path: '/thank-you', route: null });
  tracker.goal('opt_in');
  tracker.goal('some_random_goal');
  const goals = queuedEvents().filter((event) => event.event === 'goal');
  assert.equal(goals.length, 2, 'own goal events fire for both (cookieless, unrestricted)');
  const conversions = gtagCalls.filter((call) => call[1] === 'conversion');
  assert.deepEqual(conversions, [['event', 'conversion', { send_to: 'AW-123456789/OptInConv_1' }]]);
});

// ═══ consent-gated ordering (bootstrap ∘ bridge integration) ═══════════════════

test('conversion pings never precede the Consent Mode defaults, and never fire while denied', () => {
  // A restricted-region page: the T13.6 runtime seeds the dataLayer with the
  // denied defaults; the bridge's gtagPush appends to the SAME dataLayer.
  const dataLayer: unknown[] = [];
  const storage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
  };
  const configElement = {
    text: JSON.stringify({ ingest_path: '/api/t', consent: { posture: 'geo-adaptive', regions: ['DE'], gpc: true } }),
    hidden: false,
  };
  const fakeWindow = {
    document: {
      readyState: 'complete',
      getElementById: (id: string) => (id === 'trk-config' ? configElement : null),
      querySelectorAll: () => [],
      createElement: () => ({}),
      addEventListener: () => undefined,
      dispatchEvent: () => true,
    },
    navigator: {},
    localStorage: storage(),
    sessionStorage: (() => {
      const session = storage();
      session.setItem('_dlregion', 'DE');
      return session;
    })(),
    CustomEvent: class {
      constructor(
        public type: string,
        public init?: { detail?: unknown }
      ) {}
    },
    Date: { now: () => 1 },
    dataLayer,
  };
  consentRuntime(fakeWindow as unknown as ConsentWindowLike);
  const isConsentDefault = (entry: unknown) => Array.from(entry as ArrayLike<unknown>)[1] === 'default';
  assert.ok(dataLayer.some(isConsentDefault), 'the bootstrap seeded denied defaults');

  const gtagPush = (args: unknown[]) => void dataLayer.push(args);
  const env: TrackerEnv = {
    send: () => undefined,
    gtagPush,
    now: () => 1,
    uuid: () => '3fb14a1c-0000-4000-8000-00000000abcd',
    random: () => 0.5,
    referrer: null,
    lang: null,
    viewport: () => null,
    gpc: false,
  };
  const tracker = createTracker(CONFIG, env);
  // Denied region, no grant: the bridge must add NO conversion entries.
  tracker.pageLoad({ path: '/shop/guide', route: null });
  tracker.click('buy_click', null, undefined, { object_type: 'product', object_id: 'prod_guide' });
  const conversionIndex = () =>
    dataLayer.findIndex((entry) => Array.from(entry as ArrayLike<unknown>)[1] === 'conversion');
  assert.equal(conversionIndex(), -1, 'denied ⇒ conversion never fires');
  // Grant: conversions may now fire — and land AFTER the defaults entry.
  tracker.setConsent({ ads: true });
  tracker.click('buy_click', null, undefined, { object_type: 'product', object_id: 'prod_guide' });
  const defaultIndex = dataLayer.findIndex(isConsentDefault);
  assert.ok(conversionIndex() > defaultIndex, 'post-grant conversions follow the Consent Mode defaults');
});

// ═══ enhanced conversions OFF ═════════════════════════════════════════════════

test('no email-shaped data can reach gtag: adapter heads and every bridge call are user_data-free', () => {
  const heads = assembleAdapterHeads(
    bodyWith({
      google_ads: { enabled: true, consent_class: 'advertising', conversion_id: 'AW-123456789' },
      ga4: { enabled: true, consent_class: 'analytics', measurement_id: 'G-ABCD1234' },
    }),
    'drlurie.com'
  )
    .map((result) => result.head)
    .join('');
  for (const forbidden of ['email', 'user_data', 'enhanced_conversion', 'allow_enhanced_conversions']) {
    assert.ok(!heads.includes(forbidden), `adapter heads carry no ${forbidden}`);
  }
  const calls = providerCalls(
    [...matchActivityGoals(GOAL_MAP, 'buy_click', ['prod_guide']), ...matchNamedGoals(GOAL_MAP, 'opt_in')],
    PROVIDERS
  );
  const serialized = JSON.stringify(calls);
  assert.ok(!serialized.includes('email') && !serialized.includes('user_data'), 'bridge calls are value/label-only');
});
