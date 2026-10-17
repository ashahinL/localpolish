<task>
LocalPolish is a Chrome MV3 extension (WXT, TypeScript strict, Preact, Vitest, Playwright). Its in-page popup has four mode tabs: Fix, Rephrase, Shorter, Tone. Clicking Tone sends a request right away with the options-page default tone, before the user has picked one. Redesign the mode choice as below. Every decision is made; do not reopen them.

## The new behavior (decided with the user)
1. Tabs: **Fix | Rephrase | Shorter**. The Tone tab is gone.
2. The Rephrase tab shows a chip row: **Keep tone**, Polite, Formal, Casual, Angry but civil. "Keep tone" is today's Rephrase (keeps the text's own tone).
3. Clicking the Rephrase tab sends **nothing**; it only shows the chips (none pressed until one is clicked). Clicking a chip sends one request. Fix and Shorter still send on click.
4. The popup still runs the default mode (normally Fix) when it opens.
5. Until a chip is picked, the body keeps showing the last answer (usually the Fix answer), and Accept / Copy still act on that answer. The Fix tab is no longer shown as pressed once Rephrase is open; the body shows which answer is displayed with a small caption above the diff, e.g. "Showing: Fix". Keep it subtle.
6. Each choice keeps its answer for the life of the popup: Fix, Shorter, and each Rephrase chip (Keep tone, Polite, ...). Going back to a choice that already finished shows its saved answer at once with **no new request**. Retry always sends a new request for the current choice and replaces its saved answer. A choice that ended in an error is not saved (going back sends again). A choice whose request is still streaming when you switch away is cancelled and not saved.
7. Remove the **default tone** setting.
8. The **default mode** setting stays, with options Fix, Rephrase (keep tone), Shorter. A stored `'tone'` (old value) loads as `'fix'`.
9. No new keyboard keys. Esc and Cmd/Ctrl+Enter keep working as today.

## Wire format stays the same
Do not change `src/background/`, `src/core/prompts.ts` or `src/core/messages.ts`. The port request is still `{ mode, tone, text }` with `Mode = 'fix' | 'rephrase' | 'shorter' | 'tone'`:
- Fix → `{ mode: 'fix' }`, Shorter → `{ mode: 'shorter' }`, Rephrase + Keep tone → `{ mode: 'rephrase' }`, Rephrase + a tone chip → `{ mode: 'tone', tone }`. Send `tone: 'polite'` as a filler where the tone does not matter (the background validates it).

## Where things are
- `src/content/popupState.ts`: the pure reducer (`PopupState`, `popupReducer`, `initialState`, `canAccept`, `isUnchanged`, `popupNotes`). Today `state.mode`/`state.tone` are the running request. Redesign the state so it models: the open tab (`'fix' | 'rephrase' | 'shorter'`), the current choice being shown (a key such as `'fix' | 'shorter' | 'rephrase:keep' | 'rephrase:polite' | ...`), and a per-choice cache of finished results. Keep it a pure reducer with unit tests in `src/content/popupState.test.ts` (add tests for: tab switch to Rephrase sends nothing and keeps the shown answer; chip pick; going back uses the cache; Retry replaces; error not cached; switching away from a streaming choice).
- `src/content/controller.ts`: `open()` (around line 76) builds the state from `settings.defaultMode`/`settings.defaultTone` and calls `request()`; `dispatch()` (around line 105) renders `Popup` with `onMode`/`onTone`/`onRetry`; `request()` (around line 129) opens the port. Make the controller decide "use cache or send" from the reducer state, and map choices to the wire format above.
- `src/content/ui/Popup.tsx`: tabs from `MODES` (lines 7-12), chips shown when `state.mode === 'tone'` (lines 88-101). Chips get `aria-pressed` for the chosen one. Keep the class names `.lp-tab`, `.lp-chip`, `.lp-chips`, `.lp-diff`, `.lp-body`, `.lp-primary` (tests use them). Styles live in `src/content/ui/popup.css`; add the caption style there and keep both light and dark color schemes working.
- `src/core/settings.ts`: remove `defaultTone` from `Settings` and `DEFAULT_SETTINGS`. In `storedPatch` (line ~64) drop a stored `defaultTone` key and turn a stored `defaultMode` that is not `'fix' | 'rephrase' | 'shorter'` into `'fix'`. Narrow the `defaultMode` type to those three. Update `src/core/settings.test.ts` (lines 86-87 check `defaultTone`).
- `src/options/sections.tsx`: `DefaultsSection` (line ~117) — remove the Default tone field and `TONES` if unused; `MODES` (line 15) loses Tone and the Rephrase label becomes "Rephrase (keep tone)".
- e2e (you cannot run Chromium; make them typecheck, the orchestrator runs them):
  - `tests/e2e/popup.spec.ts` line ~160 "switching mode restarts the request with the new mode" clicks `Tone`; rewrite it for the new flow: Rephrase tab click sends nothing (no new script consumed, Fix diff still shown), then a `Formal` chip click sends. Add a test that going back to Fix shows the cached answer without a new request. Read how that spec feeds scripted answers (`__lp.setScripts`, `openPopup(page, scripts, settings)`) at the top of the file.
  - `tests/e2e/extension.spec.ts` line ~184 "tone tab asks for a formal rewrite" clicks `Tone` then `Formal`; change it to `Rephrase` then `Formal`, and also assert that clicking `Rephrase` alone did not add a request to `mock.requests`.
  - `tests/e2e/options.spec.ts`: remove any Default tone check if present.

## Rules
- UI should look like the existing popup: same spacing, fonts and colors. Keep it compact.
- Only touch the files named above (and their tests). Write comments only for a non-obvious why.
- Follow the implement-plan skill in its light form: build, test, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass; the orchestrator reviews the diff. Do NOT run git add or git commit.
</task>

<verification_loop>
While working: `npx vitest run src/content src/core`.
At the end, all green: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npx prettier --write` on touched files and `npx prettier --check .`.
</verification_loop>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed, per numbered behavior above
  2. The new PopupState shape (paste the interface)
  3. Files touched
  4. Gate outcomes (paste counts)
  5. Anything you deviated on or want a decision on
  6. Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
</structured_output_contract>
