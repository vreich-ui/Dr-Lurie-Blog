/**
 * Product materializer — 'product.v1' → src/data/site/products/{prod_id}.json
 * (06-shop-module-plan §1). One export per product, consumed at build time by
 * the /shop surfaces (S2) the same way page/section exports are.
 */
import { productBodySchema } from '../../../src/schema/bodies/product-v1.js';
import { renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeProduct = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = productBodySchema.parse(body);
  return {
    path: `src/data/site/products/${objectId}.json`,
    content: renderExport('product', objectId, parsed, meta),
  };
};
