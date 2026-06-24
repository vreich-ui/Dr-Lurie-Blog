import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { workflowStatuses } from '../../src/schema/workflow-contract.js';
import { contentSourceV1Schema } from '../../src/schema/schema-v1.js';

describe('timestamp publication contract', () => {
  it('keeps workflow statuses separate from article publication', () => {
    assert.deepEqual(workflowStatuses, ['pending', 'in_progress', 'completed', 'failed']);
  });

  it('validates publication.v2 with published_time only', () => {
    const result = contentSourceV1Schema.safeParse({
      record_type: 'content_source',
      schema_version: 'content_source.v1',
      content: {
        title: 'Timestamp Contract',
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [{ id: 'n_1', kind: 'content', public: { body: 'Visible body.' } }],
        },
      },
      publication: { schema_version: 'publication.v2', published_time: null },
    });

    assert.equal(result.success, true);
  });

  it('exposes only the timestamp publishing MCP tool', async () => {
    const source = await readFile(join(process.cwd(), 'netlify/functions/mcp.ts'), 'utf8');

    assert.match(source, /save_json_blob_publish_by_time/);
    assert.equal(source.includes('save_json_blob_' + 'mark_' + 'published'), false);
    assert.equal(source.includes('save_json_blob_' + 'publish_' + 'scheduled'), false);
    assert.equal(source.includes('save_json_blob_' + 'update_publication_' + 'status'), false);
    assert.equal(source.includes('save_json_blob_' + 'publish_article_now'), false);
  });

  it('defines future, immediate, and unpublish branches in publish_by_time', async () => {
    const source = await readFile(join(process.cwd(), 'netlify/functions/mcp.ts'), 'utf8');

    assert.match(source, /status: isFuturePublish \? 'time_set' : 'published'/);
    assert.match(source, /status: 'unpublished'/);
    assert.match(source, /published_time: null/);
    assert.equal(source.includes('draft' + ': true'), false);
    assert.match(source, /publish_receipt: receipt/);
    assert.match(source, /validateCanonicalArticleBody/);
  });
});
