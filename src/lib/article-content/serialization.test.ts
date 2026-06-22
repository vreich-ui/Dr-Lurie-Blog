import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  articleBodyToMarkdown,
  normalizeArticleBodyFromLegacy
} from './to-markdown.ts';
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
            public: { title: 'Public Title', body: 'Public Body' }
          }
        ]
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
            visibility: 'hidden'
          },
          {
            id: 'n_internal',
            kind: 'content',
            public: { body: 'Internal Body' },
            visibility: 'internal'
          },
          {
            id: 'n_public',
            kind: 'content',
            public: { body: 'Visible Body' },
            visibility: 'public'
          }
        ]
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
              inputTemplateId: 'prose_section'
            }
          }
        ]
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
                label: 'Partner Content'
              }
            }
          }
        ]
      };
      const md = articleBodyToMarkdown(body);
      assert.ok(md.includes('*Partner Content*'));
      assert.ok(md.includes('Sponsored offer'));
    });

    it('should render media as a markdown image', () => {
      const body: ArticleBodyV1 = {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_media',
            kind: 'content',
            public: {
              title: 'Alt Text',
              media: 'src/assets/images/test.jpg'
            }
          }
        ]
      };
      const md = articleBodyToMarkdown(body);
      assert.ok(md.includes('![Alt Text](~/assets/images/test.jpg)'));
    });
  });

  describe('normalizeArticleBodyFromLegacy', () => {
    it('should normalize legacy markdown into a single public node', () => {
      const markdown = 'Some legacy text';
      const body = normalizeArticleBodyFromLegacy(markdown);
      assert.strictEqual(body.nodes.length, 1);
      assert.strictEqual(body.nodes[0].public.body, markdown);
      assert.strictEqual(body.nodes[0].visibility, 'public');
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
