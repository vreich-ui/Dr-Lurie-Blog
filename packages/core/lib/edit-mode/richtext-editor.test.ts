/**
 * T9.19 — grammar binding + round-trip. Pins:
 *   - TipTap doc → rich_text.v1 → TipTap doc is stable across the grammar
 *     (paragraphs, h2/h3, bold/italic, https links, hard breaks, lists), and the
 *     rich_text.v1 intermediate validates against the store schema;
 *   - the client sanitizer strips out-of-grammar structure from arbitrary
 *     (pasted) ProseMirror JSON — non-https links, extra marks, h1/h4,
 *     blockquote, unknown blocks — and the result serializes without throwing;
 *   - a hand-built out-of-grammar rich_text.v1 doc is rejected by the store
 *     schema (the server-side half of the defense).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  sanitizeProseMirrorDoc,
  serializeToRichTextV1,
  deserializeFromRichTextV1,
  GRAMMAR_MARKS,
} from './richtext-editor.js';
import { richTextV1Schema } from '../../lib/richtext/rich-text-v1.js';
import type { ProseMirrorNode } from '../richtext/prosemirror.js';
import { BLOCKS, INLINES, MARKS } from '@contentful/rich-text-types';

// rich_text.v1 fixture builders (for schema assertions)
const rtText = (value: string, marks: Array<{ type: string }> = []) => ({ nodeType: 'text', value, marks, data: {} });
const rtLink = (uri: string, ...content: unknown[]) => ({ nodeType: INLINES.HYPERLINK, data: { uri }, content });

// ProseMirror/TipTap fixture builders
const pmDoc = (...content: ProseMirrorNode[]): ProseMirrorNode => ({ type: 'doc', content });
const pmText = (text: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>): ProseMirrorNode => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
});
const pmPara = (...content: ProseMirrorNode[]): ProseMirrorNode => ({ type: 'paragraph', content });

describe('round-trip: TipTap doc → rich_text.v1 → TipTap doc is stable across the grammar', () => {
  const cases: Array<[string, ProseMirrorNode]> = [
    ['a plain paragraph', pmDoc(pmPara(pmText('Hello world.')))],
    ['bold + italic runs', pmDoc(pmPara(pmText('a', [{ type: 'bold' }]), pmText('b', [{ type: 'italic' }])))],
    ['an h2 heading', pmDoc({ type: 'heading', attrs: { level: 2 }, content: [pmText('Section title')] })],
    ['an https link', pmDoc(pmPara(pmText('anchor', [{ type: 'link', attrs: { href: 'https://example.com' } }])))],
    ['a hard break', pmDoc(pmPara(pmText('line one'), { type: 'hardBreak' }, pmText('line two')))],
    [
      'a bullet list',
      pmDoc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [pmPara(pmText('first'))] },
          { type: 'listItem', content: [pmPara(pmText('second'))] },
        ],
      }),
    ],
  ];

  for (const [label, pm] of cases) {
    it(label, () => {
      const rt = serializeToRichTextV1(pm);
      // The intermediate rich_text.v1 validates against the store schema…
      assert.doesNotThrow(() => richTextV1Schema.parse(rt), `${label}: rt is schema-valid`);
      // …and loading it back yields the same TipTap document (the brief's invariant).
      const back = deserializeFromRichTextV1(rt);
      assert.deepEqual(back, pm, `${label} must round-trip identically`);
    });
  }

  it('the rich_text.v1 intermediates carry the expected marks/links', () => {
    const rt = serializeToRichTextV1(pmDoc(pmPara(pmText('x', [{ type: 'bold' }]))));
    assert.deepEqual(rt.content[0], {
      nodeType: BLOCKS.PARAGRAPH,
      data: {},
      content: [rtText('x', [{ type: MARKS.BOLD }])],
    });
    const linked = serializeToRichTextV1(
      pmDoc(pmPara(pmText('anchor', [{ type: 'link', attrs: { href: 'https://ok.example' } }])))
    );
    assert.deepEqual(linked.content[0], {
      nodeType: BLOCKS.PARAGRAPH,
      data: {},
      content: [rtLink('https://ok.example', rtText('anchor'))],
    });
  });
});

describe('sanitizer strips out-of-grammar ProseMirror structure', () => {
  it('drops a non-https link mark but keeps the text', () => {
    const pasted: ProseMirrorNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'http://insecure.example' } }] },
          ],
        },
      ],
    };
    const rt = serializeToRichTextV1(sanitizeProseMirrorDoc(pasted));
    const json = JSON.stringify(rt);
    assert.ok(json.includes('click'), 'text is preserved');
    assert.ok(!json.includes('insecure.example'), 'the non-https href is stripped');
    assert.ok(!json.includes(INLINES.HYPERLINK), 'no hyperlink node survives');
  });

  it('keeps an https link mark', () => {
    const pasted: ProseMirrorNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'go', marks: [{ type: 'link', attrs: { href: 'https://ok.example' } }] }],
        },
      ],
    };
    const rt = serializeToRichTextV1(sanitizeProseMirrorDoc(pasted));
    assert.ok(JSON.stringify(rt).includes('https://ok.example'));
  });

  it('drops an out-of-grammar mark (strike) but keeps the text', () => {
    const pasted: ProseMirrorNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept', marks: [{ type: 'strike' }] }] }],
    };
    const rt = serializeToRichTextV1(sanitizeProseMirrorDoc(pasted));
    assert.ok(JSON.stringify(rt).includes('kept'));
    assert.ok(!JSON.stringify(rt).includes('strike'), 'strike is stripped');
    assert.ok(!GRAMMAR_MARKS.has('strike'), 'strike is not a grammar mark');
  });

  it('keeps the code mark (inline code display, widened alongside rich-text-v1.ts)', () => {
    const pasted: ProseMirrorNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'const x', marks: [{ type: 'code' }] }] }],
    };
    const rt = serializeToRichTextV1(sanitizeProseMirrorDoc(pasted));
    assert.deepEqual(rt.content[0], {
      nodeType: BLOCKS.PARAGRAPH,
      data: {},
      content: [rtText('const x', [{ type: MARKS.CODE }])],
    });
    assert.ok(GRAMMAR_MARKS.has('code'), 'code is a grammar mark');
  });

  it('demotes h1/h4 to paragraphs and unwraps blockquote', () => {
    const pasted: ProseMirrorNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'big' }] },
        { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'small' }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] },
      ],
    };
    const clean = sanitizeProseMirrorDoc(pasted);
    assert.deepEqual(
      clean.content?.map((b) => b.type),
      ['paragraph', 'paragraph', 'paragraph'],
      'h1/h4 demote to paragraph; blockquote unwraps to its paragraph'
    );
    assert.doesNotThrow(() => serializeToRichTextV1(clean));
  });

  it('flattens an unknown block (codeBlock) to a paragraph of its text', () => {
    const pasted: ProseMirrorNode = {
      type: 'doc',
      content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] }],
    };
    const rt = serializeToRichTextV1(sanitizeProseMirrorDoc(pasted));
    assert.ok(JSON.stringify(rt).includes('x = 1'));
  });

  it('is total: any garbage doc yields a schema-valid rich_text.v1', () => {
    const garbage: ProseMirrorNode = {
      type: 'doc',
      content: [
        { type: 'horizontalRule' },
        { type: 'table', content: [{ type: 'tableRow', content: [] }] },
        { type: 'paragraph', content: [{ type: 'image', attrs: { src: 'x' } } as unknown as ProseMirrorNode] },
      ],
    };
    const rt = serializeToRichTextV1(sanitizeProseMirrorDoc(garbage));
    assert.doesNotThrow(() => richTextV1Schema.parse(rt));
  });
});

describe('server-side half: the store schema rejects a hand-built violation', () => {
  it('rejects an unknown mark that bypassed the client sanitizer', () => {
    const violation = {
      nodeType: BLOCKS.DOCUMENT,
      data: {},
      content: [{ nodeType: BLOCKS.PARAGRAPH, data: {}, content: [rtText('x', [{ type: 'underline' }])] }],
    };
    assert.throws(() => richTextV1Schema.parse(violation), /invalid|underline|enum/i);
  });
});
