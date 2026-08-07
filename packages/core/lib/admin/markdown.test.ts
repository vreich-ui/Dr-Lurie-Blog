import { describe, it } from 'node:test';
import assert from 'node:assert';

import { safeMarkdownUrl } from './markdown.js';

describe('safeMarkdownUrl', () => {
  it('allows absolute http and https links', () => {
    assert.equal(safeMarkdownUrl('https://example.com/path?q=1'), 'https://example.com/path?q=1');
    assert.equal(safeMarkdownUrl(' HTTP://example.com '), 'HTTP://example.com');
  });

  it('rejects executable, data, mail, and relative targets', () => {
    assert.equal(safeMarkdownUrl('javascript:alert(1)'), '');
    assert.equal(safeMarkdownUrl('data:text/html,<script>alert(1)</script>'), '');
    assert.equal(safeMarkdownUrl('mailto:editor@example.com'), '');
    assert.equal(safeMarkdownUrl('/admin'), '');
  });
});
