/**
 * Brand-token key registry + CSS-value safety (W8.3, 09-template-system-plan
 * §6.3) — the ONE source of truth for which token keys the renderer consumes
 * and which values are safe to interpolate.
 *
 * CustomStyles.astro emits exactly these custom properties, interpolating the
 * token VALUES raw into an inline <style> block — which makes token values an
 * injection/breakage surface: a value carrying `;`, `}` or `url(` could break
 * or extend the site's CSS from content. Validation (checkTheme + the site
 * structural check) and the renderer both read THIS module, so the enforced
 * key list and the emitted key list cannot drift, and no unsafe value reaches
 * the style tag through `set_theme_fields` (theme bodies) OR `set_site_brand_tokens` (the site palette writer emitted by site_apply_theme).
 *
 * Client-safe (no server imports): the Netlify function bundle and the .astro
 * renderer both import it.
 */

/** The light-block color keys CustomStyles emits (`--aw-color-<key>`). */
export const THEME_COLOR_KEYS = [
  'primary',
  'secondary',
  'accent',
  'gold',
  'text-heading',
  'text-default',
  'text-muted',
  'bg-page',
  'bg-surface',
  'bg-page-dark',
] as const;
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

/**
 * The `.dark`-block override keys (`dark:<key>`). Every light key except
 * `bg-page-dark` (which IS the dark page color, emitted in the light block).
 * All optional: a missing dark key falls back to the light value.
 */
export const THEME_DARK_COLOR_KEYS = THEME_COLOR_KEYS.filter((key) => key !== 'bg-page-dark').map(
  (key) => `dark:${key}` as const
);

/** The font-stack keys (`--aw-font-<key>`); all required by the zod shape. */
export const THEME_FONT_KEYS = ['sans', 'serif', 'heading'] as const;
export type ThemeFontKey = (typeof THEME_FONT_KEYS)[number];

/**
 * The pre-conversion literals — the values CustomStyles falls back to when
 * the site export is absent (W4) or a key is missing. Moved here verbatim
 * from CustomStyles.astro (byte-identity is the gate; the odd comma form in
 * `dark:text-heading` is the current literal — do not "fix" it).
 */
export const FALLBACK_COLORS: Record<string, string> = {
  primary: 'rgb(46 111 149)',
  secondary: 'rgb(37 90 120)',
  accent: 'rgb(94 140 138)',
  gold: 'rgb(194 168 120)',
  'text-heading': 'rgb(22 26 29)',
  'text-default': 'rgb(36 41 46)',
  'text-muted': 'rgb(58 65 73 / 76%)',
  'bg-page': 'rgb(252 251 248)',
  'bg-surface': 'rgb(247 245 240)',
  'bg-page-dark': 'rgb(3 6 32)',
  'dark:text-heading': 'rgb(247, 248, 248)',
  'dark:text-default': 'rgb(229 236 246)',
  'dark:text-muted': 'rgb(229 236 246 / 66%)',
  'dark:bg-page': 'rgb(3 6 32)',
  'dark:bg-surface': 'rgb(19 24 46)',
};

export const FALLBACK_FONTS: Record<string, string> = {
  sans: "'Inter Variable'",
  serif: "'Source Serif 4', Georgia, serif",
  heading: "'Playfair Display', 'Times New Roman', serif",
};

// ─── CSS-value safety ─────────────────────────────────────────────────────────

// Hard floor for ANY token value: characters/constructs that could terminate
// the declaration, open a new rule, close the <style> tag, or fetch a
// resource. Checked case-insensitively; applies on top of the per-kind
// grammar so even a grammar gap can't smuggle these through.
const HARD_FLOOR_RE = /[;{}<>]|url\s*\(|@import|expression\s*\(/i;

// One CSS color: hex, a functional form with ONE paren level (rgb/rgba/hsl/
// hsla/oklch/color, modern or comma syntax), or a bare keyword (lavender,
// transparent). No nesting — calc()/var() chains don't belong in a token.
const COLOR_VALUE_RE = /^(#[0-9a-fA-F]{3,8}|(rgba?|hsla?|oklch|color)\(\s*[^()]*\s*\)|[a-zA-Z][a-zA-Z-]*)$/;

// A font stack: family names (quoted or bare) separated by commas — letters,
// digits, spaces, hyphens, and straight quotes only.
const FONT_STACK_RE = /^[A-Za-z0-9'" -]+(?:\s*,\s*[A-Za-z0-9'" -]+)*$/;

export type TokenValueCheck = { ok: true } | { ok: false; error: string };

export const checkBrandTokenValue = (kind: 'color' | 'font', value: string): TokenValueCheck => {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: 'empty value' };
  if (HARD_FLOOR_RE.test(trimmed)) {
    return {
      ok: false,
      error:
        'value carries a CSS-injection construct (;, {, }, <, >, url(, @import) — it would break or extend the inline style tag',
    };
  }
  if (kind === 'color' && !COLOR_VALUE_RE.test(trimmed)) {
    return {
      ok: false,
      error: 'not a recognized color value (hex, rgb()/rgba()/hsl()/hsla()/oklch()/color(), or a bare keyword)',
    };
  }
  if (kind === 'font' && !FONT_STACK_RE.test(trimmed)) {
    return { ok: false, error: 'not a plain font stack (family names separated by commas)' };
  }
  return { ok: true };
};
