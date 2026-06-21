import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  articleNodeTemplates,
  createDefaultNodeFromTemplate,
  createLegacyBodyNode,
  createOpaqueNodeId
} from './input-bank.js';
import { articleBodyNodeSchema } from '../../schema/article-content-v1.js';

describe('Article Content Input Bank', () => {
  describe('createOpaqueNodeId', () => {
    it('should generate IDs matching the required pattern', () => {
      const id = createOpaqueNodeId();
      assert.match(id, /^n_[a-z0-9]+$/i);
    });

    it('should not contain forbidden words', () => {
      const forbidden = ['hook', 'agitation', 'cta', 'advert', 'offer', 'ad'];
      for (let i = 0; i < 100; i++) {
        const id = createOpaqueNodeId().toLowerCase();
        for (const word of forbidden) {
          assert.strictEqual(id.includes(word), false, `ID "${id}" should not contain "${word}"`);
        }
      }
    });
  });

  describe('articleNodeTemplates', () => {
    it('should contain all 11 required templates', () => {
      const required = [
        'prose_section', 'plain_text', 'callout', 'summary',
        'soft_action', 'contextual_offer', 'commerce_offer',
        'product_mention', 'ad_slot', 'chat_invite', 'faq'
      ];
      for (const id of required) {
        assert.ok(articleNodeTemplates[id], `Missing template: ${id}`);
      }
    });
  });

  describe('createDefaultNodeFromTemplate', () => {
    it('should create valid nodes for all templates', () => {
      for (const templateId in articleNodeTemplates) {
        const node = createDefaultNodeFromTemplate(templateId);
        const result = articleBodyNodeSchema.safeParse(node);
        assert.strictEqual(result.success, true, `Validation failed for ${templateId}: ${result.success ? '' : result.error.message}`);
      }
    });

    it('should throw for unknown templates', () => {
      assert.throws(() => createDefaultNodeFromTemplate('unknown'), /Template not found/);
    });
  });

  describe('createLegacyBodyNode', () => {
    it('should create a valid legacy content node', () => {
      const markdown = '## Hello World\nThis is legacy content.';
      const node = createLegacyBodyNode(markdown);
      const result = articleBodyNodeSchema.safeParse(node);
      assert.strictEqual(result.success, true);
      assert.strictEqual(node.kind, 'content');
      assert.strictEqual(node.public.body, markdown);
    });
  });
});
