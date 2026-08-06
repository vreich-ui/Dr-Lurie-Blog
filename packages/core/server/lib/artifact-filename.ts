/**
 * Shared filename sanitizer for every route that serves an artifact blob with
 * a human-readable `Content-Disposition` filename (get-public-pdf.ts,
 * get-purchase.ts's token-gated purchase delivery). Extracted from
 * get-purchase.ts so the two callers stay in lockstep instead of drifting
 * copies of the same regex.
 *
 * Keeps only characters that are safe across filesystems and HTTP headers —
 * everything else (spaces, slashes, quotes, non-ASCII, control characters)
 * collapses to `_`.
 */
export const sanitizeFilename = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '_');
