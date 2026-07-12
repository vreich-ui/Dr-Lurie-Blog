import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderRichTextV1Html } from './render-html.js';

const text = (value: string, marks: Array<{ type: string }> = []) => ({
  nodeType: 'text',
  value,
  marks,
  data: {},
});

const paragraph = (...content: unknown[]) => ({ nodeType: 'paragraph', data: {}, content });

const doc = (...content: unknown[]) => ({ nodeType: 'document', data: {}, content });

describe('renderRichTextV1Html', () => {
  it('renders paragraphs, headings, lists, and quotes with house tags', () => {
    const html = renderRichTextV1Html(
      doc(
        { nodeType: 'heading-2', data: {}, content: [text('Heading')] },
        paragraph(text('plain '), text('bold', [{ type: 'bold' }]), text(' and '), text('em', [{ type: 'italic' }])),
        {
          nodeType: 'ordered-list',
          data: {},
          content: [{ nodeType: 'list-item', data: {}, content: [paragraph(text('item'))] }],
        },
        { nodeType: 'blockquote', data: {}, content: [paragraph(text('quoted'))] }
      )
    );
    assert.equal(
      html,
      '<h2>Heading</h2>' +
        '<p>plain <strong>bold</strong> and <em>em</em></p>' +
        '<ol><li><p>item</p></li></ol>' +
        '<blockquote><p>quoted</p></blockquote>'
    );
  });

  it('renders hyperlinks', () => {
    const html = renderRichTextV1Html(
      doc(paragraph({ nodeType: 'hyperlink', data: { uri: '/start-here' }, content: [text('go')] }))
    );
    assert.equal(html, '<p><a href="/start-here">go</a></p>');
  });

  it('escapes text content and renders \\n as <br/>', () => {
    const html = renderRichTextV1Html(doc(paragraph(text('a <b> & "c"\nnext'))));
    assert.equal(html, '<p>a &lt;b&gt; &amp; &quot;c&quot;<br/>next</p>');
  });

  it('routes embeds through the injected resolvers', () => {
    const html = renderRichTextV1Html(
      doc(
        {
          nodeType: 'embedded-entry-block',
          data: { target: { sys: { id: 'sec_x', type: 'Link', linkType: 'Entry' } } },
          content: [],
        },
        {
          nodeType: 'embedded-asset-block',
          data: { target: { sys: { id: 'image/req_a/f.png', type: 'Link', linkType: 'Asset' } } },
          content: [],
        }
      ),
      {
        renderEmbeddedEntry: (id) => `<section data-entry="${id}"></section>`,
        renderEmbeddedAsset: (id) => `<img data-asset="${id}"/>`,
      }
    );
    assert.equal(html, '<section data-entry="sec_x"></section><img data-asset="image/req_a/f.png"/>');
  });

  it('throws loudly on an embed without a resolver, naming the target', () => {
    const embedded = doc({
      nodeType: 'embedded-entry-block',
      data: { target: { sys: { id: 'sec_orphan', type: 'Link', linkType: 'Entry' } } },
      content: [],
    });
    assert.throws(() => renderRichTextV1Html(embedded), /sec_orphan/);
  });

  it('throws on schema-invalid input rather than rendering a hole', () => {
    assert.throws(() => renderRichTextV1Html(doc({ nodeType: 'heading-1', data: {}, content: [text('x')] })));
  });

  it('never emits node data annotations into HTML', () => {
    const withAnnotations = doc({
      nodeType: 'paragraph',
      data: { strategy: 'hook', agentNotes: 'internal-only' },
      content: [text('visible copy')],
    });
    const html = renderRichTextV1Html(withAnnotations);
    assert.equal(html, '<p>visible copy</p>');
    assert.ok(!html.includes('hook'));
    assert.ok(!html.includes('internal-only'));
  });
});
