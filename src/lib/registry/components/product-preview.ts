/**
 * `product_preview` registry module — a product card grid (ProductPreview.astro,
 * A§2.9). Each product's `action` resolves to an href the same way hero/lede
 * actions do (ProductPreviewResolved), computed centrally by the renderer
 * (src/lib/renderer/resolve.ts); `imageAssetRef` awaits the trusted-artifact
 * resolver. This module declares no resolveRefs — the resolved shape is the
 * contract the renderer fills.
 */
import { sectionVariantDataSchema, type ProductPreviewResolved, type SectionComponentDefinition } from './types.js';

export const productPreviewDefinition: SectionComponentDefinition<'product_preview', ProductPreviewResolved> = {
  type: 'product_preview',
  schema: sectionVariantDataSchema('product_preview'),
  editor: {
    label: 'Product preview',
    icon: 'tabler:shopping-bag',
    fieldHints: {
      heading: { label: 'Heading', widget: 'text' },
      products: {
        label: 'Products',
        help: 'Product cards. Each has a title, optional description, optional image (trusted artifact ref), and optional action.',
        widget: 'cards',
      },
    },
    defaultData: {
      heading: 'Products',
      products: [],
    },
  },
};
