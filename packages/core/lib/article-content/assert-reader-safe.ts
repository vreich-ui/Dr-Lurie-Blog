/**
 * Forbidden keywords that indicate accidental leakage of private strategy metadata.
 * Focuses on technical field names and metadata containers that should never reach the reader.
 */
export const FORBIDDEN_READER_KEYWORDS = ['private', 'strategy', 'agentNotes', 'sourcePromptId', 'inputTemplateId'];

/**
 * The two natural-language words above are leak markers ONLY inside the
 * content_item annotation model, where a `private` strategy annotation bleeding
 * into a rendered node is a real leak. Everywhere else — an ordinary page or
 * section — "Our Strategy" and "private beta" are legitimate prose, and scanning
 * for them as bare words blocks real content (W14 finding F4). The camelCase
 * markers are never legitimate reader-facing text, so they are always scanned.
 */
const NATURAL_LANGUAGE_KEYWORDS = new Set(['private', 'strategy']);

type ReaderSafetyOptions = {
  /**
   * Scan for the natural-language keywords (`private`, `strategy`) as bare prose
   * words, not just as JSON field names. True for the content_item reader
   * projection (its annotation layer gives those words leak-meaning); false for
   * plain object bodies, where they are ordinary prose. Defaults to true so the
   * bare `assertReaderSafe(x)` call keeps its original, strictest behavior.
   */
  scanProseWords?: boolean;
};

/**
 * Asserts that the provided content (string or object) is safe for reader consumption.
 * Throws an error if any forbidden private metadata keywords are found.
 */
export function assertReaderSafe(content: string | object | unknown, options: ReaderSafetyOptions = {}): void {
  if (content === null || content === undefined) return;

  const { scanProseWords = true } = options;
  const contentString = typeof content === 'string' ? content : JSON.stringify(content);

  for (const keyword of FORBIDDEN_READER_KEYWORDS) {
    // Bare-word (prose) scan: skipped for the natural-language keywords when the
    // caller opts out (a plain body), always run for the camelCase markers.
    if (scanProseWords || !NATURAL_LANGUAGE_KEYWORDS.has(keyword)) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(contentString)) {
        throw new Error(`Reader safety violation: Found forbidden internal keyword "${keyword}" in content.`);
      }
    }

    // Field-name (JSON key) leak check ALWAYS runs, for every keyword and every
    // body — a leaked internal object key is a structural leak regardless of type.
    if (contentString.includes(`"${keyword}"`) || contentString.includes(`'${keyword}'`)) {
      throw new Error(`Reader safety violation: Found forbidden internal field "${keyword}" in content.`);
    }
  }
}
