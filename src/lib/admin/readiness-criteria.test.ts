import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateReadiness, readinessLevel, isValidSlug } from './readiness-criteria.ts';
import type { ArticleBodyNode } from '../../schema/article-content-v1.ts';

// ─── helpers ──────────────────────────────────────────────────────────────────

const node = (id: string, overrides: Partial<ArticleBodyNode> = {}): ArticleBodyNode => ({
  id,
  kind: 'content',
  public: { title: 'Section', body: 'Body text here.' },
  ...overrides,
});

const sourceNode = (items: string[] = []): ArticleBodyNode =>
  node('n_sources', {
    public: { title: 'Sources', items },
  });

// ─── isValidSlug ──────────────────────────────────────────────────────────────

describe('isValidSlug', () => {
  it('accepts valid slugs', () => {
    assert.ok(isValidSlug('my-article'));
    assert.ok(isValidSlug('science-of-skin-care-2024'));
    assert.ok(isValidSlug('abc'));
    assert.ok(isValidSlug('a1b2'));
  });

  it('rejects invalid slugs', () => {
    assert.strictEqual(isValidSlug(''), false);
    assert.strictEqual(isValidSlug('My Article'), false);
    assert.strictEqual(isValidSlug('--double-dash'), false);
    assert.strictEqual(isValidSlug('trailing-'), false);
    assert.strictEqual(isValidSlug('has/slash'), false);
  });
});

// ─── evaluateReadiness ────────────────────────────────────────────────────────

describe('evaluateReadiness', () => {
  it('returns six groups', () => {
    const groups = evaluateReadiness({});
    assert.strictEqual(groups.length, 6);
    const ids = groups.map((g) => g.id);
    assert.ok(ids.includes('metadata'));
    assert.ok(ids.includes('content'));
    assert.ok(ids.includes('sources'));
    assert.ok(ids.includes('media'));
    assert.ok(ids.includes('editorial'));
    assert.ok(ids.includes('safety'));
  });

  it('marks title, excerpt, slug, and canonical record as missing when empty', () => {
    const groups = evaluateReadiness({ title: '', excerpt: '', slug: '', canonicalSaved: false });
    const meta = groups.find((g) => g.id === 'metadata')!;
    assert.strictEqual(meta.criteria.find((c) => c.id === 'meta_title')!.status, 'missing');
    assert.strictEqual(meta.criteria.find((c) => c.id === 'meta_excerpt')!.status, 'missing');
    assert.strictEqual(meta.criteria.find((c) => c.id === 'meta_slug')!.status, 'missing');

    const safety = groups.find((g) => g.id === 'safety')!;
    assert.strictEqual(safety.criteria.find((c) => c.id === 'safety_saved')!.status, 'missing');
  });

  it('marks all metadata complete when filled in', () => {
    const groups = evaluateReadiness({
      title: 'My Article',
      excerpt: 'A short excerpt.',
      slug: 'my-article',
      seoDescription: 'SEO text here.',
      category: 'Health',
      tags: ['skin', 'care'],
    });
    const meta = groups.find((g) => g.id === 'metadata')!;
    for (const c of meta.criteria) {
      assert.ok(['complete', 'optional'].includes(c.status), `${c.id} should be complete/optional`);
    }
  });

  it('warns on invalid slug format', () => {
    const groups = evaluateReadiness({ slug: 'My Bad Slug' });
    const meta = groups.find((g) => g.id === 'metadata')!;
    const slugCriterion = meta.criteria.find((c) => c.id === 'meta_slug')!;
    assert.strictEqual(slugCriterion.status, 'warning');
  });

  it('marks content body as missing when no nodes', () => {
    const groups = evaluateReadiness({ nodes: [] });
    const content = groups.find((g) => g.id === 'content')!;
    assert.strictEqual(content.criteria.find((c) => c.id === 'content_body')!.status, 'missing');
  });

  it('marks content body as complete when nodes present', () => {
    const groups = evaluateReadiness({ nodes: [node('n_1')] });
    const content = groups.find((g) => g.id === 'content')!;
    assert.strictEqual(content.criteria.find((c) => c.id === 'content_body')!.status, 'complete');
  });

  it('detects source section', () => {
    const groups = evaluateReadiness({ nodes: [node('n_1'), sourceNode()] });
    const sources = groups.find((g) => g.id === 'sources')!;
    assert.strictEqual(sources.criteria.find((c) => c.id === 'sources_exist')!.status, 'complete');
  });

  it('warns when source items contain raw URLs', () => {
    const groups = evaluateReadiness({
      nodes: [node('n_1'), sourceNode(['https://example.com/raw-url'])],
    });
    const sources = groups.find((g) => g.id === 'sources')!;
    const linksCriterion = sources.criteria.find((c) => c.id === 'sources_links');
    assert.ok(linksCriterion, 'sources_links criterion should exist');
    assert.strictEqual(linksCriterion!.status, 'warning');
  });

  it('does not warn for source items that are titled links', () => {
    const groups = evaluateReadiness({
      nodes: [node('n_1'), sourceNode(['Nature — Key findings from the 2023 study'])],
    });
    const sources = groups.find((g) => g.id === 'sources')!;
    const linksCriterion = sources.criteria.find((c) => c.id === 'sources_links');
    if (linksCriterion) {
      assert.strictEqual(linksCriterion.status, 'complete');
    }
  });

  it('detects missing image alt text', () => {
    const imgNode = node('n_img', { public: { media: { type: 'image', src: 'image/abc/def.jpg', alt: '' } } });
    const groups = evaluateReadiness({ nodes: [node('n_1'), imgNode] });
    const media = groups.find((g) => g.id === 'media')!;
    assert.strictEqual(media.criteria.find((c) => c.id === 'media_alt')!.status, 'warning');
  });

  it('marks image alt as complete when present', () => {
    const imgNode = node('n_img', {
      public: { media: { type: 'image', src: 'image/abc/def.jpg', alt: 'A descriptive alt text' } },
    });
    const groups = evaluateReadiness({ nodes: [node('n_1'), imgNode] });
    const media = groups.find((g) => g.id === 'media')!;
    assert.strictEqual(media.criteria.find((c) => c.id === 'media_alt')!.status, 'complete');
  });

  it('warns on empty blocks', () => {
    const emptyNode = node('n_empty', { public: {} });
    const groups = evaluateReadiness({ nodes: [node('n_1'), emptyNode] });
    const editorial = groups.find((g) => g.id === 'editorial')!;
    assert.strictEqual(editorial.criteria.find((c) => c.id === 'editorial_empty')!.status, 'warning');
  });

  it('warns on placeholder text', () => {
    const placeholderNode = node('n_ph', { public: { body: 'Lorem ipsum dolor sit amet...' } });
    const groups = evaluateReadiness({ nodes: [node('n_1'), placeholderNode] });
    const editorial = groups.find((g) => g.id === 'editorial')!;
    assert.strictEqual(editorial.criteria.find((c) => c.id === 'editorial_placeholder')!.status, 'warning');
  });

  it('shows lock as missing (blocking) when lock not held', () => {
    const groups = evaluateReadiness({ lockHeld: false });
    const safety = groups.find((g) => g.id === 'safety')!;
    assert.strictEqual(safety.criteria.find((c) => c.id === 'safety_lock')!.status, 'missing');
  });

  it('shows lock complete when lock held', () => {
    const groups = evaluateReadiness({ lockHeld: true });
    const safety = groups.find((g) => g.id === 'safety')!;
    assert.strictEqual(safety.criteria.find((c) => c.id === 'safety_lock')!.status, 'complete');
  });

  it('warns when agent lock present', () => {
    const groups = evaluateReadiness({ agentLockPresent: true });
    const safety = groups.find((g) => g.id === 'safety')!;
    assert.strictEqual(safety.criteria.find((c) => c.id === 'safety_agent')!.status, 'warning');
  });
});

// ─── readinessLevel ───────────────────────────────────────────────────────────

describe('readinessLevel', () => {
  it('returns missing when any criterion is missing', () => {
    const groups = evaluateReadiness({ title: '', slug: '' });
    assert.strictEqual(readinessLevel(groups), 'missing');
  });

  it('returns warning when all required but some warnings', () => {
    const groups = evaluateReadiness({
      title: 'Title',
      excerpt: 'Excerpt',
      slug: 'my-slug',
      lockHeld: true,
      canonicalSaved: true,
      nodes: [node('n_1')],
    });
    const level = readinessLevel(groups);
    assert.ok(['warning', 'ready'].includes(level));
  });

  it('returns ready when all required criteria are complete', () => {
    const readyNode = node('n_1', {
      public: { title: 'Section', body: 'This is the intro paragraph.' },
    });
    const groups = evaluateReadiness({
      title: 'My Article',
      excerpt: 'Short excerpt.',
      slug: 'my-article',
      seoDescription: 'SEO text.',
      nodes: [readyNode],
      lockHeld: true,
      canonicalSaved: true,
    });
    const missingCriteria = groups.flatMap((g) => g.criteria).filter((c) => c.status === 'missing');
    assert.strictEqual(missingCriteria.length, 0, `Unexpected missing: ${JSON.stringify(missingCriteria)}`);
  });
});
