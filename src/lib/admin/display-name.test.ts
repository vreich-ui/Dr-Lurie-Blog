import { describe, it } from 'node:test';
import assert from 'node:assert';

import { objectDisplayName, objectTypeLabel, deSlug, principalName, verbToPhrase, idTooltip } from './display-name.js';
import type { ObjectType } from '../../schema/object-record-v1.js';

/**
 * Fixtures mirror the real seed bodies under src/data/site/* (values copied
 * verbatim from disk on 2026-07-17) so the derivation is tested against the
 * shapes it will actually see, not invented ones.
 */
const fixture = (object_type: ObjectType, object_id: string, body: unknown) => ({ object_type, object_id, body });

describe('objectDisplayName — all ten object types', () => {
  it('page → body.title', () => {
    assert.strictEqual(
      objectDisplayName(fixture('page', 'page_404', { title: 'Page Not Found', route: '/404' })),
      'Page Not Found'
    );
  });

  it('page → de-slugged route when title missing', () => {
    assert.strictEqual(objectDisplayName(fixture('page', 'page_start', { route: '/start-here' })), 'Start Here');
  });

  it('section → first heading from stored HTML (no naked id)', () => {
    assert.strictEqual(
      objectDisplayName(
        fixture('section', 'sec_about_blog', {
          section: { id: 's_blog', data: { body: '<h2>Why This Blog Exists</h2><p>This site…</p>' } },
        })
      ),
      'Why This Blog Exists'
    );
  });

  it('navigation → role-based label', () => {
    assert.strictEqual(
      objectDisplayName(fixture('navigation', 'nav_footer', { role: 'footer', brand: {} })),
      'Footer navigation'
    );
  });

  it('taxonomy → kinds list', () => {
    assert.strictEqual(
      objectDisplayName(fixture('taxonomy', 'tax_drlurie', { kinds: { category: {}, tag: {} } })),
      'Taxonomy (category, tag)'
    );
  });

  it('site → body.name', () => {
    assert.strictEqual(
      objectDisplayName(fixture('site', 'site_drlurie', { name: 'Dr. Lurié Skincare' })),
      'Dr. Lurié Skincare'
    );
  });

  it('template → body.name', () => {
    assert.strictEqual(
      objectDisplayName(fixture('template', 'tpl_interior', { name: 'Interior page' })),
      'Interior page'
    );
  });

  it('section_template → body.name', () => {
    assert.strictEqual(
      objectDisplayName(fixture('section_template', 'stpl_audience_grid', { name: 'Audience grid' })),
      'Audience grid'
    );
  });

  it('theme → body.name', () => {
    assert.strictEqual(
      objectDisplayName(fixture('theme', 'thm_drlurie_default', { name: 'Dr. Lurié default' })),
      'Dr. Lurié default'
    );
  });

  it('product → presentation.title, else de-slugged slug', () => {
    assert.strictEqual(
      objectDisplayName(
        fixture('product', 'prod_barrier', {
          slug: 'barrier-repair-guide',
          presentation: { title: 'The Barrier Repair Guide' },
        })
      ),
      'The Barrier Repair Guide'
    );
    assert.strictEqual(
      objectDisplayName(fixture('product', 'prod_x', { slug: 'starter-checklist', presentation: {} })),
      'Starter Checklist'
    );
  });

  it('content_item → body.title', () => {
    assert.strictEqual(
      objectDisplayName(
        fixture('content_item', 'req_agent_minimal_routine_20260713_01', {
          title: 'The three-step routine that is genuinely enough',
          slug: 'the-three-step-routine',
        })
      ),
      'The three-step routine that is genuinely enough'
    );
  });

  it('never leaks a raw id — falls back to "Untitled <type>"', () => {
    assert.strictEqual(objectDisplayName(fixture('page', 'page_mystery', {})), 'Untitled page');
    assert.strictEqual(objectDisplayName(fixture('content_item', 'req_empty', {})), 'Untitled article');
    assert.strictEqual(objectDisplayName(fixture('theme', 'thm_empty', {})), 'Untitled theme');
  });
});

describe('objectTypeLabel', () => {
  it('maps the machine type to a human label', () => {
    assert.strictEqual(objectTypeLabel('content_item'), 'Article');
    assert.strictEqual(objectTypeLabel('section_template'), 'Section template');
  });
});

describe('deSlug', () => {
  it('title-cases and de-hyphenates', () => {
    assert.strictEqual(deSlug('barrier-repair-guide'), 'Barrier Repair Guide');
    assert.strictEqual(deSlug('/start-here/'), 'Start Here');
    assert.strictEqual(deSlug(''), undefined);
    assert.strictEqual(deSlug(undefined), undefined);
  });
});

describe('principalName', () => {
  it('humanizes a person email local-part', () => {
    assert.strictEqual(principalName({ kind: 'human', id: 'u1', email: 'alex.rivera@example.com' }), 'Alex Rivera');
  });
  it('labels an agent', () => {
    assert.strictEqual(
      principalName({ kind: 'agent', agent_name: 'reader_insight', auth: 'mcp_token' }),
      'Reader Insight (agent)'
    );
  });
});

describe('verbToPhrase', () => {
  it('renders a person action as a sentence', () => {
    assert.strictEqual(
      verbToPhrase({ action: 'checkout', actor: { kind: 'human', id: 'u1', email: 'wolf@kugelbrands.com' } }),
      'Wolf checked out'
    );
  });
  it('renders an agent publish', () => {
    assert.strictEqual(
      verbToPhrase({ action: 'publish', actor: { kind: 'agent', agent_name: 'final_article', auth: 'publish_key' } }),
      'Final Article (agent) published'
    );
  });
  it('refines review_decide by the decision detail', () => {
    assert.strictEqual(
      verbToPhrase({
        action: 'review_decide',
        actor: { kind: 'human', id: 'u1', email: 'wolf@kugelbrands.com' },
        details: { decision: 'approve' },
      }),
      'Wolf approved the changes'
    );
  });
  it('falls back to a humanized action for unknown verbs', () => {
    assert.strictEqual(
      verbToPhrase({ action: 'some_new_verb', actor: { kind: 'human', id: 'u1', email: 'a.b@x.com' } }),
      'A B some new verb'
    );
  });
});

describe('idTooltip', () => {
  it('frames the raw id for a tooltip', () => {
    assert.strictEqual(
      idTooltip('req_agent_object_model_demo_20260713_01'),
      'Internal id: req_agent_object_model_demo_20260713_01'
    );
    assert.strictEqual(idTooltip(undefined), 'No id assigned');
  });
});
