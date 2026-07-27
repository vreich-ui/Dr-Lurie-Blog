/**
 * T2.4 — prop-shape adapter: published NavigationBody records → the exact
 * prop shapes Header.astro / Footer.astro consume today (`links/actions` and
 * `links/secondaryLinks/socialLinks/footNote(/brand/descriptor)`, A§2.2–2.3).
 *
 * The P2 cutover changes who FEEDS the proven markup, never the markup
 * (04 Part 2 point 2): these are pure functions with no Astro imports, unit
 * tested by deep-equality against the current `headerData`/`footerData`/
 * `homeFooterData` literals — the byte-identical guarantee moved to the type
 * level. Anything that would change rendered output — a surfaced M-5 parent
 * link, a visible label on the icon-only RSS link — is deliberately NOT done
 * here:
 *
 *  - M-5 group targets are mapped to the same dead `href` the headerData
 *    literal carries: Header.astro renders dropdown parents as <button>s and
 *    ignores it (Header.astro:92-121). Buttons stay buttons; making parents
 *    real links would be an intentional future behavior change, not P2.
 *  - Social-slot items emit `{ariaLabel, icon, href}` with NO `text` key:
 *    Footer renders social links icon-only (A§2.3); the record's `label`
 *    stays canonical in the CMS data, `ariaLabel` carries it to readers.
 *  - `footNote` passes through verbatim (whitespace included).
 *  - Header chrome flags (isSticky/showRssFeed/showToggleTheme) are not nav
 *    data — they stay where they are until the Site object lands (P5).
 *
 * Target resolution mirrors what the D§3.8 materializer contract will do for
 * `page`-kind targets at materialize time. In Phase 2 no published nav may
 * carry page/taxonomy targets (Gap Note 2: everything page-like is seeded as
 * `route`), so those two kinds THROW here — a loud build failure instead of a
 * silently dead link; T3.11/T4.5 upgrade targets only after materialize-time
 * resolution exists.
 */
// Relative + extensioned so this module compiles under both Astro/Vite and
// the NodeNext test compiler (tsconfig.test.json has no `~` alias).
import {
  navigationBodySchema,
  type NavigationBody,
  type NavItem,
  type NavTarget,
} from '../../schema/bodies/navigation-v1.js';

export type NavTargetResolver = (target: NavTarget) => string;

export type HeaderMenuLink = {
  text?: string;
  href?: string;
  description?: string;
  links?: HeaderMenuLink[];
  adminOnly?: boolean;
};

export type HeaderAction = {
  text: string;
  href: string;
  variant?: 'primary' | 'secondary' | 'link';
};

export type HeaderNavProps = {
  links: HeaderMenuLink[];
  actions: HeaderAction[];
};

export type FooterLink = {
  text?: string;
  href: string;
  ariaLabel?: string;
  icon?: string;
};

export type FooterNavProps = {
  links: Array<{ title?: string; links: FooterLink[] }>;
  secondaryLinks: Array<{ text: string; href: string }>;
  socialLinks: FooterLink[];
  footNote?: string;
  brand?: string;
  descriptor?: string;
};

/**
 * Site-relative resolution for every target kind that exists in Phase 2
 * exports. `blogPermalink` is injected (getBlogPermalink() from the Astro
 * side, a literal in tests) so this module stays free of astrowind:config.
 */
export const createNavTargetResolver = (options: { blogPermalink: string }): NavTargetResolver => {
  return (target: NavTarget): string => {
    switch (target.kind) {
      case 'route':
      case 'external':
      case 'asset':
        return target.href;
      case 'listing':
        return options.blogPermalink;
      case 'page':
        throw new Error(
          `NavTarget page:"${target.page}" cannot be resolved by the P2 adapter — page targets resolve at ` +
            'materialize time once Page objects exist (T3.11/T4.5); Phase 2 navs must carry route-kind targets.'
        );
      case 'taxonomy':
        throw new Error(
          `NavTarget taxonomy:${target.termKind}/${target.term_id} cannot be resolved by the P2 adapter — ` +
            'no taxonomy registry export exists until P5; Phase 2 navs must carry route-kind targets.'
        );
    }
  };
};

/** Derived exports carry a top-level __generated marker (T1.1); the body is the rest. */
export const parseNavigationExport = (data: unknown): NavigationBody => {
  const record = data && typeof data === 'object' ? { ...(data as Record<string, unknown>) } : data;
  if (record && typeof record === 'object') delete (record as Record<string, unknown>).__generated;
  return navigationBodySchema.parse(record);
};

const headerItem = (item: NavItem, resolve: NavTargetResolver): HeaderMenuLink => ({
  text: item.label,
  href: resolve(item.target),
  ...(item.description !== undefined ? { description: item.description } : {}),
  ...(item.children && item.children.length > 0
    ? { links: item.children.map((child) => headerItem(child, resolve)) }
    : {}),
  // M-9: carried only when set, so navs without adminOnly stay byte-identical.
  ...(item.adminOnly ? { adminOnly: true } : {}),
});

export const navigationToHeaderProps = (body: NavigationBody, resolve: NavTargetResolver): HeaderNavProps => ({
  links: body.groups
    .filter((group) => group.slot === undefined || group.slot === 'primary')
    .flatMap((group) => {
      // A group with items but NO title has no label to render, and Header
      // draws any group carrying `links` as a dropdown — so it came out as a
      // bare chevron with its items trapped inside an unlabelled menu (W14 F3;
      // every create-site scaffold ships exactly this shape: one titleless
      // `g_primary` holding "Home"). A titleless group is not a menu, it is a
      // set of TOP-LEVEL links, so flatten it. Groups WITH a title are
      // untouched, which is every group Dr-Lurié has — its header is unchanged.
      if (group.title === undefined && group.items.length > 0) {
        return group.items.map((item) => ({
          ...headerItem(item, resolve),
          ...(group.adminOnly ? { adminOnly: true } : {}),
        }));
      }
      return [
        {
          ...(group.title !== undefined ? { text: group.title } : {}),
          // M-5: the stored parent target maps to the same (unrendered-for-
          // dropdowns) href the literal carries. Data preserved, behavior not.
          ...(group.target !== undefined ? { href: resolve(group.target) } : {}),
          ...(group.items.length > 0 ? { links: group.items.map((item) => headerItem(item, resolve)) } : {}),
          // M-9: group-level admin gate (carried only when set → byte-identical otherwise).
          ...(group.adminOnly ? { adminOnly: true } : {}),
        },
      ];
    }),
  actions: (body.actions ?? []).map((action) => ({
    text: action.label,
    href: resolve(action.target),
    ...(action.style !== undefined ? { variant: action.style } : {}),
  })),
});

const footerLink = (item: NavItem, resolve: NavTargetResolver): FooterLink => ({
  text: item.label,
  href: resolve(item.target),
  ...(item.ariaLabel !== undefined ? { ariaLabel: item.ariaLabel } : {}),
  ...(item.icon !== undefined ? { icon: item.icon } : {}),
});

// Icon-only social rendering (A§2.3): no `text` key, or the footer would
// visibly gain link text next to the icon.
const socialLink = (item: NavItem, resolve: NavTargetResolver): FooterLink => ({
  ...(item.ariaLabel !== undefined ? { ariaLabel: item.ariaLabel } : {}),
  ...(item.icon !== undefined ? { icon: item.icon } : {}),
  href: resolve(item.target),
});

export const navigationToFooterProps = (body: NavigationBody, resolve: NavTargetResolver): FooterNavProps => ({
  links: body.groups
    .filter((group) => group.slot === undefined || group.slot === 'primary')
    .map((group) => ({
      ...(group.title !== undefined ? { title: group.title } : {}),
      links: group.items.map((item) => footerLink(item, resolve)),
    })),
  secondaryLinks: body.groups
    .filter((group) => group.slot === 'secondary')
    .flatMap((group) => group.items.map((item) => ({ text: item.label, href: resolve(item.target) }))),
  socialLinks: body.groups
    .filter((group) => group.slot === 'social')
    .flatMap((group) => group.items.map((item) => socialLink(item, resolve))),
  ...(body.footNote !== undefined ? { footNote: body.footNote } : {}),
  ...(body.brand?.text !== undefined ? { brand: body.brand.text } : {}),
  ...(body.brand?.descriptor !== undefined ? { descriptor: body.brand.descriptor } : {}),
});
