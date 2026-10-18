import { type DiffPart } from '../core/diff';

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

export function countChanges(parts: DiffPart[]): number {
  let count = 0;
  let changing = false;
  for (const part of parts) {
    if (part.type === 'same') {
      changing = false;
      continue;
    }
    if (!changing) count += 1;
    changing = true;
  }
  return count;
}
