import { diffWordsWithSpace } from 'diff';

export type DiffPart = { type: 'same' | 'add' | 'del'; text: string };

export function wordDiff(before: string, after: string): DiffPart[] {
  if (before === after) return [{ type: 'same', text: before }];

  const parts: DiffPart[] = diffWordsWithSpace(before, after).map((change) => ({
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
