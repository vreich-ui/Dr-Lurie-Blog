/**
 * Function name: Save_Artifact
 * Required method: POST
 * Required header: x-publish-key
 * Stores:
 * - artifacts: final binary artifact bytes and temporary upload chunks
 * - artifact-index: JSON request artifact reference indexes
 */
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ArtifactKind, artifactReferenceLimits, artifactKindValues, createArtifactReference, isArtifactReference, isSafeArtifactFilename, isSafeArtifactText, safePathSegment, } from '../lib/artifacts.js';
import { getHeader } from '../lib/admin-auth.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore } from '../lib/blob-store.js';
import { sha256Hex } from '../lib/crypto.js';
import { ImageValidationError, validatePublishImageBytes } from '../lib/image-validation.js';
const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};
const safeArtifactFilenameSchema = z
    .string()
    .trim()
    .min(1)
    .max(artifactReferenceLimits.originalFilename)
    .refine((value) => isSafeArtifactFilename(value), {
    message: 'filename must not contain control characters, angle brackets, or path separators.',
});
const safeArtifactLabelSchema = z
    .string()
    .trim()
    .min(1)
    .max(artifactReferenceLimits.label)
    .refine((value) => isSafeArtifactText(value, artifactReferenceLimits.label), {
    message: 'label must not contain control characters or angle brackets.',
});
const safeArtifactTagSchema = z
    .string()
    .trim()
    .min(1)
    .max(artifactReferenceLimits.tag)
    .refine((value) => isSafeArtifactText(value, artifactReferenceLimits.tag), {
    message: 'tags must not contain control characters or angle brackets.',
});
const uploadSchema = z
    .object({
    requestId: z.string().min(1),
    artifactKind: z.enum(artifactKindValues),
    contentType: z.string().min(1),
    filename: safeArtifactFilenameSchema.optional(),
    clientUploadId: z.uuid().optional(),
    chunkIndex: z.number().int().nonnegative().optional(),
    totalChunks: z.number().int().positive().max(10_000).optional(),
    encoding: z.enum(['base64', 'binary']).optional(),
    expectedSizeBytes: z.number().int().nonnegative().optional(),
    expectedSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/i)
        .optional(),
    localSizeBytes: z.number().int().nonnegative().optional(),
    localSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/i)
        .optional(),
    payload: z.string(),
    label: safeArtifactLabelSchema.optional(),
    tags: z.array(safeArtifactTagSchema).max(artifactReferenceLimits.tags).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
})
    .strict()
    .superRefine((value, context) => {
    const hasChunkIndex = value.chunkIndex !== undefined;
    const hasTotalChunks = value.totalChunks !== undefined;
    if (hasChunkIndex !== hasTotalChunks) {
        context.addIssue({
            code: 'custom',
            path: hasChunkIndex ? ['totalChunks'] : ['chunkIndex'],
            message: 'chunkIndex and totalChunks must be supplied together.',
        });
    }
    if (hasChunkIndex && !value.clientUploadId) {
        context.addIssue({
            code: 'custom',
            path: ['clientUploadId'],
            message: 'clientUploadId is required for chunked uploads.',
        });
    }
    if (value.expectedSizeBytes !== undefined &&
        value.localSizeBytes !== undefined &&
        value.expectedSizeBytes !== value.localSizeBytes) {
        context.addIssue({
            code: 'custom',
            path: ['localSizeBytes'],
            message: 'localSizeBytes must match expectedSizeBytes when both are supplied.',
        });
    }
    if (value.expectedSha256 !== undefined &&
        value.localSha256 !== undefined &&
        value.expectedSha256.toLowerCase() !== value.localSha256.toLowerCase()) {
        context.addIssue({
            code: 'custom',
            path: ['localSha256'],
            message: 'localSha256 must match expectedSha256 when both are supplied.',
        });
    }
    if (value.chunkIndex !== undefined && value.totalChunks !== undefined && value.chunkIndex >= value.totalChunks) {
        context.addIssue({
            code: 'custom',
            path: ['chunkIndex'],
            message: 'chunkIndex must be less than totalChunks.',
        });
    }
});
const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body),
});
const parseBody = (event) => {
    if (!event.body)
        return undefined;
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return JSON.parse(body);
};
const secretsMatch = (provided, expected) => {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length)
        return false;
    return timingSafeEqual(providedBuffer, expectedBuffer);
};
const verifyPublishKey = (event) => {
    const provided = getHeader(event.headers, 'x-publish-key');
    const expected = process.env.NETLIFY_PUBLISH_SECRET || process.env.PUBLISH_SECRET || '';
    if (!provided || !expected || !secretsMatch(provided, expected)) {
        return jsonResponse(401, { error: 'Unauthorized' });
    }
    return undefined;
};
const decodePayload = (input) => {
    if (input.encoding === 'binary')
        return Buffer.from(input.payload, 'binary');
    return Buffer.from(input.payload, 'base64');
};
const getTruncatedSha256 = (sha256) => sha256?.slice(0, 8);
const getExpectedSizeBytes = (input) => input.expectedSizeBytes ?? input.localSizeBytes;
const getExpectedSha256 = (input) => input.expectedSha256 ?? input.localSha256;
const logArtifactUpload = (event, input, logEvent, details = {}) => {
    const payload = typeof input.payload === 'string' ? input.payload : undefined;
    event.log?.({
        event: logEvent,
        requestId: event.requestId ?? input.requestId,
        rpcMethod: event.rpcMethod ?? null,
        slug: event.slug ?? null,
        uploadId: null,
        encoding: input.encoding ?? 'base64',
        payloadChars: payload?.length ?? null,
        payloadUtf8Bytes: payload === undefined ? null : Buffer.byteLength(payload, 'utf8'),
        decodedBytes: null,
        expectedSizeBytes: getExpectedSizeBytes(input) ?? null,
        expectedSha256: getTruncatedSha256(getExpectedSha256(input)) ?? null,
        ...details,
    });
};
const validateArtifactIntegrity = (event, input, bytes, uploadId) => {
    const sizeBytes = bytes.byteLength;
    const sha256 = sha256Hex(bytes);
    const expectedSizeBytes = getExpectedSizeBytes(input);
    const expectedSha256 = getExpectedSha256(input);
    if (expectedSizeBytes !== undefined && expectedSizeBytes !== sizeBytes) {
        logArtifactUpload(event, input, 'artifact_upload_size_mismatch', {
            uploadId: uploadId ?? null,
            decodedBytes: bytes.length,
            receivedSizeBytes: sizeBytes,
        });
        return jsonResponse(400, {
            error: `Artifact size mismatch: expected ${expectedSizeBytes} bytes, received ${sizeBytes} bytes.`,
        });
    }
    if (expectedSha256 !== undefined && expectedSha256.toLowerCase() !== sha256) {
        return jsonResponse(400, {
            error: `Artifact sha256 mismatch: expected ${expectedSha256}, received ${sha256}.`,
        });
    }
    return undefined;
};
const validateImageArtifact = async (input, bytes) => {
    if (input.artifactKind !== ArtifactKind.Image)
        return undefined;
    try {
        await validatePublishImageBytes({
            bytes,
            contentType: input.contentType,
            filename: input.filename,
            path: input.filename ?? 'artifact',
        });
    }
    catch (error) {
        if (error instanceof ImageValidationError) {
            return jsonResponse(400, { error: error.message });
        }
        throw error;
    }
    return undefined;
};
const validateFinalArtifact = async (event, input, bytes, uploadId) => {
    const integrityError = validateArtifactIntegrity(event, input, bytes, uploadId);
    if (integrityError)
        return integrityError;
    return validateImageArtifact(input, bytes);
};
const chunkUploadPrefix = (requestId, clientUploadId) => {
    return `artifact-chunks/${requestId}/${clientUploadId}/`;
};
const chunkKey = (requestId, clientUploadId, chunkIndex) => {
    return `${chunkUploadPrefix(requestId, clientUploadId)}${chunkIndex}`;
};
const chunkManifestKey = (requestId, clientUploadId) => {
    return `${chunkUploadPrefix(requestId, clientUploadId)}manifest.json`;
};
const requestArtifactIndexKey = (requestId, sha256) => {
    return `request-artifacts/${encodeURIComponent(requestId)}/${sha256}.json`;
};
const getArtifactKindFromReference = (reference) => {
    const [artifactKind] = reference.blobKey.split('/');
    return artifactKind;
};
const artifactPointerValue = (requestId, reference) => ({
    requestId,
    sha256: reference.sha256,
    artifactKind: getArtifactKindFromReference(reference),
});
const artifactKindPointerKey = (reference) => {
    const pointer = artifactPointerValue('', reference);
    return `by-kind/${pointer.artifactKind}/${reference.sha256}.json`;
};
const artifactRequestPointerKey = (requestId, reference) => {
    const pointer = artifactPointerValue(requestId, reference);
    return `by-request/${encodeURIComponent(requestId)}/${pointer.artifactKind}/${reference.sha256}.json`;
};
const artifactTagPointerKeys = (reference) => {
    const tags = reference.tags ?? [];
    return [...new Set(tags.map(safePathSegment).filter(Boolean))].map((tag) => `by-tag/${tag}/${reference.sha256}.json`);
};
const getArrayBuffer = async (store, key) => {
    const binaryStore = store;
    const value = await binaryStore.get(key, { type: 'arrayBuffer' });
    return value ? Buffer.from(value) : null;
};
const chunkStatusCache = new Map();
const chunkStatusCacheKey = (requestId, clientUploadId) => `${requestId}:${clientUploadId}`;
const toValidChunkIndexSet = (indexes, totalChunks) => {
    if (!Array.isArray(indexes))
        return new Set();
    return new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0 && index < totalChunks));
};
const readChunkManifestRecord = async (store, requestId, clientUploadId) => {
    const manifest = await store.get(chunkManifestKey(requestId, clientUploadId));
    if (!manifest)
        return undefined;
    try {
        const parsed = JSON.parse(manifest);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : undefined;
    }
    catch {
        return undefined;
    }
};
const readChunkManifest = async (store, requestId, clientUploadId, totalChunks) => {
    const parsed = await readChunkManifestRecord(store, requestId, clientUploadId);
    return toValidChunkIndexSet(parsed?.receivedChunkIndexes, totalChunks);
};
const validateChunkUploadManifest = async (store, input, bytes) => {
    const parsed = await readChunkManifestRecord(store, input.requestId, input.clientUploadId);
    if (!parsed)
        return undefined;
    if (parsed.totalChunks !== undefined && parsed.totalChunks !== input.totalChunks) {
        return jsonResponse(400, {
            error: `Chunk upload totalChunks mismatch for clientUploadId ${input.clientUploadId}: expected existing total ${parsed.totalChunks}, received ${input.totalChunks}.`,
        });
    }
    const expectedSizeBytes = getExpectedSizeBytes(input);
    const expectedSha256 = getExpectedSha256(input)?.toLowerCase();
    const manifestExpectedSha256 = parsed.expectedSha256?.toLowerCase();
    const mismatches = [
        parsed.artifactKind !== undefined && parsed.artifactKind !== input.artifactKind
            ? `artifactKind expected ${parsed.artifactKind} received ${input.artifactKind}`
            : undefined,
        parsed.contentType !== undefined && parsed.contentType !== input.contentType
            ? `contentType expected ${parsed.contentType} received ${input.contentType}`
            : undefined,
        parsed.filename !== undefined && parsed.filename !== input.filename
            ? `filename expected ${parsed.filename} received ${input.filename ?? ''}`
            : undefined,
        parsed.label !== undefined && parsed.label !== input.label
            ? `label expected ${parsed.label} received ${input.label ?? ''}`
            : undefined,
        parsed.tags !== undefined && (input.tags === undefined || parsed.tags.join('\0') !== input.tags.join('\0'))
            ? `tags expected ${parsed.tags.join(',')} received ${input.tags?.join(',') ?? ''}`
            : undefined,
        parsed.expectedSizeBytes !== undefined &&
            expectedSizeBytes !== undefined &&
            parsed.expectedSizeBytes !== expectedSizeBytes
            ? `expectedSizeBytes expected ${parsed.expectedSizeBytes} received ${expectedSizeBytes}`
            : undefined,
        manifestExpectedSha256 !== undefined && expectedSha256 !== undefined && manifestExpectedSha256 !== expectedSha256
            ? `expectedSha256 expected ${manifestExpectedSha256} received ${expectedSha256}`
            : undefined,
    ].filter(Boolean);
    if (mismatches.length) {
        return jsonResponse(400, {
            error: `Chunk upload metadata mismatch for clientUploadId ${input.clientUploadId}: ${mismatches.join('; ')}.`,
        });
    }
    const existingChunkDigest = parsed.chunkDigests?.[String(input.chunkIndex)];
    const incomingChunkDigest = { sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) };
    if (existingChunkDigest &&
        (existingChunkDigest.sizeBytes !== incomingChunkDigest.sizeBytes ||
            existingChunkDigest.sha256.toLowerCase() !== incomingChunkDigest.sha256)) {
        return jsonResponse(400, {
            error: `Chunk upload digest mismatch for clientUploadId ${input.clientUploadId} chunkIndex ${input.chunkIndex}.`,
        });
    }
    return undefined;
};
const writeChunkManifest = async (store, input, receivedChunkIndexes, bytes) => {
    const existingManifest = await readChunkManifestRecord(store, input.requestId, input.clientUploadId);
    const expectedSizeBytes = getExpectedSizeBytes(input);
    const expectedSha256 = getExpectedSha256(input)?.toLowerCase();
    const manifest = {
        requestId: input.requestId,
        clientUploadId: input.clientUploadId,
        totalChunks: input.totalChunks,
        artifactKind: input.artifactKind,
        contentType: input.contentType,
        ...(input.filename ? { filename: input.filename } : {}),
        ...(input.label ? { label: input.label } : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
        ...(expectedSizeBytes !== undefined ? { expectedSizeBytes } : {}),
        ...(expectedSha256 ? { expectedSha256 } : {}),
        receivedChunkIndexes: [...receivedChunkIndexes].sort((a, b) => a - b),
        chunkDigests: {
            ...(existingManifest?.chunkDigests ?? {}),
            [String(input.chunkIndex)]: { sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) },
        },
        updatedAtISO: new Date().toISOString(),
    };
    await store.setJSON(chunkManifestKey(input.requestId, input.clientUploadId), manifest, {
        metadata: {
            requestId: input.requestId,
            clientUploadId: input.clientUploadId,
            totalChunks: String(input.totalChunks),
            receivedChunks: String(manifest.receivedChunkIndexes.length),
        },
    });
};
const getVisibleChunkIndexes = async (store, requestId, clientUploadId, totalChunks) => {
    const receivedChunkIndexes = new Set();
    // Intentionally avoid prefix listing because list visibility can lag behind recent writes in Netlify Blob runtime.
    for (let index = 0; index < totalChunks; index += 1) {
        const chunk = await getArrayBuffer(store, chunkKey(requestId, clientUploadId, index));
        if (chunk)
            receivedChunkIndexes.add(index);
    }
    return receivedChunkIndexes;
};
const toChunkStatus = (requestId, clientUploadId, totalChunks, receivedChunkIndexes) => {
    const cacheKey = chunkStatusCacheKey(requestId, clientUploadId);
    const previousReceivedChunks = chunkStatusCache.get(cacheKey) ?? 0;
    const receivedChunks = Math.min(totalChunks, Math.max(previousReceivedChunks, receivedChunkIndexes.size));
    chunkStatusCache.set(cacheKey, receivedChunks);
    return {
        complete: receivedChunks === totalChunks,
        receivedChunks,
        totalChunks,
    };
};
export const saveUploadedChunk = async (store, requestId, clientUploadId, chunkIndex, totalChunks, bytes, uploadInput) => {
    await store.set(chunkKey(requestId, clientUploadId, chunkIndex), bytes, {
        metadata: {
            requestId,
            clientUploadId,
            chunkIndex: String(chunkIndex),
            totalChunks: String(totalChunks),
        },
    });
    const [manifestChunkIndexes, visibleChunkIndexes] = await Promise.all([
        readChunkManifest(store, requestId, clientUploadId, totalChunks),
        getVisibleChunkIndexes(store, requestId, clientUploadId, totalChunks),
    ]);
    const receivedChunkIndexes = new Set([...manifestChunkIndexes, ...visibleChunkIndexes, chunkIndex]);
    await writeChunkManifest(store, uploadInput ?? {
        requestId,
        clientUploadId,
        chunkIndex,
        totalChunks,
        artifactKind: ArtifactKind.Data,
        contentType: 'application/octet-stream',
        payload: '',
    }, receivedChunkIndexes, bytes);
    return toChunkStatus(requestId, clientUploadId, totalChunks, receivedChunkIndexes);
};
const mergeChunkManifestIntegrity = async (store, input) => {
    const manifest = await readChunkManifestRecord(store, input.requestId, input.clientUploadId);
    if (!manifest)
        return input;
    return {
        ...input,
        label: input.label ?? manifest.label,
        tags: input.tags ?? manifest.tags,
        expectedSizeBytes: input.expectedSizeBytes ?? input.localSizeBytes ?? manifest.expectedSizeBytes,
        expectedSha256: input.expectedSha256 ?? input.localSha256 ?? manifest.expectedSha256,
    };
};
const assembleChunks = async (store, requestId, clientUploadId, totalChunks) => {
    const chunks = [];
    for (let index = 0; index < totalChunks; index += 1) {
        const chunk = await getArrayBuffer(store, chunkKey(requestId, clientUploadId, index));
        if (!chunk)
            return null;
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};
const waitForStoredBytesRetry = (attemptIndex) => {
    const baseDelayMs = 25 * 2 ** attemptIndex;
    const jitterMs = Math.floor(Math.random() * 10);
    return new Promise((resolve) => setTimeout(resolve, baseDelayMs + jitterMs));
};
const readStoredBytes = async (store, key, options = {}) => {
    const maxAttempts = options.retry === false ? 1 : 5;
    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
        const storedBytes = await getArrayBuffer(store, key);
        if (storedBytes)
            return storedBytes;
        if (attemptIndex < maxAttempts - 1)
            await waitForStoredBytesRetry(attemptIndex);
    }
    return null;
};
const validateStoredBytes = async (store, reference) => {
    const storedBytes = await readStoredBytes(store, reference.blobKey);
    if (!storedBytes) {
        await store.del(reference.blobKey);
        return jsonResponse(500, { error: 'Artifact blob write failed: stored bytes could not be read back.' });
    }
    const storedSizeBytes = storedBytes.byteLength;
    const storedSha256 = sha256Hex(storedBytes);
    if (storedSizeBytes !== reference.sizeBytes || storedSha256 !== reference.sha256) {
        await store.del(reference.blobKey);
        return jsonResponse(500, {
            error: `Artifact blob write failed integrity verification: expected ${reference.sizeBytes} bytes/${reference.sha256}, stored ${storedSizeBytes} bytes/${storedSha256}.`,
        });
    }
    return undefined;
};
const saveFinalArtifact = async (store, reference, bytes) => {
    if (await readStoredBytes(store, reference.blobKey, { retry: false })) {
        const existingIntegrityError = await validateStoredBytes(store, reference);
        if (existingIntegrityError)
            return { deduped: true, integrityError: existingIntegrityError };
        return { deduped: true };
    }
    await store.set(reference.blobKey, bytes, {
        onlyIfNew: true,
        metadata: {
            contentType: reference.contentType,
            sha256: reference.sha256,
            sizeBytes: String(reference.sizeBytes),
            createdAtISO: reference.createdAtISO,
        },
    });
    const integrityError = await validateStoredBytes(store, reference);
    return { deduped: false, integrityError };
};
const getExistingReference = async (store, requestId, sha256) => {
    const existing = await store.get(requestArtifactIndexKey(requestId, sha256));
    if (!existing)
        return undefined;
    try {
        const parsed = JSON.parse(existing);
        return isArtifactReference(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
};
const saveReferencePointers = async (store, requestId, reference) => {
    const pointer = artifactPointerValue(requestId, reference);
    const pointerMetadata = {
        requestId,
        sha256: reference.sha256,
        artifactKind: pointer.artifactKind,
    };
    const pointerWrites = [
        store.setJSON(artifactKindPointerKey(reference), pointer, { metadata: pointerMetadata }),
        store.setJSON(artifactRequestPointerKey(requestId, reference), pointer, { metadata: pointerMetadata }),
        ...artifactTagPointerKeys(reference).map((key) => store.setJSON(key, pointer, { metadata: pointerMetadata })),
    ];
    await Promise.all(pointerWrites);
};
const saveReference = async (store, requestId, reference) => {
    await store.setJSON(requestArtifactIndexKey(requestId, reference.sha256), reference, {
        metadata: {
            requestId,
            sha256: reference.sha256,
            contentType: reference.contentType,
        },
    });
    await saveReferencePointers(store, requestId, reference);
};
const mergeArtifactReferenceDisplayFields = (existingReference, newReference) => ({
    ...existingReference,
    originalFilename: existingReference.originalFilename ?? newReference.originalFilename,
    label: existingReference.label ?? newReference.label,
    tags: existingReference.tags ?? newReference.tags,
});
const shouldSaveArtifactReference = (existingReference, responseReference) => {
    if (!existingReference || existingReference.blobKey !== responseReference.blobKey)
        return true;
    return (existingReference.originalFilename !== responseReference.originalFilename ||
        existingReference.label !== responseReference.label ||
        existingReference.tags?.join('\0') !== responseReference.tags?.join('\0'));
};
export const finalizeUpload = async (event, input, finalBytes, chunkStatus) => {
    const reference = createArtifactReference({ input, bytes: finalBytes });
    logArtifactUpload(event, input, 'artifact_upload_finalize_started', {
        uploadId: reference.blobKey,
        decodedBytes: finalBytes.length,
    });
    const validationError = await validateFinalArtifact(event, input, finalBytes, reference.blobKey);
    if (validationError)
        return validationError;
    const artifactStore = await getArtifactBlobStore(event);
    const indexStore = await getArtifactIndexBlobStore(event);
    const { deduped, integrityError } = await saveFinalArtifact(artifactStore, reference, finalBytes);
    if (integrityError)
        return integrityError;
    const existingReference = deduped
        ? await getExistingReference(indexStore, input.requestId, reference.sha256)
        : undefined;
    const responseReference = existingReference?.blobKey === reference.blobKey
        ? mergeArtifactReferenceDisplayFields(existingReference, reference)
        : reference;
    if (shouldSaveArtifactReference(existingReference, responseReference)) {
        await saveReference(indexStore, input.requestId, responseReference);
    }
    else {
        await saveReferencePointers(indexStore, input.requestId, responseReference);
    }
    logArtifactUpload(event, input, 'artifact_upload_finalize_completed', {
        uploadId: responseReference.blobKey,
        decodedBytes: finalBytes.length,
    });
    return jsonResponse(deduped ? 200 : 201, {
        ok: true,
        complete: true,
        deduped,
        artifact: responseReference,
        ...(chunkStatus ? { receivedChunks: chunkStatus.receivedChunks, totalChunks: chunkStatus.totalChunks } : {}),
    });
};
export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }
    const unauthorized = verifyPublishKey(event);
    if (unauthorized)
        return unauthorized;
    let parsedBody;
    try {
        parsedBody = parseBody(event);
    }
    catch {
        return jsonResponse(400, { error: 'Invalid request body' });
    }
    const parsedInput = uploadSchema.safeParse(parsedBody);
    if (!parsedInput.success) {
        return jsonResponse(400, { error: 'Invalid artifact upload input', issues: parsedInput.error.issues });
    }
    const input = parsedInput.data;
    logArtifactUpload(event, input, 'artifact_upload_decode_started');
    const bytes = decodePayload(input);
    if (input.chunkIndex === undefined || input.totalChunks === undefined || !input.clientUploadId) {
        const reference = createArtifactReference({ input, bytes });
        logArtifactUpload(event, input, 'artifact_upload_decode_completed', {
            uploadId: reference.blobKey,
            decodedBytes: bytes.length,
        });
        return finalizeUpload(event, input, bytes);
    }
    const chunkInput = {
        ...input,
        clientUploadId: input.clientUploadId,
        chunkIndex: input.chunkIndex,
        totalChunks: input.totalChunks,
    };
    const artifactStore = await getArtifactBlobStore(event);
    const chunkManifestValidationError = await validateChunkUploadManifest(artifactStore, chunkInput, bytes);
    if (chunkManifestValidationError)
        return chunkManifestValidationError;
    const status = await saveUploadedChunk(artifactStore, chunkInput.requestId, chunkInput.clientUploadId, chunkInput.chunkIndex, chunkInput.totalChunks, bytes, chunkInput);
    if (!status.complete) {
        return jsonResponse(202, {
            ok: true,
            complete: false,
            receivedChunks: status.receivedChunks,
            totalChunks: status.totalChunks,
        });
    }
    const assembledBytes = await assembleChunks(artifactStore, chunkInput.requestId, chunkInput.clientUploadId, chunkInput.totalChunks);
    if (!assembledBytes) {
        return jsonResponse(202, {
            ok: true,
            complete: false,
            receivedChunks: status.receivedChunks,
            totalChunks: status.totalChunks,
        });
    }
    const finalInput = await mergeChunkManifestIntegrity(artifactStore, chunkInput);
    return finalizeUpload(event, finalInput, assembledBytes, status);
};
