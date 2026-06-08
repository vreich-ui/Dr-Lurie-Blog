import { randomUUID } from 'node:crypto';

import { type ArtifactReference } from './artifacts.js';
import { sha256Hex } from './crypto.js';

export type UploadableImage = {
  base64?: string;
  content?: string;
  encoding?: string;
  name?: string;
  repoPath?: string;
  type?: string;
};

type McpToolCall = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

type UploadImagesWithIntegrityInput = {
  images: UploadableImage[];
  requestId: string;
  mcpToolCall: McpToolCall;
  onWorkflowError?: (message: string) => void;
  chunkSizeBytes?: number;
};

const DEFAULT_IMAGE_CHUNK_SIZE_BYTES = 6 * 1024;

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
  if (lowerName.endsWith('.svg')) return 'image/svg+xml';

  return 'application/octet-stream';
};

const normalizeContentType = (contentType: string) => contentType.split(';', 1)[0].trim().toLowerCase();

const getImageName = (image: UploadableImage, index: number) => {
  const name = image.name?.trim() || image.repoPath?.split('/').filter(Boolean).pop()?.trim();

  return name || `article-image-${index + 1}`;
};

const decodeImageBytes = (image: UploadableImage) => {
  const payload = image.base64 ?? image.content;
  if (!payload) {
    throw new ArtifactIntegrityError('Artifact upload failed integrity verification: image payload is missing.');
  }

  return Buffer.from(payload, image.encoding === 'binary' ? 'binary' : 'base64');
};

const assertArtifactReference = (value: unknown): ArtifactReference => {
  if (!value || typeof value !== 'object') {
    throw new ArtifactIntegrityError(
      'Artifact upload failed integrity verification: server did not return an artifact.'
    );
  }

  const artifact = value as Partial<ArtifactReference>;
  if (
    typeof artifact.blobKey !== 'string' ||
    typeof artifact.sha256 !== 'string' ||
    typeof artifact.sizeBytes !== 'number' ||
    typeof artifact.contentType !== 'string' ||
    typeof artifact.createdAtISO !== 'string'
  ) {
    throw new ArtifactIntegrityError(
      'Artifact upload failed integrity verification: server returned incomplete artifact metadata.'
    );
  }

  return artifact as ArtifactReference;
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
  index,
  requestId,
  mcpToolCall,
  chunkSizeBytes,
}: {
  image: UploadableImage;
  index: number;
  requestId: string;
  mcpToolCall: McpToolCall;
  chunkSizeBytes: number;
}) => {
  const bytes = decodeImageBytes(image);
  const filename = getImageName(image, index);
  const contentType = image.type?.trim() || inferContentTypeFromName(filename);
  const sizeBytes = bytes.byteLength;
  const sha256 = sha256Hex(bytes);
  const totalChunks = Math.max(1, Math.ceil(sizeBytes / chunkSizeBytes));
  const clientUploadId = randomUUID();
  let completedArtifact: ArtifactReference | undefined;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const chunk = bytes.subarray(chunkIndex * chunkSizeBytes, Math.min(sizeBytes, (chunkIndex + 1) * chunkSizeBytes));
    const result = await mcpToolCall('save_artifact_chunk', {
      requestId,
      artifactKind: 'image',
      contentType,
      clientUploadId,
      chunkIndex,
      totalChunks,
      filename,
      encoding: 'base64',
      expectedSizeBytes: sizeBytes,
      expectedSha256: sha256,
      payload: chunk.toString('base64'),
      metadata: { source: 'publisher_agent', filename },
    });

    if (result.complete === true) {
      completedArtifact = assertArtifactReference(result.artifact);
    }
  }

  if (!completedArtifact) {
    throw new ArtifactIntegrityError('Artifact upload failed integrity verification: chunked upload did not complete.');
  }

  verifyReturnedArtifact({ artifact: completedArtifact, contentType, sha256, sizeBytes });

  return completedArtifact;
};

export const uploadImagesWithIntegrity = async ({
  images,
  requestId,
  mcpToolCall,
  onWorkflowError,
  chunkSizeBytes = DEFAULT_IMAGE_CHUNK_SIZE_BYTES,
}: UploadImagesWithIntegrityInput) => {
  const verifiedArtifacts: ArtifactReference[] = [];

  try {
    for (let index = 0; index < images.length; index += 1) {
      verifiedArtifacts.push(
        await uploadImageWithIntegrity({ image: images[index], index, requestId, mcpToolCall, chunkSizeBytes })
      );
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
