/**
 * Shared client + report helpers for the Phase 2 navigation scripts
 * (seed-navigation.mjs / submit-navigation-review.mjs).
 *
 * Extracted after the first production run exposed two gaps:
 *  1. the two scripts each carried their own copy of the transport and
 *     report parsing, so a guard added to one didn't protect the other;
 *  2. the seed's warning expectation assumed the DEPLOYED validator already
 *     carries the T2.1 navigation rules — false whenever seeding runs before
 *     the Phase 2 merge deploys (which is the documented order!). The
 *     `validatorHasNavRules` probe lets callers tell "no warning because the
 *     deployed validator predates T2.1" apart from "no warning, so the data
 *     must be wrong".
 *
 * Pure helpers are exported individually so tests/scripts/ can unit-test
 * them without a network.
 */

export const createObjectStoreClient = ({ baseUrl, publishSecret, agentName }) => {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/.netlify/functions/object-store`;
  return async (payload) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-publish-key': publishSecret },
      body: JSON.stringify({ agent_name: agentName, ...payload }),
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    return { status: response.status, body };
  };
};

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    );
  return value;
};

/** Key-order-insensitive deep equality (JSON-safe values only). */
export const sameBody = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

const criteria = (validation) => (validation ?? []).flatMap((group) => group.criteria ?? []);

export const warningIds = (validation) =>
  criteria(validation)
    .filter((criterion) => criterion.status === 'warning')
    .map((criterion) => criterion.id);

export const blockerMessages = (validation) =>
  criteria(validation)
    .filter((criterion) => criterion.status === 'missing')
    .map((criterion) => `${criterion.id}: ${criterion.message}`);

/**
 * True when the validation report came from a validator that includes the
 * T2.1 navigation rules (criteria ids nav_groups / nav_depth /
 * nav_duplicates / nav_published_targets). A pre-T2.1 validator reports the
 * generic 'structure: no structural invariants for this type' criterion
 * instead — nav-specific warnings are unverifiable server-side there, NOT
 * absent from the data.
 */
export const validatorHasNavRules = (validation) =>
  criteria(validation).some((criterion) => typeof criterion.id === 'string' && criterion.id.startsWith('nav_'));

/**
 * Evaluate one record's validation report against a seed expectation.
 * Returns { ok, note } — blockers always fail; the exact warning-set check
 * applies only when the deployed validator can produce nav warnings at all.
 */
export const checkValidationAgainstSeed = (validation, expectedWarningIds) => {
  const blockers = blockerMessages(validation);
  if (blockers.length > 0) return { ok: false, note: `hard failures: ${blockers.join(' | ')}` };

  if (!validatorHasNavRules(validation)) {
    return {
      ok: true,
      note:
        'deployed validator predates T2.1 (no nav_* criteria) — duplicate-target warning cannot be checked ' +
        'server-side; the seed data itself is verified offline by npm test.',
    };
  }

  const got = JSON.stringify([...warningIds(validation)].sort());
  const expected = JSON.stringify([...expectedWarningIds].sort());
  if (got !== expected) {
    return { ok: false, note: `warning set mismatch — expected ${expected}, got ${got}.` };
  }
  return {
    ok: true,
    note: expectedWarningIds.length
      ? `validates with the expected warning (${expectedWarningIds.join(', ')})`
      : 'validates with zero warnings',
  };
};
