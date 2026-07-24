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
import '../../../config/policy-bindings.js'; // W11 T11.2: register policy/site-identity providers before core registry defs (bio.ts et al. read getSiteIdentity at module load)
import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

import Bio from '~/components/sections/Bio.astro';
import Checklist from '~/components/sections/Checklist.astro';
import ContactForm from '~/components/sections/ContactForm.astro';
import ContentEmbed from '~/components/sections/ContentEmbed.astro';
import ContentGrid from '~/components/sections/ContentGrid.astro';
import ContentSplit from '~/components/sections/ContentSplit.astro';
import CtaBanner from '~/components/sections/CtaBanner.astro';
import Faq from '~/components/sections/Faq.astro';
import Hero from '~/components/sections/Hero.astro';
import Lede from '~/components/sections/Lede.astro';
import LinkList from '~/components/sections/LinkList.astro';
import NewsletterSignup from '~/components/sections/NewsletterSignup.astro';
import ProductPreview from '~/components/sections/ProductPreview.astro';
import PricingTable from '~/components/sections/PricingTable.astro';
import Prose from '~/components/sections/Prose.astro';
import FormConfirmation from '~/components/sections/FormConfirmation.astro';
import Search from '~/components/sections/Search.astro';
import Steps from '~/components/sections/Steps.astro';
import BrandRow from '~/components/sections/BrandRow.astro';
import ComparisonTable from '~/components/sections/ComparisonTable.astro';
import Media from '~/components/sections/Media.astro';
import Stats from '~/components/sections/Stats.astro';
import Timeline from '~/components/sections/Timeline.astro';
import Testimonial from '~/components/sections/Testimonial.astro';

import { bioDefinition } from '../../../../packages/core/lib/registry/components/bio.js';
import { checklistDefinition } from '../../../../packages/core/lib/registry/components/checklist.js';
import { contactFormDefinition } from '../../../../packages/core/lib/registry/components/contact-form.js';
import { contentEmbedDefinition } from '../../../../packages/core/lib/registry/components/content-embed.js';
import { contentGridDefinition } from '../../../../packages/core/lib/registry/components/content-grid.js';
import { contentSplitDefinition } from '../../../../packages/core/lib/registry/components/content-split.js';
import { ctaBannerDefinition } from '../../../../packages/core/lib/registry/components/cta-banner.js';
import { faqDefinition } from '../../../../packages/core/lib/registry/components/faq.js';
import { heroDefinition } from '../../../../packages/core/lib/registry/components/hero.js';
import { ledeDefinition } from '../../../../packages/core/lib/registry/components/lede.js';
import { linkListDefinition } from '../../../../packages/core/lib/registry/components/link-list.js';
import { newsletterSignupDefinition } from '../../../../packages/core/lib/registry/components/newsletter-signup.js';
import { productPreviewDefinition } from '../../../../packages/core/lib/registry/components/product-preview.js';
import { pricingTableDefinition } from '../../../../packages/core/lib/registry/components/pricing-table.js';
import { proseDefinition } from '../../../../packages/core/lib/registry/components/prose.js';
import { formConfirmationDefinition } from '../../../../packages/core/lib/registry/components/form-confirmation.js';
import { searchDefinition } from '../../../../packages/core/lib/registry/components/search.js';
import { stepsDefinition } from '../../../../packages/core/lib/registry/components/steps.js';
import { brandRowDefinition } from '../../../../packages/core/lib/registry/components/brand-row.js';
import { comparisonTableDefinition } from '../../../../packages/core/lib/registry/components/comparison-table.js';
import { mediaDefinition } from '../../../../packages/core/lib/registry/components/media.js';
import { statsDefinition } from '../../../../packages/core/lib/registry/components/stats.js';
import { timelineDefinition } from '../../../../packages/core/lib/registry/components/timeline.js';
import { testimonialDefinition } from '../../../../packages/core/lib/registry/components/testimonial.js';
import type { RegisteredSectionType } from '../../../../packages/core/lib/registry/components/registered-types.js';
import type {
  SectionComponentDefinition,
  SectionType,
} from '../../../../packages/core/lib/registry/components/types.js';

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

// Typed as a TOTAL record over REGISTERED_SECTION_TYPES: a binding missing from
// (or absent in) the list is a compile error, so the two cannot drift.
export const componentRegistry: Record<RegisteredSectionType, RegisteredComponent> = {
  hero: bind(heroDefinition, Hero),
  lede: bind(ledeDefinition, Lede),
  prose: bind(proseDefinition, Prose),
  checklist: bind(checklistDefinition, Checklist),
  content_grid: bind(contentGridDefinition, ContentGrid),
  bio: bind(bioDefinition, Bio),
  newsletter_signup: bind(newsletterSignupDefinition, NewsletterSignup),
  testimonial: bind(testimonialDefinition, Testimonial),
  cta_banner: bind(ctaBannerDefinition, CtaBanner),
  faq: bind(faqDefinition, Faq),
  link_list: bind(linkListDefinition, LinkList),
  product_preview: bind(productPreviewDefinition, ProductPreview),
  contact_form: bind(contactFormDefinition, ContactForm),
  search: bind(searchDefinition, Search),
  content_embed: bind(contentEmbedDefinition, ContentEmbed),
  form_confirmation: bind(formConfirmationDefinition, FormConfirmation),
  steps: bind(stepsDefinition, Steps),
  media: bind(mediaDefinition, Media),
  brand_row: bind(brandRowDefinition, BrandRow),
  stats: bind(statsDefinition, Stats),
  timeline: bind(timelineDefinition, Timeline),
  comparison_table: bind(comparisonTableDefinition, ComparisonTable),
  content_split: bind(contentSplitDefinition, ContentSplit),
  pricing_table: bind(pricingTableDefinition, PricingTable),
};

export const getRegisteredComponent = (type: SectionType): RegisteredComponent => {
  const entry = (componentRegistry as Partial<Record<SectionType, RegisteredComponent>>)[type];
  if (!entry) {
    throw new Error(
      `No component registered for section type '${type}' — add its registry module and binding (one of each, T3.2 pattern) before rendering it.`
    );
  }
  return entry;
};
