import { z } from 'zod';

/**
 * Commercial metadata for nodes that have a commercial purpose.
 */
export const commercialMetadataSchema = z
  .object({
    type: z
      .enum([
        'adSlot',
        'sponsoredPlacement',
        'productMention',
        'affiliateMention',
        'partnerResource',
        'offer',
        'housePromotion',
      ])
      .optional(),
    source: z.enum(['firstParty', 'sponsor', 'affiliate', 'partner', 'programmatic', 'directSold']).optional(),
    sponsorName: z.string().optional(),
    advertiserName: z.string().optional(),
    merchantName: z.string().optional(),
    productId: z.string().optional(),
    offerId: z.string().optional(),
    campaignId: z.string().optional(),
    creativeId: z.string().optional(),
    placementId: z.string().optional(),
    destinationUrl: z.string().optional(),
    rel: z.enum(['sponsored', 'nofollow sponsored']).optional(),
    disclosure: z
      .object({
        required: z.boolean(),
        label: z.string().optional(),
        mode: z.enum(['inline', 'nearby', 'section', 'global']).optional(),
      })
      .optional(),
    offer: z
      .object({
        couponCode: z.string().optional(),
        expiresAt: z.string().optional(), // ISO
        terms: z.string().optional(),
        eligibility: z.string().optional(),
      })
      .optional(),
    adSlot: z
      .object({
        provider: z.string().optional(),
        adUnitPath: z.string().optional(),
        sizes: z.array(z.tuple([z.number(), z.number()])).optional(),
        lazyLoad: z.boolean().optional(),
        targeting: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
        fallbackNodeId: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export type CommercialMetadata = z.infer<typeof commercialMetadataSchema>;

/**
 * Strategy metadata for internal use by agents and editors.
 * This must never be rendered to the reader.
 */
export const articlePrivateMetadataSchema = z
  .object({
    strategy: z
      .enum([
        'hook',
        'agitation',
        'context',
        'explanation',
        'proof',
        'example',
        'comparison',
        'myth',
        'step',
        'recommendation',
        'resolution',
        'summary',
      ])
      .optional(),
    intent: z.enum(['educate', 'persuade', 'reassure', 'convert', 'navigate']).optional(),
    agentNotes: z.string().optional(),
    sourcePromptId: z.string().optional(),
    inputTemplateId: z.string().optional(),
  })
  .strict();

export type ArticlePrivateMetadata = z.infer<typeof articlePrivateMetadataSchema>;

/**
 * Presentation hints for rendering.
 */
export const articleRenderingHintsSchema = z
  .object({
    presentation: z
      .enum([
        'plain',
        'section',
        'callout',
        'inline',
        'card',
        'panel',
        'faq',
        'summary',
        'chatInvite',
        'adSlot',
        'offerInline',
        'offerCard',
      ])
      .optional(),
    emphasis: z.enum(['low', 'medium', 'high']).optional(),
    placement: z.enum(['inline', 'section', 'sidebar', 'afterParagraph', 'footer']).optional(),
  })
  .strict();

export type ArticleRenderingHints = z.infer<typeof articleRenderingHintsSchema>;

/**
 * Configuration for chat features.
 */
export const articleChatConfigSchema = z
  .object({
    enabled: z.boolean(),
    promptOverride: z.string().optional(),
    welcomeMessage: z.string().optional(),
    suggestedQuestions: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ArticleChatConfig = z.infer<typeof articleChatConfigSchema>;

/**
 * Publicly visible fields for an article node.
 */
export const articleNodePublicSchema = z
  .object({
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    items: z.array(z.string()).optional(),
    ctaText: z.string().optional(),
    ctaLink: z.string().optional(),
    label: z.string().optional(),
    media: z
      .object({
        type: z.enum(['image', 'video', 'audio', 'embed']),
        src: z.string(),
        alt: z.string().optional(),
        caption: z.string().optional(),
      })
      .optional(),
  })
  .strict();

/**
 * A single node within an article body.
 */
export const articleBodyNodeSchema = z
  .object({
    id: z
      .string()
      .regex(/^n_[a-z0-9]+$/i, {
        message: 'Node ID must be a stable opaque ID starting with n_',
      })
      .refine(
        (id) => {
          const forbidden = ['hook', 'agitation', 'cta', 'advert', 'offer'];
          const lowerId = id.toLowerCase();
          return !forbidden.some((word) => lowerId.includes(word));
        },
        {
          message:
            'Node ID must be opaque and not contain strategy or commercial keywords (hook, agitation, cta, advert, offer, etc.)',
        }
      ),
    kind: z.enum(['content', 'action', 'placement', 'interactive']),
    public: articleNodePublicSchema,
    private: articlePrivateMetadataSchema.optional(),
    commercial: commercialMetadataSchema.optional(),
    chat: z
      .object({
        invitationText: z.string().optional(),
        suggestedQuery: z.string().optional(),
      })
      .optional(),
    rendering: articleRenderingHintsSchema.optional(),
    visibility: z.enum(['public', 'internal', 'hidden']).optional(),
  })
  .strict();

export type ArticleBodyNode = z.infer<typeof articleBodyNodeSchema>;

/**
 * The root container for structured article content.
 */
export const articleBodyV1Schema = z
  .object({
    schema_version: z.literal('article_body.v1'),
    nodes: z.array(articleBodyNodeSchema).refine(
      (nodes) => {
        // At least one node with public visibility (or default) is required.
        return nodes.some((node) => !node.visibility || node.visibility === 'public');
      },
      {
        message: 'At least one public node is required for a valid article body.',
      }
    ),
    chat: articleChatConfigSchema.optional(),
    defaults: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ArticleBodyV1 = z.infer<typeof articleBodyV1Schema>;
