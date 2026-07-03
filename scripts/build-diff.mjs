#!/usr/bin/env node
// Build-diff harness: builds the site at two git references (or the
// uncommitted working tree vs. a ref) and proves the built HTML is
// unchanged, modulo asset-hash/whitespace/attribute-order noise.
//
// Usage:
//   node scripts/build-diff.mjs                  # working tree vs HEAD
//   node scripts/build-diff.mjs main              # working tree vs main
//   node scripts/build-diff.mjs main feature-branch
//   node scripts/build-diff.mjs --out <dir> [--keep] [refA] [refB]
//
// Exit code is non-zero if any content difference is found.

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPatch } from 'diff';
import { parse } from 'parse5';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORKTREE_ALIASES = new Set(['worktree', '.', 'working-tree', 'workdir']);
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
// Matches hashed build output under `_astro/`, e.g.
// `_astro/click-through.Db4yvXHZ.css` -> `_astro/click-through.HASH.css`.
const HASH_URL_RE =
  /(_astro\/[^"'\s)]+?)\.([A-Za-z0-9_-]{6,24})\.(js|mjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|json|map)(?=["'\s)?#]|$)/g;

function printHelp() {
  console.log(`Build-diff harness

Usage:
  node scripts/build-diff.mjs [refA] [refB] [--out <dir>] [--keep]

  With no refs: compares the uncommitted working tree against HEAD.
  With one ref: compares the uncommitted working tree against that ref.
  With two refs: compares the two git refs (branches, tags, or commits).
  "worktree", "." are accepted as an explicit alias for the working tree.

Options:
  --out <dir>   Where to write the report (default: .build-diff-report)
  --keep        Do not delete the temporary build trees on exit
  -h, --help    Show this help
`);
}

function parseArgs(argv) {
  const positional = [];
  let outDir = null;
  let keep = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--out') {
      outDir = argv[++i];
      if (!outDir) throw new Error('--out requires a directory argument');
    } else if (arg === '--keep') {
      keep = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 2) {
    throw new Error(`Expected at most two refs, got: ${positional.join(', ')}`);
  }

  const [refA = 'HEAD', refB = 'worktree'] = positional;
  return { refA, refB, outDir, keep };
}

function git(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

function resolveRef(ref) {
  if (WORKTREE_ALIASES.has(ref.toLowerCase())) {
    return { kind: 'worktree', label: 'working tree (uncommitted)' };
  }
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  return { kind: 'commit', ref, sha, label: `${ref} (${sha.slice(0, 12)})` };
}

// Hardlinked (not symlinked) so Vite/Rollup's realpath-based module
// resolution sees plain files under the build dir instead of resolving
// through a symlink back to the real repo root (which produces bogus
// nested paths and cache misses). Falls back to a real copy if the temp
// dir lives on a different filesystem (hardlinks require the same device).
function linkNodeModules(dir) {
  const target = path.join(REPO_ROOT, 'node_modules');
  const dest = path.join(dir, 'node_modules');
  if (!existsSync(target)) {
    throw new Error('node_modules not found at repo root — run `npm install` first.');
  }
  const hardlink = spawnSync('cp', ['-al', target, dest]);
  if (hardlink.status !== 0) {
    const copy = spawnSync('cp', ['-a', target, dest]);
    if (copy.status !== 0) {
      throw new Error(`Failed to materialize node_modules in ${dir}:\n${copy.stderr}`);
    }
  }
}

function copyWorkingTree(destDir) {
  // Tracked files (reflecting on-disk edits) + untracked-but-not-ignored files.
  // This deliberately excludes gitignored artifacts like node_modules/dist/.astro.
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    maxBuffer: 1024 * 1024 * 64,
  });
  const files = output.toString('utf8').split('\0').filter(Boolean);

  for (const rel of files) {
    const src = path.join(REPO_ROOT, rel);
    if (!existsSync(src)) continue; // tracked file deleted in the working tree
    const dest = path.join(destDir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync('cp', ['-P', src, dest]);
  }
}

function prepareBuildDir(refInfo, tmpBase, slot) {
  const dir = path.join(tmpBase, `src-${slot}`);

  if (refInfo.kind === 'worktree') {
    mkdirSync(dir, { recursive: true });
    copyWorkingTree(dir);
  } else {
    mkdirSync(tmpBase, { recursive: true });
    const result = spawnSync('git', ['worktree', 'add', '--detach', dir, refInfo.sha], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`git worktree add failed for ${refInfo.label}:\n${result.stderr}`);
    }
    refInfo.isGitWorktree = true;
  }

  linkNodeModules(dir);
  refInfo.dir = dir;
  return dir;
}

function runBuild(dir, label) {
  const start = Date.now();
  process.stdout.write(`▶ Building ${label} … `);
  const result = spawnSync('npm', ['run', 'build'], { cwd: dir, encoding: 'utf8' });
  const seconds = ((Date.now() - start) / 1000).toFixed(1);

  if (result.status !== 0) {
    console.log('failed.');
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`Build failed for ${label} (exit ${result.status}).`);
  }

  console.log(`done (${seconds}s).`);

  const distDir = path.join(dir, 'dist');
  if (!existsSync(distDir)) {
    throw new Error(`Build for ${label} did not produce ${distDir}`);
  }
  return distDir;
}

function collectHtmlFiles(distDir) {
  const entries = readdirSync(distDir, { withFileTypes: true, recursive: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const parentPath = entry.parentPath ?? entry.path;
    const rel = path.relative(distDir, path.join(parentPath, entry.name)).split(path.sep).join('/');
    files.push(rel);
  }
  return files.sort();
}

function attrsToString(attrs) {
  return attrs
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((attr) => (attr.value === '' ? attr.name : `${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`))
    .join(' ');
}

// Renders a parse5 tree into a canonical one-node-per-line form: attributes
// sorted, insignificant whitespace collapsed. This both IS the normalized
// form used for equality checks and doubles as diff-friendly text.
function pretty(node, depth, out, preserveWs) {
  const indent = '  '.repeat(depth);

  switch (node.nodeName) {
    case '#document':
    case '#document-fragment':
      for (const child of node.childNodes) pretty(child, depth, out, preserveWs);
      return;
    case '#documentType':
      out.push(`${indent}<!DOCTYPE ${node.name}>`);
      return;
    case '#comment':
      out.push(`${indent}<!--${node.data.trim()}-->`);
      return;
    case '#text': {
      const text = preserveWs ? node.value : node.value.replace(/\s+/g, ' ').trim();
      if (text) out.push(`${indent}${text}`);
      return;
    }
    default: {
      const tag = node.tagName;
      const attrString = node.attrs && node.attrs.length ? ` ${attrsToString(node.attrs)}` : '';
      out.push(`${indent}<${tag}${attrString}>`);
      if (VOID_ELEMENTS.has(tag)) return;

      const childPreserve = preserveWs || tag === 'pre' || tag === 'textarea' || tag === 'script' || tag === 'style';
      const children = node.childNodes || (node.content && node.content.childNodes) || [];
      for (const child of children) pretty(child, depth + 1, out, childPreserve);
      out.push(`${indent}</${tag}>`);
    }
  }
}

function normalizeHtml(rawHtml) {
  const document = parse(rawHtml);
  const lines = [];
  pretty(document, 0, lines, false);
  return lines.join('\n').replace(HASH_URL_RE, (_match, base, _hash, ext) => `${base}.HASH.${ext}`);
}

function buildReport(distA, distB, labelA, labelB) {
  const filesA = new Set(collectHtmlFiles(distA));
  const filesB = new Set(collectHtmlFiles(distB));
  const allRoutes = Array.from(new Set([...filesA, ...filesB])).sort();

  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  for (const route of allRoutes) {
    const inA = filesA.has(route);
    const inB = filesB.has(route);

    if (inA && !inB) {
      removed.push(route);
      continue;
    }
    if (!inA && inB) {
      added.push(route);
      continue;
    }

    const normA = normalizeHtml(readFileSync(path.join(distA, route), 'utf8'));
    const normB = normalizeHtml(readFileSync(path.join(distB, route), 'utf8'));

    if (normA === normB) {
      unchanged.push(route);
    } else {
      const patch = createPatch(route, normA, normB, labelA, labelB);
      changed.push({ route, patch });
    }
  }

  return { added, removed, changed, unchanged };
}

function renderMarkdown(summary, report) {
  const lines = [];
  lines.push('# Build-diff report', '');
  lines.push(`- **A:** ${summary.refA}`);
  lines.push(`- **B:** ${summary.refB}`);
  lines.push(`- **Generated:** ${summary.generatedAt}`, '');

  if (summary.identical) {
    lines.push(
      '**Result: no differences.** Built HTML is identical modulo normalized whitespace, attribute order, and asset hashes.'
    );
  } else {
    lines.push(
      `**Result: differences found.** ${report.changed.length} page(s) changed, ${report.added.length} added, ${report.removed.length} removed.`
    );
  }
  lines.push('');

  if (report.removed.length) {
    lines.push(`## Removed routes (${report.removed.length})`, '');
    for (const route of report.removed) lines.push(`- \`${route}\``);
    lines.push('');
  }
  if (report.added.length) {
    lines.push(`## Added routes (${report.added.length})`, '');
    for (const route of report.added) lines.push(`- \`${route}\``);
    lines.push('');
  }
  if (report.changed.length) {
    lines.push(`## Changed routes (${report.changed.length})`, '');
    for (const { route } of report.changed) {
      lines.push(`- \`${route}\` — see \`diffs/${route.replace(/\//g, '__')}.diff\``);
    }
    lines.push('');
  }

  lines.push(`## Unchanged: ${report.unchanged.length} route(s)`, '');
  return lines.join('\n');
}

function writeReport(report, outDir, infoA, infoB) {
  // Only ever touch the specific files/subdir this script owns — never a
  // blanket rmSync(outDir), which would be destructive if --out points at
  // an existing directory the caller didn't intend to have wiped.
  mkdirSync(outDir, { recursive: true });
  rmSync(path.join(outDir, 'report.json'), { force: true });
  rmSync(path.join(outDir, 'report.md'), { force: true });
  rmSync(path.join(outDir, 'diffs'), { recursive: true, force: true });

  if (report.changed.length) {
    const diffsDir = path.join(outDir, 'diffs');
    mkdirSync(diffsDir, { recursive: true });
    for (const entry of report.changed) {
      const filename = `${entry.route.replace(/\//g, '__')}.diff`;
      writeFileSync(path.join(diffsDir, filename), entry.patch, 'utf8');
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    refA: infoA.label,
    refB: infoB.label,
    added: report.added,
    removed: report.removed,
    changed: report.changed.map((entry) => entry.route),
    unchangedCount: report.unchanged.length,
    identical: report.added.length === 0 && report.removed.length === 0 && report.changed.length === 0,
  };

  writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(outDir, 'report.md'), `${renderMarkdown(summary, report)}\n`, 'utf8');

  return summary;
}

function printSummary(summary, outDir) {
  console.log('');
  if (summary.identical) {
    console.log(`✓ No differences (${summary.unchangedCount} route(s) compared).`);
  } else {
    console.log(
      `✗ Differences found: ${summary.changed.length} changed, ${summary.added.length} added, ${summary.removed.length} removed (${summary.unchangedCount} unchanged).`
    );
    for (const route of summary.removed) console.log(`  - removed: ${route}`);
    for (const route of summary.added) console.log(`  + added:   ${route}`);
    for (const route of summary.changed) console.log(`  ~ changed: ${route}`);
  }
  console.log(`\nReport written to ${path.relative(process.cwd(), outDir) || '.'}`);
}

function cleanup(built, tmpBase, keep) {
  if (keep) {
    console.log(`\n(--keep) build trees left in place under ${tmpBase}`);
    return;
  }
  for (const info of built) {
    if (!info.dir) continue;
    if (info.isGitWorktree) {
      spawnSync('git', ['worktree', 'remove', '--force', info.dir], { cwd: REPO_ROOT });
    }
  }
  spawnSync('git', ['worktree', 'prune'], { cwd: REPO_ROOT });
  rmSync(tmpBase, { recursive: true, force: true });
}

async function main() {
  const { refA, refB, outDir: outDirArg, keep } = parseArgs(process.argv.slice(2));
  const infoA = resolveRef(refA);
  const infoB = resolveRef(refB);
  const outDir = outDirArg ? path.resolve(outDirArg) : path.join(REPO_ROOT, '.build-diff-report');
  const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'build-diff-'));
  const built = [];

  console.log(`Comparing:\n  A: ${infoA.label}\n  B: ${infoB.label}\n`);

  try {
    const distA = runBuild(prepareBuildDir(infoA, tmpBase, 'a'), infoA.label);
    built.push(infoA);
    const distB = runBuild(prepareBuildDir(infoB, tmpBase, 'b'), infoB.label);
    built.push(infoB);

    const report = buildReport(distA, distB, infoA.label, infoB.label);
    const summary = writeReport(report, outDir, infoA, infoB);
    printSummary(summary, outDir);

    process.exitCode = summary.identical ? 0 : 1;
  } finally {
    cleanup(built, tmpBase, keep);
  }
}

main().catch((error) => {
  console.error(`\nbuild-diff failed: ${error.message}`);
  process.exitCode = 1;
});
