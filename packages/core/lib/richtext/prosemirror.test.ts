import { describe, it } from 'node:test';
import assert from 'node:assert';

import { proseMirrorToRichTextV1, richTextV1ToProseMirror, type ProseMirrorNode } from './prosemirror.js';
import { parseRichTextV1 } from '../../lib/richtext/rich-text-v1.js';

const pmText = (text: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>): ProseMirrorNode => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
});

const pmDoc = (...content: ProseMirrorNode[]): ProseMirrorNode => ({ type: 'doc', content });

describe('proseMirrorToRichTextV1', () => {
  it('maps the TipTap StarterKit vocabulary onto the v1 universe', () => {
    const converted = proseMirrorToRichTextV1(
      pmDoc(
        { type: 'heading', attrs: { level: 2 }, content: [pmText('Title')] },
        { type: 'paragraph', content: [pmText('plain '), pmText('strong', [{ type: 'bold' }])] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [pmText('a')] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [pmText('b')] }] },
          ],
        },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [pmText('q')] }] }
      )
    );
    // Round-trips the schema — the mapper can only emit valid documents.
    const parsed = parseRichTextV1(converted);
    assert.equal(parsed.content.length, 4);
    assert.equal(parsed.content[0].nodeType, 'heading-2');
    assert.equal(parsed.content[2].nodeType, 'unordered-list');
  });

  it('merges consecutive linked runs into one hyperlink node', () => {
    const converted = proseMirrorToRichTextV1(
      pmDoc({
        type: 'paragraph',
        content: [
          pmText('see '),
          pmText('the ', [{ type: 'link', attrs: { href: '/guide' } }]),
          pmText('guide', [{ type: 'bold' }, { type: 'link', attrs: { href: '/guide' } }]),
          pmText(' now'),
        ],
      })
    );
    const para = converted.content[0] as { content: Array<{ nodeType: string; content?: unknown[] }> };
    assert.equal(para.content.length, 3);
    assert.equal(para.content[1].nodeType, 'hyperlink');
    assert.equal((para.content[1].content as unknown[]).length, 2);
  });

  it('encodes hardBreak as a newline in the text stream', () => {
    const converted = proseMirrorToRichTextV1(
      pmDoc({ type: 'paragraph', content: [pmText('one'), { type: 'hardBreak' }, pmText('two')] })
    );
    const para = converted.content[0] as { content: Array<{ value: string }> };
    assert.deepEqual(
      para.content.map((t) => t.value),
      ['one', '\n', 'two']
    );
  });

  it('throws loudly on vocabulary the store cannot hold', () => {
    assert.throws(
      () => proseMirrorToRichTextV1(pmDoc({ type: 'heading', attrs: { level: 1 }, content: [pmText('x')] })),
      /heading level '1'/
    );
    assert.throws(() => proseMirrorToRichTextV1(pmDoc({ type: 'codeBlock', content: [pmText('x')] })), /codeBlock/);
    assert.throws(
      () => proseMirrorToRichTextV1(pmDoc({ type: 'paragraph', content: [pmText('x', [{ type: 'strike' }])] })),
      /strike/
    );
  });
});

describe('richTextV1ToProseMirror', () => {
  it('splits hyperlink nodes back into link-marked text runs', () => {
    const doc = parseRichTextV1({
      nodeType: 'document',
      data: {},
      content: [
        {
          nodeType: 'paragraph',
          data: {},
          content: [
            { nodeType: 'text', value: 'see ', marks: [], data: {} },
            {
              nodeType: 'hyperlink',
              data: { uri: '/guide' },
              content: [{ nodeType: 'text', value: 'guide', marks: [{ type: 'bold' }], data: {} }],
            },
          ],
        },
      ],
    });
    const pm = richTextV1ToProseMirror(doc);
    const para = pm.content?.[0];
    assert.equal(para?.content?.length, 2);
    const linked = para?.content?.[1];
    assert.deepEqual(linked?.marks, [{ type: 'bold' }, { type: 'link', attrs: { href: '/guide' } }]);
  });

  it('throws on embeds (no editor representation until W7.7)', () => {
    const doc = parseRichTextV1({
      nodeType: 'document',
      data: {},
      content: [
        {
          nodeType: 'embedded-entry-block',
          data: { target: { sys: { id: 'sec_x', type: 'Link', linkType: 'Entry' } } },
          content: [],
        },
      ],
    });
    assert.throws(() => richTextV1ToProseMirror(doc), /W7\.7/);
  });

  it('round-trips pm → ct → pm on the representative document', () => {
    const original = pmDoc(
      { type: 'heading', attrs: { level: 3 }, content: [pmText('H3')] },
      {
        type: 'paragraph',
        content: [pmText('a '), pmText('b', [{ type: 'italic' }]), { type: 'hardBreak' }, pmText('c')],
      },
      {
        type: 'orderedList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [pmText('item')] }] }],
      }
    );
    const roundTripped = richTextV1ToProseMirror(proseMirrorToRichTextV1(original));
    assert.deepEqual(roundTripped, original);
  });

  it('round-trips ct → pm → ct on a schema-valid document', () => {
    const doc = parseRichTextV1({
      nodeType: 'document',
      data: {},
      content: [
        {
          nodeType: 'paragraph',
          data: {},
          content: [
            { nodeType: 'text', value: 'plain ', marks: [], data: {} },
            { nodeType: 'text', value: 'bold', marks: [{ type: 'bold' }], data: {} },
          ],
        },
        {
          nodeType: 'blockquote',
          data: {},
          content: [
            {
              nodeType: 'paragraph',
              data: {},
              content: [{ nodeType: 'text', value: 'q', marks: [], data: {} }],
            },
          ],
        },
      ],
    });
    assert.deepEqual(proseMirrorToRichTextV1(richTextV1ToProseMirror(doc)), doc);
  });
});
