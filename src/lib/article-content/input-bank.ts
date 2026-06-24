import { type ArticleBodyNode, articleBodyNodeSchema } from '../../schema/article-content-v1.ts';

/**
 * Generates an opaque, stable-looking ID for article nodes.
 * Explicitly avoids words that might trigger filters or reveal strategy.
 */
export function createOpaqueNodeId(): string {
  const forbidden = ['hook', 'agitation', 'cta', 'advert', 'offer', 'ad'];
  let id = '';
  let attempts = 0;

  while (attempts < 100) {
    id = `n_${Math.random().toString(36).substring(2, 10)}`;
    const lowerId = id.toLowerCase();
    if (!forbidden.some((word) => lowerId.includes(word))) {
      return id;
    }
    attempts++;
  }

  // Fallback to a very safe format if we keep hitting forbidden words (unlikely)
  return `n_node${Date.now().toString(36)}`;
}

export interface ArticleNodeTemplate {
  id: string;
  name: string;
  description: string;
  kind: ArticleBodyNode['kind'];
  defaults: Partial<ArticleBodyNode>;
  fields: {
    public: string[];
    optional: string[];
  };
}

export const articleNodeTemplates: Record<string, ArticleNodeTemplate> = {
  prose_section: {
    id: 'prose_section',
    name: 'Text Section',
    description: 'A standard section of text with an optional title.',
    kind: 'content',
    fields: {
      public: ['body'],
      optional: ['title'],
    },
    defaults: {
      kind: 'content',
      public: {
        title: '',
        body: '',
      },
      rendering: {
        presentation: 'section',
      },
    },
  },
  image: {
    id: 'image',
    name: 'Image',
    description: 'A standalone image with an optional caption.',
    kind: 'content',
    fields: {
      public: ['media'],
      optional: ['title', 'body'],
    },
    defaults: {
      kind: 'content',
      public: {
        title: '',
        body: '',
        media: {
          type: 'image',
          src: '',
        },
      },
      rendering: {
        presentation: 'section',
      },
    },
  },
  plain_text: {
    id: 'plain_text',
    name: 'Plain Text',
    description: 'Simple text without section styling.',
    kind: 'content',
    fields: {
      public: ['body'],
      optional: [],
    },
    defaults: {
      kind: 'content',
      public: {
        body: '',
      },
      rendering: {
        presentation: 'plain',
      },
    },
  },
  callout: {
    id: 'callout',
    name: 'Callout',
    description: 'Highlighted text to draw attention.',
    kind: 'content',
    fields: {
      public: ['body'],
      optional: ['title'],
    },
    defaults: {
      kind: 'content',
      public: {
        title: '',
        body: '',
      },
      rendering: {
        presentation: 'callout',
      },
    },
  },
  summary: {
    id: 'summary',
    name: 'Summary',
    description: 'A summary section, often with bullet points.',
    kind: 'content',
    fields: {
      public: [],
      optional: ['title', 'items'],
    },
    defaults: {
      kind: 'content',
      public: {
        title: 'Summary',
        items: [],
      },
      private: {
        strategy: 'summary',
      },
      rendering: {
        presentation: 'summary',
      },
    },
  },
  soft_action: {
    id: 'soft_action',
    name: 'Soft CTA',
    description: 'An inline call to action with optional text.',
    kind: 'action',
    fields: {
      public: ['ctaText', 'ctaLink'],
      optional: ['body'],
    },
    defaults: {
      kind: 'action',
      public: {
        body: '',
        ctaText: 'Learn More',
        ctaLink: '',
      },
      rendering: {
        presentation: 'inline',
      },
    },
  },
  contextual_offer: {
    id: 'contextual_offer',
    name: 'Contextual Offer',
    description: 'An offer embedded within the flow of content.',
    kind: 'action',
    fields: {
      public: ['body'],
      optional: ['ctaText', 'ctaLink'],
    },
    defaults: {
      kind: 'action',
      public: {
        body: '',
        ctaText: '',
        ctaLink: '',
      },
      commercial: {
        type: 'offer',
      },
      rendering: {
        presentation: 'offerInline',
      },
    },
  },
  commerce_offer: {
    id: 'commerce_offer',
    name: 'Commerce Offer',
    description: 'A prominent product or service offer card.',
    kind: 'placement',
    fields: {
      public: ['title', 'ctaText', 'ctaLink'],
      optional: ['body', 'media'],
    },
    defaults: {
      kind: 'placement',
      public: {
        title: '',
        body: '',
        ctaText: 'Buy Now',
        ctaLink: '',
      },
      commercial: {
        type: 'offer',
      },
      rendering: {
        presentation: 'offerCard',
      },
    },
  },
  product_mention: {
    id: 'product_mention',
    name: 'Product Mention',
    description: 'A mention of a product with a link.',
    kind: 'content',
    fields: {
      public: ['body'],
      optional: [],
    },
    defaults: {
      kind: 'content',
      public: {
        body: '',
      },
      commercial: {
        type: 'productMention',
      },
      rendering: {
        presentation: 'inline',
      },
    },
  },
  ad_slot: {
    id: 'ad_slot',
    name: 'Ad Slot',
    description: 'A placeholder for an advertisement.',
    kind: 'placement',
    fields: {
      public: [],
      optional: ['label'],
    },
    defaults: {
      kind: 'placement',
      public: {
        label: 'Advertisement',
      },
      commercial: {
        type: 'adSlot',
      },
      rendering: {
        presentation: 'adSlot',
      },
    },
  },
  chat_invite: {
    id: 'chat_invite',
    name: 'Chat Invite',
    description: 'An invitation for the reader to start a chat.',
    kind: 'interactive',
    fields: {
      public: [],
      optional: ['title', 'body'],
    },
    defaults: {
      kind: 'interactive',
      public: {
        title: 'Have questions?',
        body: 'Ask our assistant about this article.',
      },
      rendering: {
        presentation: 'chatInvite',
      },
    },
  },
  faq: {
    id: 'faq',
    name: 'FAQ',
    description: 'A list of frequently asked questions.',
    kind: 'content',
    fields: {
      public: ['items'],
      optional: ['title'],
    },
    defaults: {
      kind: 'content',
      public: {
        title: 'Frequently Asked Questions',
        items: [],
      },
      rendering: {
        presentation: 'faq',
      },
    },
  },
};

/**
 * Returns a template by its ID.
 */
export function getArticleNodeTemplate(templateId: string): ArticleNodeTemplate | undefined {
  return articleNodeTemplates[templateId];
}

/**
 * Creates a valid article node based on a template.
 */
export function createDefaultNodeFromTemplate(templateId: string): ArticleBodyNode {
  const template = getArticleNodeTemplate(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const node: ArticleBodyNode = {
    ...JSON.parse(JSON.stringify(template.defaults)),
    id: createOpaqueNodeId(),
    private: {
      ...(template.defaults.private || {}),
      inputTemplateId: templateId,
    },
  };

  // Double-check validation
  const result = articleBodyNodeSchema.safeParse(node);
  if (!result.success) {
    throw new Error(`Generated node from template "${templateId}" is invalid: ${result.error.message}`);
  }

  return node;
}

/**
 * Creates a legacy content node from a markdown string.
 */
export function createLegacyBodyNode(markdown: string): ArticleBodyNode {
  return {
    id: createOpaqueNodeId(),
    kind: 'content',
    public: {
      body: markdown.trim(),
    },
    private: {
      inputTemplateId: 'prose_section',
    },
    rendering: {
      presentation: 'section',
    },
    visibility: 'public',
  };
}

/**
 * Infers the closest matching template ID for a node that lacks one.
 */
export function inferTemplateId(node: Partial<ArticleBodyNode>): string {
  if (node.private?.inputTemplateId) return node.private.inputTemplateId;

  if (node.rendering?.presentation === 'faq') return 'faq';
  if (node.rendering?.presentation === 'summary') return 'summary';
  if (node.rendering?.presentation === 'offerCard') return 'commerce_offer';
  if (node.rendering?.presentation === 'offerInline') return 'contextual_offer';
  if (node.rendering?.presentation === 'adSlot') return 'ad_slot';
  if (node.rendering?.presentation === 'chatInvite') return 'chat_invite';
  if (node.rendering?.presentation === 'callout') return 'callout';
  if (node.rendering?.presentation === 'plain') return 'plain_text';
  if (node.commercial?.type === 'productMention') return 'product_mention';
  if (node.kind === 'action') return 'soft_action';

  return 'prose_section';
}
