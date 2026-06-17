import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { artifactKindValues, artifactReferenceLimits, isSafeArtifactFilename, isSafeArtifactText, safePathSegment, } from './artifacts.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore } from './blob-store.js';
import { sha256Hex } from './crypto.js';
import { signUploadSessionToken, validateUploadSessionToken } from './upload-session-tokens.js';
export const UPLOAD_SESSION_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
export const UPLOAD_SESSION_MAX_BYTES = 50 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
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
const uploadDirectorySchema = z
    .string()
    .trim()
    .min(1)
    .max(240)
    .refine((value) => {
    if (value.includes('\0') || value.includes('..') || value.includes('\\'))
        return false;
    const normalized = value.replace(/^\/+/, '').replace(/\/+$/, '');
    return normalized.startsWith('src/assets/images/uploads/');
}, {
    message: 'uploadDirectory must be under src/assets/images/uploads/ and must not contain .. or backslashes.',
});
const normalizeUploadDirectory = (value) => value ? value.trim().replace(/^\/+/, '').replace(/\/+$/, '') : undefined;
const appendUploadDirectoryMetadata = (input) => {
    const uploadDirectory = normalizeUploadDirectory(input.uploadDirectory);
    if (!uploadDirectory)
        return input;
    const filename = input.filename ? safePathSegment(input.filename) : undefined;
    const repoPath = filename ? `${uploadDirectory}/${filename}` : uploadDirectory;
    return {
        ...input,
        uploadDirectory,
        metadata: {
            ...(input.metadata ?? {}),
            uploadDirectory,
            repoPath,
        },
    };
};
const createUploadSessionSchema = z
    .object({
    requestId: z.string().min(1),
    artifactKind: z.enum(artifactKindValues),
    contentType: z.string().min(1),
    filename: safeArtifactFilenameSchema.optional(),
    expectedSizeBytes: z.number().int().nonnegative().max(UPLOAD_SESSION_MAX_BYTES),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    label: safeArtifactLabelSchema.optional(),
    tags: z.array(safeArtifactTagSchema).max(artifactReferenceLimits.tags).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    uploadDirectory: uploadDirectorySchema.optional(),
})
    .strict();
const finalizeUploadSessionSchema = createUploadSessionSchema.extend({
    sessionId: z.uuid(),
});
export const parseCreateUploadSessionInput = (input) => appendUploadDirectoryMetadata(createUploadSessionSchema.parse(input));
export const parseFinalizeUploadSessionInput = (input) => appendUploadDirectoryMetadata(finalizeUploadSessionSchema.parse(input));
export const uploadSessionManifestKey = (sessionId) => `artifact-upload-sessions/${sessionId}/manifest.json`;
export const uploadSessionChunkPrefix = (sessionId) => `upload-session/${sessionId}/`;
export const uploadSessionChunkKey = (sessionId, chunkIndex) => `${uploadSessionChunkPrefix(sessionId)}chunk-${chunkIndex}`;
const legacyUploadSessionChunkKey = (sessionId, chunkIndex) => `artifact-upload-sessions/${sessionId}/chunks/${chunkIndex}`;
const toArrayBufferBuffer = (value) => {
    if (value === null)
        return null;
    if (Buffer.isBuffer(value))
        return value;
    if (value instanceof ArrayBuffer)
        return Buffer.from(value);
    return Buffer.from(value);
};
export const getUploadSessionBaseUrl = (event) => {
    const relativeUrl = '/.netlify/functions/upload-session-chunk';
    if (!event || typeof event !== 'object' || !('headers' in event))
        return relativeUrl;
    const headers = event.headers;
    if (!headers)
        return relativeUrl;
    const host = headers.host || headers.Host;
    if (!host)
        return relativeUrl;
    const proto = headers['x-forwarded-proto'] || 'https';
    return `${proto}://${host}${relativeUrl}`;
};
export const createUploadSession = async (event, rawInput) => {
    const proxyInfo = {
        HTTPS_PROXY: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy),
        HTTP_PROXY: Boolean(process.env.HTTP_PROXY || process.env.http_proxy),
        ALL_PROXY: Boolean(process.env.ALL_PROXY || process.env.all_proxy),
    };
    console.log('Artifact upload session diagnostics:', {
        proxyInfo,
        hasEvent: Boolean(event),
        hasHeaders: Boolean(event?.headers),
    });
    const input = parseCreateUploadSessionInput(rawInput);
    const sessionId = randomUUID();
    const nowISO = new Date().toISOString();
    const expiresAtISO = new Date(Date.now() + UPLOAD_SESSION_TTL_MS).toISOString();
    const totalChunks = Math.max(1, Math.ceil(input.expectedSizeBytes / UPLOAD_SESSION_CHUNK_SIZE_BYTES));
    const uploadToken = signUploadSessionToken({
        sessionId,
        requestId: input.requestId,
        expectedSizeBytes: input.expectedSizeBytes,
        expiresAt: Date.parse(expiresAtISO),
        totalChunks,
        chunkSizeBytes: UPLOAD_SESSION_CHUNK_SIZE_BYTES,
    });
    const manifest = {
        sessionId,
        requestId: input.requestId,
        artifactKind: input.artifactKind,
        contentType: input.contentType,
        ...(input.filename ? { filename: input.filename } : {}),
        expectedSizeBytes: input.expectedSizeBytes,
        expectedSha256: input.expectedSha256.toLowerCase(),
        ...(input.label ? { label: input.label } : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.uploadDirectory ? { uploadDirectory: input.uploadDirectory } : {}),
        totalChunks,
        chunkSizeBytes: UPLOAD_SESSION_CHUNK_SIZE_BYTES,
        maxBytes: UPLOAD_SESSION_MAX_BYTES,
        expiresAtISO,
        createdAtISO: nowISO,
        updatedAtISO: nowISO,
        uploadedChunkIndexes: [],
        perChunk: {},
        receivedChunkIndexes: [],
        chunkDigests: {},
    };
    await setSessionManifest(event, manifest, {
        metadata: {
            sessionId,
            requestId: input.requestId,
            artifactKind: input.artifactKind,
            expectedSizeBytes: String(input.expectedSizeBytes),
            expectedSha256: input.expectedSha256.toLowerCase(),
            ...(input.uploadDirectory ? { uploadDirectory: input.uploadDirectory } : {}),
        },
    });
    const uploadUrl = getUploadSessionBaseUrl(event);
    try {
        const urlObj = new URL(uploadUrl, 'https://example.com');
        console.log('Artifact uploadUrl host:', {
            protocol: urlObj.protocol,
            host: urlObj.host,
        });
    }
    catch {
        console.warn('Failed to parse uploadUrl for logging:', uploadUrl);
    }
    return {
        sessionId,
        uploadUrl,
        uploadUrlBase: uploadUrl,
        uploadToken,
        chunkSizeBytes: UPLOAD_SESSION_CHUNK_SIZE_BYTES,
        maxBytes: UPLOAD_SESSION_MAX_BYTES,
        totalChunks,
    };
};
const normalizeSessionManifest = (manifest) => {
    const uploadedChunkIndexes = manifest.uploadedChunkIndexes ?? manifest.receivedChunkIndexes ?? [];
    const legacyChunkDigests = manifest.chunkDigests ?? {};
    const perChunk = manifest.perChunk ??
        Object.fromEntries(Object.entries(legacyChunkDigests).map(([index, digest]) => [
            index,
            {
                ...digest,
                updatedAt: manifest.updatedAtISO,
                ...(manifest.label ? { label: manifest.label } : {}),
                ...(manifest.tags?.length ? { tags: manifest.tags } : {}),
                ...(manifest.metadata ? { metadata: manifest.metadata } : {}),
            },
        ]));
    return {
        ...manifest,
        totalChunks: manifest.totalChunks ?? Math.max(1, Math.ceil(manifest.expectedSizeBytes / manifest.chunkSizeBytes)),
        uploadedChunkIndexes,
        perChunk,
        receivedChunkIndexes: uploadedChunkIndexes,
        chunkDigests: Object.fromEntries(Object.entries(perChunk).map(([index, digest]) => [index, { sizeBytes: digest.sizeBytes, sha256: digest.sha256 }])),
    };
};
export const getSessionManifest = async (event, sessionId) => {
    const key = uploadSessionManifestKey(sessionId);
    const indexStore = await getArtifactIndexBlobStore(event);
    const text = await indexStore.get(key);
    if (text)
        return normalizeSessionManifest(JSON.parse(text));
    const artifactStore = await getArtifactBlobStore(event);
    const legacyText = await artifactStore.get(key);
    if (!legacyText)
        return undefined;
    return normalizeSessionManifest(JSON.parse(legacyText));
};
export const readUploadSessionManifest = getSessionManifest;
export const setSessionManifest = async (event, manifest, options) => {
    const store = await getArtifactIndexBlobStore(event);
    await store.setJSON(uploadSessionManifestKey(manifest.sessionId), normalizeSessionManifest(manifest), options);
};
export const appendChunkIndex = (manifest, index) => {
    const uploadedChunkIndexes = new Set(manifest.uploadedChunkIndexes ?? manifest.receivedChunkIndexes ?? []);
    uploadedChunkIndexes.add(index);
    return [...uploadedChunkIndexes].sort((a, b) => a - b);
};
const getExpectedTotalChunks = (manifest) => Math.max(1, Math.ceil(manifest.expectedSizeBytes / manifest.chunkSizeBytes));
const getMissingChunkIndexes = (manifest) => {
    const totalChunks = manifest.totalChunks ?? getExpectedTotalChunks(manifest);
    const uploaded = new Set(manifest.uploadedChunkIndexes ?? manifest.receivedChunkIndexes ?? []);
    const missing = [];
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        if (!uploaded.has(chunkIndex))
            missing.push(chunkIndex);
    }
    return missing;
};
const validateManifestActive = (manifest) => {
    if (manifest.finalizedArtifact)
        return { ok: false, statusCode: 409, error: 'Upload session is already finalized.' };
    if (Date.parse(manifest.expiresAtISO) <= Date.now()) {
        return { ok: false, statusCode: 410, error: 'Upload session has expired.' };
    }
    return { ok: true };
};
export const storeUploadSessionChunk = async ({ event, sessionId, uploadToken, chunkIndex, totalChunks, bytes, chunkSha256, }) => {
    const store = await getArtifactBlobStore(event);
    const manifest = await readUploadSessionManifest(event, sessionId);
    if (!manifest)
        return { statusCode: 404, body: { error: 'Upload session not found.' } };
    const active = validateManifestActive(manifest);
    if (!active.ok)
        return { statusCode: active.statusCode, body: { error: active.error } };
    const tokenValidation = validateUploadSessionToken({
        token: uploadToken,
        expected: {
            sessionId: manifest.sessionId,
            requestId: manifest.requestId,
            expectedSizeBytes: manifest.expectedSizeBytes,
            totalChunks: manifest.totalChunks,
            chunkSizeBytes: manifest.chunkSizeBytes,
        },
    });
    if (!tokenValidation.ok) {
        return { statusCode: tokenValidation.statusCode, body: { error: tokenValidation.error } };
    }
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !Number.isInteger(totalChunks) || totalChunks < 1) {
        return { statusCode: 400, body: { error: 'Invalid chunk index or total chunks.' } };
    }
    if (chunkIndex >= totalChunks)
        return { statusCode: 400, body: { error: 'chunkIndex must be less than totalChunks.' } };
    if (bytes.byteLength > manifest.chunkSizeBytes) {
        return { statusCode: 413, body: { error: `Chunk exceeds maximum size of ${manifest.chunkSizeBytes} bytes.` } };
    }
    const expectedTotalChunks = getExpectedTotalChunks(manifest);
    if (totalChunks !== expectedTotalChunks) {
        return {
            statusCode: 400,
            body: { error: `totalChunks must be ${expectedTotalChunks} for this upload session.` },
        };
    }
    if (manifest.totalChunks !== totalChunks) {
        return { statusCode: 400, body: { error: 'totalChunks does not match the existing upload session manifest.' } };
    }
    const incomingDigest = { sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) };
    if (chunkSha256 && chunkSha256.toLowerCase() !== incomingDigest.sha256) {
        return { statusCode: 400, body: { error: 'x-chunk-sha256 does not match the uploaded chunk bytes.' } };
    }
    const existingDigest = manifest.perChunk[String(chunkIndex)] ?? manifest.chunkDigests?.[String(chunkIndex)];
    if (existingDigest &&
        (existingDigest.sizeBytes !== incomingDigest.sizeBytes ||
            existingDigest.sha256.toLowerCase() !== incomingDigest.sha256)) {
        return { statusCode: 409, body: { error: 'Chunk digest mismatch for existing chunk.' } };
    }
    if (!existingDigest)
        await store.set(uploadSessionChunkKey(sessionId, chunkIndex), bytes);
    const uploadedChunkIndexes = appendChunkIndex(manifest, chunkIndex);
    const updatedManifest = {
        ...manifest,
        totalChunks,
        uploadedChunkIndexes,
        receivedChunkIndexes: uploadedChunkIndexes,
        perChunk: {
            ...manifest.perChunk,
            [String(chunkIndex)]: {
                ...incomingDigest,
                updatedAt: new Date().toISOString(),
                ...(manifest.label ? { label: manifest.label } : {}),
                ...(manifest.tags?.length ? { tags: manifest.tags } : {}),
                ...(manifest.metadata ? { metadata: manifest.metadata } : {}),
            },
        },
        chunkDigests: { ...(manifest.chunkDigests ?? {}), [String(chunkIndex)]: incomingDigest },
        updatedAtISO: new Date().toISOString(),
    };
    await setSessionManifest(event, updatedManifest, {
        metadata: {
            sessionId,
            requestId: manifest.requestId,
            artifactKind: manifest.artifactKind,
            totalChunks: String(totalChunks),
            receivedChunks: String(updatedManifest.uploadedChunkIndexes.length),
        },
    });
    return {
        statusCode: 200,
        body: {
            ok: true,
            receivedBytes: bytes.byteLength,
            complete: updatedManifest.uploadedChunkIndexes.length === totalChunks,
            receivedChunks: updatedManifest.uploadedChunkIndexes.length,
            totalChunks,
        },
    };
};
const getChunkBytes = async (event, sessionId, chunkIndex) => {
    const store = await getArtifactBlobStore(event);
    const typedStore = store;
    const chunk = toArrayBufferBuffer(await typedStore.get(uploadSessionChunkKey(sessionId, chunkIndex), { type: 'arrayBuffer' }));
    if (chunk)
        return chunk;
    return toArrayBufferBuffer(await typedStore.get(legacyUploadSessionChunkKey(sessionId, chunkIndex), { type: 'arrayBuffer' }));
};
const assertFinalizeInputMatchesManifest = (input, manifest) => {
    const mismatches = [
        input.requestId !== manifest.requestId ? 'requestId does not match upload session.' : undefined,
        input.artifactKind !== manifest.artifactKind ? 'artifactKind does not match upload session.' : undefined,
        input.contentType !== manifest.contentType ? 'contentType does not match upload session.' : undefined,
        (input.filename ?? '') !== (manifest.filename ?? '') ? 'filename does not match upload session.' : undefined,
        input.expectedSizeBytes !== manifest.expectedSizeBytes
            ? 'expectedSizeBytes does not match upload session.'
            : undefined,
        input.expectedSha256.toLowerCase() !== manifest.expectedSha256.toLowerCase()
            ? 'expectedSha256 does not match upload session.'
            : undefined,
        (input.uploadDirectory ?? '') !== (manifest.uploadDirectory ?? '')
            ? 'uploadDirectory does not match upload session.'
            : undefined,
    ].filter(Boolean);
    return mismatches[0];
};
export const assembleUploadSessionBytes = async (event, manifest) => {
    const totalChunks = manifest.totalChunks ?? getExpectedTotalChunks(manifest);
    const chunks = [];
    let totalSizeBytes = 0;
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const chunk = await getChunkBytes(event, manifest.sessionId, chunkIndex);
        if (!chunk)
            return { ok: false, error: `Upload session is missing chunk ${chunkIndex}.` };
        const digest = manifest.perChunk[String(chunkIndex)] ?? manifest.chunkDigests?.[String(chunkIndex)];
        const actualDigest = { sizeBytes: chunk.byteLength, sha256: sha256Hex(chunk) };
        if (!digest || digest.sizeBytes !== actualDigest.sizeBytes || digest.sha256 !== actualDigest.sha256) {
            return { ok: false, error: `Upload session chunk ${chunkIndex} failed integrity verification.` };
        }
        totalSizeBytes += chunk.byteLength;
        chunks.push(chunk);
    }
    if (totalSizeBytes !== manifest.expectedSizeBytes) {
        return {
            ok: false,
            error: `Upload session reconstructed size ${totalSizeBytes} does not match expectedSizeBytes ${manifest.expectedSizeBytes}.`,
        };
    }
    const bytes = Buffer.concat(chunks, totalSizeBytes);
    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== manifest.expectedSha256.toLowerCase()) {
        return { ok: false, error: 'Upload session reconstructed sha256 does not match expectedSha256.' };
    }
    return { ok: true, bytes };
};
export const getFinalizeUploadSessionPayload = async (event, rawInput) => {
    const input = parseFinalizeUploadSessionInput(rawInput);
    const manifest = await readUploadSessionManifest(event, input.sessionId);
    if (!manifest)
        return { ok: false, statusCode: 404, error: 'Upload session not found.' };
    if (manifest.finalizedArtifact) {
        return { ok: true, alreadyFinalized: true, manifest, artifact: manifest.finalizedArtifact };
    }
    if (Date.parse(manifest.expiresAtISO) <= Date.now()) {
        return { ok: false, statusCode: 410, error: 'Upload session has expired.' };
    }
    const mismatch = assertFinalizeInputMatchesManifest(input, manifest);
    if (mismatch)
        return { ok: false, statusCode: 400, error: mismatch };
    const totalChunks = manifest.totalChunks ?? getExpectedTotalChunks(manifest);
    const missingChunkIndexes = getMissingChunkIndexes(manifest);
    if (missingChunkIndexes.length > 0 || manifest.uploadedChunkIndexes.length !== totalChunks) {
        return {
            ok: false,
            statusCode: 409,
            error: `Upload session is incomplete; missing chunk indexes: ${missingChunkIndexes.join(', ') || 'unknown'}.`,
        };
    }
    const assembled = await assembleUploadSessionBytes(event, manifest);
    if (!assembled.ok)
        return { ok: false, statusCode: 409, error: assembled.error };
    return {
        ok: true,
        alreadyFinalized: false,
        manifest,
        bytes: assembled.bytes,
        uploadInput: {
            requestId: manifest.requestId,
            artifactKind: manifest.artifactKind,
            contentType: manifest.contentType,
            filename: manifest.filename,
            expectedSizeBytes: manifest.expectedSizeBytes,
            expectedSha256: manifest.expectedSha256,
            payload: '',
            label: manifest.label,
            tags: manifest.tags,
            metadata: manifest.metadata,
        },
    };
};
export const markUploadSessionFinalized = async (event, manifest, artifact) => {
    const updatedManifest = {
        ...manifest,
        finalizedArtifact: artifact,
        finalizedAtISO: new Date().toISOString(),
        updatedAtISO: new Date().toISOString(),
    };
    await setSessionManifest(event, updatedManifest, {
        metadata: {
            sessionId: manifest.sessionId,
            requestId: manifest.requestId,
            artifactKind: manifest.artifactKind,
            finalized: 'true',
        },
    });
};
export const cleanupUploadSessionChunks = async (event, manifest) => {
    const store = await getArtifactBlobStore(event);
    const totalChunks = manifest.totalChunks ?? getExpectedTotalChunks(manifest);
    await Promise.allSettled(Array.from({ length: totalChunks }, async (_, chunkIndex) => {
        await store.del?.(uploadSessionChunkKey(manifest.sessionId, chunkIndex));
        await store.del?.(legacyUploadSessionChunkKey(manifest.sessionId, chunkIndex));
    }));
};
export const getUploadSessionSafeRequestSegment = (requestId) => safePathSegment(requestId) || 'request';
