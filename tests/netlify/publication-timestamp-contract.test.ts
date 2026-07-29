import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { workflowStatuses } from '../../packages/core/schema/workflow-contract.js';
import { contentSourceV1Schema } from '../../packages/core/schema/schema-v1.js';

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

  // The two source-scan cases that used to live here pinned the shape of
  // `save_json_blob_publish_by_time` — the single timestamp-publishing MCP
  // tool, and its future/immediate/unpublish branches. That tool was retired
  // on 2026-07-29 with the rest of the legacy pipeline (ruling OQ-W11-6), so
  // the scans have no subject; the schema-level contract above is what
  // outlived it.
});
