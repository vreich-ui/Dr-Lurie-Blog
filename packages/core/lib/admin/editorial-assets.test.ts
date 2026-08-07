import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  artifactsByFamily,
  classifyMediaFamily,
  projectEditorialArtifact,
  projectPdfTemplate,
} from './editorial-assets.js';

describe('editorial asset projection', () => {
  it('projects only safe PDF-template summary fields', () => {
    const projected = projectPdfTemplate({
      templateId: 'tpl_evidence_guide',
      latestVersion: 3,
      latestActiveVersion: 2,
      status: 'active',
      renderer: 'pdfme',
      createdAt: '2026-08-07T10:00:00.000Z',
      storage: { token: 'never-expose', stores: { templates: 'pdf-templates' } },
      templateJson: { private: true },
    });
    assert.deepStrictEqual(projected, {
      id: 'tpl_evidence_guide',
      label: 'Evidence Guide',
      status: 'active',
      renderer: 'pdfme',
      version: 3,
      active_version: 2,
      created_at: '2026-08-07T10:00:00.000Z',
    });
    assert.doesNotMatch(JSON.stringify(projected), /never-expose|pdf-templates|templateJson/);
  });

  it('projects an artifact to an authenticated preview without leaking raw metadata', () => {
    const sha = 'a'.repeat(64);
    const projected = projectEditorialArtifact({
      blobKey: `pdf/req_evidence/${sha}.pdf`,
      sha256: sha,
      contentType: 'application/pdf',
      sizeBytes: 1200,
      createdAtISO: '2026-08-07T10:00:00.000Z',
      artifactKind: 'pdf',
      originalFilename: 'evidence-guide.pdf',
      label: 'Evidence guide',
      tags: ['guide'],
      metadata: {
        templateId: 'tpl_evidence_guide',
        pageCount: 4,
        renderDataRef: { storeName: 'pdf-render-data', blobKey: 'secret-internal-ref' },
      },
    });
    assert.equal(projected?.family, 'documents');
    assert.equal(projected?.template_id, 'tpl_evidence_guide');
    assert.equal(projected?.page_count, 4);
    assert.match(projected?.preview_url ?? '', /admin-get-blob-pdf/);
    assert.doesNotMatch(JSON.stringify(projected), /pdf-render-data|secret-internal-ref/);
  });
});

describe('media grouping', () => {
  it('groups recognized visual roles and uses editorial as the calm fallback', () => {
    assert.equal(classifyMediaFamily({ kind: 'image', filename: 'brand-wordmark.svg' }), 'logos');
    assert.equal(classifyMediaFamily({ kind: 'image', tags: ['sku', 'product'] }), 'product');
    assert.equal(classifyMediaFamily({ kind: 'image', label: 'Routine diagram' }), 'illustrations');
    assert.equal(classifyMediaFamily({ kind: 'image', label: 'Morning portrait' }), 'editorial');
    assert.equal(classifyMediaFamily({ kind: 'pdf', label: 'Guide' }), 'documents');
  });

  it('returns every stable family with honest counts, including empty groups', () => {
    const sha = 'b'.repeat(64);
    const artifact = projectEditorialArtifact({
      blobKey: `image/req_product/${sha}.webp`,
      sha256: sha,
      contentType: 'image/webp',
      sizeBytes: 500,
      createdAtISO: '2026-08-07T10:00:00.000Z',
      artifactKind: 'image',
      label: 'Serum product portrait',
      tags: ['product'],
    });
    assert.ok(artifact);
    const grouped = artifactsByFamily([artifact]);
    assert.equal(grouped.product.length, 1);
    assert.equal(grouped.logos.length, 0);
    assert.equal(grouped.documents.length, 0);
  });
});
