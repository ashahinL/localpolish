import { describe, expect, it } from 'vitest';
import { wordDiff, type DiffPart } from './diff';

function joined(parts: DiffPart[], types: ReadonlySet<DiffPart['type']>): string {
  return parts
    .filter((part) => types.has(part.type))
    .map((part) => part.text)
    .join('');
}

describe('wordDiff', () => {
  it('returns one same part for identical strings', () => {
    expect(wordDiff('same text', 'same text')).toEqual([{ type: 'same', text: 'same text' }]);
  });

  it('diffs i has went into I have gone word by word', () => {
    expect(wordDiff('i has went', 'I have gone')).toEqual([
      { type: 'del', text: 'i' },
      { type: 'add', text: 'I' },
      { type: 'same', text: ' ' },
      { type: 'del', text: 'has' },
      { type: 'add', text: 'have' },
      { type: 'same', text: ' ' },
      { type: 'del', text: 'went' },
      { type: 'add', text: 'gone' },
    ]);
  });

  it('joins same+add back to after and same+del back to before', () => {
    const cases = [
      ['i has went', 'I have gone'],
      ['مرحبا كيف حالك', 'مرحبا، كيف حالك؟'],
      ['line one\nline two', 'line one\nline 2'],
    ] as const;

    for (const [before, after] of cases) {
      const parts = wordDiff(before, after);
      expect(joined(parts, new Set(['same', 'add']))).toBe(after);
      expect(joined(parts, new Set(['same', 'del']))).toBe(before);
    }
  });
});
