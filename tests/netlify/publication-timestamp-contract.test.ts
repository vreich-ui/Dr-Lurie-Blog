import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { workflowStatuses } from '../../packages/core/schema/workflow-contract.js';
import { contentSourceV1Schema } from '../../packages/core/schema/schema-v1.js';

/**
 * Repo root, anchored to this test file's own compiled location rather than
 * `process.cwd()` — the CI test runner compiles the whole suite to a temp
 * outDir and invokes `node --test` from there, so `process.cwd()` is NOT the
 * repo root at test time. This source-scan test reads the real .ts source
 * (never emitted into outDir), so it must resolve the real repo root.
 */
const findRepoRoot = (startDir: string): string => {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, 'astro.config.ts'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate repo root (no ancestor with astro.config.ts).');
    dir = parent;
  }
};
const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

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
    const source = await readFile(join(REPO_ROOT, 'netlify/functions/mcp.ts'), 'utf8');

    assert.match(source, /save_json_blob_publish_by_time/);
    assert.equal(source.includes('save_json_blob_' + 'mark_' + 'published'), false);
    assert.equal(source.includes('save_json_blob_' + 'publish_' + 'scheduled'), false);
    assert.equal(source.includes('save_json_blob_' + 'update_publication_' + 'status'), false);
    assert.equal(source.includes('save_json_blob_' + 'publish_article_now'), false);
  });

  it('defines future, immediate, and unpublish branches in publish_by_time', async () => {
    const source = await readFile(join(REPO_ROOT, 'netlify/functions/mcp.ts'), 'utf8');

    assert.match(source, /status: isFuturePublish \? 'time_set' : 'published'/);
    assert.match(source, /status: 'unpublished'/);
    assert.match(source, /published_time: null/);
    assert.equal(source.includes('draft' + ': true'), false);
    assert.match(source, /publish_receipt: receipt/);
    assert.match(source, /validateCanonicalArticleBody/);
  });
});
