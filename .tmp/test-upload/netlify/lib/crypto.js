import { createHash } from 'node:crypto';
const toHashableBytes = (input) => {
    if (input instanceof ArrayBuffer)
        return new Uint8Array(input);
    return input;
};
/**
 * Returns a SHA-256 digest encoded as lowercase hexadecimal.
 *
 * Hex is intentionally used instead of base64url because it is URL-safe,
 * case-stable, and easy to compare in blob indexes and logs.
 */
export const sha256Hex = (input) => {
    return createHash('sha256').update(toHashableBytes(input)).digest('hex');
};
