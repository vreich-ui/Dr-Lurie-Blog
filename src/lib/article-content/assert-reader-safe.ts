/**
 * Forbidden keywords that indicate accidental leakage of private strategy metadata.
 * Focuses on technical field names and metadata containers that should never reach the reader.
 */
export const FORBIDDEN_READER_KEYWORDS = [
  'private',
  'strategy',
  'agentNotes',
  'sourcePromptId',
  'inputTemplateId',
];

/**
 * Asserts that the provided content (string or object) is safe for reader consumption.
 * Throws an error if any forbidden private metadata keywords are found.
 */
export function assertReaderSafe(content: string | object | unknown): void {
  if (content === null || content === undefined) return;

  const contentString = typeof content === 'string' ? content : JSON.stringify(content);

  for (const keyword of FORBIDDEN_READER_KEYWORDS) {
    // Case-insensitive search for keywords, ensuring we don't catch them as part of larger words
    // unless it's a field name in an object.
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(contentString)) {
      throw new Error(`Reader safety violation: Found forbidden internal keyword "${keyword}" in content.`);
    }

    // Also check for camelCase fields in JSON strings specifically
    if (contentString.includes(`"${keyword}"`) || contentString.includes(`'${keyword}'`)) {
      throw new Error(`Reader safety violation: Found forbidden internal field "${keyword}" in content.`);
    }
  }
}
