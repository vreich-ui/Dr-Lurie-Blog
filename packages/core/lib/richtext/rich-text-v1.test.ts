import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  ARTICLE_BODY_GRAMMAR,
  INLINE_COPY_GRAMMAR,
  PROSE_GRAMMAR,
  isRichTextV1,
  parseRichTextV1,
  richTextV1Schema,
  validateRichTextGrammar,
} from './rich-text-v1.js';

const text = (value: string, marks: Array<{ type: string }> = []) => ({
  nodeType: 'text',
  value,
  marks,
  data: {},
});

const paragraph = (...content: unknown[]) => ({ nodeType: 'paragraph', data: {}, content });

const doc = (...content: unknown[]) => ({ nodeType: 'document', data: {}, content });

describe('rich_text.v1 schema', () => {
  it('accepts the core-structure canonical shapes', () => {
    const document = doc(
      { nodeType: 'heading-2', data: {}, content: [text('Why skin changes after 60')] },
      paragraph(text('Skin behaves '), text('differently', [{ type: 'italic' }]), text(' — and that changes.')),
      { nodeType: 'blockquote', data: {}, content: [paragraph(text('Understand the system first.'))] },
      {
        nodeType: 'unordered-list',
        data: {},
        content: [
          { nodeType: 'list-item', data: {}, content: [paragraph(text('one'))] },
          { nodeType: 'list-item', data: {}, content: [paragraph(text('two', [{ type: 'bold' }]))] },
        ],
      },
      {
        nodeType: 'embedded-entry-block',
        data: { target: { sys: { id: 'sec_cta_free_guide', type: 'Link', linkType: 'Entry' } } },
        content: [],
      },
      {
        nodeType: 'embedded-asset-block',
        data: { target: { sys: { id: 'image/req_x/abc.png', type: 'Link', linkType: 'Asset' } } },
        content: [],
      }
    );
    assert.ok(isRichTextV1(document));
  });

  it('accepts hyperlinks wrapping text runs', () => {
    const document = doc(
      paragraph(text('Read the '), {
        nodeType: 'hyperlink',
        data: { uri: '/start-here' },
        content: [text('guide')],
      })
    );
    assert.ok(isRichTextV1(document));
  });

  it('accepts an empty document', () => {
    assert.ok(isRichTextV1(doc()));
  });

  it('rejects node types outside the v1 universe', () => {
    assert.ok(!isRichTextV1(doc({ nodeType: 'heading-1', data: {}, content: [text('nope')] })));
    assert.ok(!isRichTextV1(doc({ nodeType: 'table', data: {}, content: [] })));
  });

  it('rejects marks outside the v1 universe', () => {
    assert.ok(!isRichTextV1(doc(paragraph(text('x', [{ type: 'underline' }])))));
  });

  it('accepts the code mark', () => {
    assert.ok(isRichTextV1(doc(paragraph(text('npm test', [{ type: 'code' }])))));
  });

  it('rejects embeds without a target id and unknown extra keys', () => {
    assert.ok(!isRichTextV1(doc({ nodeType: 'embedded-entry-block', data: {}, content: [] })));
    const extras = doc(paragraph(text('x')));
    (extras as Record<string, unknown>).surprise = true;
    assert.ok(!richTextV1Schema.safeParse(extras).success);
  });

  it('rejects a hyperlink with a non-text child or empty uri', () => {
    assert.ok(
      !isRichTextV1(
        doc(
          paragraph({
            nodeType: 'hyperlink',
            data: { uri: '' },
            content: [text('x')],
          })
        )
      )
    );
  });

  it('parseRichTextV1 throws on invalid input', () => {
    assert.throws(() => parseRichTextV1({ nodeType: 'document' }));
  });
});

describe('rich_text.v1 field grammars', () => {
  const proseDoc = parseRichTextV1(
    doc({ nodeType: 'heading-2', data: {}, content: [text('H')] }, paragraph(text('body', [{ type: 'bold' }])))
  );

  it('every field grammar allows the code mark (widened alongside the tag allowlist)', () => {
    const withCode = parseRichTextV1(doc(paragraph(text('x', [{ type: 'code' }]))));
    assert.deepEqual(validateRichTextGrammar(withCode, INLINE_COPY_GRAMMAR), []);
    assert.deepEqual(validateRichTextGrammar(withCode, PROSE_GRAMMAR), []);
    assert.deepEqual(validateRichTextGrammar(withCode, ARTICLE_BODY_GRAMMAR), []);
  });

  it('INLINE_COPY_GRAMMAR refuses headings but allows paragraph + link + marks', () => {
    const violations = validateRichTextGrammar(proseDoc, INLINE_COPY_GRAMMAR);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /heading-2/);

    const okDoc = parseRichTextV1(
      doc(
        paragraph(text('see '), {
          nodeType: 'hyperlink',
          data: { uri: '/x' },
          content: [text('here', [{ type: 'italic' }])],
        })
      )
    );
    assert.deepEqual(validateRichTextGrammar(okDoc, INLINE_COPY_GRAMMAR), []);
  });

  it('PROSE_GRAMMAR accepts prose but refuses quotes and embeds', () => {
    assert.deepEqual(validateRichTextGrammar(proseDoc, PROSE_GRAMMAR), []);
    const withQuote = parseRichTextV1(doc({ nodeType: 'blockquote', data: {}, content: [paragraph(text('q'))] }));
    const violations = validateRichTextGrammar(withQuote, PROSE_GRAMMAR);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /blockquote/);
  });

  it('ARTICLE_BODY_GRAMMAR accepts the full universe', () => {
    const full = parseRichTextV1(
      doc(
        { nodeType: 'blockquote', data: {}, content: [paragraph(text('q'))] },
        {
          nodeType: 'embedded-entry-block',
          data: { target: { sys: { id: 'sec_x', type: 'Link', linkType: 'Entry' } } },
          content: [],
        }
      )
    );
    assert.deepEqual(validateRichTextGrammar(full, ARTICLE_BODY_GRAMMAR), []);
  });

  it('violations name the path to the offending node', () => {
    const nested = parseRichTextV1(
      doc({
        nodeType: 'unordered-list',
        data: {},
        content: [{ nodeType: 'list-item', data: {}, content: [paragraph(text('x'))] }],
      })
    );
    const violations = validateRichTextGrammar(nested, INLINE_COPY_GRAMMAR);
    assert.ok(violations.some((v) => v.includes('unordered-list[0]')));
    assert.ok(violations.some((v) => v.includes('list-item[0]')));
  });
});
