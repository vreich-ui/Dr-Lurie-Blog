#!/usr/bin/env node
/**
 * T3.2 render verification — the "markup structurally identical" gate.
 *
 * Renders the five extracted section components (Hero, Checklist,
 * ContentGrid, Bio, NewsletterSignup) from the C§1.1 fixture data through a
 * REAL `astro build` (a temporary fixture route, removed afterwards), then
 * compares each rendered <section> fragment against the corresponding
 * fragment of the LIVE homepage from the SAME build, normalized by the same
 * T2.0 normalizer build-diff uses. The strongest available oracle: not a
 * hand-written golden, but the actual current index.astro output — if the
 * components and the audited markup ever drift, this fails.
 *
 * Usage: node scripts/verify-section-components.mjs
 * Exit codes: 0 all sections identical; 1 mismatch or build failure.
 *
 * Builds into .tmp/t32-verify/dist (never the repo's dist/). Cleans up the
 * fixture route and purges the shared Astro content store before building
 * (the store bleeds stale entries across builds — see build-diff.mjs).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeHtml } from './lib/html-normalize.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoute = path.join(repoRoot, 'src', 'pages', 't32-fixture-verify.astro');
const outDir = path.join(repoRoot, '.tmp', 't32-verify', 'dist');

const FIXTURE_SOURCE = `---
/* T3.2 render-verification fixture — written and removed by
 * scripts/verify-section-components.mjs. Never commit this file. */
import Layout from '~/layouts/PageLayout.astro';
import Bio from '~/components/sections/Bio.astro';
import Checklist from '~/components/sections/Checklist.astro';
import ContentGrid from '~/components/sections/ContentGrid.astro';
import Hero from '~/components/sections/Hero.astro';
import NewsletterSignup from '~/components/sections/NewsletterSignup.astro';
import {
  homeBioData,
  homeChecklistData,
  homeContentGridData,
  homeHeroData,
  homeNewsletterSignupData,
} from '~/lib/registry/components/home-fixture-data';
import { getPermalink } from '~/utils/permalinks';

const metadata = { title: 'T3.2 fixture' };
const heroResolved = {
  actionHrefs: homeHeroData.actions.map((action) => getPermalink(action.target.href)),
};
---

<Layout metadata={metadata}>
  <Hero data={homeHeroData} resolved={heroResolved} ctx={{}} />
  <Checklist data={homeChecklistData} resolved={{}} ctx={{}} />
  <ContentGrid data={homeContentGridData} resolved={{}} ctx={{}} />
  <Bio data={homeBioData} resolved={{}} ctx={{}} />
  <NewsletterSignup data={homeNewsletterSignupData} resolved={{}} ctx={{}} />
</Layout>
`;

const SECTION_LABELS = [
  'hero',
  'checklist (audience)',
  'content_grid (start-here)',
  'bio (about)',
  'newsletter_signup',
];

/** All top-level <section>…</section> fragments, in document order (none nest here). */
const extractSections = (html, file) => {
  const fragments = [];
  let cursor = 0;
  for (;;) {
    const start = html.indexOf('<section', cursor);
    if (start === -1) break;
    const end = html.indexOf('</section>', start);
    if (end === -1) throw new Error(`${file}: unterminated <section> at offset ${start}`);
    fragments.push(html.slice(start, end + '</section>'.length));
    cursor = end + '</section>'.length;
  }
  return fragments;
};

const firstDifference = (a, b) => {
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : max;
};

const main = () => {
  fs.rmSync(path.join(repoRoot, 'node_modules', '.astro', 'data-store.json'), { force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.writeFileSync(fixtureRoute, FIXTURE_SOURCE);
  try {
    console.info('[t32-verify] building (fixture route + live homepage, one build)…');
    execFileSync('npx', ['astro', 'build', '--outDir', outDir], { cwd: repoRoot, stdio: 'pipe' });

    const homepage = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    const fixture = fs.readFileSync(path.join(outDir, 't32-fixture-verify', 'index.html'), 'utf8');

    const homepageSections = extractSections(homepage, 'index.html');
    const fixtureSections = extractSections(fixture, 't32-fixture-verify/index.html');
    if (homepageSections.length !== 5 || fixtureSections.length !== 5) {
      console.error(
        `[t32-verify] expected 5 <section> fragments per page, found homepage=${homepageSections.length} fixture=${fixtureSections.length}`
      );
      return 1;
    }

    let failures = 0;
    for (let i = 0; i < 5; i += 1) {
      const expected = normalizeHtml(homepageSections[i]);
      const actual = normalizeHtml(fixtureSections[i]);
      if (expected === actual) {
        console.info(`[t32-verify] ${SECTION_LABELS[i]}: IDENTICAL`);
      } else {
        failures += 1;
        const at = firstDifference(expected, actual);
        console.error(`[t32-verify] ${SECTION_LABELS[i]}: DIFFERENT (first divergence at ${at})`);
        console.error(`  homepage:  …${expected.slice(Math.max(0, at - 80), at + 120)}…`);
        console.error(`  component: …${actual.slice(Math.max(0, at - 80), at + 120)}…`);
      }
    }

    if (failures) {
      console.error(`[t32-verify] RESULT: ${failures}/5 sections differ.`);
      return 1;
    }
    console.info('[t32-verify] RESULT: all 5 sections render identical to the live homepage.');
    return 0;
  } catch (error) {
    console.error('[t32-verify] build failed:');
    console.error(error.stderr ? String(error.stderr).slice(-4000) : error);
    return 1;
  } finally {
    fs.rmSync(fixtureRoute, { force: true });
  }
};

process.exitCode = main();
