import { listArtifactIndexKeys, type ArtifactIndexStore } from './artifact-index.js';
import { isArtifactReference } from './artifacts.js';

/** Matches a Major Key artifact reference: {image|pdf}/{id}/{sha256-64-hex}.{ext} */
export const MAJOR_KEY_ARTIFACT_REF_RE = /^(image|pdf)\/[^/]+\/[0-9a-f]{64}\.[a-z]+$/i;

/**
 * The PUBLIC, servable path for a raw Major Key artifact ref — the inverse of
 * the netlify redirects (`/img/* → get-public-image?blobKey=image/:splat`,
 * `/pdf/* → get-public-pdf?blobKey=pdf/:splat`). A raw blob key
 * (`image/<id>/<sha>.ext`) is NOT servable as-is; the browser resolves it as a
 * relative path (404) and Astro's `<Image>`/`getImage` throws
 * `LocalImageUsedWrongly`. Renderable `src`/`ogImage`/`portrait.src` fields
 * must carry THIS path — only the trusted `*AssetRef` fields hold the raw ref.
 * Returns the input unchanged when it is not a raw Major Key ref.
 */
export const publicPathForArtifactRef = (ref: string): string => {
  if (!MAJOR_KEY_ARTIFACT_REF_RE.test(ref)) return ref;
  return ref.startsWith('pdf/') ? `/pdf/${ref.slice('pdf/'.length)}` : `/img/${ref.slice('image/'.length)}`;
};

/** Matches the PUBLIC servable path form: /img|/pdf/{id}/{sha256}.{ext} (see publicPathForArtifactRef). */
export const PUBLIC_ARTIFACT_PATH_RE = /^\/(img|pdf)\/[^/]+\/[0-9a-f]{64}\.[a-z]+$/i;

/**
 * The inverse of publicPathForArtifactRef: a /img|/pdf public path back to its
 * raw Major Key blobKey (for artifact-index lookups). Returns the input
 * unchanged when it is not a public artifact path.
 */
export const rawArtifactRefForPublicPath = (path: string): string => {
  if (!PUBLIC_ARTIFACT_PATH_RE.test(path)) return path;
  return path.startsWith('/pdf/') ? `pdf/${path.slice('/pdf/'.length)}` : `image/${path.slice('/img/'.length)}`;
};

/**
 * The trust state for one workflow record's artifact references.
 *
 * `trusted` is the authoritative allow-list for canonical-input image/PDF references:
 * the union of (1) refs the agents explicitly wrote into
 * `agent_outputs[*].output.artifactReferences` and (2) every non-deleted reference in the
 * artifact-index store for this request — the same store `list_artifacts_for_request` and
 * the publish-time resolver read, so staging and publish cannot diverge (PR #327).
 *
 * `deleted` carries blobKeys that exist in the index but are soft-deleted, so rejection
 * messages can tell the agent *why* a ref it can see in history is not accepted.
 */
export type ArtifactTrustIndex = {
  requestId: string;
  trusted: Set<string>;
  deleted: Set<string>;
};

type AgentOutputsCarrier = {
  request_id: string;
  agent_outputs: Partial<Record<string, { output?: unknown } | undefined>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const parseIndexJson = async (indexStore: ArtifactIndexStore, key: string): Promise<unknown> => {
  const text = await indexStore.get(key);
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * Collect the trusted (and soft-deleted) blobKeys for a workflow record.
 *
 * Cross-request pointers are intentionally out of scope (they remain publish-only /
 * opt-in). When `indexStore` is omitted only agent_outputs is consulted.
 */
export const gatherTrustedArtifactRefs = async (
  record: AgentOutputsCarrier,
  indexStore?: ArtifactIndexStore
): Promise<ArtifactTrustIndex> => {
  const trusted = new Set<string>();
  const deleted = new Set<string>();

  for (const agentOutput of Object.values(record.agent_outputs)) {
    if (!agentOutput) continue;
    const out = agentOutput.output;
    if (!isRecord(out)) continue;
    const artifactRefs = out.artifactReferences;
    if (!Array.isArray(artifactRefs)) continue;

    for (const ref of artifactRefs) {
      if (isRecord(ref) && typeof ref.blobKey === 'string' && MAJOR_KEY_ARTIFACT_REF_RE.test(ref.blobKey)) {
        trusted.add(ref.blobKey);
      }
    }
  }

  if (indexStore) {
    // The request-artifacts/<requestId>/ reference JSONs are the canonical index records
    // (by-request pointers resolve back to exactly these), and unlike the pointer path they
    // carry the soft-delete markers this helper reports.
    const referenceKeys = await listArtifactIndexKeys(
      indexStore,
      `request-artifacts/${encodeURIComponent(record.request_id)}/`
    );
    const references = await Promise.all(referenceKeys.map((key) => parseIndexJson(indexStore, key)));

    for (const reference of references) {
      if (!isArtifactReference(reference) || !MAJOR_KEY_ARTIFACT_REF_RE.test(reference.blobKey)) continue;
      if (reference.deletedAtISO) {
        deleted.add(reference.blobKey);
      } else {
        trusted.add(reference.blobKey);
      }
    }
  }

  return { requestId: record.request_id, trusted, deleted };
};

const getBlobKeyOwnerRequestId = (blobKey: string) => blobKey.split('/')[1] ?? '';

/**
 * Explain WHY a well-formed Major Key artifact reference was rejected, so an agent can
 * self-diagnose: cross-request ref, soft-deleted artifact, or never uploaded.
 */
export const describeUntrustedArtifactRef = (path: string, value: string, trust: ArtifactTrustIndex): string => {
  const ownerRequestId = getBlobKeyOwnerRequestId(value);

  if (ownerRequestId && ownerRequestId !== trust.requestId) {
    return (
      `${path} "${value}" belongs to request '${ownerRequestId}', not '${trust.requestId}'. ` +
      `Cross-request artifact references are not accepted in canonical input. Regenerate the artifact for this ` +
      `request through pdf-tool using the site's storage grant (get_pdf_tool_storage_grant) so it is written into ` +
      `this request's artifact index, then use the returned ArtifactReference blobKey.`
    );
  }

  if (trust.deleted.has(value)) {
    return (
      `${path} "${value}" refers to a soft-deleted artifact for request '${trust.requestId}'. ` +
      `It is excluded from listing, trust, and publish. Re-upload the exact bytes to restore it, ` +
      `or ask an admin to run restore_artifact, then retry.`
    );
  }

  return (
    `${path} "${value}" is not in the artifact index for request '${trust.requestId}' and is not present in ` +
    `agent_outputs.artifactReferences. Generate the artifact through pdf-tool using the site's storage grant ` +
    `(get_pdf_tool_storage_grant) so it lands in this request's index, then use the exact returned ArtifactReference ` +
    `blobKey — list_artifacts_for_request shows what exists.`
  );
};
