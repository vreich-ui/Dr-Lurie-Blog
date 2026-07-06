/**
 * HTML normalization for the build-diff harness (T2.0).
 *
 * Two builds of the "same" site are compared only after both sides pass
 * through `normalizeHtml`, which removes exactly the classes of difference
 * that carry no content meaning (04-phased-plan Part 2 point 3):
 *
 *   1. hashed asset names — `/_astro/<name>.<hash>.<ext>` (and the image
 *      service's `<hash>_<hash>` double segment) become `<name>.HASH.<ext>`,
 *      so an unrelated chunk-hash shift never reads as a page change;
 *   2. attribute order — attributes are sorted per tag;
 *   3. whitespace — runs collapse to a single space outside <script>/<style>.
 *
 * <script> and <style> contents are treated as opaque (inline scripts on this
 * site legitimately contain `<div …>` template-literal HTML that a naive tag
 * tokenizer would mangle); only the asset-hash rewrite applies inside them.
 *
 * Anything else — text, tag names, attribute values, element order — is
 * content and is deliberately left alone: a difference there MUST fail the
 * diff. The rules here are the ceiling of allowed variance, not a place to
 * hide inconvenient diffs.
 */

// Astro emits 8-char base64url content hashes; the image service appends a
// second short segment (e.g. `hero.CbOUtso8_jjwzL.webp`). Both collapse to HASH.
const ASTRO_ASSET_RE = /(\/_astro\/[^\s"'()<>]*?)\.([A-Za-z0-9_-]{8,12}(?:_[A-Za-z0-9_-]{1,12})?)\.([A-Za-z0-9]+)/g;

export const normalizeAssetHashes = (html) =>
  html.replace(ASTRO_ASSET_RE, (_m, base, _hash, ext) => `${base}.HASH.${ext}`);

// Attribute grammar: name, optionally =value (double-, single-, or unquoted).
const ATTR_RE = /([^\s"'>/=]+)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;

const sortTagAttributes = (tag) => {
  // Leave closers, comments, doctype, and CDATA alone.
  if (/^<[/!]/.test(tag)) return tag;
  const match = tag.match(/^<([a-zA-Z][^\s/>]*)([\s\S]*?)(\/?)>$/);
  if (!match) return tag;
  const [, name, rawAttrs, selfClose] = match;
  const attrs = [];
  for (const attr of rawAttrs.matchAll(ATTR_RE)) {
    attrs.push(`${attr[1]}${attr[2] ? `=${attr[3]}` : ''}`);
  }
  attrs.sort();
  const attrText = attrs.length ? ` ${attrs.join(' ')}` : '';
  return `<${name}${attrText}${selfClose ? ' /' : ''}>`;
};

const collapseWhitespace = (text) => text.replace(/\s+/g, ' ');

// Split the document into opaque (<script>/<style> elements, comments) and
// normal segments; tags inside opaque segments are never re-tokenized.
const SEGMENT_RE = /(<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->)/gi;
// Within a normal segment: a tag token, or a text run.
const TOKEN_RE = /(<[^>]*>)|([^<]+)/g;

export const normalizeHtml = (html) => {
  const withStableAssets = normalizeAssetHashes(html);
  const out = [];
  const segments = withStableAssets.split(SEGMENT_RE);
  for (const segment of segments) {
    if (segment === undefined || segment === '') continue;
    if (/^<script\b/i.test(segment) || /^<style\b/i.test(segment) || segment.startsWith('<!--')) {
      out.push(segment); // opaque: asset hashes already normalized above
      continue;
    }
    for (const token of segment.matchAll(TOKEN_RE)) {
      if (token[1]) out.push(sortTagAttributes(token[1]));
      else out.push(collapseWhitespace(token[2]));
    }
  }
  return out.join('').trim();
};
