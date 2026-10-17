import { diffWordsWithSpace } from 'diff';

export type DiffPart = { type: 'same' | 'add' | 'del'; text: string };

export function wordDiff(before: string, after: string): DiffPart[] {
  if (before === after) return [{ type: 'same', text: before }];

  const changes = diffWordsWithSpace(before, after, { timeout: 200 });
  // `diff` returns undefined when the timeout hits, instead of a partial result.
  if (changes === undefined) {
    return [
      { type: 'del', text: before },
      { type: 'add', text: after },
    ];
  }

  const parts: DiffPart[] = changes.map((change) => ({
    type: change.added ? 'add' : change.removed ? 'del' : 'same',
    text: change.value,
  }));
  return mergeAdjacent(parts);
}

function mergeAdjacent(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (last && last.type === part.type) last.text += part.text;
    else merged.push({ type: part.type, text: part.text });
  }
  return merged;
}
