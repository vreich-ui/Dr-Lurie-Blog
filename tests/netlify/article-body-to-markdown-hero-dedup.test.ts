import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { articleBodyToMarkdown } from '../../src/lib/article-content/to-markdown.js';

// Regression: a hero/featured node (id === 'n_hero' OR rendering.presentation === 'hero')
// with rendering.placement === 'inline' must NOT produce an ![]() embed in the body markdown,
// because the page template renders it in the hero slot via the image: frontmatter field.
// Emitting it in both places caused the same image to appear twice on the published page.
describe('articleBodyToMarkdown hero-dedup', () => {
  const heroImagePath = '~/assets/images/uploads/test-article/hero.png';
  const inlineImagePath = '~/assets/images/uploads/test-article/inline.png';

  it('suppresses ![]() for a node with id === "n_hero" even when placement === "inline"', () => {
    const body = {
      schema_version: 'article_body.v1' as const,
      nodes: [
        {
          id: 'n_hero',
          kind: 'content' as const,
          public: {
            title: 'Hero Title',
            media: { type: 'image' as const, src: heroImagePath, alt: 'Hero alt text' },
          },
          rendering: { placement: 'inline' as const },
        },
      ],
    };

    const md = articleBodyToMarkdown(body);
    assert.ok(!md.includes(`![`), `n_hero node must not emit an ![]() embed; got:\n${md}`);
    assert.ok(!md.includes(heroImagePath), `hero image path must not appear in body markdown; got:\n${md}`);
  });

  it('suppresses ![]() for a node with rendering.presentation === "hero" even when placement === "inline"', () => {
    // Cast to unknown first since 'hero' is not in the presentation enum but may appear at runtime.
    const body = {
      schema_version: 'article_body.v1' as const,
      nodes: [
        {
          id: 'n_featured',
          kind: 'content' as const,
          public: {
            title: 'Featured Title',
            media: { type: 'image' as const, src: heroImagePath, alt: 'Featured alt' },
          },
          rendering: { presentation: 'hero' as unknown as 'section', placement: 'inline' as const },
        },
      ],
    };

    const md = articleBodyToMarkdown(body);
    assert.ok(!md.includes(`![`), `presentation=hero node must not emit an ![]() embed; got:\n${md}`);
    assert.ok(!md.includes(heroImagePath), `hero image path must not appear in body markdown; got:\n${md}`);
  });

  it('still renders ![]() for a non-hero inline image node', () => {
    const body = {
      schema_version: 'article_body.v1' as const,
      nodes: [
        {
          id: 'n_inline',
          kind: 'content' as const,
          public: {
            title: 'Inline Image',
            media: { type: 'image' as const, src: inlineImagePath, alt: 'Inline alt' },
          },
          rendering: { placement: 'inline' as const },
        },
      ],
    };

    const md = articleBodyToMarkdown(body);
    assert.ok(md.includes(`![Inline alt](${inlineImagePath})`), `inline image must appear in body; got:\n${md}`);
  });

  it('renders hero title but not hero image when article has both a hero node and an inline node', () => {
    const body = {
      schema_version: 'article_body.v1' as const,
      nodes: [
        {
          id: 'n_hero',
          kind: 'content' as const,
          public: {
            title: 'Hero Title',
            media: { type: 'image' as const, src: heroImagePath, alt: 'Hero alt' },
          },
          rendering: { placement: 'inline' as const },
        },
        {
          id: 'n_body',
          kind: 'content' as const,
          public: {
            title: 'Section',
            media: { type: 'image' as const, src: inlineImagePath, alt: 'Inline alt' },
          },
          rendering: { placement: 'inline' as const },
        },
      ],
    };

    const md = articleBodyToMarkdown(body);

    // Hero image must NOT be in body
    assert.ok(!md.includes(heroImagePath), `hero image must not appear in body markdown; got:\n${md}`);
    // Hero title SHOULD be in body
    assert.ok(md.includes('Hero Title'), `hero node title must still appear in body; got:\n${md}`);
    // Inline image SHOULD be in body
    assert.ok(
      md.includes(`![Inline alt](${inlineImagePath})`),
      `inline image must still appear in body; got:\n${md}`
    );
  });
});
