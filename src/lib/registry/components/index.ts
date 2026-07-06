/**
 * Component registry v1 (T3.2, D§3.5) — the dispatch table the T3.6 renderer
 * (and the admin preview, D§4.4) will use. This file is the ONLY place a
 * section type meets its Astro component; everything else about a type lives
 * in its per-type module (see types.ts for why the binding is centralized:
 * per-type modules stay pure TS so the node test harness can execute them).
 *
 * `shared_ref` is deliberately absent: the renderer dereferences it to the
 * target section's variant BEFORE dispatch (D§3.5), so no component ever
 * sees a reference. Types in the section union without a registry entry
 * (prose, faq, …) fail lookup loudly — they gain entries when a migration
 * needs them, one module + one binding each.
 */
import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

import Bio from '~/components/sections/Bio.astro';
import Checklist from '~/components/sections/Checklist.astro';
import ContentGrid from '~/components/sections/ContentGrid.astro';
import Hero from '~/components/sections/Hero.astro';
import NewsletterSignup from '~/components/sections/NewsletterSignup.astro';

import { bioDefinition } from './bio.js';
import { checklistDefinition } from './checklist.js';
import { contentGridDefinition } from './content-grid.js';
import { heroDefinition } from './hero.js';
import { newsletterSignupDefinition } from './newsletter-signup.js';
import type { SectionComponentDefinition, SectionType } from './types.js';

export type RegisteredComponent = {
  definition: SectionComponentDefinition<SectionType, unknown>;
  component: AstroComponentFactory;
};

const bind = <TType extends SectionType, TResolved>(
  definition: SectionComponentDefinition<TType, TResolved>,
  component: unknown
): RegisteredComponent => ({
  definition: definition as SectionComponentDefinition<SectionType, unknown>,
  component: component as AstroComponentFactory,
});

export const componentRegistry: Partial<Record<SectionType, RegisteredComponent>> = {
  hero: bind(heroDefinition, Hero),
  checklist: bind(checklistDefinition, Checklist),
  content_grid: bind(contentGridDefinition, ContentGrid),
  bio: bind(bioDefinition, Bio),
  newsletter_signup: bind(newsletterSignupDefinition, NewsletterSignup),
};

export const getRegisteredComponent = (type: SectionType): RegisteredComponent => {
  const entry = componentRegistry[type];
  if (!entry) {
    throw new Error(
      `No component registered for section type '${type}' — add its registry module and binding (one of each, T3.2 pattern) before rendering it.`
    );
  }
  return entry;
};
