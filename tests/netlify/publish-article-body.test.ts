import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPreferredArticleMarkdownSource } from '../../src/schema/article-content-helpers.js';
import type { ContentSourceV1 } from '../../src/schema/schema-v1.js';

describe('Publish Precedence and Content Resolution', () => {
  it('should prefer article_body.nodes over all other sources', () => {
    const input: ContentSourceV1 = {
      record_type: 'content_source',
      schema_version: 'content_source.v1',
      content: {
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_1',
              kind: 'content',
              public: { body: 'Structured Content' },
              visibility: 'public'
            }
          ]
        }
      },
      publication: {
        publish_payload: {
          slug: 'test',
          title: 'Test',
          markdown: 'Payload Markdown'
        }
      },
      editorial: {
        draft_markdown: 'Editorial Markdown'
      }
    };

    const resolved = getPreferredArticleMarkdownSource(input);
    assert.strictEqual(resolved, 'Structured Content');
  });

  it('should fall back to publish_payload.markdown if article_body is missing', () => {
    const input: ContentSourceV1 = {
      record_type: 'content_source',
      schema_version: 'content_source.v1',
      publication: {
        publish_payload: {
          slug: 'test',
          title: 'Test',
          markdown: 'Payload Markdown'
        }
      },
      editorial: {
        draft_markdown: 'Editorial Markdown'
      }
    };

    const resolved = getPreferredArticleMarkdownSource(input);
    assert.strictEqual(resolved, 'Payload Markdown');
  });

  it('should never include node.private in resolved markdown', () => {
    const input: ContentSourceV1 = {
      record_type: 'content_source',
      schema_version: 'content_source.v1',
      content: {
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_1',
              kind: 'content',
              public: { body: 'Public Content' },
              private: { strategy: 'hook', agentNotes: 'Internal Note' },
              visibility: 'public'
            }
          ]
        }
      }
    };

    const resolved = getPreferredArticleMarkdownSource(input);
    assert.ok(resolved?.includes('Public Content'));
    assert.ok(!resolved?.includes('hook'));
    assert.ok(!resolved?.includes('Internal Note'));
  });

  it('should support legacy articles with only draft_markdown', () => {
    const input: ContentSourceV1 = {
      record_type: 'content_source',
      schema_version: 'content_source.v1',
      editorial: {
        draft_markdown: 'Legacy Editorial Content'
      }
    };

    const resolved = getPreferredArticleMarkdownSource(input);
    assert.strictEqual(resolved, 'Legacy Editorial Content');
  });

  it('should concatenate multiple public nodes', () => {
    const input: ContentSourceV1 = {
      record_type: 'content_source',
      schema_version: 'content_source.v1',
      content: {
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [
            {
              id: 'n_1',
              kind: 'content',
              public: { body: 'First' },
              visibility: 'public'
            },
            {
              id: 'n_2',
              kind: 'content',
              public: { body: 'Second' },
              visibility: 'public'
            }
          ]
        }
      }
    };

    const resolved = getPreferredArticleMarkdownSource(input);
    assert.strictEqual(resolved, 'First\n\nSecond');
  });
});
