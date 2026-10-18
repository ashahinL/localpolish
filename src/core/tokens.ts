interface TokenHit {
  index: number;
  token: string;
}

function urlRe(): RegExp {
  return /https?:\/\/[^\s<>"']+/gu;
}

function mentionRe(): RegExp {
  return /(?<![\w@])@[\p{L}\p{N}_.-]*[\p{L}\p{N}_]/gu;
}

function hashtagRe(): RegExp {
  return /(?<![\w#&])#[\p{L}\p{N}_]+/gu;
}

function codeRe(): RegExp {
  return /`[^`\n]+`/g;
}

function emojiRe(): RegExp {
  return new RegExp('\\p{RGI_Emoji}', 'gv');
}

function stripUrlTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)]+$/u, '');
}

function hitsFrom(text: string, re: RegExp, normalize?: (token: string) => string): TokenHit[] {
  const hits: TokenHit[] = [];
  for (const match of text.matchAll(re)) {
    if (match.index === undefined) continue;
    const token = normalize ? normalize(match[0]) : match[0];
    if (token === '') continue;
    hits.push({ index: match.index, token });
  }
  return hits;
}

export function extractProtectedTokens(text: string): string[] {
  const urlHits = hitsFrom(text, urlRe(), stripUrlTrailingPunctuation);
  const withoutUrls = text.replace(urlRe(), (match) => ' '.repeat(match.length));
  const hits = [
    ...urlHits,
    ...hitsFrom(withoutUrls, mentionRe()),
    ...hitsFrom(withoutUrls, hashtagRe()),
    ...hitsFrom(text, codeRe()),
    ...hitsFrom(text, emojiRe()),
  ];
  hits.sort((left, right) => left.index - right.index);

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const hit of hits) {
    if (seen.has(hit.token)) continue;
    seen.add(hit.token);
    tokens.push(hit.token);
  }
  return tokens;
}

export function findMissingTokens(input: string, output: string): string[] {
  const kept = new Set(extractProtectedTokens(output));
  return extractProtectedTokens(input).filter((token) => !kept.has(token));
}

const ARABIC_SCRIPT = /\p{Script=Arabic}/u;

export function lostArabicScript(input: string, output: string): boolean {
  return ARABIC_SCRIPT.test(input) && !ARABIC_SCRIPT.test(output);
}
