/**
 * Shared ResolvePageDeps builder (W6) — the load-and-inject half of section
 * rendering, extracted verbatim from PageObjectRenderer.astro so the listing
 * surfaces (which render object sections AROUND their derived list furniture,
 * not through a whole-page renderer) share one implementation of:
 *
 *   - shared_ref target preloading (sync lookup for the pure resolver),
 *   - the action-href policy (route/asset via getPermalink, external verbatim,
 *     listing → the blog permalink),
 *   - conditional content_grid / content_embed resolvers over fetchPosts().
 *
 * The blog module stays a DYNAMIC import: only pages whose sections actually
 * reference posts pull it into their bundle, so adding this module does not
 * perturb Astro's shared-CSS-chunk naming for post-free pages (the exact
 * concern the original PageObjectRenderer comment records).
 */
import { getEntry } from 'astro:content';

import { parseSharedSectionExport, type ResolvePageDeps } from '../../../lib/renderer/resolve';
import type { NavTarget } from '../../../schema/bodies/navigation-v1';
import type { ContentQuery, SectionInstance } from '../../../schema/bodies/section-v1';
import { getPermalink } from '~/utils/permalinks';
import { buildSiteNavTargetResolver } from '~/utils/site-nav-targets';

/**
 * Rendering context a surface can hand the resolver. `relatedToPostId` is the
 * current content item (the article route passes it) — the anchor a `related`
 * content_grid selects against. Surfaces without one leave it unset and a
 * `related` grid degrades to newest-first.
 */
export type SectionResolveContext = { relatedToPostId?: string };

/**
 * Build the ResolvePageDeps for the given section list. Loads every shared_ref
 * target export up front and the posts feed only when a section (inline or
 * dereferenced) actually needs it.
 */
export const buildSectionResolveDeps = async (
  sections: readonly SectionInstance[],
  context: SectionResolveContext = {}
): Promise<ResolvePageDeps> => {
  const resolveNavTarget = await buildSiteNavTargetResolver();
  const resolveActionHref = (target: NavTarget): string => {
    if (target.kind === 'route' || target.kind === 'asset') return getPermalink(target.href);
    return resolveNavTarget(target);
  };
  // Pre-load every shared_ref target so the pure resolver gets a sync lookup.
  const sharedSectionCache = new Map<string, ReturnType<typeof parseSharedSectionExport>>();
  for (const section of sections) {
    if (section.type !== 'shared_ref') continue;
    const refId = section.data.section;
    if (sharedSectionCache.has(refId)) continue;
    const sectionEntry = await getEntry('sectionObject', refId);
    if (!sectionEntry) {
      throw new Error(
        `section-resolve-deps: shared section export '${refId}' is missing (the site's committed section exports).`
      );
    }
    sharedSectionCache.set(refId, parseSharedSectionExport(sectionEntry.data));
  }

  // content_grid manual/query resolution (T3.9, M-8) and content_embed
  // resolution (D§2.5) both read the published posts: only load them if a
  // section (inline OR dereferenced via shared_ref) actually carries a
  // post-backed grid or an embed. A `cards` grid renders its curated cells
  // from data and needs no posts.
  const isPostBackedContentGrid = (type: string, data: unknown) =>
    type === 'content_grid' && (data as { source: { kind: string } }).source.kind !== 'cards';
  const isProductBackedPreview = (type: string, data: unknown) =>
    type === 'product_preview' && (data as { source: { kind: string } }).source.kind !== 'cards';
  const anySection = (predicate: (type: string, data: unknown) => boolean) =>
    sections.some((section) => predicate(section.type, section.data)) ||
    [...sharedSectionCache.values()].some((target) => predicate(target.type, target.data));
  const needsContentGrid = anySection(isPostBackedContentGrid);
  const needsContentEmbed = anySection((type) => type === 'content_embed');
  const needsProductGrid = anySection(isProductBackedPreview);
  const needsPricingTiers = anySection((type) => type === 'pricing_table');
  let contentGrid: ResolvePageDeps['contentGrid'];
  let resolveContentEmbed: ResolvePageDeps['resolveContentEmbed'];
  if (needsContentGrid || needsContentEmbed) {
    // fetchPosts() is already published-only (published_time <= now) and sorted
    // newest-first — exactly the "published content item" the schema requires.
    const { fetchPosts, rankRelatedPosts, pickRandomPosts } = await import('~/utils/blog');
    const posts = await fetchPosts();
    if (needsContentGrid) {
      const toCard = (post: (typeof posts)[number]) => ({
        id: post.id,
        title: post.title,
        description: post.excerpt,
        href: getPermalink(post.permalink, 'post'),
      });
      const matchesQuery = (post: (typeof posts)[number], query: ContentQuery) => {
        if (query.category && post.category?.slug !== query.category) return false;
        if (query.tags && query.tags.length > 0) {
          const postTagSlugs = new Set((post.tags ?? []).map((tag) => tag.slug));
          if (!query.tags.some((tag) => postTagSlugs.has(tag))) return false;
        }
        return true;
      };
      const newestFirst = (list: typeof posts) =>
        [...list].sort((a, b) => b.publishDate.valueOf() - a.publishDate.valueOf());
      contentGrid = {
        resolveManualItem: (id) => {
          const post = posts.find((candidate) => candidate.id === id);
          return post ? toCard(post) : undefined;
        },
        runQuery: (query, limit) => {
          const filtered = posts.filter((post) => matchesQuery(post, query));
          const sorted =
            query.sort === 'published_time_asc'
              ? [...filtered].sort((a, b) => a.publishDate.valueOf() - b.publishDate.valueOf())
              : newestFirst(filtered);
          return sorted.slice(0, limit).map(toCard);
        },
        // The `related` source (the "other articles" block). Anchored to the
        // surface's current post; every algorithm excludes it. Without an
        // anchor (this grid placed on a non-article page), newest-first.
        runRelated: (algorithm, limit) => {
          const current = context.relatedToPostId
            ? posts.find((candidate) => candidate.id === context.relatedToPostId)
            : undefined;
          if (algorithm === 'random') {
            // Deterministic seeded shuffle — varies per article, never churns
            // the build. Works with or without an anchor (see pickRandomPosts).
            const seed = current ? `related:${current.id}` : 'related:site';
            return pickRandomPosts(posts, current?.slug, seed, limit).map(toCard);
          }
          if (!current || algorithm === 'latest') {
            return newestFirst(posts.filter((post) => post.id !== context.relatedToPostId))
              .slice(0, limit)
              .map(toCard);
          }
          if (algorithm === 'same_category') {
            const inCategory = posts.filter(
              (post) => post.id !== current.id && post.category?.slug === current.category?.slug
            );
            return newestFirst(inCategory).slice(0, limit).map(toCard);
          }
          // tag_similarity — the site's existing related-posts scoring.
          return rankRelatedPosts(posts, current, limit).map(toCard);
        },
        idOf: (card) => card.id,
      };
    }
    if (needsContentEmbed) {
      resolveContentEmbed = (contentItemId) => {
        const post = posts.find((candidate) => candidate.id === contentItemId);
        return post
          ? { title: post.title, href: getPermalink(post.permalink, 'post'), excerpt: post.excerpt }
          : undefined;
      };
    }
  }

  // product_preview manual/query resolution (S2 — the M-8 pattern over
  // product objects). Loaded only when a section actually needs it, same as
  // the posts feed; the product-export module stays a dynamic import for the
  // same shared-CSS-chunk reason as the blog module.
  let productGrid: ResolvePageDeps['productGrid'];
  if (needsProductGrid) {
    const { loadAvailableProducts, productPriceBadge, productRoute } = await import('~/utils/products');
    const products = await loadAvailableProducts();
    const toCard = (product: (typeof products)[number]) => ({
      id: product.id,
      title: product.body.presentation.title,
      ...(product.body.presentation.excerpt !== undefined ? { excerpt: product.body.presentation.excerpt } : {}),
      ...(product.body.presentation.images?.[0] ? { image: product.body.presentation.images[0] } : {}),
      href: getPermalink(productRoute(product.body)),
      priceBadge: productPriceBadge(product.body.commerce),
    });
    productGrid = {
      resolveManualItem: (id) => {
        const product = products.find((candidate) => candidate.id === id);
        return product ? toCard(product) : undefined;
      },
      // v1's one query: every available product, title-sorted (loadAvailableProducts).
      runQuery: (_query, limit) => products.slice(0, limit).map(toCard),
      idOf: (card) => card.id,
    };
  }

  // pricing_table tier resolution (W5): tiers reference products by id and
  // resolve title/badge/availability/href from the SAME commerce data the
  // shop renders — including coming_soon products (shown, not buyable), so
  // the read is loadProductExports, not the availability-filtered catalog.
  let resolvePricingTier: ResolvePageDeps['resolvePricingTier'];
  if (needsPricingTiers) {
    const { loadProductExports, productPriceBadge, productRoute } = await import('~/utils/products');
    const allProducts = await loadProductExports();
    resolvePricingTier = (productId) => {
      const product = allProducts.find((candidate) => candidate.id === productId);
      if (!product) {
        console.warn(
          `[pricing_table] tier product "${productId}" no longer resolves to a committed export and was SKIPPED.`
        );
        return undefined;
      }
      return {
        title: product.body.presentation.title,
        priceBadge: productPriceBadge(product.body.commerce),
        available: product.body.commerce.availability === 'available',
        href: getPermalink(productRoute(product.body)),
      };
    };
  }

  return {
    resolveActionHref,
    resolveSharedSection: (sectionObjectId) => {
      const resolved = sharedSectionCache.get(sectionObjectId);
      if (!resolved) throw new Error(`section-resolve-deps: shared section '${sectionObjectId}' was not preloaded.`);
      return resolved;
    },
    contentGrid,
    resolveContentEmbed,
    productGrid,
    resolvePricingTier,
  };
};
