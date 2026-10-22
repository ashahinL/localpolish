// A small Markdown subset parsed into plain data. The renderer only ever makes text nodes
// and known elements from it, so raw HTML in an answer stays visible text.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'break' };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; children: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { type: 'quote'; children: Block[] };

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^ {0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const ESCAPABLE = /[\\`*_[\]()#+\-.!>~]/;
// Deeper nesting stays plain source text, so parsing and rendering a hostile answer
// cannot run out of stack.
const MAX_QUOTE_DEPTH = 6;
const MAX_INLINE_DEPTH = 4;
const MAX_URL_CHARS = 2048;

// Returns the first match at or after `from`. One parse only searches forward, so a remembered
// answer also covers later searches up to it. Unmatched markers then cost one scan, not one each.
type Search = (key: string, from: number, find: (from: number) => number) => number;

function forwardSearch(): Search {
  const seen = new Map<string, { from: number; at: number }>();
  return (key, from, find) => {
    const hit = seen.get(key);
    if (hit && from >= hit.from && (hit.at === -1 || from <= hit.at)) return hit.at;
    const at = find(from);
    seen.set(key, { from, at });
    return at;
  };
}

export function safeHref(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'));
}

function plainLines(lines: string[]): Inline[] {
  return lines.flatMap((text, index): Inline[] =>
    index === 0 ? [{ type: 'text', text }] : [{ type: 'break' }, { type: 'text', text }],
  );
}

function parseBlocks(lines: string[], depth = 0): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      // An unclosed fence runs to the end, which keeps a streaming code block steady.
      while (i < lines.length && !isFenceEnd(lines[i]!, marker)) body.push(lines[i++]!);
      i++;
      blocks.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', children: parseInline(heading[1]!) });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const raw: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) raw.push(lines[i++]!);
      if (depth >= MAX_QUOTE_DEPTH) {
        blocks.push({ type: 'paragraph', children: plainLines(raw) });
        continue;
      }
      const body = raw.map((quoted) => QUOTE.exec(quoted)![1]!);
      blocks.push({ type: 'quote', children: parseBlocks(body, depth + 1) });
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (BULLET.test(line) || numbered) {
      const ordered = numbered !== null;
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const item = ordered ? NUMBERED.exec(current)?.[2] : BULLET.exec(current)?.[1];
        if (item !== undefined) {
          items.push([item]);
          i++;
          continue;
        }
        // Indented lines continue the item, including nested list markers.
        if (current.trim() !== '' && /^\s{2,}/.test(current)) {
          items.at(-1)!.push(current.trim());
          i++;
          continue;
        }
        // A blank line between items keeps one list.
        const next = lines[i + 1];
        const nextIsItem =
          next !== undefined && (ordered ? NUMBERED.test(next) : BULLET.test(next));
        if (current.trim() === '' && nextIsItem) {
          i++;
          continue;
        }
        break;
      }
      blocks.push({
        type: 'list',
        ordered,
        start: numbered ? Number(numbered[1]) : 1,
        items: items.map((parts) => parseInline(parts.join('\n'))),
      });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !startsBlock(lines[i]!)) {
      body.push(lines[i++]!.trim());
    }
    blocks.push({ type: 'paragraph', children: parseInline(body.join('\n')) });
  }
  return blocks;
}

function isFenceEnd(line: string, marker: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith(marker) && trimmed.replaceAll(marker[0]!, '') === '';
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line)
  );
}

function nested(text: string, depth: number): Inline[] {
  return depth >= MAX_INLINE_DEPTH ? [{ type: 'text', text }] : parseInline(text, depth);
}

export function parseInline(text: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push({ type: 'text', text: buffer });
    buffer = '';
  };
  const search = forwardSearch();
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && ESCAPABLE.test(text[i + 1] ?? '')) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      flush();
      out.push({ type: 'break' });
      i++;
      continue;
    }
    if (ch === '`') {
      const run = /^`+/.exec(text.slice(i))![0];
      const end = search(run, i + run.length, (from) => text.indexOf(run, from));
      if (end !== -1) {
        flush();
        out.push({ type: 'code', text: text.slice(i + run.length, end).replace(/\n/g, ' ') });
        i = end + run.length;
        continue;
      }
      buffer += run;
      i += run.length;
      continue;
    }
    if (ch === '[' || (ch === '!' && text[i + 1] === '[')) {
      const link = readLink(text, ch === '!' ? i + 1 : i, search);
      if (link) {
        flush();
        const label = nested(link.label || link.url, depth + 1);
        const href = safeHref(link.url);
        // Images become plain links, so nothing remote loads without a click.
        if (href) out.push({ type: 'link', href, children: label });
        else out.push(...label);
        i = link.end;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const emphasis = readEmphasis(text, i, depth, search);
      if (emphasis) {
        flush();
        out.push(emphasis.node);
        i = emphasis.end;
        continue;
      }
      const run = ch === '*' ? /^\*+/.exec(text.slice(i))![0] : /^_+/.exec(text.slice(i))![0];
      buffer += run;
      i += run.length;
      continue;
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}

function readLink(
  text: string,
  open: number,
  search: Search,
): { label: string; url: string; end: number } | undefined {
  const close = search(']', open + 1, (from) => text.indexOf(']', from));
  if (close === -1 || text[close + 1] !== '(') return undefined;
  const paren = search(')', close + 2, (from) => text.indexOf(')', from));
  if (paren === -1) return undefined;
  // URLs may hold balanced parentheses, like a wiki link.
  let depth = 0;
  let end = close + 2;
  const last = Math.min(text.length, end + MAX_URL_CHARS);
  for (; end < last; end++) {
    if (text[end] === '\n') return undefined;
    if (text[end] === '(') depth++;
    else if (text[end] === ')' && depth-- === 0) break;
  }
  if (end >= last) return undefined;
  const target = text.slice(close + 2, end).trim();
  const url = (target.split(/\s+/)[0] ?? '').replace(/^<(.*)>$/, '$1');
  if (url === '' || text.slice(open + 1, close).includes('\n')) return undefined;
  return { label: text.slice(open + 1, close), url, end: end + 1 };
}

function readEmphasis(
  text: string,
  start: number,
  depth: number,
  search: Search,
): { node: Inline; end: number } | undefined {
  const ch = text[start]!;
  // Underscores inside words, like snake_case, stay literal.
  if (ch === '_' && /\w/.test(text[start - 1] ?? '')) return undefined;
  for (const size of [2, 1]) {
    const marker = ch.repeat(size);
    if (text.slice(start, start + size) !== marker) continue;
    const from = start + size;
    if (/\s/.test(text[from] ?? ' ')) continue;
    // Whether a marker can close depends only on its own position, so the search can be shared.
    const end = search(marker, from + 1, (at) => {
      for (let end = text.indexOf(marker, at); end !== -1; end = text.indexOf(marker, end + 1)) {
        const tooLong = size === 1 && text[end + 1] === ch;
        const wordEdge = ch === '_' && /\w/.test(text[end + size] ?? '');
        if (!/\s/.test(text[end - 1]!) && !tooLong && !wordEdge) return end;
      }
      return -1;
    });
    if (end === -1) continue;
    const children = nested(text.slice(from, end), depth + 1);
    return {
      node: size === 2 ? { type: 'strong', children } : { type: 'em', children },
      end: end + size,
    };
  }
  return undefined;
}
