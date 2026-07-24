/**
 * The node palette (W7.7) — every starter must be a COMPLETE, schema-valid
 * content_item node once the server mints its id, so a quick-add can never
 * 422 mid-edit (the sections-palette discipline). Commercial starters must
 * carry disclosure; the ad starter must be pinned to the mock provider.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { NODE_PALETTE, nodePaletteEntry, MOCK_AD_CREATIVES } from '../../packages/core/lib/edit-mode/nodes-palette.js';
import { contentItemNodeSchema } from '../../packages/core/schema/bodies/content-item-v1.js';
import { renderArticleNodes } from '../../packages/core/lib/article-object/render-nodes.js';
import type { ContentItemBody } from '../../packages/core/schema/bodies/content-item-v1.js';

test('every palette starter parses as a valid node once an id is minted', () => {
  for (const entry of NODE_PALETTE) {
    assert.equal('id' in entry.node, false, `${entry.key}: starters must omit the id (server-minted)`);
    const parsed = contentItemNodeSchema.safeParse({ ...entry.node, id: 'n_0probe' });
    assert.ok(parsed.success, `${entry.key}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
  }
});

test('every starter carries the semantic annotation from birth', () => {
  for (const entry of NODE_PALETTE) {
    const priv = entry.node.private as { strategy?: string; intent?: string } | undefined;
    assert.ok(priv?.strategy, `${entry.key}: starter must declare a strategy`);
    assert.ok(priv?.intent, `${entry.key}: starter must declare an intent`);
  }
});

test('commercial starters are disclosed and the ad slot is mock-pinned', () => {
  type CommercialNode = {
    commercial: {
      disclosure?: { required: boolean };
      rel?: string;
      adSlot?: { provider: string };
      creativeId?: string;
    };
  };
  const offer = nodePaletteEntry('offer')?.node as unknown as CommercialNode;
  assert.equal(offer.commercial.disclosure?.required, true);
  assert.equal(offer.commercial.rel, 'nofollow sponsored');

  const ad = nodePaletteEntry('ad')?.node as unknown as CommercialNode;
  assert.equal(ad.commercial.adSlot?.provider, 'mock');
  assert.ok((MOCK_AD_CREATIVES as readonly string[]).includes(ad.commercial.creativeId ?? ''));
});

test('every starter RENDERS without throwing (empty-src images legally render nothing)', () => {
  const body: ContentItemBody = {
    slug: 'palette-probe',
    title: 'Palette probe',
    nodes: NODE_PALETTE.map((entry, index) => contentItemNodeSchema.parse({ ...entry.node, id: `n_p${index}` })),
  };
  const { html } = renderArticleNodes('req_agent_palette_probe_20260713_01', body);
  // Every node emits its canvas wrapper even when its content is empty.
  for (let index = 0; index < NODE_PALETTE.length; index += 1) {
    assert.ok(html.includes(`data-cms-node-id="n_p${index}"`), `${NODE_PALETTE[index].key} wrapper missing`);
  }
  // The mock ad unit renders honestly labeled.
  assert.match(html, /article-node-ad/);
  assert.match(html, /Sponsored · Golden Hour Botanicals/);
});
