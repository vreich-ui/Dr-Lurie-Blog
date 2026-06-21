import { describe, it } from 'node:test';
import assert from 'node:assert';
import { articleBodyToMarkdown, normalizeArticleBodyFromLegacy } from './to-markdown.ts';
import { assertReaderSafe } from './assert-reader-safe.ts';
import type { ArticleBodyV1 } from '../../schema/article-content-v1.ts';

describe('Article Serialization & Safety', () => {
  const complexArticle: ArticleBodyV1 = {
    schema_version: 'article_body.v1',
    nodes: [
      {
        id: 'n_1',
        kind: 'content',
        public: {
          title: 'Welcome',
          body: 'This is a great article.',
        },
        private: {
          strategy: 'hook',
          agentNotes: 'Make it catchy.',
        },
      },
      {
        id: 'n_2',
        kind: 'content',
        public: {
          title: 'Another Section',
          body: 'Still reading.',
        },
        private: {
          strategy: 'explanation',
        },
      },
      {
        id: 'n_3',
        kind: 'action',
        public: {
          ctaText: 'Buy Now',
          ctaLink: 'https://example.com/buy',
        },
        commercial: {
          type: 'offer',
          disclosure: { required: true, label: 'Partner Offer', mode: 'section' },
          offer: { couponCode: 'SAVE10' },
        },
        rendering: { presentation: 'offerCard' },
      },
      {
        id: 'n_4',
        kind: 'content',
        public: { body: 'Hidden gem' },
        visibility: 'hidden',
      },
    ],
  };

  it('serializes a multi-node body correctly', () => {
    const markdown = articleBodyToMarkdown(complexArticle);

    assert.ok(markdown.includes('### Welcome'));
    assert.ok(markdown.includes('This is a great article.'));
    assert.ok(markdown.includes('### Another Section'));
    assert.ok(markdown.includes('**[Buy Now](https://example.com/buy)**'));
    assert.ok(markdown.includes('Partner Offer'));
    assert.ok(markdown.includes('SAVE10'));
  });

  it('skips hidden nodes', () => {
    const markdown = articleBodyToMarkdown(complexArticle);
    assert.strictEqual(markdown.includes('Hidden gem'), false);
  });

  it('does not include private metadata in markdown', () => {
    const markdown = articleBodyToMarkdown(complexArticle);

    assert.strictEqual(markdown.includes('hook'), false);
    assert.strictEqual(markdown.includes('agentNotes'), false);
    assert.strictEqual(markdown.includes('catchy'), false);
  });

  it('serializes inline offers differently from cards', () => {
    const inlineOffer: ArticleBodyV1 = {
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'n_5',
          kind: 'content',
          public: { body: 'Check this out.' },
          commercial: { offer: { couponCode: 'INLINE5' } },
          rendering: { presentation: 'offerInline' },
        },
      ],
    };

    const markdown = articleBodyToMarkdown(inlineOffer);
    assert.ok(markdown.includes('Use code **INLINE5** to save!'));
    assert.strictEqual(markdown.includes('Offer Details'), false);
  });

  it('assertReaderSafe fails on forbidden keywords', () => {
    assert.throws(() => assertReaderSafe('This is a hook.'), /Reader safety violation/);
    assert.throws(() => assertReaderSafe({ private: { strategy: 'hook' } }), /Reader safety violation/);
  });

  it('assertReaderSafe passes on safe content', () => {
    assert.doesNotThrow(() => assertReaderSafe('This is perfectly safe content.'));
    const safeMarkdown = articleBodyToMarkdown(complexArticle);
    assert.doesNotThrow(() => assertReaderSafe(safeMarkdown));
  });

  it('normalizes legacy markdown correctly', () => {
    const legacyMd = '# Legacy\n\nSome content';
    const normalized = normalizeArticleBodyFromLegacy(legacyMd, 'Legacy Title');

    assert.strictEqual(normalized.nodes.length, 1);
    assert.strictEqual(normalized.nodes[0].public.title, 'Legacy Title');
    assert.strictEqual(normalized.nodes[0].public.body, legacyMd);

    const markdown = articleBodyToMarkdown(normalized);
    assert.ok(markdown.includes('## Legacy Title'));
    assert.ok(markdown.includes('# Legacy'));
  });
});
