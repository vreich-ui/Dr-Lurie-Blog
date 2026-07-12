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

import { parseSharedSectionExport, type ResolvePageDeps } from '~/lib/renderer/resolve';
import type { NavTarget } from '~/schema/bodies/navigation-v1';
import type { ContentQuery, SectionInstance } from '~/schema/bodies/section-v1';
import { getBlogPermalink, getPermalink } from '~/utils/permalinks';

const resolveActionHref = (target: NavTarget): string => {
  switch (target.kind) {
    case 'route':
    case 'asset':
      return getPermalink(target.href);
    case 'external':
      return target.href;
    case 'listing':
      return getBlogPermalink();
    default:
      throw new Error(
        `section-resolve-deps: action target kind '${target.kind}' is not resolvable on a page body yet.`
      );
  }
};

/**
 * Build the ResolvePageDeps for the given section list. Loads every shared_ref
 * target export up front and the posts feed only when a section (inline or
 * dereferenced) actually needs it.
 */
export const buildSectionResolveDeps = async (sections: readonly SectionInstance[]): Promise<ResolvePageDeps> => {
  // Pre-load every shared_ref target so the pure resolver gets a sync lookup.
  const sharedSectionCache = new Map<string, ReturnType<typeof parseSharedSectionExport>>();
  for (const section of sections) {
    if (section.type !== 'shared_ref') continue;
    const refId = section.data.section;
    if (sharedSectionCache.has(refId)) continue;
    const sectionEntry = await getEntry('sectionObject', refId);
    if (!sectionEntry) {
      throw new Error(
        `section-resolve-deps: shared section export '${refId}' is missing (src/data/site/sections/${refId}.json).`
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
  let contentGrid: ResolvePageDeps['contentGrid'];
  let resolveContentEmbed: ResolvePageDeps['resolveContentEmbed'];
  if (needsContentGrid || needsContentEmbed) {
    // fetchPosts() is already published-only (published_time <= now) and sorted
    // newest-first — exactly the "published content item" the schema requires.
    const { fetchPosts } = await import('~/utils/blog');
    const posts = await fetchPosts();
    if (needsContentGrid) {
      const toCard = (post: (typeof posts)[number]) => ({ id: post.id, title: post.title, description: post.excerpt });
      const matchesQuery = (post: (typeof posts)[number], query: ContentQuery) => {
        if (query.category && post.category?.slug !== query.category) return false;
        if (query.tags && query.tags.length > 0) {
          const postTagSlugs = new Set((post.tags ?? []).map((tag) => tag.slug));
          if (!query.tags.some((tag) => postTagSlugs.has(tag))) return false;
        }
        return true;
      };
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
              : [...filtered].sort((a, b) => b.publishDate.valueOf() - a.publishDate.valueOf());
          return sorted.slice(0, limit).map(toCard);
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
  };
};
