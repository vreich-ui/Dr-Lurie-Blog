/**
 * Reader-facing blog routes every generated site needs in order to expose
 * governed content_item records. They stay site-owned so the generic Page
 * catch-all can see and reserve their route families via import.meta.glob.
 */

const article = `---
import type { InferGetStaticPropsType, GetStaticPaths } from 'astro';
import merge from 'lodash.merge';
import type { ImageMetadata } from 'astro';

import Layout from '~/layouts/PageLayout.astro';
import SinglePost from '~/components/blog/SinglePost.astro';
import ToBlogLink from '~/components/blog/ToBlogLink.astro';
import RelatedPosts from '~/components/blog/RelatedPosts.astro';
import ObjectSections from '~/components/cms/ObjectSections.astro';
import { getCanonical, getPermalink } from '~/utils/permalinks';
import { getStaticPathsBlogPost, blogPostRobots } from '~/utils/blog';
import { findImage, isDocumentPath } from '~/utils/images';
import { loadRoutePageObject } from '~/utils/route-page-object';
import type { MetaData } from '~/types';

export const prerender = true;
export const getStaticPaths = (async () => await getStaticPathsBlogPost()) satisfies GetStaticPaths;

type Props = InferGetStaticPropsType<typeof getStaticPaths>;
const { post } = Astro.props as Props;
const url = getCanonical(getPermalink(post.permalink, 'post'));
const image =
  typeof post.image === 'string' && isDocumentPath(post.image)
    ? undefined
    : ((await findImage(post.image)) as ImageMetadata | string | undefined);
const articleObject = await loadRoutePageObject('page_article');
const objectProvidesRelated = (articleObject?.extraSections ?? []).some(
  (section) =>
    section.type === 'content_grid' &&
    (section.data as { source?: { kind?: string } }).source?.kind === 'related' &&
    section.visibility !== 'hidden'
);
const metadata = merge(
  {
    title: post.title,
    description: post.excerpt,
    robots: {
      index: articleObject?.seo.robots?.index ?? blogPostRobots?.index,
      follow: articleObject?.seo.robots?.follow ?? blogPostRobots?.follow,
    },
    openGraph: {
      type: 'article',
      ...(image
        ? { images: [{ url: image, width: (image as ImageMetadata)?.width, height: (image as ImageMetadata)?.height }] }
        : {}),
    },
  },
  { ...(post?.metadata ? { ...post.metadata, canonical: post.metadata?.canonical || url } : {}) }
) as MetaData;
---

<Layout metadata={metadata}>
  <SinglePost post={{ ...post, image: image }} url={url}>
    {post.Content ? <post.Content /> : <Fragment set:html={post.content || ''} />}
  </SinglePost>
  <ToBlogLink />
  {!objectProvidesRelated && <RelatedPosts post={post} />}
  <ObjectSections
    objectId="page_article"
    sections={articleObject?.extraSections ?? []}
    context={{ relatedToPostId: post.id }}
  />
</Layout>
`;

const list = `---
import type { InferGetStaticPropsType, GetStaticPaths } from 'astro';

import Layout from '~/layouts/PageLayout.astro';
import BlogList from '~/components/blog/List.astro';
import Headline from '~/components/blog/Headline.astro';
import Pagination from '~/components/blog/Pagination.astro';
import ObjectSections from '~/components/cms/ObjectSections.astro';
import { blogListRobots, getStaticPathsBlogList } from '~/utils/blog';
import { loadRoutePageObject, routeHeaderAnnotation } from '~/utils/route-page-object';

export const prerender = true;
export const getStaticPaths = (async ({ paginate }) => await getStaticPathsBlogList({ paginate })) satisfies GetStaticPaths;

type Props = InferGetStaticPropsType<typeof getStaticPaths>;
const { page } = Astro.props as Props;
const currentPage = page.currentPage ?? 1;
const listing = await loadRoutePageObject('page_library');
const header = listing?.header ?? { heading: 'Library', paragraphs: ['Browse the published content library.'] };
const baseTitle = listing?.title ?? 'Library';
const headerAnnotation = routeHeaderAnnotation('page_library', listing?.header);
const metadata = {
  title: \`\${baseTitle}\${currentPage > 1 ? \` — Page \${currentPage}\` : ''}\`,
  ...(listing?.seo.description ? { description: listing.seo.description } : {}),
  robots: {
    index: (listing?.seo.robots?.index ?? blogListRobots?.index) && currentPage === 1,
    follow: listing?.seo.robots?.follow ?? blogListRobots?.follow,
  },
  openGraph: { type: 'blog' },
};
---

<Layout metadata={metadata}>
  <section class="px-6 sm:px-6 py-12 sm:py-16 lg:py-20 mx-auto max-w-4xl">
    <div style="display:contents" {...headerAnnotation}>
      {header.kicker && <p class="mb-4 text-center text-sm font-semibold uppercase tracking-[0.18em] text-accent">{header.kicker}</p>}
      <Headline subtitle={header.paragraphs.join(' ')}>{header.heading}</Headline>
    </div>
    <BlogList posts={page.data} />
    <Pagination prevUrl={page.url.prev} nextUrl={page.url.next} />
  </section>
  <ObjectSections objectId="page_library" sections={listing?.extraSections ?? []} />
</Layout>
`;

const termRoute = ({ kind, titlePrefix, objectId, robotsExport, pathsExport }) => `---
import type { InferGetStaticPropsType, GetStaticPaths } from 'astro';

import Layout from '~/layouts/PageLayout.astro';
import BlogList from '~/components/blog/List.astro';
import Headline from '~/components/blog/Headline.astro';
import Pagination from '~/components/blog/Pagination.astro';
import ObjectSections from '~/components/cms/ObjectSections.astro';
import { ${robotsExport}, ${pathsExport} } from '~/utils/blog';
import { loadRoutePageObject, routeHeaderAnnotation, type RoutePageHeader } from '~/utils/route-page-object';

export const prerender = true;
export const getStaticPaths = (async ({ paginate }) => await ${pathsExport}({ paginate })) satisfies GetStaticPaths;

type Props = InferGetStaticPropsType<typeof getStaticPaths> & { ${kind}: { title: string } };
const { page, ${kind} } = Astro.props as Props;
const currentPage = page.currentPage ?? 1;
const listing = await loadRoutePageObject('${objectId}', ${kind}.title);
const header: RoutePageHeader = listing?.header ?? { heading: '${titlePrefix}' + ${kind}.title, paragraphs: [] };
const baseTitle = listing?.title ?? '${titlePrefix}' + ${kind}.title;
const headerAnnotation = routeHeaderAnnotation('${objectId}', listing?.header);
const metadata = {
  title: \`\${baseTitle}\${currentPage > 1 ? \` — Page \${currentPage}\` : ''}\`,
  ...(listing?.seo.description ? { description: listing.seo.description } : {}),
  robots: {
    index: listing?.seo.robots?.index ?? ${robotsExport}?.index,
    follow: listing?.seo.robots?.follow ?? ${robotsExport}?.follow,
  },
};
---

<Layout metadata={metadata}>
  <section class="px-4 md:px-6 py-12 sm:py-16 lg:py-20 mx-auto max-w-4xl">
    <div style="display:contents" {...headerAnnotation}>
      {header.kicker && <p class="mb-4 text-center text-sm font-semibold uppercase tracking-[0.18em] text-accent">{header.kicker}</p>}
      <Headline subtitle={header.paragraphs.join(' ')}>{header.heading}</Headline>
    </div>
    <BlogList posts={page.data} />
    <Pagination prevUrl={page.url.prev} nextUrl={page.url.next} />
  </section>
  <ObjectSections objectId="${objectId}" sections={listing?.extraSections ?? []} />
</Layout>
`;

export const siteReaderRouteTemplates = () => [
  { path: '[...blog]/index.astro', content: article },
  { path: '[...blog]/[...page].astro', content: list },
  {
    path: '[...blog]/[category]/[...page].astro',
    content: termRoute({
      kind: 'category',
      titlePrefix: 'Category: ',
      objectId: 'page_category',
      robotsExport: 'blogCategoryRobots',
      pathsExport: 'getStaticPathsBlogCategory',
    }),
  },
  {
    path: '[...blog]/[tag]/[...page].astro',
    content: termRoute({
      kind: 'tag',
      titlePrefix: 'Tag: ',
      objectId: 'page_tag',
      robotsExport: 'blogTagRobots',
      pathsExport: 'getStaticPathsBlogTag',
    }),
  },
];
