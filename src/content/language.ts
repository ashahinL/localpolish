export type Lang = 'en' | 'ar' | 'franco' | 'other';

export interface ChromeLanguageResult {
  isReliable: boolean;
  languages: { language: string; percentage: number }[];
}

export type DetectFn = (text: string) => Promise<ChromeLanguageResult>;

export interface LanguageResult {
  main: Lang | null;
  parts: Lang[];
}

export const FRANCO_WORDS: ReadonlySet<string> = new Set([
  'ana',
  'enta',
  'enty',
  'inta',
  'inti',
  'msh',
  'mesh',
  'mish',
  'ezay',
  'izay',
  'leh',
  'keda',
  'kda',
  'yalla',
  'khalas',
  'awi',
  'gedan',
  'bokra',
  'inshallah',
  'habibi',
  'tamam',
  'ya3ni',
  'yani',
  'fein',
  'feen',
  '3ayez',
  'aho',
  'wallahi',
  'wallah',
  'ahlan',
  'shokran',
  'elhamdulillah',
  'delwa2ty',
  'dlw2ty',
  'mafeesh',
  'mafish',
  'ma3lesh',
  'lessa',
  'bardo',
]);

const ARABIC_LETTER =
  /(?=[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff])\p{L}/u;
const LATIN_LETTER = /(?=\p{Script=Latin})\p{L}/u;
const PRIORITY: Lang[] = ['en', 'ar', 'franco', 'other'];

function isFranco(word: string): boolean {
  if (FRANCO_WORDS.has(word.toLowerCase())) return true;
  // A Franco digit stands for a letter, so a letter follows it: ma3lesh, 7elw. Not mp3 or web3.
  if (!/[2356789]\p{L}/u.test(word)) return false;
  if ((word.match(/(?=\p{Script=Latin})\p{L}/gu)?.length ?? 0) < 2) return false;
  if (/^\d+(?:st|nd|rd|th|am|pm)$/i.test(word)) return false;
  if (/^\d{2,}\p{L}+$/u.test(word)) return false;
  return true;
}

export async function detectLanguages(text: string, detect: DetectFn): Promise<LanguageResult> {
  const cleaned = text
    .replace(/`[^`]*`/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, ' ')
    .replace(/[@#][\p{L}\p{M}\p{N}_]+/gu, ' ');
  const words = cleaned.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
  const counts: Record<Lang, number> = { en: 0, ar: 0, franco: 0, other: 0 };
  const latin: string[] = [];
  let francoCount = 0;

  for (const word of words) {
    if (ARABIC_LETTER.test(word)) {
      counts.ar++;
    } else if (LATIN_LETTER.test(word)) {
      latin.push(word);
      if (isFranco(word)) francoCount++;
    } else if (/\p{L}/u.test(word)) {
      counts.other++;
    }
  }

  if (latin.length > 0) {
    let language: Lang = 'franco';
    if (francoCount / latin.length < 0.25) {
      const result = await detect(latin.join(' '));
      let top: ChromeLanguageResult['languages'][number] | undefined;
      for (const candidate of result.languages) {
        if (!top || candidate.percentage > top.percentage) top = candidate;
      }
      language =
        result.isReliable && top && top.language !== 'en' && top.language !== 'und'
          ? 'other'
          : 'en';
    }
    counts[language] += latin.length;
  }

  const parts = PRIORITY.filter((language) => counts[language] > 0);
  parts.sort((a, b) => counts[b] - counts[a]);
  const total = counts.en + counts.ar + counts.franco + counts.other;
  return { main: total < 3 ? null : (parts[0] ?? null), parts };
}
