/**
 * The content_item node renderer (W7.3) — the leak rule and the render
 * matrix. The leak rule is the preservation directive's enforcement half:
 * annotations exist so agents can judge/score, and READERS MUST NEVER SEE
 * THEM — the output is grepped for the strategy vocabulary and annotation
 * field names, the same discipline the W7.1 substrate's leak test set.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { renderArticleNodes } from '../../src/lib/article-object/render-nodes.js';
import { contentItemBodySchema, type ContentItemBody } from '../../src/schema/bodies/content-item-v1.js';

// Overrides are plain JSON (the zod parse validates them) — literal strings
// for nodeType/marks don't unify with the enum-pinned output types otherwise.
const article = (overrides: Record<string, unknown> = {}): ContentItemBody =>
  contentItemBodySchema.parse({
    slug: 'barrier-myths',
    title: 'Five barrier myths',
    nodes: [
      {
        id: 'n_a1',
        kind: 'content',
        public: { eyebrow: 'Skin science', title: 'The myth', body: 'First paragraph.\n\nSecond paragraph.' },
        private: { strategy: 'hook', intent: 'persuade', agentNotes: 'Lean into the frustration angle.' },
      },
      {
        id: 'n_a2',
        kind: 'content',
        public: { items: ['One', 'Two'] },
        private: { strategy: 'proof' },
        visibility: 'public',
      },
      {
        id: 'n_a3',
        kind: 'content',
        public: { body: 'Internal working notes block.' },
        visibility: 'internal',
      },
      {
        id: 'n_a4',
        kind: 'action',
        public: { ctaText: 'Start here', ctaLink: '/start-here' },
        private: { strategy: 'recommendation', intent: 'convert' },
      },
    ],
    ...overrides,
  });

test('renders public nodes with canvas identity; internal/hidden nodes never reach HTML', () => {
  const { html } = renderArticleNodes('req_agent_barrier_myths_20260713_01', article());
  assert.match(html, /data-cms-node-id="n_a1"/);
  assert.match(html, /data-cms-node-kind="content"/);
  assert.match(html, /<h2>The myth<\/h2>/);
  assert.match(html, /<p>First paragraph\.<\/p><p>Second paragraph\.<\/p>/);
  assert.match(html, /<ul><li>One<\/li><li>Two<\/li><\/ul>/);
  // The CTA renders as a real site button: not-prose blocks the prose anchor
  // color (text-white must win) and font-sans blocks the serif leak.
  assert.match(html, /class="article-node-cta not-prose"><a class="btn btn-primary font-sans" href="\/start-here"/);
  // never-render-private: the internal node is absent ENTIRELY (no wrapper).
  assert.equal(html.includes('n_a3'), false);
  assert.equal(html.includes('Internal working notes'), false);
});

test('THE LEAK RULE: no strategy vocabulary or annotation field names in the output', () => {
  const { html } = renderArticleNodes('req_agent_barrier_myths_20260713_01', article());
  for (const forbidden of ['hook', 'agitation', 'persuade', 'convert', 'agentNotes', 'private', 'strategy']) {
    assert.equal(
      html.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `rendered HTML must not contain "${forbidden}"`
    );
  }
});

test('plain-text bodies are escaped (typed HTML shows literally, never executes)', () => {
  const { html } = renderArticleNodes(
    'req_x',
    article({
      nodes: [
        {
          id: 'n_b1',
          kind: 'content',
          public: { body: '<script>alert(1)</script> & <b>bold?</b>' },
        },
      ],
    })
  );
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
});

test('rich_text.v1 document bodies render through the W7.1 substrate', () => {
  const { html } = renderArticleNodes(
    'req_x',
    article({
      nodes: [
        {
          id: 'n_b1',
          kind: 'content',
          public: {
            body: {
              nodeType: 'document',
              data: {},
              content: [
                {
                  nodeType: 'paragraph',
                  data: {},
                  content: [
                    { nodeType: 'text', value: 'Bold ', marks: [{ type: 'bold' }], data: {} },
                    { nodeType: 'text', value: 'and plain.', marks: [], data: {} },
                  ],
                },
                {
                  nodeType: 'blockquote',
                  data: {},
                  content: [
                    {
                      nodeType: 'paragraph',
                      data: {},
                      content: [{ nodeType: 'text', value: 'Quoted.', marks: [], data: {} }],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    })
  );
  assert.match(html, /<strong>Bold <\/strong>/);
  assert.match(html, /<blockquote><p>Quoted\.<\/p><\/blockquote>/);
});

test('offer placements render with their disclosure; unsafe hrefs degrade to text', () => {
  const { html } = renderArticleNodes(
    'req_x',
    article({
      nodes: [
        {
          id: 'n_b1',
          kind: 'placement',
          public: {
            title: 'Reader deal',
            body: 'A relevant thing.',
            ctaText: 'Get it',
            ctaLink: 'https://example.com/deal',
          },
          rendering: { presentation: 'offerCard' },
          commercial: { type: 'offer', rel: 'sponsored', disclosure: { required: true, label: 'Partner offer' } },
        },
        {
          id: 'n_b2',
          kind: 'action',
          public: { ctaText: 'Bad link', ctaLink: 'javascript:alert(1)' },
        },
      ],
    })
  );
  assert.match(html, /Partner offer/);
  assert.match(html, /rel="sponsored"/);
  assert.match(html, /article-node-offer/);
  // Unsafe href: the CTA text renders, the link does not.
  assert.equal(html.includes('javascript:'), false);
  assert.match(html, /<strong>Bad link<\/strong>/);
});

test('reading time matches the md pipeline convention (ceil, min 1)', () => {
  const { readingTime } = renderArticleNodes('req_x', article());
  assert.equal(readingTime, 1);
  const words = Array.from({ length: 450 }, (_, index) => `word${index}`).join(' ');
  const { readingTime: longer } = renderArticleNodes(
    'req_x',
    article({ nodes: [{ id: 'n_b1', kind: 'content', public: { body: words } }] })
  );
  assert.equal(longer, 3);
});

// ═══ W7.7: adSlot mockup bank + multi-image blocks ═══════════════════════════

test('a mock adSlot renders its bank unit, honestly labeled; real providers render nothing', () => {
  const withAd = (adSlot: Record<string, unknown>, creativeId?: string) =>
    article({
      nodes: [
        {
          id: 'n_c1',
          kind: 'placement',
          public: {},
          commercial: { type: 'adSlot', source: 'programmatic', ...(creativeId ? { creativeId } : {}), adSlot },
          rendering: { presentation: 'adSlot' },
        },
      ],
    });

  const native = renderArticleNodes('req_x', withAd({ provider: 'mock' })).html;
  assert.match(native, /article-node-ad/);
  assert.match(native, /Sponsored · Golden Hour Botanicals/);
  assert.match(native, /rel="nofollow sponsored"/);

  const leaderboard = renderArticleNodes('req_x', withAd({ provider: 'mock' }, 'mock-leaderboard')).html;
  assert.match(leaderboard, /Advertisement/);
  assert.match(leaderboard, /btn-primary font-sans/);

  const rectangle = renderArticleNodes('req_x', withAd({ provider: 'mock' }, 'mock-rectangle')).html;
  assert.match(rectangle, /w-\[300px\]/);

  // A REAL provider config renders nothing (no runtime — never fake it):
  // the wrapper emits (canvas-addressable), the box does not.
  const real = renderArticleNodes('req_x', withAd({ provider: 'gpt', adUnitPath: '/123/slot' })).html;
  assert.ok(real.includes('data-cms-node-id="n_c1"'));
  assert.equal(real.includes('article-node-ad'), false);

  // Leak rule holds for ad units too.
  for (const forbidden of ['hook', 'agitation', 'agentNotes', 'strategy']) {
    assert.equal(native.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});

test('a multi-image block renders each image in order; empty srcs render nothing', () => {
  const { html } = renderArticleNodes(
    'req_x',
    article({
      nodes: [
        {
          id: 'n_g1',
          kind: 'content',
          public: {
            images: [
              { type: 'image', src: '/img/one.webp', alt: 'One' },
              { type: 'image', src: '', alt: 'Placeholder' },
              { type: 'image', src: '/img/two.webp', alt: 'Two', caption: 'Second' },
            ],
          },
        },
      ],
    })
  );
  const first = html.indexOf('/img/one.webp');
  const second = html.indexOf('/img/two.webp');
  assert.ok(first >= 0 && second > first, 'images render in order');
  assert.match(html, /<figcaption>Second<\/figcaption>/);
  assert.equal(html.includes('Placeholder'), false, 'an empty src renders nothing, not a broken img');
});
