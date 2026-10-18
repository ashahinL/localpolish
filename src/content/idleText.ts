import { diffChars, type Change } from 'diff';
import { type DiffPart } from '../core/diff';

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

export function pickParagraph(text: string, offset: number): { start: number; end: number } {
  const at = Math.max(0, Math.min(offset, text.length));
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const newline = text.indexOf('\n', at);
  return { start, end: newline === -1 ? text.length : newline };
}

export function mapRange(
  before: string,
  after: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const changes = diffChars(before, after);
  return { start: mapOffset(changes, start, false), end: mapOffset(changes, end, true) };
}

export function mergePart(
  current: string,
  range: { start: number; end: number },
  fixed: string,
): string {
  return current.slice(0, range.start) + fixed + current.slice(range.end);
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

function mapOffset(changes: Change[], offset: number, isEnd: boolean): number {
  let oldPos = 0;
  let newPos = 0;
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    if (!change) break;
    const len = change.value.length;
    if (change.added) {
      // Typed after the part. An insertion on the end boundary stays outside it.
      if (oldPos >= offset) return newPos;
      newPos += len;
      continue;
    }
    if (change.removed) {
      const nextOld = oldPos + len;
      if (!isEnd && offset === nextOld) {
        // The deleted text sat before the part. A replacement of it stays outside too.
        oldPos = nextOld;
        const next = changes[index + 1];
        if (next?.added) {
          newPos += next.value.length;
          index += 1;
        }
        continue;
      }
      if (offset < nextOld) return newPos;
      if (isEnd && offset === nextOld) {
        // The deleted text was inside the part, so its replacement stays inside.
        const next = changes[index + 1];
        return next?.added ? newPos + next.value.length : newPos;
      }
      oldPos = nextOld;
      continue;
    }
    const nextOld = oldPos + len;
    if (offset <= nextOld) return newPos + (offset - oldPos);
    oldPos = nextOld;
    newPos += len;
  }
  return newPos;
}
