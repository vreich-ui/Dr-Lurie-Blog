/**
 * Admin-editor preview support for image artifact references.
 *
 * A Major Key artifact ref (image/{requestId}/{sha256}.{ext}) is a blob-store key, not a
 * URL, so the admin renderer historically showed a placeholder. The identity-gated
 * admin-get-blob-image function CAN serve those bytes; this module builds the endpoint URL
 * and an authenticated loader the renderer uses to swap the placeholder for a real preview.
 *
 * Kept free of DOM APIs so it is unit-testable in Node.
 */

/** Mirrors admin-get-blob-image's allowedImageBlobKeyPattern. */
export const ADMIN_PREVIEWABLE_IMAGE_REF_RE = /^image\/[a-z0-9._-]+\/[a-f0-9]{64}(?:\.[a-z0-9]+)?$/i;

export const getAdminBlobImageEndpoint = (blobKey: string): string | undefined => {
  const trimmed = blobKey.trim();
  if (!ADMIN_PREVIEWABLE_IMAGE_REF_RE.test(trimmed)) return undefined;

  return `/.netlify/functions/admin-get-blob-image?blobKey=${encodeURIComponent(trimmed)}`;
};

export type ArtifactPreviewLoader = (blobKey: string) => Promise<string | undefined>;

type CreateLoaderOptions = {
  /** Returns a fresh Netlify Identity bearer token (publish.astro's getToken). */
  getToken: () => Promise<string>;
  fetchFn?: typeof fetch;
  createObjectUrl?: (blob: Blob) => string;
};

/**
 * Build a loader that fetches artifact bytes through admin-get-blob-image with the admin's
 * identity token and returns an object URL for an <img> src. Resolves undefined on any
 * failure so callers keep their placeholder instead of surfacing an error state.
 */
export const createAdminArtifactPreviewLoader = ({
  getToken,
  fetchFn = fetch,
  createObjectUrl = (blob) => URL.createObjectURL(blob),
}: CreateLoaderOptions): ArtifactPreviewLoader => {
  return async (blobKey: string) => {
    const endpoint = getAdminBlobImageEndpoint(blobKey);
    if (!endpoint) return undefined;

    try {
      const token = await getToken();
      const response = await fetchFn(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return undefined;

      return createObjectUrl(await response.blob());
    } catch {
      return undefined;
    }
  };
};
