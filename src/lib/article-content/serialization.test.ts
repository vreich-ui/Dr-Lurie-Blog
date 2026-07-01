import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { articleBodyToMarkdown, normalizeArticleBodyFromLegacy } from './to-markdown.ts';
import type { ArticleBodyV1 } from '../../schema/article-content-v1.ts';
import { assertReaderSafe } from './assert-reader-safe.ts';

describe('Article Body Serialization and Safety', () => {
  describe('articleBodyToMarkdown', () => {
    it('should serialize public nodes with default visibility', () => {
      const body: ArticleBodyV1 = {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_1',
            kind: 'content',
            public: { title: 'Public Title', body: 'Public Body' },
          },
        ],
      };
      const md = articleBodyToMarkdown(body);
      assert.ok(md.includes('### Public Title'));
      assert.ok(md.includes('Public Body'));
    });

    it('should skip hidden and internal nodes', () => {
      const body: ArticleBodyV1 = {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_hidden',
            kind: 'content',
            public: { body: 'Hidden Body' },
            visibility: 'hidden',
          },
          {
            id: 'n_internal',
            kind: 'content',
            public: { body: 'Internal Body' },
            visibility: 'internal',
          },
          {
            id: 'n_public',
            kind: 'content',
            public: { body: 'Visible Body' },
            visibility: 'public',
          },
        ],
      };
      const md = articleBodyToMarkdown(body);
      assert.ok(!md.includes('Hidden Body'));
      assert.ok(!md.includes('Internal Body'));
      assert.ok(md.includes('Visible Body'));
    });

    it('should never render private metadata or inputTemplateId', () => {
      const body: ArticleBodyV1 = {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_1',
            kind: 'content',
            public: { body: 'Visible content' },
            private: {
              strategy: 'hook',
              agentNotes: 'Secret strategy',
              inputTemplateId: 'prose_section',
            },
          },
        ],
      };
      const md = articleBodyToMarkdown(body);
      assert.ok(md.includes('Visible content'));
      assert.ok(!md.includes('hook'));
      assert.ok(!md.includes('Secret strategy'));
      assert.ok(!md.includes('prose_section'));
    });

    it('should render visible commercial disclosure when required', () => {
      const body: ArticleBodyV1 = {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_1',
            kind: 'placement',
            public: { body: 'Sponsored offer' },
            commercial: {
              disclosure: {
                required: true,
                label: 'Partner Content',
              },
            },
          },
        ],
      };
      const md = articleBodyToMarkdown(body);
      assert.ok(md.includes('*Partner Content*'));
      assert.ok(md.includes('Sponsored offer'));
    });

    it('should not render media as a markdown image by default', () => {
      const body: ArticleBodyV1 = {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_media',
            kind: 'content',
            public: {
              title: 'Alt Text',
              media: {
                type: 'image',
                src: 'src/assets/images/test.jpg',
              },
            },
          },
        ],
      };
      const md = articleBodyToMarkdown(body);
      assert.ok(!md.includes('![Alt Text](~/assets/images/test.jpg)'));
    });

    it('should render media as a markdown image when placement is inline', () => {
      const body: ArticleBodyV1 = {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_media',
            kind: 'content',
            public: {
              title: 'Node Title',
              media: {
                type: 'image',
                src: 'src/assets/images/test.jpg',
                alt: 'Alt Text',
              },
            },
            rendering: { placement: 'inline' },
          },
        ],
      };
      const md = articleBodyToMarkdown(body);
      assert.ok(md.includes('![Alt Text](~/assets/images/test.jpg)'));
    });

    it('should render structured CTA nodes as HTML pill buttons', () => {
      const body: ArticleBodyV1 = {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_pdf_cta',
            kind: 'content',
            public: {
              ctaText: 'Download PDF',
              ctaLink: `pdf/exact-request/${'a'.repeat(64)}.pdf`,
            },
          },
        ],
      };

      const md = articleBodyToMarkdown(body);
      assert.ok(md.includes('class="not-prose my-7"'));
      assert.ok(md.includes('rounded-full'));
      assert.ok(md.includes(`href="/pdf/exact-request/${'a'.repeat(64)}.pdf"`));
      assert.ok(md.includes('>Download PDF</a>'));
      assert.ok(!md.includes(`[Download PDF](/pdf/exact-request/${'a'.repeat(64)}.pdf)`));
    });

    it('should render full public PDF URLs as normalized public download paths', () => {
      const body: ArticleBodyV1 = {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_pdfurl',
            kind: 'action',
            public: {
              ctaText: 'Download worksheet',
              ctaLink: `https://drluriescience.netlify.app/pdf/exact-request/${'b'.repeat(64)}.pdf`,
            },
          },
        ],
      };

      const md = articleBodyToMarkdown(body);
      assert.ok(md.includes('rounded-full'));
      assert.ok(md.includes(`href="/pdf/exact-request/${'b'.repeat(64)}.pdf"`));
      assert.ok(md.includes('>Download worksheet</a>'));
      assert.ok(!md.includes('https://drluriescience.netlify.app'));
    });

    it('should not convert Markdown links inside node body into buttons', () => {
      const body: ArticleBodyV1 = {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_bodylink',
            kind: 'content',
            public: {
              body: 'Read [the article](https://example.com/article) before downloading.',
            },
          },
        ],
      };

      const md = articleBodyToMarkdown(body);
      assert.ok(md.includes('[the article](https://example.com/article)'));
      assert.ok(!md.includes('rounded-full'));
    });

    it('should render inline document media as a markdown link', () => {
      const body: ArticleBodyV1 = {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_document',
            kind: 'content',
            public: {
              title: 'Node Title',
              media: {
                type: 'document',
                src: 'src/assets/documents/uploads/article/reader-handout.pdf',
                title: 'Reader handout',
                contentType: 'application/pdf',
              },
            },
            rendering: { placement: 'inline' },
          },
        ],
      };
      const md = articleBodyToMarkdown(body);
      assert.ok(md.includes('[Reader handout](~/assets/documents/uploads/article/reader-handout.pdf)'));
      assert.ok(!md.includes('![Reader handout](~/assets/documents/uploads/article/reader-handout.pdf)'));
    });
  });

  describe('normalizeArticleBodyFromLegacy', () => {
    it('should normalize legacy markdown into a single public node', () => {
      const markdown = 'Some legacy text';
      const body = normalizeArticleBodyFromLegacy(markdown);
      assert.strictEqual(body.nodes.length, 1);
      assert.strictEqual(body.nodes[0].public.body, markdown);
      assert.strictEqual(body.nodes[0].visibility, 'public');
      assert.match(body.nodes[0].id, /^n_[a-z0-9]+$/);
    });
  });

  describe('assertReaderSafe', () => {
    it('should catch leakage of private field names', () => {
      const leaked = { title: 'Hello', private: { something: 'bad' } };
      assert.throws(() => assertReaderSafe(leaked), /Found forbidden internal keyword "private"/);
    });

    it('should catch technical metadata keys in markdown strings', () => {
      const leakedMd = 'Some text with strategy: hook leakage';
      assert.throws(() => assertReaderSafe(leakedMd), /Found forbidden internal keyword "strategy"/);
    });

    it('should allow normal words like resolution', () => {
      const safeMd = 'We achieved a high resolution image.';
      assert.doesNotThrow(() => assertReaderSafe(safeMd));
    });
  });
});
