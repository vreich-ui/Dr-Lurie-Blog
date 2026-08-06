/**
 * rich_text.v1 — the Contentful Rich Text document model, restricted to this
 * project's vocabulary (W7.1, 08-articles-plan §2.2).
 *
 * This is the schema HALF of the substrate: a zod mirror of Contentful's node
 * tree (`@contentful/rich-text-types` constants are the single source for
 * node/mark names) covering exactly the nodes the site's rich content may
 * carry. It replaces nothing yet — section bodies (W7.2) and article bodies
 * (W7.3+) adopt it in their own phases; until then no schema references it.
 *
 * The restricted universe deliberately mirrors the standing sanitizer
 * allowlist (p, strong, em, a, ul, ol, li, h2, h3 — D§3.5) plus the
 * core-structure additions (blockquote, embedded entries/assets). Per-field
 * narrowing — "this body takes paragraphs only" — is a GRAMMAR, not a new
 * schema: the same document shape validated against a per-field
 * `RichTextGrammar` (Contentful's enabledNodeTypes/enabledMarks, D§3.5's
 * allowlist-becomes-declaration). Widening the universe later (more marks,
 * tables, …) is additive; narrowing a grammar is per-field data.
 *
 * Every node carries `data` (Contentful's shape). On embeds it holds the
 * target link; elsewhere it is the annotation carrier reserved for later
 * waves — nothing in this phase writes to it.
 */
import { z } from 'zod';
import { BLOCKS, INLINES, MARKS } from '@contentful/rich-text-types';

// ---------- the restricted vocabulary ----------

export const RICH_TEXT_V1_MARKS = [MARKS.BOLD, MARKS.ITALIC, MARKS.CODE] as const;
export type RichTextV1Mark = (typeof RICH_TEXT_V1_MARKS)[number];

export const RICH_TEXT_V1_INLINES = [INLINES.HYPERLINK] as const;

export const RICH_TEXT_V1_BLOCKS = [
  BLOCKS.PARAGRAPH,
  BLOCKS.HEADING_2,
  BLOCKS.HEADING_3,
  BLOCKS.UL_LIST,
  BLOCKS.OL_LIST,
  BLOCKS.LIST_ITEM,
  BLOCKS.QUOTE,
  BLOCKS.EMBEDDED_ENTRY,
  BLOCKS.EMBEDDED_ASSET,
] as const;

// ---------- node schemas ----------

const dataBagSchema = z.record(z.string(), z.unknown());

const markSchema = z.object({ type: z.enum([MARKS.BOLD, MARKS.ITALIC, MARKS.CODE]) }).strict();

export const textNodeSchema = z
  .object({
    nodeType: z.literal('text'),
    value: z.string(),
    marks: z.array(markSchema),
    data: dataBagSchema,
  })
  .strict();
export type RichTextV1Text = z.infer<typeof textNodeSchema>;

export const hyperlinkNodeSchema = z
  .object({
    nodeType: z.literal(INLINES.HYPERLINK),
    // No whitespace in uris: real URIs never carry it, and the renderer's
    // '\n' → <br/> pass relies on newlines existing only in text values.
    data: z.object({ uri: z.string().min(1).regex(/^\S+$/, 'uri must not contain whitespace') }).strict(),
    content: z.array(textNodeSchema).min(1),
  })
  .strict();
export type RichTextV1Hyperlink = z.infer<typeof hyperlinkNodeSchema>;

const inlineOrTextSchema = z.discriminatedUnion('nodeType', [textNodeSchema, hyperlinkNodeSchema]);

// Contentful models embed targets as sys links; in this store the `id` is an
// object id (Entry) or an artifact/asset ref (Asset). Resolution is the
// renderer's caller's job — the schema only pins the pointer shape.
const entryTargetSchema = z
  .object({
    target: z
      .object({
        sys: z.object({ id: z.string().min(1), type: z.literal('Link'), linkType: z.literal('Entry') }).strict(),
      })
      .strict(),
  })
  .strict();

const assetTargetSchema = z
  .object({
    target: z
      .object({
        sys: z.object({ id: z.string().min(1), type: z.literal('Link'), linkType: z.literal('Asset') }).strict(),
      })
      .strict(),
  })
  .strict();

const paragraphSchema = z
  .object({
    nodeType: z.literal(BLOCKS.PARAGRAPH),
    data: dataBagSchema,
    content: z.array(inlineOrTextSchema),
  })
  .strict();

const headingSchema = (nodeType: typeof BLOCKS.HEADING_2 | typeof BLOCKS.HEADING_3) =>
  z
    .object({
      nodeType: z.literal(nodeType),
      data: dataBagSchema,
      content: z.array(inlineOrTextSchema),
    })
    .strict();

// Contentful list items hold blocks (paragraphs or nested lists).
type ListItemShape = {
  nodeType: typeof BLOCKS.LIST_ITEM;
  data: Record<string, unknown>;
  content: Array<z.infer<typeof paragraphSchema> | ListShape>;
};
type ListShape = {
  nodeType: typeof BLOCKS.UL_LIST | typeof BLOCKS.OL_LIST;
  data: Record<string, unknown>;
  content: ListItemShape[];
};

const listItemSchema: z.ZodType<ListItemShape> = z.lazy(() =>
  z
    .object({
      nodeType: z.literal(BLOCKS.LIST_ITEM),
      data: dataBagSchema,
      content: z.array(z.union([paragraphSchema, listSchema])).min(1),
    })
    .strict()
) as z.ZodType<ListItemShape>;

const listSchema: z.ZodType<ListShape> = z.lazy(() =>
  z
    .object({
      nodeType: z.enum([BLOCKS.UL_LIST, BLOCKS.OL_LIST]),
      data: dataBagSchema,
      content: z.array(listItemSchema).min(1),
    })
    .strict()
) as z.ZodType<ListShape>;

const quoteSchema = z
  .object({
    nodeType: z.literal(BLOCKS.QUOTE),
    data: dataBagSchema,
    content: z.array(paragraphSchema).min(1),
  })
  .strict();

const embeddedEntrySchema = z
  .object({
    nodeType: z.literal(BLOCKS.EMBEDDED_ENTRY),
    data: entryTargetSchema,
    content: z.array(z.never()).max(0),
  })
  .strict();

const embeddedAssetSchema = z
  .object({
    nodeType: z.literal(BLOCKS.EMBEDDED_ASSET),
    data: assetTargetSchema,
    content: z.array(z.never()).max(0),
  })
  .strict();

const topLevelBlockSchema = z.union([
  paragraphSchema,
  headingSchema(BLOCKS.HEADING_2),
  headingSchema(BLOCKS.HEADING_3),
  listSchema,
  quoteSchema,
  embeddedEntrySchema,
  embeddedAssetSchema,
]);

export const richTextV1Schema = z
  .object({
    nodeType: z.literal(BLOCKS.DOCUMENT),
    data: dataBagSchema,
    content: z.array(topLevelBlockSchema),
  })
  .strict();
export type RichTextV1Document = z.infer<typeof richTextV1Schema>;

export const parseRichTextV1 = (value: unknown): RichTextV1Document => richTextV1Schema.parse(value);
export const isRichTextV1 = (value: unknown): value is RichTextV1Document => richTextV1Schema.safeParse(value).success;

// ---------- per-field grammars (the allowlist-becomes-declaration) ----------

/**
 * Contentful's field-level narrowing: which node types and marks a specific
 * field accepts. The document must already be schema-valid; a grammar only
 * narrows further. Node types listed cover blocks AND inlines ('text' is
 * always legal and never listed, matching Contentful).
 */
export type RichTextGrammar = {
  enabledNodeTypes: readonly string[];
  enabledMarks: readonly RichTextV1Mark[];
};

/** The p-only fields (hero/lede/bio/… bodies — today's splitRichTextParagraphs). */
export const INLINE_COPY_GRAMMAR: RichTextGrammar = {
  enabledNodeTypes: [BLOCKS.PARAGRAPH, INLINES.HYPERLINK],
  enabledMarks: [MARKS.BOLD, MARKS.ITALIC, MARKS.CODE],
};

/** Full-page text sections (prose.body — today's splitRichTextBlocks). */
export const PROSE_GRAMMAR: RichTextGrammar = {
  enabledNodeTypes: [
    BLOCKS.PARAGRAPH,
    BLOCKS.HEADING_2,
    BLOCKS.HEADING_3,
    BLOCKS.UL_LIST,
    BLOCKS.OL_LIST,
    BLOCKS.LIST_ITEM,
    INLINES.HYPERLINK,
  ],
  enabledMarks: [MARKS.BOLD, MARKS.ITALIC, MARKS.CODE],
};

/** Article content-node bodies (W7.3+): prose plus quotes and embeds. */
export const ARTICLE_BODY_GRAMMAR: RichTextGrammar = {
  enabledNodeTypes: [
    BLOCKS.PARAGRAPH,
    BLOCKS.HEADING_2,
    BLOCKS.HEADING_3,
    BLOCKS.UL_LIST,
    BLOCKS.OL_LIST,
    BLOCKS.LIST_ITEM,
    BLOCKS.QUOTE,
    BLOCKS.EMBEDDED_ENTRY,
    BLOCKS.EMBEDDED_ASSET,
    INLINES.HYPERLINK,
  ],
  enabledMarks: [MARKS.BOLD, MARKS.ITALIC, MARKS.CODE],
};

type AnyNode = { nodeType: string; content?: AnyNode[]; marks?: Array<{ type: string }> };

/**
 * Validate a schema-valid document against a field grammar. Returns human-
 * readable violations ('' = position path, node type, offending mark), empty
 * array when the document satisfies the grammar. Violations name what and
 * where — the same never-silent contract as the splitters this replaces.
 */
export const validateRichTextGrammar = (doc: RichTextV1Document, grammar: RichTextGrammar): string[] => {
  const violations: string[] = [];
  const walk = (node: AnyNode, path: string): void => {
    if (node.nodeType !== 'text' && node.nodeType !== BLOCKS.DOCUMENT) {
      if (!grammar.enabledNodeTypes.includes(node.nodeType)) {
        violations.push(`${path}: node type '${node.nodeType}' is not enabled for this field`);
      }
    }
    for (const mark of node.marks ?? []) {
      if (!(grammar.enabledMarks as readonly string[]).includes(mark.type)) {
        violations.push(`${path}: mark '${mark.type}' is not enabled for this field`);
      }
    }
    (node.content ?? []).forEach((child, i) => walk(child, `${path}/${child.nodeType}[${i}]`));
  };
  walk(doc as unknown as AnyNode, 'document');
  return violations;
};
