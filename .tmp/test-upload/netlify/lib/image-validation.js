import path from 'node:path';
import sharp from 'sharp';
const supportedFormats = new Set(['jpeg', 'png', 'webp']);
const formatLabels = {
    jpeg: 'JPEG',
    png: 'PNG',
    webp: 'WebP',
};
const extensionFormats = {
    '.jpg': 'jpeg',
    '.jpeg': 'jpeg',
    '.png': 'png',
    '.webp': 'webp',
};
const contentTypeFormats = {
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
};
export class ImageValidationError extends Error {
    code;
    imageName;
    path;
    reason;
    constructor({ code, imageName, path, reason, }) {
        super(`Invalid image artifact: ${imageName} ${reason}. Re-upload or replace this image.`);
        this.name = 'ImageValidationError';
        this.code = code;
        this.imageName = imageName;
        this.path = path;
        this.reason = reason;
    }
}
const normalizeContentType = (contentType) => contentType?.toLowerCase().split(';')[0]?.trim();
const getExpectedFormats = ({ path: repoPath, contentType }) => {
    const extensionFormat = extensionFormats[path.extname(repoPath).toLowerCase()];
    const normalizedContentType = normalizeContentType(contentType);
    const contentTypeFormat = normalizedContentType ? contentTypeFormats[normalizedContentType] : undefined;
    return { contentTypeFormat, extensionFormat, normalizedContentType };
};
const formatLabel = (format) => (format ? (formatLabels[format] ?? format.toUpperCase()) : 'image');
export const validatePublishImageBytes = async ({ bytes, contentType, filename, path: repoPath, }) => {
    const imageName = filename || repoPath;
    const { contentTypeFormat, extensionFormat, normalizedContentType } = getExpectedFormats({
        path: repoPath,
        contentType,
    });
    const expectedFormat = extensionFormat ?? contentTypeFormat;
    let metadata;
    if (normalizedContentType && !contentTypeFormat) {
        throw new ImageValidationError({
            code: 'image-type-mismatch',
            imageName,
            path: repoPath,
            reason: `declared unsupported content type ${normalizedContentType}`,
        });
    }
    try {
        metadata = await sharp(bytes, { failOn: 'error' }).metadata();
    }
    catch {
        throw new ImageValidationError({
            code: 'invalid-image-bytes',
            imageName,
            path: repoPath,
            reason: `could not be decoded as a valid ${formatLabel(expectedFormat)}`,
        });
    }
    const decodedFormat = metadata.format;
    if (!metadata.width || metadata.width <= 0 || !metadata.height || metadata.height <= 0 || !decodedFormat) {
        throw new ImageValidationError({
            code: 'missing-image-dimensions',
            imageName,
            path: repoPath,
            reason: `could not be decoded as a valid ${formatLabel(expectedFormat)}`,
        });
    }
    if (!supportedFormats.has(decodedFormat)) {
        throw new ImageValidationError({
            code: 'image-type-mismatch',
            imageName,
            path: repoPath,
            reason: `decoded as unsupported ${formatLabel(decodedFormat)} bytes`,
        });
    }
    if (extensionFormat && decodedFormat !== extensionFormat) {
        throw new ImageValidationError({
            code: 'image-type-mismatch',
            imageName,
            path: repoPath,
            reason: `could not be decoded as a valid ${formatLabel(extensionFormat)}`,
        });
    }
    if (contentTypeFormat && decodedFormat !== contentTypeFormat) {
        throw new ImageValidationError({
            code: 'image-type-mismatch',
            imageName,
            path: repoPath,
            reason: `declared ${normalizedContentType} but decoded as ${formatLabel(decodedFormat)} bytes`,
        });
    }
    if (!extensionFormat && !contentTypeFormat) {
        throw new ImageValidationError({
            code: 'image-type-mismatch',
            imageName,
            path: repoPath,
            reason: 'must use a supported JPEG, PNG, or WebP upload type',
        });
    }
    return metadata;
};
