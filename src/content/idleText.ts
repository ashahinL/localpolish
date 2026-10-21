import { type DiffPart } from '../core/diff';

export function appendedEnding(sent: string | undefined, current: string): string | undefined {
  if (sent === undefined || !current.startsWith(sent)) return undefined;
  const ending = current.slice(sent.length);
  if (!/^[ \u00a0]*(?:\.[ \u00a0]*)?$/.test(ending)) return undefined;
  if (ending.includes('.') && /\.[ \u00a0]*$/.test(sent)) return undefined;
  return ending;
}

export function preserveEnding(fixed: string, ending: string): string {
  if (ending.includes('.')) return fixed.replace(/\.[ \u00a0]*$/, '') + ending;
  return fixed + ending;
}

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
