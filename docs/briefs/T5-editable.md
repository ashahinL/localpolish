<task>
Build `src/content/editable.ts` for the LocalPolish Chrome extension (WXT + TypeScript strict). It captures the text the user wants to rewrite in a web page field, and later replaces exactly that text in a way the page's editor framework notices. Test it with Playwright against local fixture pages. No UI in this task.

Already installed (do not install anything else, do not run `npx playwright install`): `@playwright/test` 1.64 with its headless Chromium, `react@17`, `react-dom@17`, `draft-js@0.11.7`. If an npm command is ever needed, add `--cache /tmp/npm-cache-localpolish` (the default npm cache is not writable).

## `src/content/editable.ts`

```ts
export type Target =
  | { kind: 'field'; el: HTMLInputElement | HTMLTextAreaElement; start: number; end: number; text: string }
  | { kind: 'rich'; root: HTMLElement; range: Range; text: string };

export type ApplyResult = { ok: true } | { ok: false; reason: 'changed' | 'rejected' };

export function findEditable(node: Node | null): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
export function captureTarget(opts: { wholeFieldIfEmpty: boolean }): Target | null;
export async function applyReplacement(target: Target, text: string): Promise<ApplyResult>;
```

### `findEditable(node)`
- Walk up from `node` (use the parent element for text nodes).
- A `<textarea>`, or an `<input>` whose `type` is `text`, `search`, `email`, `url` or missing, that is not `disabled` or `readOnly` → return it.
- An element with `isContentEditable === true` → return the editing host: keep walking up while `parentElement?.isContentEditable` is true, return the topmost one.
- Otherwise `null`.

### `captureTarget({ wholeFieldIfEmpty })`
1. Find the deep active element: start at `document.activeElement` and follow `.shadowRoot?.activeElement` while it exists.
2. If it is a field (`findEditable` returns an input or textarea): `start = selectionStart`, `end = selectionEnd`. If `start === end`: when `wholeFieldIfEmpty`, use `0` and `value.length` and call `el.setSelectionRange(0, value.length)` so the user sees what will change; otherwise return `null`.
3. Else use `window.getSelection()`. If it has a range and `findEditable(selection.anchorNode)` returns a contenteditable host: `range = selection.getRangeAt(0).cloneRange()`. If the range is collapsed: when `wholeFieldIfEmpty`, `range.selectNodeContents(root)` and apply it to the selection (`removeAllRanges` + `addRange`); otherwise return `null`.
4. Text: for fields `value.slice(start, end)`; for rich targets `selection.toString()` read after the selection matches the range (it keeps line breaks between blocks; `range.toString()` does not).
5. Return `null` when the text is empty or only whitespace.

### `applyReplacement(target, text)`
- If `text === target.text` → `{ ok: true }` without touching the page.
- **Field:**
  1. `el.focus()`, `el.setSelectionRange(start, end)`.
  2. If `el.value.slice(start, end) !== target.text` → `{ ok: false, reason: 'changed' }`.
  3. `document.execCommand('insertText', false, text)`. This keeps the browser undo stack and fires `beforeinput`/`input`, which React-controlled inputs need.
  4. If that returned false or `el.value.slice(start, start + text.length) !== text`: fall back to `el.setRangeText(text, start, end, 'end')` and `el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }))`.
  5. Verify `el.value.slice(start, start + text.length) === text` → `{ ok: true }`, else `{ ok: false, reason: 'rejected' }`.
- **Rich:**
  1. If `!target.root.isConnected` or `!target.root.contains(target.range.startContainer)` → `{ ok: false, reason: 'changed' }`.
  2. `root.focus()`, then select `target.range` (`removeAllRanges` + `addRange`). If `normalize(selection.toString()) !== normalize(target.text)` → `{ ok: false, reason: 'changed' }`. `normalize` = replace ` ` with space, collapse all whitespace runs to one space, trim.
  3. `document.execCommand('insertText', false, text)`. Wait for the editor to re-render: `await new Promise((r) => setTimeout(r, 50))`.
  4. Success check: `normalize(root.innerText)` includes `normalize(text)`. If yes → `{ ok: true }`.
  5. Otherwise, only if `execCommand` returned false (the page did nothing), re-select the range and try a synthetic paste: build `new DataTransfer()`, `setData('text/plain', text)`, dispatch `new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })` on the selection's anchor element. Wait 50 ms and run the same success check.
  6. Still failing → `{ ok: false, reason: 'rejected' }`. (The popup will offer Copy instead.)

## Fixture pages and Playwright

Files:
- `tests/e2e/vite.config.ts`: plain Vite config (no Preact plugin), `root: 'tests/e2e/fixtures'`, `server: { port: 5179, strictPort: true }`.
- `tests/e2e/fixtures/index.html`: one page containing, each with an `id`:
  - `<textarea id="ta">`
  - `<input id="inp" type="text">`
  - `<div id="ce" contenteditable="true">` (plain contenteditable, like Gmail)
  - `<div id="draft">` where a Draft.js editor mounts (like X/Twitter)
  - `<button id="outside">Outside</button>` (used to move focus away, like clicking the popup)
- `tests/e2e/fixtures/main.js` (plain JS, no JSX; use `React.createElement`): mounts a Draft.js `Editor` in `#draft` with `EditorState` kept in React state, and sets
  `window.__lp = { captureTarget, applyReplacement, draftText: () => <current Draft plain text from editorState.getCurrentContent().getPlainText()> }`.
  Import `captureTarget` and `applyReplacement` from `../../../src/content/editable.ts`.
- `playwright.config.ts` at the repo root: `testDir: 'tests/e2e'`, Chromium only, headless, `webServer: { command: 'npx vite --config tests/e2e/vite.config.ts', port: 5179, reuseExistingServer: true }`, `use: { baseURL: 'http://localhost:5179' }`.
- `package.json` script: `"test:e2e": "playwright test"`.
- `.gitignore`: add nothing; `test-results/` and `playwright-report/` are already ignored.
- Make sure Vitest does not pick up `tests/e2e` (its include is already `src/**/*.test.ts` and `bridge/**/*.test.mjs`; name the Playwright files `*.spec.ts`).

`tests/e2e/editable.spec.ts`. In each test: click into the field, type with `page.keyboard.type`, select, capture with `page.evaluate(() => window.__lp.captureTarget({ wholeFieldIfEmpty: false }))` (keep the target in the page: store it on `window.__t` and return only `text`), click `#outside`, then apply with `page.evaluate(() => window.__lp.applyReplacement(window.__t, '...'))`.

Tests:
1. textarea: type `i has went home`, select `has went` (`setSelectionRange(2, 10)` via evaluate) → captured text `has went`; apply `went` → `{ok:true}`, value `i went home`. Then press `ControlOrMeta+z` in the textarea → value back to `i has went home` (undo works).
2. input: type `she dont like it`, select all (`ControlOrMeta+a`) → apply `She doesn't like it.` → value equals that.
3. plain contenteditable: type `i has went home`, select all → apply `I went home.` → `innerText` trimmed equals `I went home.`.
4. Draft.js: type `i has went home`, select all → apply `I went home.` → `{ok:true}` and `window.__lp.draftText()` equals `I went home.` (proves the framework state changed, not only the DOM).
5. changed: textarea, capture, then set the value to something else via evaluate (dispatch an `input` event), apply → `{ ok: false, reason: 'changed' }`.
6. whole field: textarea with text and the caret only (no selection) → `captureTarget({ wholeFieldIfEmpty: false })` is `null`; with `true` it returns the whole text.
7. multi-line: textarea with `line one\nline two` whole-field → apply `Line one.\nLine two.` → value equals it. Contenteditable: type `line one`, press `Enter`, type `line two`, select all → apply `Line one.\nLine two.` → `innerText` contains both `Line one.` and `Line two.` on separate lines.
8. same text: apply the exact captured text → `{ok:true}` and nothing changed.
If a test cannot pass for a real browser reason (for example Draft.js rejects multi-line insertText), do not hack around it: mark it `test.fixme` with a one-line reason and report it.
</task>

<verification_loop>
While working: `npx playwright test` (and `npx vitest run` if you touch unit-testable code).
Before finishing, all green:
  npm run lint
  npm run typecheck
  npm test
  npm run build
  npm run test:e2e
Run `npm run format` once at the end.
</verification_loop>

<action_safety>
Only add `src/content/editable.ts`, the `tests/e2e/` files, `playwright.config.ts`, and the `test:e2e` script. Do not change `src/core/`, `src/background/`, `bridge/` or entrypoints. Write only comments that explain a non-obvious why. Do NOT run git add or git commit; leave the work uncommitted.
Follow the implement-plan skill in its light form: build, test, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass; the orchestrator reviews the diff.
</action_safety>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed and why
  2. Files touched
  3. Gate outcomes (paste counts, including Playwright)
  4. Which insertion path each fixture used (execCommand, setRangeText fallback, or paste), as you observed it
  5. Anything you deviated on, left open, marked fixme, or want a decision on
  6. Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
</structured_output_contract>
