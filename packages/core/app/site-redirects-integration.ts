/**
 * SITE REDIRECTS → `_redirects` (W14 F6, Wolf's ruling 3).
 *
 * "this is dtc sales and publishing project. we can't lose readers. readers
 * should always be redirected." `object_retire` records the forwarding rule for
 * every route it removes; this integration is the half that actually SERVES it,
 * emitting Netlify's `_redirects` artifact into the publish directory at the end
 * of each build.
 *
 * A build-done hook rather than an Astro endpoint route: `build.format` is
 * `directory`, so a route at `/_redirects` would land as `_redirects/index.html`
 * and Netlify would never read it. Writing the file straight into `dir` is
 * unambiguous.
 *
 * Precedence is deliberate: Netlify applies `netlify.toml` rules BEFORE
 * `_redirects`, so infrastructure routing (/mcp, /img/*, the admin rewrite) wins
 * and content forwarding fills in behind it. That is also why retirement
 * redirects live here and not in `site.config.ts` — that array is code, kept
 * byte-comparable with netlify.toml, and agents do not edit code.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AstroIntegration } from 'astro';

import { siteRedirectsSchema, toNetlifyRedirectsFile } from '../server/lib/site-redirects.js';

export const siteRedirectsFile = (options: { siteDir: string }): AstroIntegration => ({
  name: 'platform-site-redirects',
  hooks: {
    'astro:build:done': ({ dir, logger }) => {
      const source = path.join(options.siteDir, 'data', 'site', 'redirects.json');
      if (!fs.existsSync(source)) return; // No retirements yet — nothing to serve.

      let lines: string;
      try {
        const parsed = siteRedirectsSchema.safeParse(JSON.parse(fs.readFileSync(source, 'utf8')));
        if (!parsed.success) {
          // Loud, but not build-fatal: a malformed table must not take the whole
          // site down, and the previous deploy's redirects stay live until fixed.
          logger.warn(`redirects.json failed validation and was skipped: ${parsed.error.message}`);
          return;
        }
        lines = toNetlifyRedirectsFile(parsed.data);
      } catch (error) {
        logger.warn(`redirects.json could not be read and was skipped: ${String(error)}`);
        return;
      }
      if (!lines) return;

      const target = path.join(fileURLToPathCompat(dir), '_redirects');
      // Append if something already emitted one, so this never silently drops
      // another integration's rules.
      const existing = fs.existsSync(target) ? `${fs.readFileSync(target, 'utf8').trimEnd()}\n` : '';
      fs.writeFileSync(target, `${existing}${lines}\n`);
      logger.info(`wrote ${lines.split('\n').length} content redirect(s) to _redirects`);
    },
  },
});

/** `dir` is a URL; keep this dependency-free rather than importing node:url here. */
const fileURLToPathCompat = (dir: URL | string): string =>
  typeof dir === 'string' ? dir : decodeURIComponent(dir.pathname);
