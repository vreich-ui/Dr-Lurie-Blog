import { describe, it } from 'node:test';
import assert from 'node:assert';

import { markdownToRichTextV1 } from './from-markdown.js';
import { renderRichTextV1Html } from './render-html.js';
import { validateRichTextGrammar, ARTICLE_BODY_GRAMMAR } from './rich-text-v1.js';

describe('markdownToRichTextV1', () => {
  it('converts a paragraph', () => {
    const doc = markdownToRichTextV1('Hello world.');
    assert.deepEqual(doc.content, [
      { nodeType: 'paragraph', data: {}, content: [{ nodeType: 'text', value: 'Hello world.', marks: [], data: {} }] },
    ]);
  });

  it('splits blank-line-separated paragraphs and joins soft-wrapped lines with a hard break', () => {
    const doc = markdownToRichTextV1('line one\nline two\n\nsecond paragraph');
    assert.equal(doc.content.length, 2);
    const first = doc.content[0] as { content: Array<{ value: string }> };
    assert.equal(first.content[0].value, 'line one\nline two');
  });

  it('converts ## and ### headings', () => {
    const doc = markdownToRichTextV1('## Section\n\n### Sub');
    assert.equal(doc.content[0].nodeType, 'heading-2');
    assert.equal(doc.content[1].nodeType, 'heading-3');
  });

  it('rejects h1 and h4+ headings', () => {
    assert.throws(() => markdownToRichTextV1('# Title'), /only ## and ###/);
    assert.throws(() => markdownToRichTextV1('#### Deep'), /only ## and ###/);
  });

  it('converts sequential bold and italic spans', () => {
    const doc = markdownToRichTextV1('plain **bold** and *em* text');
    const para = doc.content[0] as { content: Array<{ value: string; marks: Array<{ type: string }> }> };
    assert.deepEqual(
      para.content.map((n) => [n.value, n.marks.map((m) => m.type)]),
      [
        ['plain ', []],
        ['bold', ['bold']],
        [' and ', []],
        ['em', ['italic']],
        [' text', []],
      ]
    );
  });

  it('composes marks for italic nested fully inside bold', () => {
    const doc = markdownToRichTextV1('**bold *and* italic**');
    const para = doc.content[0] as { content: Array<{ value: string; marks: Array<{ type: string }> }> };
    assert.deepEqual(
      para.content.map((n) => [n.value, n.marks.map((m) => m.type)]),
      [
        ['bold ', ['bold']],
        ['and', ['bold', 'italic']],
        [' italic', ['bold']],
      ]
    );
  });

  it('converts inline code to a real code mark, not literal backticks', () => {
    const doc = markdownToRichTextV1('run `npm test` now');
    const para = doc.content[0] as { content: Array<{ value: string; marks: Array<{ type: string }> }> };
    assert.deepEqual(
      para.content.map((n) => [n.value, n.marks.map((m) => m.type)]),
      [
        ['run ', []],
        ['npm test', ['code']],
        [' now', []],
      ]
    );
  });

  it('does not interpret markdown syntax inside a code span', () => {
    const doc = markdownToRichTextV1('`**not bold**`');
    const para = doc.content[0] as { content: Array<{ value: string; marks: Array<{ type: string }> }> };
    assert.equal(para.content.length, 1);
    assert.equal(para.content[0].value, '**not bold**');
    assert.deepEqual(
      para.content[0].marks.map((m) => m.type),
      ['code']
    );
  });

  it('converts https links and rejects unsafe urls', () => {
    const doc = markdownToRichTextV1('see the [guide](https://example.com/guide)');
    const para = doc.content[0] as { content: Array<{ nodeType: string; data?: { uri: string } }> };
    assert.equal(para.content[1].nodeType, 'hyperlink');
    assert.equal(para.content[1].data?.uri, 'https://example.com/guide');
    assert.throws(() => markdownToRichTextV1('[go](javascript:alert(1))'), /must be http/);
  });

  it('converts flat unordered and ordered lists', () => {
    const ul = markdownToRichTextV1('- one\n- two\n- three');
    assert.equal(ul.content[0].nodeType, 'unordered-list');
    assert.equal((ul.content[0] as { content: unknown[] }).content.length, 3);

    const ol = markdownToRichTextV1('1. first\n2. second');
    assert.equal(ol.content[0].nodeType, 'ordered-list');
  });

  it('rejects indented (nested) list items', () => {
    assert.throws(() => markdownToRichTextV1('- one\n  - nested'), /flat, one level only/);
  });

  it('converts a blockquote', () => {
    const doc = markdownToRichTextV1('> a wise quote');
    assert.equal(doc.content[0].nodeType, 'blockquote');
  });

  it('rejects fenced code blocks by name, not silently', () => {
    assert.throws(() => markdownToRichTextV1('```js\nconst x = 1;\n```'), /fenced code blocks/);
  });

  it('rejects horizontal rules', () => {
    assert.throws(() => markdownToRichTextV1('above\n\n---\n\nbelow'), /horizontal rules/);
  });

  it('honors backslash-escapes for markdown punctuation', () => {
    const doc = markdownToRichTextV1('literal \\*asterisks\\* and \\`backticks\\`');
    const para = doc.content[0] as { content: Array<{ value: string; marks: unknown[] }> };
    assert.equal(para.content.length, 1);
    assert.equal(para.content[0].value, 'literal *asterisks* and `backticks`');
    assert.deepEqual(para.content[0].marks, []);
  });

  it('produces a document that satisfies ARTICLE_BODY_GRAMMAR end to end', () => {
    const doc = markdownToRichTextV1(
      '## Heading\n\nSome **bold** text with `code` and a [link](https://example.com).\n\n> quoted wisdom\n\n- a\n- b'
    );
    assert.deepEqual(validateRichTextGrammar(doc, ARTICLE_BODY_GRAMMAR), []);
  });

  it('renders through the theme-driven renderer: headings/marks/code all real HTML, not literal syntax', () => {
    const doc = markdownToRichTextV1('## Title\n\nText with `code` and **bold**.');
    const html = renderRichTextV1Html(doc);
    assert.equal(html, '<h2>Title</h2><p>Text with <code>code</code> and <strong>bold</strong>.</p>');
    assert.ok(!html.includes('##'), 'no literal markdown syntax leaks into the HTML');
    assert.ok(!html.includes('**'), 'no literal markdown syntax leaks into the HTML');
  });
});
