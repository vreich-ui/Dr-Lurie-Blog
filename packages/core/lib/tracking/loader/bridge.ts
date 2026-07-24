/**
 * The goal→conversion bridge (W13 T13.7, 12-plan §7) — PURE matching and
 * call construction, so the mapping rule is unit-testable: a provider fires
 * ONLY conversions declared in some object's
 * `tracking.goals[].provider_conversions`. One bridge, two entry paths:
 *
 * - by ACTIVITY: a matrix activity fires on an object → match the goal map
 *   on `(object_id, on)` → the own `goal` event + each enabled provider's
 *   conversion call (core.ts owns emission; this module only decides).
 * - by NAME: a `trk:goal` CustomEvent (NetlifyOptInCapture success, the
 *   checkout thank-you confirmation) names a goal directly → match every
 *   map entry declaring that goal key (deduped per provider+label so two
 *   declaring objects can't double-fire one conversion).
 *
 * `value_source:'product_price'` was resolved at BUILD into `value_cents`/
 * `currency` (assemble.ts, from the product export) — never client-guessed.
 * Provider calls are gtag argument tuples; the browser binding turns them
 * into real `arguments` pushes (gtag.js ignores plain-array pushes).
 * Enhanced conversions are OFF: no call shape here can carry user_data.
 */

export type GoalConversion = {
  provider: string;
  label: string;
  value_cents?: number;
  currency?: string;
};

export type GoalBinding = {
  goal: string;
  on?: string;
  conversions?: GoalConversion[];
};

export type GoalMapLike = Record<string, { enabled?: boolean; goals?: GoalBinding[] }>;

export type BridgeProviders = {
  google_ads?: { id: string };
  ga4?: { id: string };
  meta_pixel?: { id: string };
  taboola?: { id: string };
  outbrain?: { id: string };
  mgid?: { id: string };
};

/** One native-platform conversion call: the browser binding routes `args`
 *  to the provider's queue/function (fbq / _tfa / obApi / _mgq). */
export type NativeCall = { provider: string; args: unknown[] };

/** Event kind → the goal-activity vocabulary (`tracking.goals[].on`).
 *  nav_click projects to the navigation object's `cta_click` activity —
 *  the §6 matrix; tag_click/form_start have no goal activity. */
export const EVENT_ACTIVITY: Record<string, string> = {
  pageview: 'view',
  section_impression: 'impression',
  node_impression: 'impression',
  cta_click: 'cta_click',
  nav_click: 'cta_click',
  form_submit: 'form_submit',
  buy_click: 'buy_click',
  completion: 'completion',
  outbound_click: 'outbound_click',
};

/** Goal bindings for an activity on any of the candidate object ids. */
export const matchActivityGoals = (
  map: GoalMapLike | undefined,
  activity: string,
  candidateIds: readonly (string | undefined)[]
): GoalBinding[] => {
  if (!map) return [];
  const bindings: GoalBinding[] = [];
  for (const candidateId of candidateIds) {
    if (!candidateId) continue;
    const entry = map[candidateId];
    if (!entry || entry.enabled === false || !Array.isArray(entry.goals)) continue;
    for (const binding of entry.goals) {
      if (binding.on === activity) bindings.push(binding);
    }
  }
  return bindings;
};

/** Goal bindings declaring `name` on ANY object (the trk:goal path). */
export const matchNamedGoals = (map: GoalMapLike | undefined, name: string): GoalBinding[] => {
  if (!map) return [];
  const bindings: GoalBinding[] = [];
  for (const entry of Object.values(map)) {
    if (!entry || entry.enabled === false || !Array.isArray(entry.goals)) continue;
    for (const binding of entry.goals) {
      if (binding.goal === name) bindings.push(binding);
    }
  }
  return bindings;
};

/**
 * The gtag argument tuples a binding commissions — enabled providers only,
 * deduped per provider+label. google_ads: the §7 conversion ping (value in
 * currency units when build-resolved); ga4: the goal mirrored as an event.
 */
export const providerCalls = (
  bindings: readonly GoalBinding[],
  providers: BridgeProviders | undefined
): unknown[][] => {
  if (!providers) return [];
  const calls: unknown[][] = [];
  const seen = new Set<string>();
  for (const binding of bindings) {
    for (const conversion of binding.conversions ?? []) {
      const dedupeKey = `${conversion.provider}:${conversion.label}`;
      if (seen.has(dedupeKey)) continue;
      if (conversion.provider === 'google_ads' && providers.google_ads?.id) {
        seen.add(dedupeKey);
        const payload: Record<string, unknown> = {
          send_to: `${providers.google_ads.id}/${conversion.label}`,
        };
        if (typeof conversion.value_cents === 'number') {
          payload.value = conversion.value_cents / 100;
          payload.currency = conversion.currency ?? 'USD';
        }
        calls.push(['event', 'conversion', payload]);
      } else if (conversion.provider === 'ga4' && providers.ga4?.id) {
        seen.add(dedupeKey);
        calls.push(['event', conversion.label, { send_to: providers.ga4.id }]);
      }
      // Native platforms fan out via nativeCalls; unknown providers are
      // skipped, never guessed.
    }
  }
  return calls;
};

/**
 * The native-platform half of the fan-out (T13.8): meta_pixel mirrors the
 * conversion label as a standard event (`fbq('track', label, {value?})` —
 * value in currency units when build-resolved); taboola notifies its event
 * queue with the account id; outbrain tracks the label; mgid invokes the
 * sensor. Enabled providers only, deduped per provider+label — the exact
 * providerCalls contract.
 */
export const nativeCalls = (bindings: readonly GoalBinding[], providers: BridgeProviders | undefined): NativeCall[] => {
  if (!providers) return [];
  const calls: NativeCall[] = [];
  const seen = new Set<string>();
  for (const binding of bindings) {
    for (const conversion of binding.conversions ?? []) {
      const dedupeKey = `${conversion.provider}:${conversion.label}`;
      if (seen.has(dedupeKey)) continue;
      const value = typeof conversion.value_cents === 'number' ? conversion.value_cents / 100 : undefined;
      if (conversion.provider === 'meta_pixel' && providers.meta_pixel?.id) {
        seen.add(dedupeKey);
        calls.push({
          provider: 'meta_pixel',
          args:
            value === undefined
              ? ['track', conversion.label]
              : ['track', conversion.label, { value, currency: conversion.currency ?? 'USD' }],
        });
      } else if (conversion.provider === 'taboola' && providers.taboola?.id) {
        seen.add(dedupeKey);
        calls.push({
          provider: 'taboola',
          args: [{ notify: 'event', name: conversion.label, id: providers.taboola.id }],
        });
      } else if (conversion.provider === 'outbrain' && providers.outbrain?.id) {
        seen.add(dedupeKey);
        calls.push({ provider: 'outbrain', args: ['track', conversion.label] });
      } else if (conversion.provider === 'mgid' && providers.mgid?.id) {
        seen.add(dedupeKey);
        calls.push({ provider: 'mgid', args: [['MgSensorInvoke', conversion.label]] });
      }
    }
  }
  return calls;
};
