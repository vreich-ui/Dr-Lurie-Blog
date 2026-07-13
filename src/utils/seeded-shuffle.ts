/**
 * Deterministic seeded shuffle (the `random` related-grid algorithm's engine).
 *
 * A static site has no per-request randomness and its build must be
 * reproducible, so "random" means a STABLE pseudo-random order seeded by a
 * string: the same seed always yields the same order (no build-diff churn),
 * different seeds yield different orders (variety per article). Pure — no
 * Math.random, no mutation of the input.
 *
 * xmur3 (seed hash) → mulberry32 (PRNG) → Fisher–Yates. Tiny, well-distributed.
 */
const xmur3 = (str: string): (() => number) => {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
};

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const seededShuffle = <T>(items: readonly T[], seed: string): T[] => {
  const rng = mulberry32(xmur3(seed)());
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
