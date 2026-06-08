const toText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object');

const getMarkdownBlockText = (payload: unknown) => {
  if (typeof payload === 'string') return toText(payload);
  if (!isRecord(payload)) return '';

  return toText(payload.markdown) || toText(payload.content) || toText(payload.text);
};

const getMarkdownBlocksText = (input: Record<string, unknown>) => {
  const content = isRecord(input.content) ? input.content : undefined;
  const blocks = content?.blocks;
  if (!Array.isArray(blocks)) return '';

  return blocks
    .filter((block) => isRecord(block) && block.block_type === 'markdown')
    .map((block) => (isRecord(block) ? getMarkdownBlockText(block.payload) : ''))
    .filter(Boolean)
    .join('\n\n')
    .trim();
};

/**
 * Returns importable article body markdown from a content_source.v1 object.
 *
 * Body locations are intentionally checked in publication/import precedence order:
 * 1. publication.publish_payload.markdown
 * 2. publication.publish_payload.content
 * 3. editorial.draft_markdown
 * 4. content.blocks markdown payloads where block_type === "markdown"
 */
export const getContentSourceMarkdown = (input: unknown) => {
  if (!isRecord(input)) return '';

  const publication = isRecord(input.publication) ? input.publication : undefined;
  const payload = isRecord(publication?.publish_payload) ? publication.publish_payload : undefined;
  const editorial = isRecord(input.editorial) ? input.editorial : undefined;

  return (
    toText(payload?.markdown) ||
    toText(payload?.content) ||
    toText(editorial?.draft_markdown) ||
    getMarkdownBlocksText(input)
  );
};
