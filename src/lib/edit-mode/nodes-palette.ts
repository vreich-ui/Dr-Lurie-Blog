/**
 * Edit-mode canvas — the "add an article block" palette (W7.7, pure).
 *
 * What the gap "+" between article nodes offers. Every starter is a complete,
 * schema-valid `content_item` node WITHOUT an id (the server mints the opaque
 * `n_*` id — contract `minted_id_field: node.id`), annotated with a sensible
 * default strategy/intent so the semantic layer is present from birth (the
 * annotation panel refines it). Commercial starters carry the full disclosure
 * envelope — an editor cannot insert an undisclosed ad or affiliate unit.
 *
 * The ad starter uses the MOCK provider: it renders a bank unit
 * (render-nodes.ts) and can never be mistaken for live inventory — pointing
 * the slot at a real provider stays deliberate agent/admin work.
 */

export type NodePaletteEntry = {
  key: string;
  /** Editor-facing label — what the block does in the story. */
  label: string;
  /** One-line hint shown in the picker. */
  hint: string;
  /** Complete node payload minus `id` (server-minted). */
  node: Record<string, unknown>;
};

export const NODE_PALETTE: NodePaletteEntry[] = [
  {
    key: 'text',
    label: 'Text block',
    hint: 'A paragraph (or several — blank line splits).',
    node: {
      kind: 'content',
      public: { body: 'New paragraph. Click the pencil to edit, or ask the AI to draft it.' },
      private: { strategy: 'context', intent: 'educate' },
    },
  },
  {
    key: 'heading',
    label: 'Heading + text',
    hint: 'A titled passage.',
    node: {
      kind: 'content',
      public: { title: 'New heading', body: 'Copy for this part of the story.' },
      private: { strategy: 'explanation', intent: 'educate' },
    },
  },
  {
    key: 'checklist',
    label: 'Checklist',
    hint: 'A bullet list of points.',
    node: {
      kind: 'content',
      public: { title: 'What this covers', items: ['First point'] },
      private: { strategy: 'proof', intent: 'reassure' },
    },
  },
  {
    key: 'image',
    label: 'Image',
    hint: 'One image with alt text (upload or path).',
    node: {
      kind: 'content',
      public: { media: { type: 'image', src: '', alt: '' } },
      private: { strategy: 'example', intent: 'educate' },
    },
  },
  {
    key: 'gallery',
    label: 'Image gallery',
    hint: 'Several images in a row, add as many as needed.',
    node: {
      kind: 'content',
      public: { images: [{ type: 'image', src: '', alt: '' }] },
      private: { strategy: 'example', intent: 'educate' },
    },
  },
  {
    key: 'cta',
    label: 'Call to action',
    hint: 'A prominent button.',
    node: {
      kind: 'action',
      public: { ctaText: 'Browse the library', ctaLink: '/learn/library' },
      private: { strategy: 'recommendation', intent: 'navigate' },
    },
  },
  {
    key: 'offer',
    label: 'Offer / affiliate',
    hint: 'A disclosed partner offer card.',
    node: {
      kind: 'placement',
      public: {
        title: 'Partner offer',
        body: 'One honest line on what this is and why it may help.',
        ctaText: 'See the offer',
        ctaLink: 'https://example.com/offer',
      },
      commercial: {
        type: 'offer',
        source: 'affiliate',
        rel: 'nofollow sponsored',
        disclosure: { required: true, label: 'Sponsored', mode: 'inline' },
      },
      rendering: { presentation: 'offerCard' },
      private: { strategy: 'recommendation', intent: 'convert' },
    },
  },
  {
    key: 'ad',
    label: 'Ad slot (mock)',
    hint: 'A realistic placeholder ad unit — native card.',
    node: {
      kind: 'placement',
      public: {},
      commercial: {
        type: 'adSlot',
        source: 'programmatic',
        creativeId: 'mock-native',
        adSlot: { provider: 'mock' },
      },
      rendering: { presentation: 'adSlot' },
      private: { strategy: 'recommendation', intent: 'convert' },
    },
  },
  {
    key: 'chat',
    label: 'Chat invite',
    hint: 'Invite readers to ask the assistant.',
    node: {
      kind: 'interactive',
      public: {},
      chat: { invitationText: 'Questions about this? Ask the site assistant.' },
      private: { strategy: 'recommendation', intent: 'navigate' },
    },
  },
];

export const nodePaletteEntry = (key: string): NodePaletteEntry | undefined =>
  NODE_PALETTE.find((entry) => entry.key === key);

/** The three ad bank creatives an editor can flip between (render-nodes.ts). */
export const MOCK_AD_CREATIVES = ['mock-native', 'mock-leaderboard', 'mock-rectangle'] as const;
