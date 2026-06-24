import { describe, it } from 'node:test';
import assert from 'node:assert';
import { contentSourceV1Schema, type ContentSourceV1 } from './schema-v1.ts';
import { getPreferredArticleMarkdownSource, hasStructuredArticleBody } from './article-content-helpers.ts';

describe('Structured Article Extension Integration', () => {
  const structuredInput: ContentSourceV1 = {
    record_type: 'content_source',
    schema_version: 'content_source.v1',
    content: {
      title: 'Structured Title',
      article_body: {
        schema_version: 'article_body.v1',
        nodes: [
          { id: 'n_1', kind: 'content', public: { body: 'Node 1 body' } },
          { id: 'n_2', kind: 'content', public: { body: 'Node 2 body' } },
        ],
      },
    },
    publication: {
      schema_version: 'publication.v2',
      published_time: null,
    },
  };

  it('validates ContentSourceV1 with article_body and publication.v2', () => {
    const result = contentSourceV1Schema.safeParse(structuredInput);
    assert.strictEqual(result.success, true);
  });

  it('identifies structured article body', () => {
    assert.strictEqual(hasStructuredArticleBody(structuredInput), true);
  });

  it('extracts markdown only from canonical article_body nodes', () => {
    const preferred = getPreferredArticleMarkdownSource(structuredInput);
    assert.strictEqual(preferred, 'Node 1 body\n\nNode 2 body');
  });

  it('does not fall back to legacy markdown body locations', () => {
    const legacyInput: ContentSourceV1 = {
      record_type: 'content_source',
      schema_version: 'content_source.v1',
      content: {
        blocks: [{ block_id: 'b1', block_type: 'markdown', payload: 'Block Markdown' }],
      },
    };

    const preferred = getPreferredArticleMarkdownSource(legacyInput);
    assert.strictEqual(preferred, undefined);
  });
});
