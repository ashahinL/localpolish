import { describe, expect, it } from 'vitest';
import { type DiffPart } from '../core/diff';
import { countChanges, wordCount } from './idleText';

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
