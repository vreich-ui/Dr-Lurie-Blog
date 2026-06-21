import { describe, it } from 'node:test';
import assert from 'node:assert';
import { contentSourceV1Schema } from './schema-v1.ts';
import { getPreferredArticleMarkdownSource, hasStructuredArticleBody } from './article-content-helpers.ts';

describe('Structured Article Extension Integration', () => {
  const structuredInput = {
    record_type: 'content_source',
    schema_version: 'content_source.v1',
    content: {
      title: 'Structured Title',
      article_body: {
        schema_version: 'article_body.v1',
        nodes: [
          {
            id: 'n_1',
            kind: 'content',
            public: {
              body: 'Node 1 body',
            },
          },
          {
            id: 'n_2',
            kind: 'content',
            public: {
              body: 'Node 2 body',
            },
          },
        ],
      },
    },
    publication: {
      publish_payload: {
        slug: 'structured-slug',
        title: 'Structured Title',
        author: 'Author Name',
      },
    },
  };

  it('validates ContentSourceV1 with article_body', () => {
    const result = contentSourceV1Schema.safeParse(structuredInput);
    assert.strictEqual(result.success, true);
  });

  it('identifies structured article body', () => {
    assert.strictEqual(hasStructuredArticleBody(structuredInput as any), true);
  });

  it('extracts preferred markdown source from nodes with highest precedence', () => {
    const inputWithEverything = {
      ...structuredInput,
      publication: {
        publish_payload: {
          ...structuredInput.publication.publish_payload,
          markdown: 'Payload Markdown',
        },
      },
    };

    const preferred = getPreferredArticleMarkdownSource(inputWithEverything as any);
    assert.strictEqual(preferred, 'Node 1 body\n\nNode 2 body');
  });

  it('falls back to payload markdown if no structured body', () => {
    const legacyInput = {
      record_type: 'content_source',
      schema_version: 'content_source.v1',
      publication: {
        publish_payload: {
          slug: 'legacy-slug',
          title: 'Legacy Title',
          author: 'Author Name',
          markdown: 'Legacy Markdown',
        },
      },
    };

    const preferred = getPreferredArticleMarkdownSource(legacyInput as any);
    assert.strictEqual(preferred, 'Legacy Markdown');
  });

  it('falls back to content blocks if nothing else is present', () => {
    const blocksInput = {
      record_type: 'content_source',
      schema_version: 'content_source.v1',
      content: {
        blocks: [
          {
            block_id: 'b1',
            block_type: 'markdown',
            payload: 'Block Markdown',
          },
        ],
      },
    };

    const preferred = getPreferredArticleMarkdownSource(blocksInput as any);
    assert.strictEqual(preferred, 'Block Markdown');
  });
});
