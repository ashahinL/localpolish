# T26a. Spike: does in-page Fix work inside the side panel?

You are working in a throwaway git worktree of LocalPolish, a Chrome MV3 extension (WXT, TypeScript, Preact). **Do not commit.** The orchestrator reads your report and the diff, then deletes the worktree. Code quality does not matter here. Evidence does.

Follow the `implement-plan` skill in its light form: build, test, report. Do not edit the plan file; the orchestrator does that. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass.

## Why

Release 1.5.0 adds "documents": a text area in the extension's side panel (`sidepanel.html`, an extension page) that must behave exactly like a text field on a web page: Fix while I type (idle Fix after a 3 s pause, a small `.lp-mark` dot, click it for the diff popup, Accept), the floating Fix button (`.lp-fab`) on selected text, and the popup's Accept. Today these only run as a content script on web pages. Content scripts do not run in extension pages, so the side panel must call the same factories directly. This spike proves whether that works unchanged, and lists exactly what breaks.

## Questions to answer, with evidence

1. **Idle Fix:** typing in a textarea on `sidepanel.html` and pausing sends one rewrite to the mock provider, and `.lp-mark` appears. Clicking it opens the diff popup (`.lp-popup .lp-diff`). Clicking Accept sets the textarea to the mock's answer.
2. **Undo:** after that Accept, pressing `ControlOrMeta+z` once in the textarea puts back the exact text from before Accept.
3. **Floating button:** selecting the textarea's text shows `.lp-fab`. Clicking it opens the popup with the diff. Accept works.
4. **Fit:** at a 360 × 700 viewport, are the mark, the button and the popup fully visible and placed next to the field? Screenshot each.
5. **What broke:** every change you had to make to `src/content/**` to get 1–4 working, with the reason. If something cannot work, say so and why.

## Steps

1. Read `src/entrypoints/content.ts`, function `start()` (about lines 46–175). It builds `createController`, `createIdleFix` and `createButton` with their dependencies. That is the wiring to copy.
2. Add a spike-only mode to `src/entrypoints/sidepanel/main.tsx`: when `location.hash === '#spike'`, do not render `App`. Instead put a `<textarea id="spike-doc" style="width:100%;height:300px;box-sizing:border-box">` in `#app` and call a new function `startSpikeFix()` from a new file `src/chat/spikeFix.ts`.
3. In `startSpikeFix()`, copy `start()` with these differences:
   - Settings: `pageSettings(await chrome.storage.local.get('settings').then(r => r.settings))` from `src/core/settings.ts`. Reload it when `onSettingsChanged` (from `src/options/chrome.ts`) fires, then call `idle.refresh()` and `button.refresh()`.
   - `isEnabled = () => true` (site hiding does not apply to documents).
   - `isIdleEnabled = () => settings !== null && settings.idleFix`.
   - `connect = () => chrome.runtime.connect({ name: REWRITE_PORT })` (`REWRITE_PORT` from `src/core/messages.ts`).
   - `detect = (text) => chrome.i18n.detectLanguage(text)`, as in `start()`.
   - Leave out `createChatInsert`, `createSelectionChat`, the `runtime.onMessage` listener and the `page-settings` message.
4. Run `npm run build`, then write `tests/e2e/spike-doc.spec.ts`. Copy the fixtures from `tests/e2e/chat.spec.ts` lines 1–131 (the `mock`, `extensionContext`, `sw` and `page` fixtures and the `beforeEach` that stores settings pointing at the mock). Keep that `beforeEach` as it is. Open `chrome-extension://ealpmjmaclnlpelpcacmbicmdipmbeei/sidepanel.html#spike` with `page.setViewportSize({ width: 360, height: 700 })`. The mock's default answer is `I went home.` (`defaultReply` in `tests/e2e/mock-openai.ts`).
   - Test A (questions 1, 2): click `#spike-doc`, `page.keyboard.type('i has went home today')`, then `await expect.poll(() => mock.requests.length, { timeout: 10_000 }).toBe(1)` and `await expect(page.locator('.lp-mark')).toBeVisible()`. This is the same pattern as `tests/e2e/extension.spec.ts` lines 919–926. Click `.lp-mark`, wait for `.lp-popup .lp-diff`, click the `Accept` button, expect the textarea value `I went home.`. Then press `ControlOrMeta+z` and expect `i has went home today`.
   - Test B (question 3): fill `i has went home`, select all text in the textarea, expect `.lp-fab` visible, click it, wait for `.lp-diff`, Accept, expect `I went home.`. See `openRewrite` and `accept` in `tests/e2e/extension.spec.ts` lines 1074–1084.
   - Save screenshots of the mark, the button and the open popup to `spike-shots/` in the worktree root.
5. Run only this file: `npx playwright test tests/e2e/spike-doc.spec.ts`. Rebuild (`npm run build`) after every source change, because the tests load `dist/`.
6. If a question fails, find the cause in `src/content/**` (likely places: `src/content/ui/root.ts` for the Shadow DOM layer, `src/content/position.ts` for placement, `src/content/editable.ts` for `captureTarget` and `applyReplacement`, focus checks with `document.hasFocus()`). Make the smallest change that fixes it and record it. Do not spend more than about 20 minutes on one failure. Record it and move on.

## Out of scope

- No styling, no document UI, no storage, no shortcut handling (headless Chromium cannot press extension command shortcuts; that is tested by hand later).
- Do not change `src/entrypoints/content.ts` or any existing test.
- Do not run the full test suite. Do not commit.

## Report

End with this report:

- For each of questions 1–5: **pass** or **fail**, and one or two lines of evidence (test output, what you saw).
- Every change to `src/content/**`, with file, function and the reason.
- Paths of the screenshots.
- Anything the real document editor (task T26c/T26f) must do differently from `start()`.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
