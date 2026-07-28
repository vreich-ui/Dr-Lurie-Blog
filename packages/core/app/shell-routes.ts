/**
 * Shell routes (W14 T14.1) — the routes that are LAW, injected into every
 * site's build rather than copied into each `sites/<client>/app/pages/`.
 *
 * The split is by what a route depends on:
 *
 *   INJECTED (here) — the `/admin/*` workspace. It renders from the object
 *   store and the user store at runtime, depends on no committed page export,
 *   and is identical for every tenant. A client that got its own copy would
 *   drift from the fleet the first time the console changed.
 *
 *   SITE-OWNED (`sites/<client>/app/pages/`) — every reader-facing route. Each
 *   one is a thin loader over a NAMED page object (`page_home`, `page_about`,
 *   the blog surfaces…), and `PageObjectRenderer` throws when that object is
 *   missing. Which pages exist is a property of the client's content, not of
 *   the shell, so the route files live with the content. A freshly scaffolded
 *   site starts with the routes its starter pack can actually serve.
 *
 * `[...objectPage].astro` stays site-owned for a second reason: it enumerates
 * file-owned routes with `import.meta.glob('./**\/*.astro')`, which only sees
 * the directory it lives in.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

const ROUTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'routes');

/** `pattern` → entrypoint file, relative to `packages/core/app/routes/`. */
export const SHELL_ROUTES: ReadonlyArray<{ pattern: string; entry: string }> = [
  { pattern: '/admin', entry: 'admin/index.astro' },
  { pattern: '/admin/agents', entry: 'admin/agents.astro' },
  // W14 F10: the OAuth consent screen. Inside /admin because the decision needs
  // an authenticated admin, and that login already lives here.
  { pattern: '/admin/authorize', entry: 'admin/authorize.astro' },
  { pattern: '/admin/content', entry: 'admin/content/index.astro' },
  { pattern: '/admin/content/[objectId]', entry: 'admin/content/[objectId].astro' },
  { pattern: '/admin/kit', entry: 'admin/kit.astro' },
  { pattern: '/admin/maintenance', entry: 'admin/maintenance.astro' },
  { pattern: '/admin/profile', entry: 'admin/profile.astro' },
  { pattern: '/admin/settings/admins', entry: 'admin/settings/admins.astro' },
  { pattern: '/admin/settings/guardrails', entry: 'admin/settings/guardrails.astro' },
  { pattern: '/admin/studio', entry: 'admin/studio.astro' },
];

export const shellRoutes = (): AstroIntegration => ({
  name: 'platform-shell-routes',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      for (const route of SHELL_ROUTES) {
        injectRoute({
          pattern: route.pattern,
          entrypoint: path.join(ROUTES_DIR, route.entry),
        });
      }
    },
  },
});
