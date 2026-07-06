import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeAssetHashes, normalizeHtml } from '../../scripts/lib/html-normalize.mjs';

test('asset hashes collapse to HASH (single and double segment)', () => {
  assert.equal(
    normalizeAssetHashes('<link href="/_astro/about.CJx0uzRc.css" rel="stylesheet">'),
    '<link href="/_astro/about.HASH.css" rel="stylesheet">'
  );
  assert.equal(
    normalizeAssetHashes('<img src="/_astro/hero.CbOUtso8_jjwzL.webp">'),
    '<img src="/_astro/hero.HASH.webp">'
  );
});

test('two builds differing only in asset hashes normalize identically', () => {
  const a = '<script src="/_astro/page.B1a2C3d4.js"></script>';
  const b = '<script src="/_astro/page.Zz9Yy8Xx.js"></script>';
  assert.equal(normalizeHtml(a), normalizeHtml(b));
});

test('attribute order is normalized', () => {
  assert.equal(
    normalizeHtml('<a href="/x" class="btn" id="y">go</a>'),
    normalizeHtml('<a id="y" class="btn" href="/x">go</a>')
  );
});

test('whitespace runs collapse outside script/style', () => {
  assert.equal(normalizeHtml('<p>hello\n   world</p>'), normalizeHtml('<p>hello world</p>'));
});

test('a one-character text change survives normalization (is caught)', () => {
  assert.notEqual(
    normalizeHtml('<p>Five simple places to begin.</p>'),
    normalizeHtml('<p>Five simple places to begin!</p>')
  );
});

test('attribute VALUES are content — a changed href is caught', () => {
  assert.notEqual(normalizeHtml('<a href="/about">x</a>'), normalizeHtml('<a href="/about-us">x</a>'));
});

test('script bodies are opaque: inner HTML-in-template-literals is preserved verbatim', () => {
  const html = '<script>el.innerHTML = `<div  class="py-8">  ${x}\n</div>`;</script>';
  assert.ok(normalizeHtml(html).includes('`<div  class="py-8">  ${x}\n</div>`'));
});

test('script bodies still get asset-hash normalization', () => {
  const a = '<script>fetch("/_astro/data.Aa1Bb2Cc.js")</script>';
  const b = '<script>fetch("/_astro/data.Dd4Ee5Ff.js")</script>';
  assert.equal(normalizeHtml(a), normalizeHtml(b));
});

test('element order is content — swapped siblings are caught', () => {
  assert.notEqual(normalizeHtml('<ul><li>a</li><li>b</li></ul>'), normalizeHtml('<ul><li>b</li><li>a</li></ul>'));
});

test('comments and doctype pass through untouched', () => {
  const html = '<!DOCTYPE html><!-- keep --><div>x</div>';
  const normalized = normalizeHtml(html);
  assert.ok(normalized.includes('<!DOCTYPE html>'));
  assert.ok(normalized.includes('<!-- keep -->'));
});
