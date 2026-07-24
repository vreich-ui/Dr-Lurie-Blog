import { saveArtifactBytes } from './artifact-upload.js';
import { type ArtifactReference } from './artifacts.js';
import { sha256Hex } from './crypto.js';

/**
 * Server-local compatibility helper for publisher-agent requests that still carry
 * inline base64 image payloads. External agents should not use this as an upload
 * transport; generated binary artifacts should use create_artifact_upload_intent
 * followed by raw HTTP POST /api/artifacts/upload and then pass ArtifactReference
 * objects to the publisher.
 */
export type UploadableImage = {
  base64?: string;
  content?: string;
  encoding?: string;
  name?: string;
  repoPath?: string;
  type?: string;
};

type UploadImagesWithIntegrityInput = {
  images: UploadableImage[];
  requestId: string;
  event?: unknown;
  onWorkflowError?: (message: string) => void;
};

type PreparedImageUpload = {
  bytes: Buffer;
  contentType: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
};

export class ArtifactIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactIntegrityError';
  }
}

const inferContentTypeFromName = (name: string) => {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.gif')) return 'image/gif';

  return 'application/octet-stream';
};

const normalizeContentType = (contentType: string) => contentType.split(';', 1)[0].trim().toLowerCase();

const getImageName = (image: UploadableImage, index: number) => {
  const name = image.name?.trim() || image.repoPath?.split('/').filter(Boolean).pop()?.trim();

  return name || `article-image-${index + 1}`;
};

const decodeImageBytes = (image: UploadableImage) => {
  const encoding = image.encoding?.trim().toLowerCase() || 'base64';
  if (encoding === 'binary') {
    throw new ArtifactIntegrityError(
      'Artifact upload failed integrity verification: image payload encoding must be base64, not binary.'
    );
  }
  if (encoding !== 'base64') {
    throw new ArtifactIntegrityError(
      `Artifact upload failed integrity verification: unsupported image payload encoding "${encoding}".`
    );
  }

  const payload = image.base64 ?? image.content;
  if (payload === undefined || payload === null) {
    throw new ArtifactIntegrityError('Artifact upload failed integrity verification: image payload is missing.');
  }

  const bytes = Buffer.from(payload, 'base64');
  if (bytes.byteLength === 0) {
    throw new ArtifactIntegrityError('Artifact upload failed integrity verification: image payload is empty.');
  }

  return bytes;
};

const getSupportedImageContentType = (image: UploadableImage, filename: string) => {
  const contentType = normalizeContentType(image.type?.trim() || inferContentTypeFromName(filename));
  if (contentType === 'image/svg+xml') {
    throw new ArtifactIntegrityError(
      'Artifact upload failed integrity verification: SVG images are not supported by this binary image upload path.'
    );
  }
  if (!contentType.startsWith('image/') || contentType === 'application/octet-stream') {
    throw new ArtifactIntegrityError(
      `Artifact upload failed integrity verification: unsupported image contentType "${contentType}".`
    );
  }

  return contentType;
};

const prepareImageUpload = (image: UploadableImage, index: number): PreparedImageUpload => {
  const filename = getImageName(image, index);
  const contentType = getSupportedImageContentType(image, filename);
  const bytes = decodeImageBytes(image);
  const sizeBytes = bytes.byteLength;

  return {
    bytes,
    contentType,
    filename,
    sha256: sha256Hex(bytes),
    sizeBytes,
  };
};

const verifyReturnedArtifact = ({
  artifact,
  contentType,
  sha256,
  sizeBytes,
}: {
  artifact: ArtifactReference;
  contentType: string;
  sha256: string;
  sizeBytes: number;
}) => {
  const mismatches = [
    artifact.sizeBytes !== sizeBytes ? `sizeBytes expected ${sizeBytes} received ${artifact.sizeBytes}` : undefined,
    artifact.sha256.toLowerCase() !== sha256 ? `sha256 expected ${sha256} received ${artifact.sha256}` : undefined,
    normalizeContentType(artifact.contentType) !== normalizeContentType(contentType)
      ? `contentType expected ${contentType} received ${artifact.contentType}`
      : undefined,
  ].filter(Boolean);

  if (mismatches.length) {
    throw new ArtifactIntegrityError(`Artifact upload failed integrity verification: ${mismatches.join('; ')}.`);
  }
};

const uploadImageWithIntegrity = async ({
  image,
  requestId,
  event,
}: {
  image: PreparedImageUpload;
  requestId: string;
  event?: unknown;
}) => {
  const result = await saveArtifactBytes({
    requestId,
    artifactKind: 'image',
    contentType: image.contentType,
    filename: image.filename,
    expectedSizeBytes: image.sizeBytes,
    expectedSha256: image.sha256,
    bytes: image.bytes,
    label: image.filename,
    tags: ['publisher-agent', 'image'],
    metadata: { source: 'publisher_agent', filename: image.filename },
    event,
  });

  if (!result.ok) {
    throw new ArtifactIntegrityError(`Artifact upload failed integrity verification: ${result.error}`);
  }

  verifyReturnedArtifact({
    artifact: result.artifact,
    contentType: image.contentType,
    sha256: image.sha256,
    sizeBytes: image.sizeBytes,
  });

  return result.artifact;
};

export const uploadImagesWithIntegrity = async ({
  images,
  requestId,
  event,
  onWorkflowError,
}: UploadImagesWithIntegrityInput) => {
  const verifiedArtifacts: ArtifactReference[] = [];

  try {
    const preparedImages = images.map((image, index) => prepareImageUpload(image, index));

    for (const image of preparedImages) {
      verifiedArtifacts.push(await uploadImageWithIntegrity({ image, requestId, event }));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Artifact upload failed integrity verification.';
    const workflowMessage = message.includes('Artifact upload failed integrity verification')
      ? message
      : `Artifact upload failed integrity verification: ${message}`;
    onWorkflowError?.(workflowMessage);
    throw new ArtifactIntegrityError(workflowMessage);
  }

  return verifiedArtifacts;
};

export const attachVerifiedArtifactsToFinalArticle = <T extends { artifactReferences?: ArtifactReference[] }>(
  finalArticle: T,
  verifiedArtifacts: ArtifactReference[]
) => ({
  ...finalArticle,
  artifactReferences: [...(finalArticle.artifactReferences ?? []), ...verifiedArtifacts],
});
