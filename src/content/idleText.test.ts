import { describe, expect, it } from 'vitest';
import { type DiffPart } from '../core/diff';
import { countChanges, mapRange, mergePart, pickParagraph, wordCount } from './idleText';

describe('wordCount', () => {
  it('counts words split on whitespace', () => {
    expect(wordCount('one two three four five')).toBe(5);
    expect(wordCount('  one   two  ')).toBe(2);
  });
});

describe('pickParagraph', () => {
  it('picks the paragraph that contains the offset in a long text', () => {
    const paragraph = 'one two three four five';
    const text = `${'a'.repeat(2500)}\n${paragraph}\n${'b'.repeat(2500)}`;
    const at = text.indexOf('three');
    expect(pickParagraph(text, at)).toEqual({
      start: text.indexOf(paragraph),
      end: text.indexOf(paragraph) + paragraph.length,
    });
    expect(text.length).toBeGreaterThan(3000);
  });

  it('uses the paragraph that ends at a newline', () => {
    const text = 'first line\nsecond line';
    expect(pickParagraph(text, text.indexOf('\n'))).toEqual({ start: 0, end: 'first line'.length });
  });
});

describe('mapRange', () => {
  it('keeps the same range when the text did not change', () => {
    expect(mapRange('hello world', 'hello world', 0, 11)).toEqual({ start: 0, end: 11 });
    expect(mapRange('hello world', 'hello world', 6, 11)).toEqual({ start: 6, end: 11 });
  });

  it('leaves text appended after the part outside it', () => {
    expect(mapRange('hello world', 'hello world extra', 0, 11)).toEqual({ start: 0, end: 11 });
    const before = 'hello world\nsecond line stays';
    const after = 'hello world!!\nsecond line stays';
    expect(mapRange(before, after, 0, 'hello world'.length)).toEqual({
      start: 0,
      end: 'hello world'.length,
    });
  });

  it('grows or shrinks when the part is edited inside', () => {
    expect(mapRange('hello world', 'hello big world', 0, 11)).toEqual({ start: 0, end: 15 });
    expect(mapRange('hello big world', 'hello world', 0, 15)).toEqual({ start: 0, end: 11 });
    expect(mapRange('KEEP hello', 'KEEP hi', 5, 10)).toEqual({ start: 5, end: 7 });
  });

  it('shifts the part when text is inserted before it', () => {
    expect(mapRange('hello world', 'XX hello world', 6, 11)).toEqual({ start: 9, end: 14 });
    expect('XX hello world'.slice(9, 14)).toBe('world');
    expect(mapRange('XXXXXhello', 'YYhello', 5, 10)).toEqual({ start: 2, end: 7 });
    expect('YYhello'.slice(2, 7)).toBe('hello');
  });

  it('maps an offset inside a deleted run to the start of that run', () => {
    expect(mapRange('hello', 'hi', 3, 3)).toEqual({ start: 1, end: 1 });
  });
});

describe('mergePart', () => {
  it('replaces the range and keeps the text around it', () => {
    expect(mergePart('hello world extra', { start: 0, end: 11 }, 'hi world')).toBe(
      'hi world extra',
    );
  });
});

describe('countChanges', () => {
  it('counts a deleted word and its replacement as one change', () => {
    const parts: DiffPart[] = [
      { type: 'del', text: 'has' },
      { type: 'add', text: 'have' },
    ];
    expect(countChanges(parts)).toBe(1);
  });

  it('counts separate edits as separate changes', () => {
    const parts: DiffPart[] = [
      { type: 'del', text: 'i' },
      { type: 'add', text: 'I' },
      { type: 'same', text: ' ' },
      { type: 'del', text: 'has ' },
      { type: 'same', text: 'went home today' },
      { type: 'add', text: '.' },
    ];
    expect(countChanges(parts)).toBe(3);
    expect(countChanges([{ type: 'same', text: 'same' }])).toBe(0);
  });
});
