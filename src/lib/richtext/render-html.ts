/**
 * rich_text.v1 → HTML, at build time (W7.1, 08-articles-plan §2.2).
 *
 * The renderer HALF of the substrate: `@contentful/rich-text-html-renderer`
 * with the house conventions applied on top —
 *
 *   - marks render as `<strong>`/`<em>` (the sanitizer-allowlist tags the
 *     components already style), not the library's `<b>`/`<i>` defaults;
 *   - embedded entries/assets REQUIRE an injected resolver: this module is
 *     store-agnostic, and an embed it cannot resolve throws naming the target
 *     rather than rendering a hole (the never-silently-drop contract every
 *     splitter in this directory already honors);
 *   - input is schema-validated before rendering, so an unknown node type is
 *     a loud error here, never the library's silent empty string.
 *
 * `node.data` annotations are deliberately NOT emitted — private metadata
 * never reaches reader-facing HTML (docs/agents/article-content-structure.md,
 * leak rules). Nothing consumes this module yet; W7.2 wires sections in.
 */
import { documentToHtmlString, type Options } from '@contentful/rich-text-html-renderer';
import { BLOCKS, MARKS, type Document } from '@contentful/rich-text-types';

import { parseRichTextV1, type RichTextV1Document } from '../../../packages/core/lib/richtext/rich-text-v1.js';

export type RenderRichTextOptions = {
  /** Resolve an embedded-entry-block target (an object id) to HTML. */
  renderEmbeddedEntry?: (targetId: string) => string;
  /** Resolve an embedded-asset-block target (an artifact/asset ref) to HTML. */
  renderEmbeddedAsset?: (targetId: string) => string;
};

const embedTargetId = (node: { data: Record<string, unknown> }): string => {
  const target = (node.data as { target?: { sys?: { id?: unknown } } }).target;
  const id = target?.sys?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error('renderRichTextV1Html: embed node carries no target id');
  }
  return id;
};

/**
 * Render a rich_text.v1 document to an HTML string. Throws on schema-invalid
 * input and on embed nodes without a matching resolver.
 */
export const renderRichTextV1Html = (doc: unknown, options: RenderRichTextOptions = {}): string => {
  const parsed: RichTextV1Document = parseRichTextV1(doc);

  const renderOptions: Options = {
    renderMark: {
      [MARKS.BOLD]: (text) => `<strong>${text}</strong>`,
      [MARKS.ITALIC]: (text) => `<em>${text}</em>`,
    },
    renderNode: {
      [BLOCKS.EMBEDDED_ENTRY]: (node) => {
        const id = embedTargetId(node);
        if (!options.renderEmbeddedEntry) {
          throw new Error(
            `renderRichTextV1Html: document embeds entry '${id}' but no renderEmbeddedEntry resolver was provided; ` +
              'refusing to drop it silently'
          );
        }
        return options.renderEmbeddedEntry(id);
      },
      [BLOCKS.EMBEDDED_ASSET]: (node) => {
        const id = embedTargetId(node);
        if (!options.renderEmbeddedAsset) {
          throw new Error(
            `renderRichTextV1Html: document embeds asset '${id}' but no renderEmbeddedAsset resolver was provided; ` +
              'refusing to drop it silently'
          );
        }
        return options.renderEmbeddedAsset(id);
      },
    },
  };

  // The library escapes text and attributes but has no hook for line breaks
  // (v17 ignores renderText): '\n' inside a text value — how the prosemirror
  // mapper encodes hardBreak — would reach the page as collapsible raw
  // whitespace. It emits no formatting newlines of its own and the schema
  // forbids whitespace in hyperlink uris, so every '\n' in the output string
  // is text-value content: the global replace is sound.
  return documentToHtmlString(parsed as unknown as Document, renderOptions).replaceAll('\n', '<br/>');
};
