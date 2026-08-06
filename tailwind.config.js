import path from 'node:path';
import { fileURLToPath } from 'node:url';

import defaultTheme from 'tailwindcss/defaultTheme';
import plugin from 'tailwindcss/plugin';
import typographyPlugin from '@tailwindcss/typography';

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));

export default {
  // ABSOLUTE (W14 T14.3): tailwind resolves these against the process cwd, and
  // Netlify runs a site's build from that project's BASE DIRECTORY, not the
  // repo root. Repo-relative globs matched nothing there, so every `@apply`
  // referenced a class tailwind had never seen and the CSS build died.
  content: ['packages/core', 'sites', 'src'].map((dir) =>
    path.join(REPO_ROOT, dir, '**/*.{astro,html,js,jsx,json,md,mdx,svelte,ts,tsx,vue}')
  ),
  theme: {
    extend: {
      colors: {
        primary: 'var(--aw-color-primary)',
        secondary: 'var(--aw-color-secondary)',
        accent: 'var(--aw-color-accent)',
        gold: 'var(--aw-color-gold)',
        default: 'var(--aw-color-text-default)',
        muted: 'var(--aw-color-text-muted)',
        surface: 'var(--aw-color-bg-surface)',
      },
      fontFamily: {
        sans: ['var(--aw-font-sans, ui-sans-serif)', ...defaultTheme.fontFamily.sans],
        serif: ['var(--aw-font-serif, ui-serif)', ...defaultTheme.fontFamily.serif],
        heading: ['var(--aw-font-heading, ui-sans-serif)', ...defaultTheme.fontFamily.sans],
        mono: ['var(--aw-font-mono, ui-monospace)', ...defaultTheme.fontFamily.mono],
      },

      animation: {
        fade: 'fadeInUp 1s both',
      },

      keyframes: {
        fadeInUp: {
          '0%': { opacity: 0, transform: 'translateY(2rem)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
    typographyPlugin,
    plugin(({ addVariant }) => {
      addVariant('intersect', '&:not([no-intersect])');
    }),
  ],
  darkMode: 'class',
};
