/**
 * Site-bound NavTarget resolver.
 *
 * `navigation-data.ts` stays pure; this is the Astro/content-collection half
 * that makes page-kind targets renderable. The object validator already
 * requires page targets in every published renderable object to reference
 * published Page records. Loading the committed Page exports here closes the
 * last gap between that accepted object shape and what a production build can
 * resolve.
 */
import { getCollection } from 'astro:content';

import { parsePageExport } from '../../lib/renderer/resolve';
import { createNavTargetResolver, type NavTargetResolver } from './navigation-data';
import { getBlogPermalink } from './permalinks';

export const buildSiteNavTargetResolver = async (): Promise<NavTargetResolver> => {
  const pageRoutes = new Map<string, string>();
  for (const entry of await getCollection('pageObject')) {
    pageRoutes.set(entry.id, parsePageExport(entry.data).route);
  }

  return createNavTargetResolver({
    blogPermalink: getBlogPermalink(),
    resolvePage: (pageId) => pageRoutes.get(pageId),
  });
};
