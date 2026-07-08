/**
 * Page render resolver (T3.6, D§4.2) — the pure layer between a published
 * Page export and the component registry.
 *
 * It does the three dereferences the registry components deliberately do NOT
 * do themselves (they own only layout, receiving `{data, resolved, ctx}`):
 *
 *   1. shared_ref → the target shared section's own variant. No component ever
 *      sees a `shared_ref`; the renderer swaps it for the inline section the
 *      referenced object wraps (D§3.5).
 *   2. hero action targets → hrefs (HeroResolved.actionHrefs, aligned by
 *      index). The href policy is injected (`resolveActionHref`) so this module
 *      stays free of Astro's permalink helper and is unit-testable offline.
 *   3. page metadata → the Layout's metadata prop. The `home` PageType uses its
 *      title verbatim (ignoreTitleTemplate), matching the audited homepage.
 *
 * Kept pure (no astro:content / Astro imports): the caller (index.astro)
 * performs the async collection loads and injects sync resolvers, so these
 * rules stay testable without a build. `static` content_grid needs no
 * resolution — the component renders it verbatim (transitional); `manual`/
 * `query` sources resolve here (T3.9) via resolve-content-grid.ts (M-8).
 */
import type { NavTarget } from '../../schema/bodies/navigation-v1.js';
import { pageBodySchema, type PageBody } from '../../schema/bodies/page-v1.js';
import { sectionBodySchema, type ContentGridSource } from '../../schema/bodies/section-v1.js';
import type { ContentEmbedCard, ContentGridCard, RenderCtx, SectionType } from '../registry/components/types.js';
import { resolveContentGridCards, type ContentGridResolvers } from './resolve-content-grid.js';

/** A section ready for component-registry dispatch: `{data, resolved, ctx}` plus its stable page key. */
export type RenderableSection = {
  id: string;
  type: SectionType;
  data: unknown;
  resolved: unknown;
  ctx: RenderCtx;
};

/** The Layout `metadata` prop this page renders with. */
export type PageRenderMetadata = {
  title: string;
  description?: string;
  ignoreTitleTemplate?: true;
  openGraph?: { images: Array<{ url: string; width: number; height: number }> };
};

export type ResolvedPage = {
  metadata: PageRenderMetadata;
  sections: RenderableSection[];
};

/** Internal identity for de-duplicating manual picks against fallback-query backfill. */
type ContentGridCardInternal = ContentGridCard & { id: string };

export type ResolvePageDeps = {
  /** Resolve a hero action's target to its href (route/asset via permalink, external verbatim, listing → blog). */
  resolveActionHref: (target: NavTarget) => string;
  /** Dereference a shared_ref target object id to the inline section it wraps. */
  resolveSharedSection: (sectionObjectId: string) => { type: SectionType; data: unknown };
  /**
   * Resolvers for content_grid `manual`/`query` sources (M-8, T3.9). `static`
   * needs none — the component renders it verbatim. Required only when a page
   * actually carries a non-static content_grid section.
   */
  contentGrid?: ContentGridResolvers<ContentGridCardInternal>;
  /**
   * Resolve a content_embed's `contentItem` id to a link card (D§2.5 bridge to
   * the article grammar). Returns undefined for a missing/unpublished item.
   * Required only when a page actually carries a content_embed section.
   */
  resolveContentEmbed?: (contentItemId: string) => ContentEmbedCard | undefined;
};

// The audited homepage OG image is emitted at these fixed dimensions; page.v1
// seo carries only the url, so the renderer supplies the standard card size.
const OG_IMAGE_DIMENSIONS = { width: 1200, height: 630 } as const;

/** Strip the T1.1 `__generated` provenance marker from a derived export. */
const stripGenerated = (data: unknown): unknown => {
  if (!data || typeof data !== 'object') return data;
  const { __generated, ...rest } = data as Record<string, unknown>;
  void __generated;
  return rest;
};

/** Parse a page export (marker stripped) into its validated body. */
export const parsePageExport = (data: unknown): PageBody => pageBodySchema.parse(stripGenerated(data));

/** Parse a shared-section export into the inline `{type, data}` a shared_ref dereferences to. */
export const parseSharedSectionExport = (data: unknown): { type: SectionType; data: unknown } => {
  const body = sectionBodySchema.parse(stripGenerated(data));
  return { type: body.section.type, data: body.section.data };
};

type HeroLikeData = { actions?: Array<{ target: NavTarget }> };
type LinkListLikeData = { links?: Array<{ target: NavTarget }> };
type ProductPreviewLikeData = { products?: Array<{ action?: { target: NavTarget } }> };
type ContentGridLikeData = { source: ContentGridSource; limit: number };

const resolvedFor = (type: SectionType, data: unknown, deps: ResolvePageDeps): unknown => {
  // hero, lede, cta_banner, thank_you and about share the action-hrefs resolved shape.
  if (type === 'hero' || type === 'lede' || type === 'cta_banner' || type === 'thank_you' || type === 'about') {
    return {
      actionHrefs: ((data as HeroLikeData).actions ?? []).map((action) => deps.resolveActionHref(action.target)),
    };
  }
  // link_list resolves its `links` with the same target policy (LinkListResolved).
  if (type === 'link_list') {
    return {
      linkHrefs: ((data as LinkListLikeData).links ?? []).map((link) => deps.resolveActionHref(link.target)),
    };
  }
  // product_preview resolves each product's optional action to an href, aligned
  // by index (undefined where a product carries no action).
  if (type === 'product_preview') {
    return {
      productActionHrefs: ((data as ProductPreviewLikeData).products ?? []).map((product) =>
        product.action ? deps.resolveActionHref(product.action.target) : undefined
      ),
    };
  }
  if (type === 'content_embed') {
    if (!deps.resolveContentEmbed) {
      throw new Error('index: a content_embed section requires resolveContentEmbed to be supplied to resolvePage.');
    }
    return { card: deps.resolveContentEmbed((data as { contentItem: string }).contentItem) };
  }
  if (type === 'content_grid') {
    const gridData = data as ContentGridLikeData;
    // static renders verbatim from data.source.cards — the component needs no
    // resolved data for it (transitional, T3.2, retired on arrival by design).
    if (gridData.source.kind === 'static') return {};
    if (!deps.contentGrid) {
      throw new Error(
        `index: content_grid source kind '${gridData.source.kind}' requires contentGrid resolvers to be supplied to resolvePage.`
      );
    }
    return { cards: resolveContentGridCards(gridData.source, gridData.limit, deps.contentGrid) };
  }
  return {};
};

const renderable = (id: string, type: SectionType, data: unknown, deps: ResolvePageDeps): RenderableSection => ({
  id,
  type,
  data,
  resolved: resolvedFor(type, data, deps),
  ctx: {},
});

export const resolvePageSections = (page: PageBody, deps: ResolvePageDeps): RenderableSection[] =>
  page.sections.map((section) => {
    if (section.type === 'shared_ref') {
      // Render the referenced shared section as its own variant, keyed by the
      // page section id so React-style keys stay stable and unique per page.
      const target = deps.resolveSharedSection(section.data.section);
      return renderable(section.id, target.type, target.data, deps);
    }
    return renderable(section.id, section.type, section.data, deps);
  });

export const resolvePageMetadata = (page: PageBody): PageRenderMetadata => ({
  title: page.title,
  ...(page.seo.description ? { description: page.seo.description } : {}),
  ...(page.pageType === 'home' ? { ignoreTitleTemplate: true as const } : {}),
  ...(page.seo.ogImage ? { openGraph: { images: [{ url: page.seo.ogImage, ...OG_IMAGE_DIMENSIONS }] } } : {}),
});

export const resolvePage = (page: PageBody, deps: ResolvePageDeps): ResolvedPage => ({
  metadata: resolvePageMetadata(page),
  sections: resolvePageSections(page, deps),
});
