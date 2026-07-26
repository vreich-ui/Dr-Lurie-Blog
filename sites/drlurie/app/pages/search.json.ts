import { fetchPosts } from '~/utils/blog';

export const prerender = true;

export const GET = async () => {
  const posts = await fetchPosts();

  const searchIndex = posts.map((post) => ({
    title: post.title,
    excerpt: post.excerpt,
    permalink: post.permalink,
    category: post.category?.title,
    tags: post.tags?.map((tag) => tag.title),
    publishDate: post.publishDate,
  }));

  return new Response(JSON.stringify(searchIndex), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
};
