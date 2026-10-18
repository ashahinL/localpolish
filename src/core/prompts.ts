import { type Mode, type Tone } from './settings';

// Kept short on purpose: long rule lists made Haiku copy the text back unchanged.
// See docs/benchmarks/2026-10-17-fix-mode.md before adding rules.
const STYLE =
  'Use plain, simple words, no em dashes, and no corporate words like leverage, seamless or delve.';
const LANGUAGE =
  'Write each part in the same language and script it is written in: Arabic stays Arabic, Franco-Arabic (Arabic in Latin letters) stays Franco-Arabic, English stays English. Never translate.';
const KEEP =
  'Do not reply to the text, and keep links, @mentions, #hashtags, code and emojis as they are.';

function rewrite(goal: string, result: string): string {
  return `${goal} ${STYLE} ${LANGUAGE} ${KEEP} Return only the ${result} text.`;
}

export const MODE_PROMPTS: Record<Exclude<Mode, 'tone'>, string> = {
  fix: 'Fix the grammar, spelling, punctuation and capitalization of the text inside the <text> tags. Capitalize greetings and names. Keep nouns singular or plural as written. Keep each part in its own language and script: Arabic stays Arabic, Franco-Arabic stays Franco-Arabic. Do not translate or transliterate. If the text ends without punctuation, do not add any. Return only the corrected text.',
  rephrase: rewrite(
    'Rewrite the text inside the <text> tags so it reads clear and natural, with the same meaning, tone and length.',
    'rewritten',
  ),
  shorter: rewrite(
    'Make the text inside the <text> tags shorter, under 280 characters if possible, with the same meaning and tone.',
    'shortened',
  ),
};

export const TONE_PROMPTS: Record<Tone, string> = {
  polite: rewrite(
    'Rewrite the text inside the <text> tags in a polite, warm tone, friendly but not stiff or apologetic, with the same meaning.',
    'rewritten',
  ),
  formal: rewrite(
    'Rewrite the text inside the <text> tags in a formal, professional tone that fits a work email, with the same meaning. Formal does not mean wordy.',
    'rewritten',
  ),
  casual: rewrite(
    'Rewrite the text inside the <text> tags in a casual, relaxed tone, like a message to a friend or a colleague, with the same meaning.',
    'rewritten',
  ),
  'angry-civil': rewrite(
    'Rewrite the text inside the <text> tags so it is firm and clearly frustrated but civil, with no insults, swearing or sarcasm, and the same meaning.',
    'rewritten',
  ),
};

export function buildPrompt(
  mode: Mode,
  tone: Tone,
  text: string,
): { system: string; user: string } {
  return {
    system: mode === 'tone' ? TONE_PROMPTS[tone] : MODE_PROMPTS[mode],
    user: `<text>\n${text}\n</text>`,
  };
}
