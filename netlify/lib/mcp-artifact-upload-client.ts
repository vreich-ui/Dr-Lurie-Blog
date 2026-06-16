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
type BinaryChunkUpload = (input: {
  bytes: Buffer;
  chunkIndex: number;
  totalChunks: number;
  uploadToken: string;
  uploadUrl: string;
  sessionId: string;
  filename: string;
}) => Promise<Record<string, unknown>>;

type UploadImagesWithIntegrityInput = {
  images: UploadableImage[];
  requestId: string;
  mcpToolCall: McpToolCall;
  binaryChunkUpload?: BinaryChunkUpload;
  onWorkflowError?: (message: string) => void;
  chunkSizeBytes?: number;
};

type PreparedImageUpload = {
  bytes: Buffer;
  contentType: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
};

const DEFAULT_IMAGE_CHUNK_SIZE_BYTES = 6 * 1024;
// Temporarily keep single-shot uploads tiny while MCP base64 payload limits are characterized.
const SINGLE_SHOT_UPLOAD_MAX_BYTES = 3 * 1024;
const UPLOAD_SESSION_MAX_BYTES = 50 * 1024 * 1024;
const FINAL_CHUNK_RETRY_ATTEMPTS = 3;

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

const logUploadPathSelection = ({
  filename,
  requestId,
  sizeBytes,
  uploadPath,
}: {
  filename: string;
  requestId: string;
  sizeBytes: number;
  uploadPath: 'single-shot' | 'upload-session' | 'legacy-chunks';
}) => {
  console.log(
    JSON.stringify({
      event: 'artifact_upload_path_selected',
      requestId,
      filename,
      sizeBytes,
      uploadPath,
      singleShotMaxBytes: SINGLE_SHOT_UPLOAD_MAX_BYTES,
      uploadSessionMaxBytes: UPLOAD_SESSION_MAX_BYTES,
    })
  );
};

const logUploadSessionFallback = ({
  filename,
  requestId,
  sizeBytes,
  error,
}: {
  filename: string;
  requestId: string;
  sizeBytes: number;
  error: unknown;
}) => {
  console.warn(
    JSON.stringify({
      event: 'artifact_upload_session_fallback',
      requestId,
      filename,
      sizeBytes,
      fallbackUploadPath: 'legacy-chunks',
      reason: error instanceof Error ? error.message : String(error),
    })
  );
};

const defaultBinaryChunkUpload: BinaryChunkUpload = async ({
  bytes,
  chunkIndex,
  totalChunks,
  uploadToken,
  uploadUrl,
  sessionId,
}) => {
  if (typeof fetch !== 'function') {
    throw new ArtifactIntegrityError('Artifact upload failed integrity verification: fetch is unavailable.');
  }

  const uploadWithMethod = async (method: 'PUT' | 'POST') => {
    const response = await fetch(uploadUrl, {
      method,
      headers: {
        'content-type': 'application/octet-stream',
        'x-upload-token': uploadToken,
        'x-session-id': sessionId,
        'x-chunk-index': String(chunkIndex),
        'x-total-chunks': String(totalChunks),
        'x-chunk-sha256': sha256Hex(bytes),
      },
      body: new Uint8Array(bytes),
    });
    const body = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      throw new ArtifactIntegrityError(
        `Artifact upload failed integrity verification: ${typeof body.error === 'string' ? body.error : response.statusText}.`
      );
    }

    return body;
  };

  try {
    return await uploadWithMethod('PUT');
  } catch (error) {
    if (error instanceof ArtifactIntegrityError) throw error;
    return uploadWithMethod('POST');
  }
};

const uploadImageWithLegacyChunks = async ({
  image,
  requestId,
  mcpToolCall,
  chunkSizeBytes,
}: {
  image: PreparedImageUpload;
  requestId: string;
  mcpToolCall: McpToolCall;
  chunkSizeBytes: number;
}) => {
  const { bytes, contentType, filename, sha256, sizeBytes } = image;
  const totalChunks = Math.max(1, Math.ceil(sizeBytes / chunkSizeBytes));
  const clientUploadId = randomUUID();
  let completedArtifact: ArtifactReference | undefined;

  const uploadChunk = async (chunkIndex: number) => {
    const chunk = bytes.subarray(chunkIndex * chunkSizeBytes, Math.min(sizeBytes, (chunkIndex + 1) * chunkSizeBytes));

    return mcpToolCall('save_artifact_chunk', {
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
      label: filename,
      tags: ['publisher-agent', 'image'],
      metadata: { source: 'publisher_agent', filename },
    });
  };

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const result = await uploadChunk(chunkIndex);

    if (result.complete === true) {
      completedArtifact = assertArtifactReference(result.artifact);
    }
  }

  for (let attempt = 0; !completedArtifact && attempt < FINAL_CHUNK_RETRY_ATTEMPTS; attempt += 1) {
    const result = await uploadChunk(totalChunks - 1);

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

const uploadImageSingleShot = async ({
  image,
  requestId,
  mcpToolCall,
}: {
  image: PreparedImageUpload;
  requestId: string;
  mcpToolCall: McpToolCall;
}) => {
  const { bytes, contentType, filename, sha256, sizeBytes } = image;
  const result = await mcpToolCall('save_artifact', {
    requestId,
    artifactKind: 'image',
    contentType,
    filename,
    encoding: 'base64',
    expectedSizeBytes: sizeBytes,
    expectedSha256: sha256,
    payload: bytes.toString('base64'),
    label: filename,
    tags: ['publisher-agent', 'image'],
    metadata: { source: 'publisher_agent', filename },
  });
  const artifact = assertArtifactReference(result.artifact);

  verifyReturnedArtifact({ artifact, contentType, sha256, sizeBytes });

  return artifact;
};

const uploadImageWithSession = async ({
  image,
  requestId,
  mcpToolCall,
  binaryChunkUpload,
}: {
  image: PreparedImageUpload;
  requestId: string;
  mcpToolCall: McpToolCall;
  binaryChunkUpload: BinaryChunkUpload;
}) => {
  const { bytes, contentType, filename, sha256, sizeBytes } = image;
  const session = await mcpToolCall('create_upload_session', {
    requestId,
    artifactKind: 'image',
    contentType,
    filename,
    expectedSizeBytes: sizeBytes,
    expectedSha256: sha256,
    label: filename,
    tags: ['publisher-agent', 'image'],
    metadata: { source: 'publisher_agent', filename },
  });
  const sessionId = typeof session.sessionId === 'string' ? session.sessionId : undefined;
  const uploadUrl =
    typeof session.uploadUrl === 'string'
      ? session.uploadUrl
      : typeof session.uploadUrlBase === 'string'
        ? session.uploadUrlBase
        : undefined;
  const uploadToken = typeof session.uploadToken === 'string' ? session.uploadToken : undefined;
  const chunkSizeBytes = typeof session.chunkSizeBytes === 'number' ? session.chunkSizeBytes : undefined;

  if (!sessionId || !uploadUrl || !uploadToken || !chunkSizeBytes) {
    throw new ArtifactIntegrityError('Artifact upload failed integrity verification: incomplete upload session.');
  }

  const totalChunks = Math.max(1, Math.ceil(sizeBytes / chunkSizeBytes));
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const chunk = bytes.subarray(chunkIndex * chunkSizeBytes, Math.min(sizeBytes, (chunkIndex + 1) * chunkSizeBytes));
    await binaryChunkUpload({ bytes: chunk, chunkIndex, totalChunks, uploadToken, uploadUrl, sessionId, filename });
  }

  const finalizeResult = await mcpToolCall('finalize_upload_session', {
    sessionId,
    requestId,
    artifactKind: 'image',
    contentType,
    filename,
    expectedSizeBytes: sizeBytes,
    expectedSha256: sha256,
    label: filename,
    tags: ['publisher-agent', 'image'],
    metadata: { source: 'publisher_agent', filename },
  });
  const artifact = assertArtifactReference(finalizeResult.artifact);

  verifyReturnedArtifact({ artifact, contentType, sha256, sizeBytes });

  return artifact;
};

const uploadImageWithIntegrity = async ({
  image,
  requestId,
  mcpToolCall,
  binaryChunkUpload,
  chunkSizeBytes,
}: {
  image: PreparedImageUpload;
  requestId: string;
  mcpToolCall: McpToolCall;
  binaryChunkUpload: BinaryChunkUpload;
  chunkSizeBytes: number;
}) => {
  if (image.sizeBytes <= SINGLE_SHOT_UPLOAD_MAX_BYTES) {
    logUploadPathSelection({
      filename: image.filename,
      requestId,
      sizeBytes: image.sizeBytes,
      uploadPath: 'single-shot',
    });
    return uploadImageSingleShot({ image, requestId, mcpToolCall });
  }

  if (image.sizeBytes <= UPLOAD_SESSION_MAX_BYTES) {
    logUploadPathSelection({
      filename: image.filename,
      requestId,
      sizeBytes: image.sizeBytes,
      uploadPath: 'upload-session',
    });
    try {
      return await uploadImageWithSession({ image, requestId, mcpToolCall, binaryChunkUpload });
    } catch (error) {
      logUploadSessionFallback({ filename: image.filename, requestId, sizeBytes: image.sizeBytes, error });
      logUploadPathSelection({
        filename: image.filename,
        requestId,
        sizeBytes: image.sizeBytes,
        uploadPath: 'legacy-chunks',
      });
      return uploadImageWithLegacyChunks({ image, requestId, mcpToolCall, chunkSizeBytes });
    }
  }

  logUploadPathSelection({
    filename: image.filename,
    requestId,
    sizeBytes: image.sizeBytes,
    uploadPath: 'legacy-chunks',
  });
  return uploadImageWithLegacyChunks({ image, requestId, mcpToolCall, chunkSizeBytes });
};

export const uploadImagesWithIntegrity = async ({
  images,
  requestId,
  mcpToolCall,
  binaryChunkUpload = defaultBinaryChunkUpload,
  onWorkflowError,
  chunkSizeBytes = DEFAULT_IMAGE_CHUNK_SIZE_BYTES,
}: UploadImagesWithIntegrityInput) => {
  const verifiedArtifacts: ArtifactReference[] = [];

  try {
    const preparedImages = images.map((image, index) => prepareImageUpload(image, index));

    for (let index = 0; index < preparedImages.length; index += 1) {
      verifiedArtifacts.push(
        await uploadImageWithIntegrity({
          image: preparedImages[index],
          requestId,
          mcpToolCall,
          binaryChunkUpload,
          chunkSizeBytes,
        })
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
