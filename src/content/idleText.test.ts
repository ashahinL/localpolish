import { describe, expect, it } from 'vitest';
import { type DiffPart } from '../core/diff';
import { appendedEnding, countChanges, preserveEnding, wordCount } from './idleText';

describe('appendedEnding', () => {
  it.each([
    ['hello', 'hello', ''],
    ['hello', 'hello   ', '   '],
    ['hello', 'hello\u00a0', '\u00a0'],
    ['hello', 'hello.', '.'],
    ['hello', 'hello  .  ', '  .  '],
    ['hello.', 'hello.  ', '  '],
    ['hello ', 'hello . ', '. '],
  ])('preserves the literal harmless ending of %j → %j', (sent, current, ending) => {
    expect(appendedEnding(sent, current)).toBe(ending);
  });

  it.each([
    [undefined, 'hello'],
    ['hello', 'hell'],
    ['hello', 'Hello'],
    ['hello', 'he llo'],
    ['hello', 'hello now'],
    ['hello', 'hello\n'],
    ['hello', 'hello\t'],
    ['hello', 'hello!'],
    ['hello', 'hello…'],
    ['hello', 'hello..'],
    ['hello', 'hello . . '],
    ['hello.', 'hello..'],
    ['hello. ', 'hello. .'],
  ])('rejects a meaningful change from %j to %j', (sent, current) => {
    expect(appendedEnding(sent, current)).toBeUndefined();
  });
});

describe('preserveEnding', () => {
  it.each([
    ['Fixed.', '', 'Fixed.'],
    ['Fixed.', '  ', 'Fixed.  '],
    ['Fixed.', '\u00a0', 'Fixed.\u00a0'],
    ['Fixed', '.', 'Fixed.'],
    ['Fixed.', '.', 'Fixed.'],
    ['Fixed', '  .  ', 'Fixed  .  '],
    ['Fixed.', '  .  ', 'Fixed  .  '],
  ])('preserves %j with ending %j', (fixed, ending, expected) => {
    expect(preserveEnding(fixed, ending)).toBe(expected);
  });
});

describe('wordCount', () => {
  it('counts words split on whitespace', () => {
    expect(wordCount('one two three four five')).toBe(5);
    expect(wordCount('  one   two  ')).toBe(2);
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
