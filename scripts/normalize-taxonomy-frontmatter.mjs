#!/usr/bin/env node
/**
 * One-time taxonomy frontmatter normalization (W3 step 2, Wolf-approved plan) —
 * rewrite every post's `category:` / `tags:` frontmatter to the CANONICAL SLUGS
 * of the tax_drlurie registry, using the approved raw→canonical mapping
 * committed in scripts/lib/taxonomy-seed-data.mjs (RAW_TO_CANONICAL).
 *
 * Rules (exactly the approved cleanup):
 *   - a raw string with a mapping → its canonical slug;
 *   - a raw string WITHOUT a mapping (pipeline-test junk / unclustered one-offs)
 *     → DROPPED (category line removed / tag omitted);
 *   - tags are de-duplicated after mapping (casing variants collapse), original
 *     order preserved; an emptied tags list removes the whole block;
 *   - everything else in the file is preserved byte-exact — the script performs
 *     line surgery on the frontmatter, it does not re-serialize it. The tag
 *     list style (block list vs inline array) is preserved per file.
 *
 * Display is unaffected by slug-form frontmatter: the blog renderer looks up
 * display labels from the registry export (src/data/site/taxonomy.json) by
 * slug. Routes are already slugified, so kept terms keep their URLs; merged
 * terms consolidate onto the canonical term's page (intended).
 *
 * Usage:
 *   node scripts/normalize-taxonomy-frontmatter.mjs           # dry run (report only)
 *   node scripts/normalize-taxonomy-frontmatter.mjs --write   # apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RAW_TO_CANONICAL } from '../sites/drlurie/seeds/taxonomy-seed-data.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postsDir = path.join(repoRoot, 'src', 'data', 'post');
const write = process.argv.includes('--write');

const strip = (value) => value.trim().replace(/^["']|["']$/g, '');

const stats = { files: 0, changed: 0, categoryMapped: 0, categoryDropped: 0, tagsMapped: 0, tagsDropped: 0 };
const dropped = new Map(); // raw string -> count, for the report

const mapTerm = (kind, raw) => {
  const canonical = RAW_TO_CANONICAL[kind][raw];
  if (canonical === undefined) {
    dropped.set(`${kind}:${raw}`, (dropped.get(`${kind}:${raw}`) ?? 0) + 1);
    return undefined;
  }
  return canonical;
};

for (const file of fs
  .readdirSync(postsDir)
  .filter((name) => name.endsWith('.md'))
  .sort()) {
  const filePath = path.join(postsDir, file);
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) continue;
  stats.files += 1;

  const fm = match[1];
  const lines = fm.split('\n');
  const out = [];
  const notes = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // ─ category: <value> ─
    const catMatch = line.match(/^(category:\s*)(.+)$/);
    if (catMatch) {
      const raw = strip(catMatch[2]);
      const canonical = mapTerm('category', raw);
      if (canonical === undefined) {
        stats.categoryDropped += 1;
        notes.push(`category "${raw}" → dropped`);
        continue; // drop the line
      }
      if (canonical !== raw) notes.push(`category "${raw}" → ${canonical}`);
      stats.categoryMapped += 1;
      out.push(`${catMatch[1]}${canonical}`);
      continue;
    }

    // ─ tags: [a, b] (inline) ─
    const inlineMatch = line.match(/^(tags:\s*)\[(.*)\]\s*$/);
    if (inlineMatch) {
      const rawTags = inlineMatch[2].split(',').map(strip).filter(Boolean);
      const mapped = [...new Set(rawTags.map((raw) => mapTerm('tag', raw)).filter(Boolean))];
      stats.tagsMapped += mapped.length;
      stats.tagsDropped += rawTags.length - mapped.length;
      if (rawTags.join() !== mapped.join()) notes.push(`tags [${rawTags}] → [${mapped}]`);
      if (mapped.length > 0) out.push(`${inlineMatch[1]}[${mapped.join(', ')}]`);
      continue;
    }

    // ─ tags: (block list) ─
    if (/^tags:\s*$/.test(line)) {
      const items = [];
      let j = i + 1;
      let itemIndent = '  ';
      while (j < lines.length) {
        const itemMatch = lines[j].match(/^(\s+)-\s+(.*)$/);
        if (!itemMatch) break;
        itemIndent = itemMatch[1];
        items.push(strip(itemMatch[2]));
        j += 1;
      }
      const mapped = [...new Set(items.map((raw) => mapTerm('tag', raw)).filter(Boolean))];
      stats.tagsMapped += mapped.length;
      stats.tagsDropped += items.length - mapped.length;
      if (items.join() !== mapped.join()) notes.push(`tags [${items}] → [${mapped}]`);
      if (mapped.length > 0) {
        out.push(line);
        for (const slug of mapped) out.push(`${itemIndent}- ${slug}`);
      }
      i = j - 1;
      continue;
    }

    out.push(line);
  }

  const nextFm = out.join('\n');
  if (nextFm !== fm) {
    stats.changed += 1;
    console.info(`${write ? 'normalized' : 'would normalize'}  ${file}`);
    for (const note of notes) console.info(`    ${note}`);
    if (write) {
      fs.writeFileSync(filePath, text.replace(match[0], `---\n${nextFm}\n---`));
    }
  }
}

console.info(
  `\n[normalize-taxonomy] ${write ? 'APPLIED' : 'DRY RUN'} — ${stats.changed}/${stats.files} files changed; ` +
    `category kept ${stats.categoryMapped} / dropped ${stats.categoryDropped}; ` +
    `tags kept ${stats.tagsMapped} / dropped ${stats.tagsDropped}`
);
if (dropped.size > 0) {
  console.info('[normalize-taxonomy] dropped raw strings (junk / unclustered — promotable later):');
  for (const [key, count] of [...dropped.entries()].sort((a, b) => b[1] - a[1])) {
    console.info(`  ${String(count).padStart(3)}  ${key}`);
  }
}
if (!write) console.info('\nRe-run with --write to apply.');
