import { describe, it } from 'node:test';
import assert from 'node:assert';
import { articleBodyV1Schema } from './article-content-v1.ts';

describe('ArticleBodyV1 Schema', () => {
  it('validates a correct article body', () => {
    const validData = {
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'n_12345',
          kind: 'content',
          public: {
            title: 'Hello World',
            body: 'This is a test article.',
          },
          private: {
            strategy: 'hook',
            intent: 'educate',
          },
        },
      ],
    };

    const result = articleBodyV1Schema.safeParse(validData);
    assert.strictEqual(result.success, true);
  });

  it('fails if no nodes are present', () => {
    const invalidData = {
      schema_version: 'article_body.v1',
      nodes: [],
    };

    const result = articleBodyV1Schema.safeParse(invalidData);
    assert.strictEqual(result.success, false);
  });

  it('fails if no nodes have public visibility', () => {
    const invalidData = {
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'n_12345',
          kind: 'content',
          public: { body: 'Hidden content' },
          visibility: 'hidden',
        },
      ],
    };

    const result = articleBodyV1Schema.safeParse(invalidData);
    assert.strictEqual(result.success, false);
  });

  it('fails with forbidden words in node ID', () => {
    const invalidData = {
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'n_cta_button',
          kind: 'action',
          public: { ctaText: 'Click me' },
        },
      ],
    };

    const result = articleBodyV1Schema.safeParse(invalidData);
    assert.strictEqual(result.success, false);
  });
  it('accepts document media nodes with title and contentType', () => {
    const result = articleBodyV1Schema.safeParse({
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'n_document1',
          kind: 'content',
          public: {
            title: 'Document',
            media: {
              type: 'document',
              src: '~/assets/documents/uploads/article/reader-handout.pdf',
              title: 'Reader handout',
              contentType: 'application/pdf',
              caption: 'Download the full handout.',
            },
          },
        },
      ],
    });

    assert.strictEqual(result.success, true);
  });
});
