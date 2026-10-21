# T22b. Language settings and the idle skip

Lane: Sol medium (`second`). Follow the `implement-plan` skill in its light form: build, test, keep the plan current, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass. The owner reviews the diff.

Repo: LocalPolish, a Chrome MV3 extension (WXT, TypeScript, Preact, Vitest, Playwright). Plan: `docs/plans/features-1.3-1.4.md`, section "1.3.0, part 2: language switches". T22a already added `src/content/language.ts` (`detectLanguages`, `DetectFn`, `Lang`).

## Goal

Let the user turn languages off for idle Fix ("Fix while I type"). This task adds the setting, the idle skip and the "leave these parts alone" prompt line. There is no UI in this task. T22c adds the switches later, so for now the setting is set through storage only.

## Rules from the owner

- **Off means idle Fix skips it.** No idle request and no idle mark for a draft whose main language is off. Manual Fix (the sparkle button, the shortcut, the popup) still works on any language and never adds the keep line.
- **The main language decides.** Main language off: skip. Main language on, but other parts in languages that are off: send the idle request with a line telling the model to leave those parts as they are.
- **Main language `null`** (too short to judge): use the last main language seen for that same field. If there is none, treat it as on.
- **Defaults:** all four on, so nothing changes after an update.

## Steps

1. **Settings** (`src/core/settings.ts`):
   - Add `export type LanguageId = 'en' | 'ar' | 'franco' | 'other';`. In `src/content/language.ts`, make `Lang` an alias of it (`export type Lang = LanguageId;`), so there is one list.
   - Add `languages: Record<LanguageId, boolean>` to `Settings`, defaulting to all `true` in `DEFAULT_SETTINGS`.
   - Use checked reads like the existing ones. In `storedPatch`, keep only known keys with boolean values. In `mergeSettings` and `saveSettings`, merge `languages` key by key, the same way `models` and `efforts` are merged, so a partial save keeps the other switches.
   - Add `languages` to `PageSettings` (`src/core/messages.ts`) and to `pageSettings()`.
   - Find every place that builds or checks a `PageSettings` value and include `languages`: the background broadcast of `page-settings-changed` and the `page-settings` reply, and `applySettings` in `src/entrypoints/content.ts`, whose validation must also reject a bad `languages` value.
2. **The request** (`src/core/messages.ts`): add `keep?: LanguageId[]` to `RewriteRequest`. In `isRewriteRequest` (`src/entrypoints/background.ts`, about line 71), accept `keep` only when `trigger === 'idle'`, and only as an array of known ids with no duplicates. Otherwise reject the request, as unknown triggers are rejected today.
3. **The prompt** (`src/core/prompts.ts`): `buildPrompt(mode, tone, text, keep?)`. When `keep` is non-empty, add one sentence to the end of the system prompt: `Leave the <names> parts exactly as they are.` The names are English, Arabic, Franco-Arabic and "other-language", joined like "Arabic and Franco-Arabic" or "English, Arabic and Franco-Arabic". Pass `req.keep` from `src/background/rewrite.ts:47`. If the background caches or reuses answers by request, `keep` must be part of that key. Check this, and say what you found in the report.
4. **Idle Fix** (`src/content/idle.ts`):
   - Add to `IdleDeps`: `languages(): Record<LanguageId, boolean>` and `detect: DetectFn`. In `src/entrypoints/content.ts`, pass `languages: () => (settings ?? DEFAULT_SETTINGS).languages` and a `detect` that calls `chrome.i18n.detectLanguage(text)`. Extend the local `ContentChrome` type for it, matching how that file types `chrome`.
   - In `tryRun` (about line 166), after the existing checks pass:
     - If every language is on, send exactly as today, with no detection. This keeps the common case free.
     - Otherwise call `detectLanguages(full, deps.detect)`. When it resolves, run the same checks as `tryRun` again: enabled, focused, connected, popup closed, not running, and the field text still equal to `full`. If any check fails, do nothing. A later input re-arms the timer.
     - Store the main language on the slot (for example `slot.language`) whenever it is not `null`. Use it when a later result is `null`.
     - Main language off: send nothing, and hide any mark for that field, using the existing `hide` and `renderMarks` helpers.
     - Main language on: send with `keep` set to the parts that are off, or no `keep` when none are. Give `send` an optional `keep` parameter and add it to the posted message only when it is non-empty.
   - `open()` and `activate()` (the manual paths) never add `keep`, and are not language-gated.
   - When the `languages` setting changes, existing idle results must not keep showing marks for drafts whose main language is now off. Mirror what `refresh()` does today when `idleFix` changes. If that is too broad, clear only the results whose recorded main language is now off. Say which one you chose.
   - Detection errors (a rejected promise) count as "all on": send as today. Wrap the call with the file's existing `guarded` and `settle` helpers, not a new pattern.
5. **Tests.** Use made-up text only.
   - `src/core/settings.test.ts`: the default is all on, bad stored values are ignored, a partial save keeps the other switches, and `pageSettings` includes `languages`.
   - `src/core/prompts.test.ts`: no line without `keep`, and the exact sentence for one, two and three names.
   - `src/background/entrypoint.test.ts`: `keep` is accepted on idle requests, and rejected on manual requests, with unknown ids, or with duplicates.
   - e2e, in the spec that already runs the built extension against the mock OpenAI server (`tests/e2e/extension.spec.ts`, which has `writeSettings` and request recording). Write settings with `languages.ar = false`, then:
     1. An Arabic-only draft gets no idle request after the idle wait.
     2. Manual Fix on the same draft (the Polish shortcut) does send a request, without the keep line.
     3. A mostly English draft with one Arabic word gets an idle request whose system prompt ends with `Leave the Arabic parts exactly as they are.`
   - Prove each e2e test fails without your change, then passes with it.
6. **Plan:** tick T22b in `docs/plans/features-1.3-1.4.md`, and add this line under the T22b entry: "Bench check of the keep line: pending, the owner schedules it (paid run)."

## Do not

- Do not add UI. That is T22c.
- Do not run the bench, a real CLI or a paid provider. Use the mock server and fake CLIs only.
- Do not change the Fix prompt text beyond the one added sentence. It is kept short on purpose (`docs/benchmarks/2026-10-17-fix-mode.md`).
- Do not add dependencies or change the version. Do not commit. The orchestrator reviews and commits.

## Checks

npm needs `--cache /tmp/npm-cache-localpolish` if it uses a cache.

- Targeted: `npx vitest run src/core src/background src/content`, and `npx playwright test tests/e2e/extension.spec.ts` (it builds first through `npm run test:e2e`; `npm run build` before a targeted Playwright run).
- Full gates once at the end: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, `npm run test:e2e`.
- If the sandbox blocks the browser tests or their local port, say so in the report. The orchestrator runs them.

## Report

List the changed files, the check results (failing before, passing after for the e2e tests), the cache-key finding from step 3, the `refresh()` choice from step 4, and anything in this brief you had to bend and why.

Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
