import { describe, it } from 'node:test';
import assert from 'node:assert';
import { slugifyTitle, shortIdFromRequestId, generateArticlePath } from './article-path.ts';

// ─── slugifyTitle ─────────────────────────────────────────────────────────────

describe('slugifyTitle', () => {
  it('lowercases and hyphenates words', () => {
    assert.strictEqual(slugifyTitle('Hello World'), 'hello-world');
  });

  it('strips punctuation and special chars', () => {
    assert.strictEqual(slugifyTitle('Dr. Lurie! The Expert.'), 'dr-lurie-the-expert');
  });

  it('strips apostrophes without inserting a gap', () => {
    assert.strictEqual(slugifyTitle("Lurie's Guide"), 'luries-guide');
  });

  it('collapses multiple spaces / underscores to a single hyphen', () => {
    assert.strictEqual(slugifyTitle('A  Double   Space'), 'a-double-space');
    assert.strictEqual(slugifyTitle('A_Under_score'), 'a-under-score');
  });

  it('strips leading and trailing hyphens', () => {
    assert.strictEqual(slugifyTitle('--- hello ---'), 'hello');
  });

  it('returns untitled for empty string', () => {
    assert.strictEqual(slugifyTitle(''), 'untitled');
    assert.strictEqual(slugifyTitle('   '), 'untitled');
  });

  it('returns untitled when only special chars remain', () => {
    assert.strictEqual(slugifyTitle('!!!'), 'untitled');
  });

  it('caps slug at 80 characters', () => {
    const long = 'word '.repeat(25).trim();
    assert.ok(slugifyTitle(long).length <= 80);
  });
});

// ─── shortIdFromRequestId ─────────────────────────────────────────────────────

describe('shortIdFromRequestId', () => {
  it('strips hyphens and takes first 8 alphanumeric chars (lowercase)', () => {
    assert.strictEqual(shortIdFromRequestId('abc-def-123-456'), 'abcdef12');
  });

  it('lowercases uppercase letters', () => {
    assert.strictEqual(shortIdFromRequestId('ABCDEF12'), 'abcdef12');
  });

  it('returns empty string for empty input', () => {
    assert.strictEqual(shortIdFromRequestId(''), '');
  });
});

// ─── generateArticlePath ──────────────────────────────────────────────────────

describe('generateArticlePath', () => {
  it('generates a clean path from the title', () => {
    assert.strictEqual(generateArticlePath('My Article'), 'src/data/post/my-article.md');
  });

  it('does not include ID by default', () => {
    assert.strictEqual(generateArticlePath('My Article', 'abc-def-123'), 'src/data/post/my-article.md');
  });

  it('includes short ID when forceId is true', () => {
    const path = generateArticlePath('My Article', 'abc-def-123', true);
    assert.strictEqual(path, 'src/data/post/my-article-abcdef12.md');
  });

  it('skips ID suffix when requestId is empty and forceId is true', () => {
    assert.strictEqual(generateArticlePath('My Article', '', true), 'src/data/post/my-article.md');
  });

  it('handles a complex title correctly', () => {
    const path = generateArticlePath("Dr. Lurie's Guide to Skin Care!");
    assert.strictEqual(path, 'src/data/post/dr-luries-guide-to-skin-care.md');
  });

  it('always starts with src/data/post/ and ends with .md', () => {
    const path = generateArticlePath('Some Title', 'req-id-001', false);
    assert.ok(path.startsWith('src/data/post/'), 'should start with path prefix');
    assert.ok(path.endsWith('.md'), 'should end with .md');
  });
});
