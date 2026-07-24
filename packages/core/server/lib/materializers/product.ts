/**
 * Product materializer — 'product.v1' → `<exportRoot>/products/{prod_id}.json`
 * (06-shop-module-plan §1; exportRoot parameterized W11 T11.6). One export per
 * product, consumed at build time by the /shop surfaces (S2) the same way
 * page/section exports are.
 */
import { productBodySchema } from '../../../schema/bodies/product-v1.js';
import { exportPath, renderExport, type MaterializeMeta, type MaterializedFile } from './shared.js';

export const materializeProduct = (objectId: string, body: unknown, meta: MaterializeMeta): MaterializedFile => {
  const parsed = productBodySchema.parse(body);
  return {
    path: exportPath(meta, 'products', `${objectId}.json`),
    content: renderExport('product', objectId, parsed, meta),
  };
};
