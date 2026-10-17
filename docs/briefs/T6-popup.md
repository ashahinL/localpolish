<task>
Build the in-page UI of the LocalPolish Chrome extension (WXT 0.21 + TypeScript strict + Preact 11, MV3): a floating button that appears when text is selected in an editable field, and a popup in a Shadow DOM that streams a rewrite, shows a word diff, and lets the user Accept, Copy, Retry or Close. The logic it calls already exists and is tested; this task is the UI and its wiring.

Already there (read only these, do not change them):
- `src/content/editable.ts`: `findEditable(node)`, `captureTarget({ wholeFieldIfEmpty })` → `Target | null`, `applyReplacement(target, text)` → `{ok:true} | {ok:false, reason:'changed'|'rejected'}`.
- `src/core/messages.ts`: `REWRITE_PORT = 'rewrite'`, `RewriteRequest {mode, tone, text}`, `RewriteEvent` = `{type:'chunk', text}` | `{type:'done', text}` (final cleaned text) | `{type:'error', message}`, `RuntimeMessage` (`{type:'open-popup'}` is sent by the background when the user presses the `polish` shortcut).
- `src/core/settings.ts`: `loadSettings()`, `isBlocked(hostname, blocklist)`, types `Mode` (`fix|rephrase|shorter|tone`), `Tone` (`polite|formal|casual|angry-civil`), settings `defaultMode`, `defaultTone`, `blocklist`. Stored under `chrome.storage.local` key `settings`.
- `src/core/diff.ts`: `wordDiff(before, after)` → `{type:'same'|'add'|'del', text}[]`.
- `src/core/tokens.ts`: `findMissingTokens(input, output)` → string[], `lostArabicScript(input, output)` → boolean.
- `src/entrypoints/content.ts`: empty content script (`<all_urls>`, `allFrames: true`). You fill its `main()`.
- `tests/e2e/`: Playwright + Vite fixture page (`fixtures/index.html`, `fixtures/main.js`, port 5179) used to test `editable.ts`. Keep its 9 tests passing. `playwright.config.ts` launches Chromium with `--single-process` because this Mac's sandbox blocks Chromium otherwise; the spec keeps one browser context per worker for the same reason. Reuse that pattern (copy the `test` fixture from `tests/e2e/editable.spec.ts`).

## Files
- `src/content/ui/` (new): Preact components and `popup.css`.
- `src/content/controller.ts` (new): opens and closes the popup, runs requests, applies the result. No direct `chrome.*` calls inside; it receives its dependencies (see "Testability").
- `src/content/button.ts` (new): the floating button.
- `src/entrypoints/content.ts`: wire real `chrome.*` into the controller and button.
- Tests: `src/content/*.test.ts` for pure logic (Vitest, node environment, no DOM library installed: keep tested functions pure), `tests/e2e/popup.spec.ts` + additions to the fixture page.

## Behaviour

### Floating button
1. Listen to `selectionchange` on `document`, debounced 150 ms.
2. Show the button only when: the site is not blocklisted (`isBlocked(location.hostname, settings.blocklist)`), and there is a non-empty selection inside an editable field: for `input`/`textarea` (from `findEditable(deep active element)`) `selectionStart !== selectionEnd`; for contenteditable, `getSelection()` is not collapsed and `findEditable(selection.anchorNode)` is a contenteditable host.
3. Position (`position: fixed`): for a contenteditable selection, just below and right-aligned to the end of `range.getBoundingClientRect()`; for input/textarea, the bottom-right corner of the field's rect, 4 px inside. Clamp to the viewport with 8 px margin. Hide on scroll (capture), resize, or when the selection collapses.
4. 28 px round button with the LocalPolish mark (an inline SVG, a simple pen or sparkle glyph, no external assets), tooltip `LocalPolish (⌘⇧K)` on Mac / `Ctrl+Shift+K` elsewhere.
5. `mousedown` on the button must `preventDefault()` so the page keeps its selection. On click: `captureTarget({ wholeFieldIfEmpty: false })`, hide the button, open the popup.
6. The button lives in the same shadow host as the popup (see below).
7. Load settings once at start, and update them on `chrome.storage.onChanged` (area `local`, key `settings`).

### Shortcut
On runtime message `{type:'open-popup'}`: only the frame that has focus acts (`document.hasFocus()`; the message reaches every frame). `captureTarget({ wholeFieldIfEmpty: true })`. If null, show a small toast near the top-right of the viewport for 3 s: "Click into a text field first." The shortcut works on blocklisted sites too.

### Popup
- Shadow host: one custom element `<localpolish-root>` appended to `document.documentElement` on first use, `attachShadow({ mode: 'open' })` (open so tests can reach it). Host style: `all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;` Import the CSS with `import css from './popup.css?inline'` and put it in a `<style>` inside the shadow root. Nothing leaks into the page; page CSS must not affect the popup (`:host { all: initial }`, set font, color and box-sizing inside).
- Position: below the target (selection rect or field rect), left-aligned with it; if not enough room below, above it. Clamp to the viewport (8 px margin). Width `min(440px, 100vw - 16px)`, `max-height: min(60vh, 520px)` with the body scrolling. Write this as a pure function `placePopup(anchor: Rect, popup: Size, viewport: Size): {top, left}` and unit test it.
- Layout, top to bottom:
  1. Header: mode tabs `Fix · Rephrase · Shorter · Tone`; a close (×) button on the right.
  2. When mode is Tone: a second row of chips `Polite · Formal · Casual · Angry but civil`.
  3. Body: while streaming, the streamed text with a subtle working indicator ("Working…"); after `done`, the word diff of `target.text` → final text (`del`: red background + strikethrough; `add`: green background; `same`: plain). Keep line breaks (`white-space: pre-wrap`).
  4. Notes area (only if any apply):
     - Shorter mode: `142 → 98 characters`; show it in red with "over 280" when the result is longer than 280. Count with `[...text].length`.
     - `findMissingTokens(input, result)` not empty: "Missing from the new text: " + the tokens as code chips.
     - `lostArabicScript(input, result)`: "The Arabic text was changed to another script. Check it before you accept."
     - Accept failure messages (below).
  5. Footer: `Accept` (primary), `Copy`, `Retry`, and on the right a muted hint `Esc to close · ⌘↵ to accept` (`Ctrl+↵` off Mac).
- On open: mode = `settings.defaultMode`, tone = `settings.defaultTone`, and the request starts at once.
- Clicking another mode or tone chip cancels the running request (disconnect its port) and starts a new one. Retry does the same with the current mode and tone. Accept and Copy are disabled until `done`.
- Request: open the port (`chrome.runtime.connect({ name: REWRITE_PORT })`), `postMessage({ mode, tone, text: target.text })`, append each `chunk`, and on `done` use `event.text` as the result (it is the cleaned text; the chunks are not). On `error`, or the port disconnecting before `done`, show the error text in the body with Retry enabled. If the background is gone (`connect` throws, as after the extension reloads) show "LocalPolish was updated. Reload this page to use it."
- If the final text equals the input, show "No changes needed." instead of the diff, and Accept just closes.
- Accept: `applyReplacement(target, result)`. On `{ok:true}`, close. On failure, copy the result to the clipboard and keep the popup open with a note:
  - `changed`: "The text in the field changed since you selected it. The new text is copied. Paste it with ⌘V."
  - `rejected`: "This site did not accept the change. The new text is copied. Paste it with ⌘V."
  (Use `Ctrl+V` off Mac.)
- Copy: copy the result, change the button label to "Copied" for 1.5 s. Clipboard: `navigator.clipboard.writeText`; if it throws, fall back to a hidden `<textarea>` inside the shadow root + `document.execCommand('copy')`.
- Close on: ×, Esc, Accept success, or a `mousedown` outside the popup (`event.composedPath()` does not include the host). Closing disconnects any running port. After close, if the target was a field still in the page, put focus back on it.
- Keyboard: register a `keydown` listener on `window` in the **capture** phase only while the popup is open. Esc → close, and `preventDefault()` + `stopPropagation()` so the page does not see it (Gmail closes the compose window on Esc). `Cmd+Enter`/`Ctrl+Enter` → Accept when enabled. Tab moves between popup controls. All controls are real `<button>`s with visible focus rings.
- Only one popup at a time. Opening a new one closes the old one.

### Look
Clean and quiet, like a native macOS popover. System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`), 14 px, line height 1.5. Accent `#2563eb`, radius 10 px for the popup and 6 px for controls, a soft shadow (`0 8px 30px rgb(0 0 0 / 0.18)`), 1 px border. Light and dark themes via `@media (prefers-color-scheme: dark)` with CSS custom properties on `:host`. Diff colors readable in both themes. Mode tabs: the active one is filled with the accent at low opacity and accent text. No animations beyond a 120 ms fade/scale on open.

## Testability
- `controller.ts` exports a function like `createController(deps)` where `deps` gives: `connect(): PortLike` (`postMessage`, `onMessage.addListener`, `onDisconnect.addListener`, `disconnect`), `getSettings(): Settings`, `isMac: boolean`. The real entrypoint passes `chrome.runtime.connect`; tests pass a fake.
- Put state transitions in a pure reducer (`popupReducer(state, action)`) and unit test it: start → chunks → done; error; mode change resets; accept failure notes; disabled states.
- `tests/e2e/fixtures/main.js`: also expose `window.__lp.openPopup(fakeScript)` that creates the controller with a fake `connect` whose port replies with chunks and then `done` (for example chunks `I went`, ` home.` then `{type:'done', text:'I went home.'}`), or an `error`. Use real `captureTarget` and `applyReplacement`.
- `tests/e2e/popup.spec.ts`, using the fixture page:
  1. textarea `i has went home`, select all, `openPopup` → popup shows a diff with `del` and `add` parts; click Accept → textarea value `I went home.` and the popup is gone.
  2. Esc closes the popup, and a `keydown` listener on `document` in the page does not see the Esc.
  3. error path shows the message and an enabled Retry; Retry with a fake that succeeds shows the diff.
  4. Accept on a target whose text was changed meanwhile shows the "changed" note and the popup stays open.
  5. Shorter mode with a 300-character result shows the red "over 280" counter.
  6. selecting text in `#ta` shows the floating button inside the shadow root after the debounce; collapsing the selection hides it.
  Reach shadow content with Playwright locators (they pierce open shadow roots).
- Take screenshots of the popup (light and dark: `page.emulateMedia({ colorScheme: 'dark' })`) and check them yourself for alignment, overflow and contrast. Do not commit screenshots.

## Rules
- Do not change `src/core/`, `src/background/`, `bridge/`, `src/content/editable.ts`, `src/entrypoints/background.ts`, the options page, or `docs/`. Do not add npm dependencies. If something seems to require one, stop and report.
- Wrap everything in `content.ts` so an error in LocalPolish never breaks the page (try/catch around setup; listeners that throw must not leave the page in a bad state).
- Never log the user's text or settings.
- `@types/chrome` is not installed. Type the few `chrome.*` calls you use with a small local interface, the way `src/entrypoints/background.ts` and `src/core/settings.ts` do.
- Write only comments that explain a non-obvious why.
</task>

<verification_loop>
While working: `npx vitest run src/content` and `npx playwright test`.
Before finishing, all green:
  npm run lint
  npm run typecheck
  npm test
  npm run build
  npm run test:e2e
Run `npm run format` once at the end, then `npx prettier --check .`.
</verification_loop>

<action_safety>
Do NOT run git add, git commit or git push; leave the work uncommitted. Follow the implement-plan skill in its light form: build, test, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass; the orchestrator reviews the diff.
</action_safety>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed and why
  2. Files touched
  3. Gate outcomes (paste counts, including Playwright)
  4. What you checked in the screenshots, and anything that still looks off
  5. Anything you deviated on, left open, or want a decision on
  6. Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
</structured_output_contract>
