#!/usr/bin/env node
/**
 * Fleet CI matrix discovery + change-scoped filtering (W11 T11.8).
 *
 * "Canonical changes update all clients" is only true if CI proves every
 * client on every core change — this script is the mechanism: it discovers
 * `sites/*` dynamically (adding a client is zero workflow-file edits) and
 * decides, from the PR/push diff, whether the fleet fans out fully or the
 * run can scope to just the site(s) actually touched.
 *
 * Rule (deliberately conservative — 05/CLAUDE.md "no half measures" spirit
 * applied to CI correctness): a diff confined ENTIRELY to `sites/**` paths
 * only rebuilds the touched site(s) — anything else (packages/core, root
 * config, netlify functions, the workflow file itself, docs, …) is treated
 * as potentially core-impacting and fans out to the WHOLE fleet. Silently
 * under-building on an ambiguous change would be the actual bug; over-
 * building is just a slower green.
 *
 * Usage (as the CI step):
 *   node scripts/ci/discover-fleet-matrix.mjs --base <sha> --head <sha> [--sites-root sites]
 * Prints `{"sites": [...], "fanOut": true|false}` to stdout. In GitHub
 * Actions, capture with:
 *   run: node scripts/ci/discover-fleet-matrix.mjs --base ${{ github.event.pull_request.base.sha || github.event.before }} --head ${{ github.sha }} >> "$GITHUB_OUTPUT_JSON"
 * (the workflow step wraps this to also write `sites=`/`fan_out=` lines to
 * $GITHUB_OUTPUT — see .github/workflows/actions.yaml).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every `sites/<name>/` directory that carries its own `site.config.ts` — the buildable fleet. */
export const discoverSites = (sitesRoot = path.join(repoRoot, 'sites')) => {
  if (!fs.existsSync(sitesRoot)) return [];
  return fs
    .readdirSync(sitesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(sitesRoot, name, 'site.config.ts')))
    .sort();
};

/**
 * Pure decision function — no filesystem/git access — so the fan-out logic
 * is unit-testable against fixture diffs without a real repo/git history.
 *
 * @param {string[]} allSites - the discovered fleet (discoverSites()'s output)
 * @param {string[]} changedPaths - repo-relative paths from the diff (may be empty)
 * @returns {{ sites: string[], fanOut: boolean }}
 */
export const computeFleetMatrix = ({ allSites, changedPaths }) => {
  // No diff information (e.g. the first commit on a branch, or a manual
  // full run) — fail toward completeness, not speed.
  if (changedPaths.length === 0) return { sites: allSites, fanOut: true };

  const sitePrefix = (p) => {
    const match = /^sites\/([^/]+)\//.exec(p);
    return match ? match[1] : null;
  };

  const touchedSites = new Set();
  let coreTouched = false;
  for (const changedPath of changedPaths) {
    const site = sitePrefix(changedPath);
    if (site && allSites.includes(site)) {
      touchedSites.add(site);
    } else {
      // Outside sites/**, OR inside sites/** but not a known/buildable site
      // (e.g. a half-scaffolded dir) — conservatively treat as core-impacting.
      coreTouched = true;
    }
  }

  if (coreTouched) return { sites: allSites, fanOut: true };
  return { sites: allSites.filter((site) => touchedSites.has(site)), fanOut: false };
};

const readFlagValue = (argv, flag) => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

const getChangedPaths = (base, head) => {
  if (!base || !head) return [];
  try {
    const output = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    // A shallow checkout or an unknown base (e.g. a force-push rewriting
    // history) can make the three-dot range unresolvable — fail toward
    // completeness (full fan-out) rather than silently scoping down.
    console.error(
      `[discover-fleet-matrix] could not diff ${base}...${head} (${error instanceof Error ? error.message : error}); falling back to full fan-out.`
    );
    return [];
  }
};

/**
 * Appends `sites=<json-array>` and `fan_out=<true|false>` lines to a
 * GitHub Actions `$GITHUB_OUTPUT` file, so the workflow step needs no
 * bash-side JSON parsing (the classic footgun of shelling `jq`-less JSON
 * out of a `run:` block) — it just reads `steps.discover.outputs.sites` /
 * `.fan_out` directly.
 */
export const writeGithubOutput = (outputPath, result) => {
  fs.appendFileSync(outputPath, `sites=${JSON.stringify(result.sites)}\n`);
  fs.appendFileSync(outputPath, `fan_out=${result.fanOut}\n`);
};

export const main = (argv) => {
  const base = readFlagValue(argv, '--base');
  const head = readFlagValue(argv, '--head');
  const sitesRootArg = readFlagValue(argv, '--sites-root');
  const sitesRoot = sitesRootArg ? path.resolve(repoRoot, sitesRootArg) : undefined;

  const allSites = discoverSites(sitesRoot);
  const changedPaths = getChangedPaths(base, head);
  const result = computeFleetMatrix({ allSites, changedPaths });

  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) writeGithubOutput(process.env.GITHUB_OUTPUT, result);
  return result;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
