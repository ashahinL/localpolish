# T22c. Language switches in the UI

Lane: art (Claude Opus). Follow the `implement-plan` skill in its light form: build, test, keep the plan current, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass. The owner reviews the diff.

Repo: LocalPolish, a Chrome MV3 extension (WXT, TypeScript, Preact, Vitest, Playwright). Plan: `docs/plans/features-1.3-1.4.md`, section "1.3.0, part 2: language switches".

## Background

T22b added the setting `languages: Record<LanguageId, boolean>` (`src/core/settings.ts`), with `LanguageId = 'en' | 'ar' | 'franco' | 'other'`. All four default to on. A language that is off is skipped by idle Fix ("Fix while I type") when it is the draft's main language. When it is only a part of the draft, idle Fix asks the model to leave those parts as they are. Manual Fix (the sparkle button, the shortcut) is never affected. Right now there is no UI for this setting. This task adds it.

Labels: English, Arabic, Franco-Arabic, Other languages.

## Work

1. **Options page** (`src/options/sections.tsx`, the "Defaults" card, under the "Fix while I type" checkbox at about line 116):
   - Add a small group titled "Languages to fix while I type", with four checkboxes in the same `check-option` style.
   - Help text: "Off: Fix while I type skips text that is mostly in that language and leaves those words alone in other text. The button and the shortcut still fix every language."
   - Show the group as disabled, not hidden, while "Fix while I type" is off. The four values stay saved.
   - Save with `change((s) => ({ languages: { ...s.languages, [id]: !s.languages[id] } }))`. The functional form keeps quick clicks from overwriting each other.
2. **Toolbar popup** (`src/popup/QuickToggles.tsx`, the "Fix while I type" row):
   - Add a compact control for the four languages under that row, for example four small toggle chips: EN, AR, Franco, Other.
   - Each chip needs an accessible name with the full language name (for example `aria-label="Arabic"`) and `aria-pressed`.
   - Hide the row while "Fix while I type" is off.
   - The popup must not grow by more than one short row. Match the existing tokens in `src/popup/popup.css` (spacing, radius, colors) in light and dark mode. Load the `frontend-design` skill if it helps, but keep the popup's current look.
3. **About tab** (`src/popup/AboutTab.tsx`, near line 58): one sentence saying you can turn languages off for Fix while I type in the Home tab and in Options.
4. **Screenshots.** The popup's Home tab changes. Run `npm run shots`, open every image in `docs/screenshots`, and keep the new ones only if they look right in both light and dark mode.

## Tests

- e2e in `tests/e2e/options.spec.ts`:
  - The four checkboxes show the stored values.
  - Clicking one saves only that language. Check with the existing `stored(page)` helper.
  - The group is disabled while "Fix while I type" is off.
- e2e in `tests/e2e/action-popup.spec.ts`:
  - The chips show the stored values and toggle each language.
  - Each chip has its accessible name and `aria-pressed`.
  - The chips are hidden while "Fix while I type" is off.
- Use the helpers those files already have. Do not add new test dependencies.

## Do not

- Do not change the idle logic, the detector, the prompt or the setting's shape. Those are done (T22a, T22b).
- Do not run a real CLI or a paid provider. Don't use real drafts.
- Do not add dependencies or change the version. Do not commit. The orchestrator reviews and commits.

## Checks

npm needs `--cache /tmp/npm-cache-localpolish` if it uses a cache.

- Targeted: `npm run build`, then `npx playwright test tests/e2e/options.spec.ts tests/e2e/action-popup.spec.ts`.
- Full gates once at the end: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, `npm run test:e2e`.
- If the sandbox blocks the browser tests, say so. The orchestrator runs them.

## When done

Tick T22c in `docs/plans/features-1.3-1.4.md`.

## Report

List the changed files and the check results, describe the popup control you chose and why, and say whether the screenshots changed.

Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
