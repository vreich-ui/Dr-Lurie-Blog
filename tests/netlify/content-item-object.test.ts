/**
 * content_item as a governed object (W7.3, 08-articles-plan §2) — the
 * type-specific surface: variant cloning, the create_variant verb, article
 * validation criteria (taxonomy slugs, slug uniqueness, node structure,
 * rich-text renderability), and the reader-safety projection (the annotation
 * layer is legitimate record data; the leak rule guards the RENDERED surface).
 */
import { test } from 'node:test';
import assert from 'node:assert';

import { buildVariantBody } from '../../src/lib/article-object/variant.js';
import { contentItemBodySchema, type ContentItemBody } from '../../src/schema/bodies/content-item-v1.js';
import {
  checkReaderSafety,
  checkReferenceIntegrity,
  checkRenderability,
  checkStructuralInvariants,
  validateObject,
  summarizeValidation,
  type ObjectValidationContext,
  type ReadinessCriterion,
} from '../../netlify/lib/object-validate.js';
import { handleObjectVerb, type ObjectVerbRequest, type ObjectVerbStore } from '../../netlify/lib/object-verbs.js';
import type { Principal } from '../../src/schema/object-record-v1.js';

const AGENT: Principal = { kind: 'agent', agent_name: 'tester', auth: 'publish_key' };

const articleBody = (): ContentItemBody =>
  contentItemBodySchema.parse({
    slug: 'barrier-myths',
    title: 'Five barrier myths',
    taxonomy: { category: 'skin-science', tags: ['barrier-repair'] },
    nodes: [
      {
        id: 'n_a1',
        kind: 'content',
        public: { title: 'The myth', body: 'Everyone repeats it.' },
        private: { strategy: 'hook', intent: 'persuade' },
      },
      {
        id: 'n_a2',
        kind: 'content',
        public: { body: 'And the fix.' },
        private: { strategy: 'resolution' },
      },
    ],
    claims: {
      claim_list: [{ text: 'The myth is wrong.', node_ids: ['n_a1'], risk: 'low' }],
    },
    scores: [
      { scored_by: 'judge-1', at: '2026-07-12T00:00:00.000Z', framework: 'pas', dimension: 'hook_strength', score: 7 },
    ],
  });

const statusOf = (criteria: ReadinessCriterion[], id: string) =>
  criteria.find((criterion) => criterion.id === id)?.status;

// ─── variant cloning (§2.4) ───────────────────────────────────────────────────

test('buildVariantBody re-mints node ids, re-points claims, sets lineage, drops scores', () => {
  const source = articleBody();
  const variant = buildVariantBody(source, {
    sourceObjectId: 'req_agent_barrier_myths_20260713_01',
    newObjectId: 'req_agent_barrier_myths_variant_20260713_01',
  });

  // Every node id re-minted, still opaque n_*, kinds/annotations carried.
  assert.equal(variant.nodes.length, source.nodes.length);
  for (const [index, node] of variant.nodes.entries()) {
    assert.notEqual(node.id, source.nodes[index].id);
    assert.match(node.id, /^n_[a-z0-9]+$/i);
    assert.deepEqual(node.private, source.nodes[index].private);
  }
  // Claims re-pointed through the same map — the judge substrate survives.
  assert.deepEqual(variant.claims?.claim_list[0].node_ids, [variant.nodes[0].id]);
  // Lineage + fresh slug + unjudged start.
  assert.equal(variant.lineage?.parent_content_id, 'req_agent_barrier_myths_20260713_01');
  assert.equal(variant.slug, 'barrier-myths-variant');
  assert.equal(variant.scores, undefined);
  // Deterministic: same inputs, same body.
  assert.deepEqual(
    buildVariantBody(source, {
      sourceObjectId: 'req_agent_barrier_myths_20260713_01',
      newObjectId: 'req_agent_barrier_myths_variant_20260713_01',
    }),
    variant
  );
  // The variant is itself a valid body.
  contentItemBodySchema.parse(variant);
});

// ─── the create_variant verb ──────────────────────────────────────────────────

const createMemoryStore = () => {
  const blobs = new Map<string, string>();
  const store: ObjectVerbStore = {
    get: async (key: string) => blobs.get(key) ?? null,
    setJSON: async (key: string, value: unknown) => {
      blobs.set(key, JSON.stringify(value));
    },
    list: async (options?: { prefix?: string }) => ({
      blobs: [...blobs.keys()]
        .filter((key) => key.startsWith(options?.prefix ?? ''))
        .map((key) => ({ key, etag: 'e' })),
    }),
    delete: async (key: string) => {
      blobs.delete(key);
    },
  } as unknown as ObjectVerbStore;
  return { store, blobs };
};

const call = (store: ObjectVerbStore, request: ObjectVerbRequest) => handleObjectVerb(store, request, AGENT, {});

test('create_variant clones through the standard create path (verb round-trip)', async () => {
  const { store } = createMemoryStore();
  const created = await call(store, {
    action: 'create',
    object_type: 'content_item',
    site: 'site_drlurie',
    body: articleBody(),
  });
  assert.equal(created.status, 200);
  const sourceId = (created.body as { record: { object_id: string } }).record.object_id;

  const variant = await call(store, {
    action: 'create_variant',
    object_type: 'content_item',
    source_object_id: sourceId,
  });
  assert.equal(variant.status, 200);
  const variantRecord = (variant.body as { record: { object_id: string; body: ContentItemBody }; variant_of: string })
    .record;
  assert.equal((variant.body as { variant_of: string }).variant_of, sourceId);
  assert.equal(variantRecord.body.lineage?.parent_content_id, sourceId);
  assert.notEqual(variantRecord.object_id, sourceId);

  // A second default-slug variant collides — validation names the problem.
  const second = await call(store, {
    action: 'create_variant',
    object_type: 'content_item',
    source_object_id: sourceId,
  });
  assert.equal(second.status, 409); // same minted id (deterministic) — already exists
  const third = await call(store, {
    action: 'create_variant',
    object_type: 'content_item',
    source_object_id: sourceId,
    slug: 'barrier-myths-bab-arc',
    requested_id: 'req_agent_barrier_myths_bab_20260713_01',
  });
  assert.equal(third.status, 200);

  const missing = await call(store, {
    action: 'create_variant',
    object_type: 'content_item',
    source_object_id: 'req_agent_ghost_20260713_01',
  });
  assert.equal(missing.status, 404);
});

test('create_variant slug collision with the source is blocked at validation', async () => {
  const { store } = createMemoryStore();
  const created = await call(store, {
    action: 'create',
    object_type: 'content_item',
    site: 'site_drlurie',
    body: articleBody(),
  });
  const sourceId = (created.body as { record: { object_id: string } }).record.object_id;
  // The production wrapper injects the store-backed context (which scans
  // content_item records + committed post ids); the fake stands in for it.
  const collided = await handleObjectVerb(
    store,
    {
      action: 'create_variant',
      object_type: 'content_item',
      source_object_id: sourceId,
      slug: 'barrier-myths',
      requested_id: 'req_agent_barrier_myths_collide_20260713_01',
    },
    AGENT,
    { validationContext: { isArticleSlugTaken: (slug) => slug === 'barrier-myths' } }
  );
  assert.equal(collided.status, 422);
});

// ─── validation criteria ──────────────────────────────────────────────────────

test('article taxonomy resolves slugs against the registry (aliases follow; ghosts block)', () => {
  const resolveTaxonomyTerm: ObjectValidationContext['resolveTaxonomyTerm'] = (kind, term) => {
    if (kind === 'category' && term === 'skin-science') return { active: true };
    if (kind === 'tag' && term === 'barrier-repair') return { active: true };
    return undefined;
  };
  const clean = checkReferenceIntegrity('content_item', articleBody(), { resolveTaxonomyTerm });
  assert.equal(statusOf(clean, 'references'), 'complete');

  const ghost = { ...articleBody(), taxonomy: { category: 'made-up-category' } };
  const blocked = checkReferenceIntegrity('content_item', ghost, { resolveTaxonomyTerm });
  assert.equal(statusOf(blocked, 'references'), 'missing');

  // Registry-gated: no resolver → not verified, never a false failure.
  const ungated = checkReferenceIntegrity('content_item', ghost, {});
  assert.notEqual(statusOf(ungated, 'references'), 'missing');
});

test('article structure: duplicate node ids, taken slugs, and zero public content nodes at publish', () => {
  const body = articleBody();
  const duplicated = { ...body, nodes: [body.nodes[0], { ...body.nodes[1], id: 'n_a1' }] };
  assert.equal(
    statusOf(checkStructuralInvariants('content_item', 'req_x', duplicated, {}, false), 'article_node_ids'),
    'missing'
  );

  const taken = checkStructuralInvariants('content_item', 'req_x', body, { isArticleSlugTaken: () => true }, false);
  assert.equal(statusOf(taken, 'article_slug'), 'missing');
  const free = checkStructuralInvariants('content_item', 'req_x', body, { isArticleSlugTaken: () => false }, false);
  assert.equal(statusOf(free, 'article_slug'), 'complete');

  const hidden = {
    ...body,
    nodes: body.nodes.map((node) => ({ ...node, visibility: 'internal' as const })),
  };
  assert.equal(
    statusOf(checkStructuralInvariants('content_item', 'req_x', hidden, {}, true), 'article_visible_nodes'),
    'missing'
  );
  assert.equal(
    statusOf(checkStructuralInvariants('content_item', 'req_x', hidden, {}, false), 'article_visible_nodes'),
    'warning'
  );
});

test('article renderability: embeds and non-https links in rich_text bodies are blockers', () => {
  const richBody = (content: unknown[]) => ({
    ...articleBody(),
    nodes: [
      {
        id: 'n_r1',
        kind: 'content' as const,
        public: { body: { nodeType: 'document', data: {}, content } },
      },
    ],
  });

  const paragraph = (text: string, marks: Array<{ type: string }> = []) => ({
    nodeType: 'paragraph',
    data: {},
    content: [{ nodeType: 'text', value: text, marks, data: {} }],
  });

  const fine = checkRenderability('content_item', richBody([paragraph('Hello.')]));
  assert.equal(statusOf(fine, 'render_splitters'), 'complete');

  const withEmbed = checkRenderability(
    'content_item',
    richBody([
      {
        nodeType: 'embedded-asset-block',
        data: { target: { sys: { id: 'image/x/abc.png', type: 'Link', linkType: 'Asset' } } },
        content: [],
      },
    ])
  );
  assert.equal(statusOf(withEmbed, 'render_splitters'), 'missing');

  const withBadLink = checkRenderability(
    'content_item',
    richBody([
      {
        nodeType: 'paragraph',
        data: {},
        content: [
          {
            nodeType: 'hyperlink',
            data: { uri: 'javascript:alert(1)' },
            content: [{ nodeType: 'text', value: 'click', marks: [], data: {} }],
          },
        ],
      },
    ])
  );
  assert.equal(statusOf(withBadLink, 'render_splitters'), 'missing');
});

test('reader safety scans the READER PROJECTION: annotations pass, leaked strategy words block', () => {
  // The annotation layer (private.strategy etc.) is legitimate record data.
  assert.equal(statusOf(checkReaderSafety(articleBody(), 'content_item'), 'reader_safety'), 'complete');

  // A strategy keyword in PUBLIC copy is a leak — blocked.
  const leaking = {
    ...articleBody(),
    nodes: [
      {
        id: 'n_a1',
        kind: 'content' as const,
        public: { body: 'Our agentNotes say buy now.' },
      },
    ],
  };
  assert.equal(statusOf(checkReaderSafety(leaking, 'content_item'), 'reader_safety'), 'missing');
});

test('a full validateObject pass on a clean article is publish-eligible', () => {
  const groups = validateObject(
    { objectType: 'content_item', objectId: 'req_agent_barrier_myths_20260713_01', body: articleBody() },
    { isArticleSlugTaken: () => false, publishIntent: true }
  );
  const summary = summarizeValidation(groups);
  assert.equal(summary.eligible, true, JSON.stringify(summary.blockers));
});

// ─── author field (T9.23a — the T9.23 parity-drive gap) ───────────────────────

test('author is additive-optional: a pre-T9.23a record (no author) still parses', () => {
  const body = articleBody();
  assert.equal('author' in body, false);
  assert.equal(contentItemBodySchema.safeParse(body).success, true);
});

test('author accepts a plain byline up to 120 chars and rejects longer strings', () => {
  const withAuthor = contentItemBodySchema.safeParse({ ...articleBody(), author: 'Dr. Lurie' });
  assert.equal(withAuthor.success, true);
  assert.equal(withAuthor.success && withAuthor.data.author, 'Dr. Lurie');

  const atLimit = contentItemBodySchema.safeParse({ ...articleBody(), author: 'A'.repeat(120) });
  assert.equal(atLimit.success, true);

  const overLimit = contentItemBodySchema.safeParse({ ...articleBody(), author: 'A'.repeat(121) });
  assert.equal(overLimit.success, false);
});

test('author joins the reader-safety projection: a leaked strategy word in it blocks, same as title/deck', () => {
  const clean = checkReaderSafety({ ...articleBody(), author: 'Dr. Lurie' }, 'content_item');
  assert.equal(statusOf(clean, 'reader_safety'), 'complete');

  const leaking = checkReaderSafety({ ...articleBody(), author: 'agentNotes: ghostwritten' }, 'content_item');
  assert.equal(statusOf(leaking, 'reader_safety'), 'missing');
});
