# T22a. Language detector

Lane: Sol medium (`second`). Follow the `implement-plan` skill in its light form: build, test, keep the plan current, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass. The owner reviews the diff.

Repo: LocalPolish, a Chrome MV3 extension (WXT, TypeScript, Preact, Vitest). Plan: `docs/plans/features-1.3-1.4.md`, section "1.3.0, part 2: language switches".

## Goal

Add a pure module that tells idle Fix the main language of a draft and which other languages appear in it. T22b (a later task) wires it into settings and idle Fix. This task adds the module and its unit tests only. Do not touch `idle.ts`, settings or UI.

## The module: `src/content/language.ts`

```ts
export type Lang = 'en' | 'ar' | 'franco' | 'other';

export interface ChromeLanguageResult {
  isReliable: boolean;
  languages: { language: string; percentage: number }[];
}

// The shape of chrome.i18n.detectLanguage. Passed in so tests can use a fake.
export type DetectFn = (text: string) => Promise<ChromeLanguageResult>;

export interface LanguageResult {
  main: Lang | null; // null when the text is too short to judge
  parts: Lang[]; // every language with at least one counted word, main first, no duplicates
}

export async function detectLanguages(text: string, detect: DetectFn): Promise<LanguageResult>;
```

## Rules

1. **Strip noise before counting.** Remove URLs, emails, `@mentions`, `#hashtags`, inline code in backticks, emojis and tokens that are only digits or punctuation. These never count as words.
2. **Split words into two groups by script.**
   - A word with any Arabic-script letter (ranges `؀-ۿ`, `ݐ-ݿ`, `ࢠ-ࣿ`, `ﭐ-﷿`, `ﹰ-﻿`) is an Arabic word.
   - A word with Latin letters is a Latin word.
   - Other scripts (Cyrillic, CJK, …) count as `other` words.
3. **Franco words in the Latin group.** A Latin word is a Franco word when either:
   - it mixes letters with one of the digits 2, 3, 5, 6, 7, 8, 9 (examples: `3ala`, `ma3lesh`, `7elw`, `delwa2ty`, `2ana`). Plain numbers like `2026` or `3pm`, `5k` and `2nd` are not Franco. Require at least two letters and the digit not to be only a leading count or an English ordinal (`1st`, `2nd`, `3rd`, `4th`);
   - or it is in a small exported set `FRANCO_WORDS`. Use only words that are not also common English: `ana`, `enta`, `enty`, `inta`, `inti`, `msh`, `mesh`, `mish`, `ezay`, `izay`, `leh`, `keda`, `kda`, `yalla`, `khalas`, `awi`, `gedan`, `bokra`, `inshallah`, `habibi`, `tamam`, `ya3ni`, `yani`, `fein`, `feen`, `3ayez`, `aho`, `wallahi`, `wallah`, `ahlan`, `shokran`, `elhamdulillah`, `delwa2ty`, `dlw2ty`, `mafeesh`, `mafish`, `ma3lesh`, `lessa`, `bardo`. Do not add `bas`, `eh`, `fen`, `law`, `men`, `ya`, `el`, because they are short or also English or ambiguous.
4. **Decide the Latin group.**
   - If at least 25% of the Latin words are Franco words, the whole Latin group is `franco`.
   - Otherwise call `detect` once with only the Latin words joined by spaces. If its top language is `en`, the group is `en`. If the result is reliable and its top language is something else, the group is `other`. If it is unreliable or `und`, the group is `en`, because English is the common case here.
5. **Main language.** Count words per language: Arabic words → `ar`, the Latin group → its language, other-script words → `other`. The main language has the most words. On a tie, prefer `en`, then `ar`, then `franco`, then `other`.
6. **Too short.** If there are fewer than 3 counted words in total, return `{ main: null, parts }`. Still fill `parts`, so T22b can know what appears.
7. **Speed.** At most one `detect` call per `detectLanguages` call, and none when the Latin group is empty or already Franco. Use plain loops and regexes, with no new dependencies.

## Tests: `src/content/language.test.ts`

Vitest, matching the style of `src/content/idleText.test.ts`. Use a fake `DetectFn` that records its calls and returns what each test sets. Use made-up sample text only.

Cover, with literal expected results:

- English only → `{ main: 'en', parts: ['en'] }`.
- Arabic only → `ar`, and `detect` is not called.
- Franco by digits (`ana 3ayez a7ki m3ak bokra`) → `franco`, and `detect` is not called.
- Franco by word list only (`ana mesh fahem keda khalas`) → `franco`.
- An English sentence with one Arabic word → main `en`, parts `['en', 'ar']`.
- Mostly Arabic with two English words → main `ar`, parts `['ar', 'en']`.
- English with `2026`, `3pm`, `2nd` and a URL → `en`, not `franco`.
- Mentions, hashtags, emails, URLs, emojis and backtick code don't count. A text that is only those returns `main: null`.
- Fewer than 3 words → `main: null`, with parts filled.
- French text where the fake says reliable `fr` → `other`.
- An unreliable or `und` result for Latin text → `en`.
- A tie between English and Arabic → `en`.
- `detect` is called at most once, with only the Latin words.

## Do not

- Do not edit `idle.ts`, settings, prompts, UI, the bridge or e2e tests.
- Do not add dependencies or change the version.
- Do not commit. The orchestrator reviews and commits.

## Checks

Use `--cache /tmp/npm-cache-localpolish` if npm needs a cache.

- Targeted: `npx vitest run src/content/language.test.ts`
- Full: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`

## When done

Tick T22a in `docs/plans/features-1.3-1.4.md` (change `- [ ] **T22a.` to `- [x] **T22a.`).

## Report

List the changed files, the targeted and full check results, and any rule above you had to bend and why.

Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
