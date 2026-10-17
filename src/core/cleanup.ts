const PREAMBLE_LINE =
  /^(here('s| is| are)|sure|certainly|of course|okay|ok|corrected|rewritten|revised|edited|polished)\b[^\n]*:\s*$/i;

const QUOTE_PAIRS = [
  ['"', '"'],
  ['\u201C', '\u201D'],
  ["'", "'"],
  ['\u2018', '\u2019'],
] as const;

export function cleanOutput(raw: string, input: string): string {
  let out = raw.trim();
  out = stripTextTags(out);
  out = stripFence(out, input);
  out = stripPreamble(out, input);
  out = stripWrappingQuotes(out, input);
  out = replaceEmDashes(out, input);
  out = replaceSmartQuotes(out, input);
  const lead = leadingWhitespace(input);
  return lead + out + trailingWhitespace(input.slice(lead.length));
}

function stripTextTags(out: string): string {
  if (out.startsWith('<text>') && out.endsWith('</text>')) {
    return out.slice('<text>'.length, -'</text>'.length).trim();
  }
  return out;
}

function stripFence(out: string, input: string): string {
  if (!out.startsWith('```') || input.trim().startsWith('```')) return out;
  const open = /^```[^\n]*\n/.exec(out);
  if (!open) return out;
  const lines = out.slice(open[0].length).split('\n');
  if (lines.at(-1)?.trim() === '```') lines.pop();
  return lines.join('\n').trim();
}

function stripPreamble(out: string, input: string): string {
  const splitAt = out.indexOf('\n');
  if (splitAt === -1) return out;
  const firstLine = out.slice(0, splitAt);
  const rest = out.slice(splitAt + 1);
  if (!PREAMBLE_LINE.test(firstLine) || rest.trim() === '') return out;
  // The user's own text can start with a heading like "Corrected:".
  if (PREAMBLE_LINE.test(input.trim().split('\n')[0] ?? '')) return out;
  return rest.trim();
}

function matchingQuotePair(text: string): (typeof QUOTE_PAIRS)[number] | undefined {
  if (text.length < 2) return undefined;
  return QUOTE_PAIRS.find(([open, close]) => text.startsWith(open) && text.endsWith(close));
}

function stripWrappingQuotes(out: string, input: string): string {
  const pair = matchingQuotePair(out);
  if (!pair || matchingQuotePair(input.trim())) return out;
  return out.slice(pair[0].length, -pair[1].length);
}

function replaceEmDashes(out: string, input: string): string {
  if (input.includes('\u2014')) return out;
  // Absorb a comma next to the dash, so "a, \u2014 b" does not become "a, , b".
  return out.replace(/,?[ \t]*\u2014[ \t]*,?[ \t]*/g, ', ');
}

function hasCurlyQuotes(text: string): boolean {
  return (
    text.includes('\u2018') ||
    text.includes('\u2019') ||
    text.includes('\u201C') ||
    text.includes('\u201D')
  );
}

function replaceSmartQuotes(out: string, input: string): string {
  if (hasCurlyQuotes(input)) return out;
  return out
    .replaceAll('\u2018', "'")
    .replaceAll('\u2019', "'")
    .replaceAll('\u201C', '"')
    .replaceAll('\u201D', '"');
}

function leadingWhitespace(input: string): string {
  return /^\s*/.exec(input)?.[0] ?? '';
}

function trailingWhitespace(input: string): string {
  return /\s*$/.exec(input)?.[0] ?? '';
}
