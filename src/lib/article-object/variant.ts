/**
 * Variant cloning for content_item objects (W7.3, 08-articles-plan §2.4 — the
 * A/B substrate). Pure: same inputs, same body out.
 *
 * A variant is a full clone of the source article with:
 *   - node ids RE-MINTED deterministically (opaque n_* ids; seeded per
 *     (source object, new object, source node) so a re-run is idempotent) —
 *     and every annotation that references node ids (claims.node_ids,
 *     compliance.requirements[].node_ids) re-pointed through the same map,
 *     so the judge/score substrate survives the clone intact;
 *   - `lineage.parent_content_id` set to the source object id (what
 *     inventory/agents use to walk a variant family);
 *   - a fresh slug (variants may not share the source's permalink — slug
 *     uniqueness is validation-enforced): caller-supplied, or
 *     `<source-slug>-variant` by default.
 *
 * Serving/traffic-splitting is explicitly out of scope (OQ-W7-2): variants
 * are draft records agents build, judge, and score; publishing a winner is an
 * ordinary object_publish.
 */
import { mintId } from '../../../packages/core/lib/object-ids-mint.js';
import type { ContentItemBody } from '../../../packages/core/schema/bodies/content-item-v1.js';

export type VariantOptions = {
  sourceObjectId: string;
  newObjectId: string;
  /** Overrides the default `<source-slug>-variant`. */
  slug?: string;
};

export const buildVariantBody = (source: ContentItemBody, options: VariantOptions): ContentItemBody => {
  const body = structuredClone(source) as ContentItemBody;

  const idMap = new Map<string, string>();
  body.nodes = body.nodes.map((node) => {
    const nextId = mintId({ kind: 'article_node' }, `${options.sourceObjectId}:${options.newObjectId}:${node.id}`);
    idMap.set(node.id, nextId);
    return { ...node, id: nextId };
  });

  const remap = (ids: string[] | undefined): string[] | undefined => ids?.map((id) => idMap.get(id) ?? id);

  if (body.claims) {
    body.claims.claim_list = body.claims.claim_list.map((claim) => ({
      ...claim,
      ...(claim.node_ids ? { node_ids: remap(claim.node_ids) } : {}),
    }));
  }
  if (body.compliance) {
    body.compliance.requirements = body.compliance.requirements.map((requirement) => ({
      ...requirement,
      ...(requirement.node_ids ? { node_ids: remap(requirement.node_ids) } : {}),
    }));
  }

  body.slug = options.slug ?? `${source.slug}-variant`;
  body.lineage = { ...(body.lineage ?? {}), parent_content_id: options.sourceObjectId };
  // Scores describe the SOURCE's judged state; a variant starts unjudged.
  delete body.scores;

  return body;
};
