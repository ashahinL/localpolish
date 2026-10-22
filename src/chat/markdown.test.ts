import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref, type Block, type Inline } from './markdown';

describe('parseMarkdown', () => {
  it('parses paragraphs, lists, a heading and a fenced code block', () => {
    const source = [
      '## Plan',
      'First line',
      'second line',
      '',
      '- one',
      '- **two**',
      '',
      '3. three',
      '4. four',
      '',
      '```ts',
      'const a = "<b>";',
      '```',
    ].join('\n');
    expect(parseMarkdown(source)).toEqual([
      { type: 'heading', children: [{ type: 'text', text: 'Plan' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'First line' },
          { type: 'break' },
          { type: 'text', text: 'second line' },
        ],
      },
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [
          [{ type: 'text', text: 'one' }],
          [{ type: 'strong', children: [{ type: 'text', text: 'two' }] }],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [[{ type: 'text', text: 'three' }], [{ type: 'text', text: 'four' }]],
      },
      { type: 'code', lang: 'ts', text: 'const a = "<b>";' },
    ]);
  });

  it('keeps an unclosed fence as code while it streams', () => {
    expect(parseMarkdown('Look:\n```\nline 1\nline')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'Look:' }] },
      { type: 'code', lang: '', text: 'line 1\nline' },
    ]);
  });

  it('keeps raw HTML as text', () => {
    const html = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    expect(parseMarkdown(html)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: html }] },
    ]);
  });
});

// Element nesting the renderer walks: quotes, then a block, then inline children.
function depth(node: Block | Inline): number {
  const children: Array<Block | Inline> =
    'children' in node ? node.children : 'items' in node ? node.items.flat() : [];
  return 1 + Math.max(0, ...children.map(depth));
}

describe('nesting limits', () => {
  it('keeps quotes nested past the limit as plain text', () => {
    let blocks = parseMarkdown(`${'>'.repeat(10_000)} text`);
    for (let level = 0; level < 6; level++) {
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.type).toBe('quote');
      blocks = (blocks[0] as Extract<Block, { type: 'quote' }>).children;
    }
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: `${'>'.repeat(9_994)} text` }] },
    ]);
  });

  it('keeps inline nesting past the limit as plain text', () => {
    const nodes = parseInline('**a *b _c __d [e](https://x.test/) d__ c_ b* a**');
    const text = (value: string): Inline => ({ type: 'text', text: value });
    expect(nodes).toEqual([
      {
        type: 'strong',
        children: [
          text('a '),
          {
            type: 'em',
            children: [
              text('b '),
              {
                type: 'em',
                children: [
                  text('c '),
                  { type: 'em', children: [text('_d [e](https://x.test/) d')] },
                ],
              },
              text(' c_ b'),
            ],
          },
          text(' a'),
        ],
      },
    ]);
    expect(Math.max(...nodes.map(depth))).toBe(5);
  });

  it('parses a megabyte of unmatched markers in one pass', () => {
    const source = '*a [b _c '.repeat(128 * 1024);
    expect(parseMarkdown(source)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: source.trim() }] },
    ]);
  });
});

describe('parseInline', () => {
  it('parses emphasis, inline code and escapes', () => {
    expect(parseInline('*a* __b__ `<i>` \\*c\\* snake_case_name')).toEqual([
      { type: 'em', children: [{ type: 'text', text: 'a' }] },
      { type: 'text', text: ' ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: '<i>' },
      { type: 'text', text: ' *c* snake_case_name' },
    ]);
  });

  it('links only allowed protocols', () => {
    expect(parseInline('[docs](https://example.test/a?b=1)')).toEqual([
      {
        type: 'link',
        href: 'https://example.test/a?b=1',
        children: [{ type: 'text', text: 'docs' }],
      },
    ]);
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', '/x']) {
      expect(parseInline(`[click](${url})`)).toEqual([{ type: 'text', text: 'click' }]);
    }
  });

  it('turns images into plain links so nothing loads on its own', () => {
    expect(parseInline('![chart](https://example.test/c.png)')).toEqual([
      {
        type: 'link',
        href: 'https://example.test/c.png',
        children: [{ type: 'text', text: 'chart' }],
      },
    ]);
  });

  it('leaves unmatched markers as text', () => {
    expect(parseInline('2 * 3 and `open and [x](')).toEqual([
      { type: 'text', text: '2 * 3 and `open and [x](' },
    ]);
  });
});

describe('safeHref', () => {
  it('allows http, https and mailto only', () => {
    expect(safeHref('mailto:a@example.test')).toBe('mailto:a@example.test');
    expect(safeHref('HTTPS://Example.test')).toBe('https://example.test/');
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeUndefined();
    expect(safeHref('chrome-extension://abc/options.html')).toBeUndefined();
  });
});
