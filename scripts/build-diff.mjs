#!/usr/bin/env node
/**
 * Build-diff harness (T2.0) — the mechanical safety net for every cutover
 * (04-phased-plan Part 2 point 3).
 *
 * Builds the site twice — at two git refs, or working tree vs. a ref — then
 * compares every dist/ HTML page after normalization (hashed asset names,
 * attribute order, whitespace: scripts/lib/html-normalize.mjs). Any remaining
 * difference is a content difference: the harness prints a per-page report
 * and exits non-zero. An empty diff is the acceptance gate for cutover
 * commits (T2.5, T3.7, T4.3, T5.2 …).
 *
 * Usage:
 *   node scripts/build-diff.mjs                     # working tree vs HEAD
 *   node scripts/build-diff.mjs --base <ref>        # working tree vs <ref>
 *   node scripts/build-diff.mjs --base <A> --head <B>   # ref vs ref
 *   node scripts/build-diff.mjs --self-test         # T2.0 acceptance drill
 *   options: --report <path>   (default .tmp/build-diff/report.txt)
 *            --keep            (keep temp worktrees for inspection)
 *
 * Ref builds happen in throwaway `git worktree`s under .tmp/build-diff/ with
 * node_modules symlinked from this checkout (same dependency tree both sides
 * — the harness compares source states, not lockfiles). The working-tree
 * build runs in place, so uncommitted changes AND untracked files (e.g.
 * locally materialized derived JSON during cutover rehearsal) participate,
 * which is exactly what cutover verification needs.
 *
 * Self-test (--self-test), per the T2.0 acceptance criteria:
 *   1. a no-op rebuild of the same source diffs empty;
 *   2. a one-character copy change is caught, and only on the page it edits.
 * Both run inside a temp worktree; the real working tree is never touched.
 *
 * Exit codes: 0 = no content difference · 1 = differences found or self-test
 * failed · 2 = usage/build error.
 */
import { execFileSync, execSync } from 'node:child_process';
import { createTwoFilesPatch } from 'diff';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeHtml } from './lib/html-normalize.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = path.join(repoRoot, '.tmp', 'build-diff');

// ─── args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const readFlagValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`${flag} requires a value.`);
    process.exit(2);
  }
  return value;
};

const selfTest = args.includes('--self-test');
const keepWorktrees = args.includes('--keep');
const baseRef = readFlagValue('--base') ?? 'HEAD';
const headRef = readFlagValue('--head'); // absent → working tree
const reportPath = readFlagValue('--report') ?? path.join(workDir, 'report.txt');

// ─── build + snapshot ────────────────────────────────────────────────────────

const run = (command, commandArgs, cwd) =>
  execFileSync(command, commandArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

const log = (message) => console.log(`[build-diff] ${message}`);

const buildSite = (dir, label) => {
  log(`building ${label} …`);
  const startedAt = Date.now();
  try {
    execSync('npm run build', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', FORCE_COLOR: '0' },
    });
  } catch (error) {
    console.error(`[build-diff] build failed for ${label}:`);
    console.error(
      String(error.stdout ?? '')
        .split('\n')
        .slice(-30)
        .join('\n')
    );
    console.error(
      String(error.stderr ?? '')
        .split('\n')
        .slice(-30)
        .join('\n')
    );
    process.exit(2);
  }
  log(`built ${label} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
};

/** dist/**.html → Map<route, normalized html>. */
const snapshotDist = (dir) => {
  const distDir = path.join(dir, 'dist');
  if (!fs.existsSync(distDir)) {
    console.error(`[build-diff] no dist/ found under ${dir}`);
    process.exit(2);
  }
  const pages = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) {
        const route = `/${path.relative(distDir, full).replaceAll(path.sep, '/')}`;
        pages.set(route, normalizeHtml(fs.readFileSync(full, 'utf8')));
      }
    }
  };
  walk(distDir);
  return pages;
};

// ─── worktrees ────────────────────────────────────────────────────────────────

const createdWorktrees = [];

const addWorktree = (ref, label) => {
  const dir = path.join(workDir, `wt-${label}-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  run('git', ['worktree', 'add', '--force', '--detach', dir, ref], repoRoot);
  createdWorktrees.push(dir);
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
};

const removeWorktrees = () => {
  if (keepWorktrees) {
    if (createdWorktrees.length) log(`keeping worktrees: ${createdWorktrees.join(', ')}`);
    return;
  }
  for (const dir of createdWorktrees) {
    try {
      run('git', ['worktree', 'remove', '--force', dir], repoRoot);
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
      try {
        run('git', ['worktree', 'prune'], repoRoot);
      } catch {
        /* best effort */
      }
    }
  }
};

// ─── compare + report ─────────────────────────────────────────────────────────

const comparePages = (basePages, headPages) => {
  const routes = [...new Set([...basePages.keys(), ...headPages.keys()])].sort();
  const identical = [];
  const changed = [];
  const onlyBase = [];
  const onlyHead = [];
  for (const route of routes) {
    const inBase = basePages.has(route);
    const inHead = headPages.has(route);
    if (inBase && !inHead) onlyBase.push(route);
    else if (!inBase && inHead) onlyHead.push(route);
    else if (basePages.get(route) === headPages.get(route)) identical.push(route);
    else changed.push(route);
  }
  return { routes, identical, changed, onlyBase, onlyHead };
};

const writeReport = (result, basePages, headPages, labels) => {
  const lines = [];
  lines.push(`build-diff report — base: ${labels.base} · head: ${labels.head}`);
  lines.push(
    `pages: ${result.routes.length} total · ${result.identical.length} identical · ` +
      `${result.changed.length} changed · ${result.onlyBase.length} only-in-base · ${result.onlyHead.length} only-in-head`
  );
  lines.push('');
  for (const route of result.onlyBase) lines.push(`ONLY IN BASE  ${route}`);
  for (const route of result.onlyHead) lines.push(`ONLY IN HEAD  ${route}`);
  for (const route of result.changed) {
    lines.push(`CHANGED       ${route}`);
    lines.push(
      createTwoFilesPatch(`base:${route}`, `head:${route}`, basePages.get(route), headPages.get(route), '', '', {
        context: 1,
      })
    );
  }
  lines.push('');
  for (const route of result.identical) lines.push(`identical     ${route}`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`);
};

const printSummary = (result) => {
  const clean = result.changed.length === 0 && result.onlyBase.length === 0 && result.onlyHead.length === 0;
  log(
    `${result.routes.length} pages compared: ${result.identical.length} identical, ` +
      `${result.changed.length} changed, ${result.onlyBase.length} only-in-base, ${result.onlyHead.length} only-in-head`
  );
  for (const route of [...result.onlyBase]) log(`  only in base: ${route}`);
  for (const route of [...result.onlyHead]) log(`  only in head: ${route}`);
  for (const route of result.changed) log(`  changed: ${route}`);
  if (clean) log('RESULT: EMPTY DIFF — no content differences.');
  else log(`RESULT: CONTENT DIFFERENCES FOUND — full report at ${reportPath}`);
  return clean;
};

// ─── self-test ────────────────────────────────────────────────────────────────

// One-character copy change applied inside the self-test worktree only. The
// haystack is homepage copy; if it ever changes upstream, update both strings.
const SELF_TEST_FILE = 'src/pages/index.astro';
const SELF_TEST_NEEDLE = 'Five simple places to begin.';
const SELF_TEST_MUTATION = 'Five simple places to begin!';

const runSelfTest = () => {
  log('self-test: build #1 (baseline), build #2 (no-op rebuild), build #3 (one-char copy change)');
  const wt = addWorktree('HEAD', 'selftest');

  buildSite(wt, 'self-test build #1');
  const first = snapshotDist(wt);
  buildSite(wt, 'self-test build #2 (no-op rebuild)');
  const second = snapshotDist(wt);

  const noop = comparePages(first, second);
  writeReport(noop, first, second, { base: 'self-test #1', head: 'self-test #2' });
  const noopClean = noop.changed.length === 0 && noop.onlyBase.length === 0 && noop.onlyHead.length === 0;
  log(
    noopClean ? 'self-test 1/2 PASS: no-op rebuild diffs empty.' : 'self-test 1/2 FAIL: no-op rebuild was not clean!'
  );
  if (!noopClean) printSummary(noop);

  const target = path.join(wt, SELF_TEST_FILE);
  const source = fs.readFileSync(target, 'utf8');
  if (!source.includes(SELF_TEST_NEEDLE)) {
    console.error(`[build-diff] self-test needle not found in ${SELF_TEST_FILE}; update SELF_TEST_NEEDLE.`);
    process.exit(2);
  }
  fs.writeFileSync(target, source.replace(SELF_TEST_NEEDLE, SELF_TEST_MUTATION));
  buildSite(wt, 'self-test build #3 (mutated copy)');
  const third = snapshotDist(wt);

  const mutated = comparePages(second, third);
  const expected = mutated.changed.length === 1 && mutated.changed[0] === '/index.html';
  const caught = expected && mutated.onlyBase.length === 0 && mutated.onlyHead.length === 0;
  log(
    caught
      ? 'self-test 2/2 PASS: one-character copy change caught, confined to /index.html.'
      : `self-test 2/2 FAIL: expected exactly /index.html to change; saw changed=[${mutated.changed.join(', ')}] ` +
          `only-in-base=[${mutated.onlyBase.join(', ')}] only-in-head=[${mutated.onlyHead.join(', ')}]`
  );

  const pass = noopClean && caught;
  log(pass ? 'SELF-TEST PASS' : 'SELF-TEST FAIL');
  return pass;
};

// ─── main ─────────────────────────────────────────────────────────────────────

try {
  if (selfTest) {
    process.exit(runSelfTest() ? 0 : 1);
  }

  const baseDir = addWorktree(baseRef, 'base');
  let headDir = repoRoot;
  let headLabel = 'working tree';
  if (headRef) {
    headDir = addWorktree(headRef, 'head');
    headLabel = headRef;
  }

  buildSite(baseDir, `base (${baseRef})`);
  const basePages = snapshotDist(baseDir);
  buildSite(headDir, `head (${headLabel})`);
  const headPages = snapshotDist(headDir);

  const result = comparePages(basePages, headPages);
  writeReport(result, basePages, headPages, { base: baseRef, head: headLabel });
  const clean = printSummary(result);
  process.exit(clean ? 0 : 1);
} finally {
  removeWorktrees();
}
