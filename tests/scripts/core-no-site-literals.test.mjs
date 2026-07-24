/**
 * W11 T11.5 — the zero-`drlurie` core lint (plan §8 exit bar).
 *
 * packages/core is fleet law: no client name may appear in its APPLICATION
 * code. Scope per the ratified 2026-07-22 carve-out: application sources only
 * — `*.test.ts` files are exempt (fixture parameterization deferred), and
 * COMMENTS are exempt (docs may narrate history/examples; code may not).
 * Site names live under `sites/` and `src/config/` only.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE = join(ROOT, 'packages', 'core');
const LITERAL = /drlurie|kugelmedia|luri[eé]/i;

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|astro|mjs|js)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
};

const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments (incl. JSDoc)
    .replace(/^\s*\/\/.*$/gm, '') // whole-line // comments
    .replace(/(?<=\s)\/\/(?!:).*$/gm, '') // trailing // comments (not protocol//)
    .replace(/<!--[\s\S]*?-->/g, ''); // HTML comments in .astro

test('packages/core application code carries zero site-name literals (comments exempt)', () => {
  const offenders = [];
  for (const file of walk(CORE)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const lines = code.split('\n');
    lines.forEach((line, i) => {
      if (LITERAL.test(line)) offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, [], `site-name literals in core application code:\n${offenders.join('\n')}`);
});
