<task>
Add an end-to-end Playwright test for the LocalPolish Chrome extension (WXT, MV3) that loads the real built extension from `dist/`, points it at a mock OpenAI-compatible server, and runs select → rewrite → Accept on the existing fixture page. No product code changes in this task; only tests and one npm script.

## What exists
- `npm run build` writes the unpacked extension to `dist/` (fixed extension ID `ealpmjmaclnlpelpcacmbicmdipmbeei`, from the manifest `key`).
- `playwright.config.ts`: `testDir: 'tests/e2e'`, a Vite web server for `tests/e2e/fixtures` on `http://localhost:5179`, and `launchOptions: { args: ['--single-process'] }` for the shared `browser` fixture. Your spec does not use that `browser` fixture (see below), so those launch options do not apply to it.
- `tests/e2e/fixtures/index.html` has `#ta` (textarea), `#inp` (input), `#ce` (contenteditable div), `#draft` (a Draft.js editor mounted by `fixtures/main.js`; `window.__lp.draftText()` returns its plain text), `#outside` (button). The fixture's own `__lp` helpers only act when called; ignore them except `draftText`.
- The content script adds one `<localpolish-root>` element with an **open** shadow root. Inside it: the floating button `button.lp-fab` (appears 150 ms after a non-empty selection in an editable field), the popup `.lp-popup` (role `dialog`, name `LocalPolish`) with mode buttons `.lp-tab` (Fix, Rephrase, Shorter, Tone), body `.lp-body` (diff in `.lp-diff` with `ins`/`del`, errors in `.lp-error`), and footer buttons `Accept` (`.lp-primary`), `Copy`, `Retry`. Playwright locators pierce open shadow roots, so `page.locator('.lp-fab')` and `page.getByRole('button', { name: 'Accept' })` work.
- Background: provider `openai-compatible` POSTs to `${openaiBaseUrl}/chat/completions` with JSON `{ model, temperature, stream: true, messages: [{role:'system',content}, {role:'user',content:'<text>\n...\n</text>'}] }` and reads SSE lines `data: {"choices":[{"delta":{"content":"..."}}]}` until `data: [DONE]`. A non-2xx reply becomes the popup error `HTTP <status>: <first 300 chars of body>`. Settings live in `chrome.storage.local` under key `settings` (shape in `src/core/settings.ts`; missing fields fall back to defaults).
- The `polish` keyboard command cannot be pressed from Playwright. The background handles it by sending `{ type: 'open-popup' }` to the active tab; the test sends that same message itself from the service worker.

Verified by the orchestrator on this Mac (outside any sandbox): this launches the extension and its service worker in about 1 s:
```ts
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',          // full Chromium (installed); the headless shell cannot load extensions
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
// sw.url() === 'chrome-extension://ealpmjmaclnlpelpcacmbicmdipmbeei/background.js'
```

## Files
1. `tests/e2e/extension.spec.ts` (new).
2. `tests/e2e/mock-openai.ts` (new): `startMockOpenAI(): Promise<{ url: string; requests: Array<{ body: any }>; reply(next: MockReply): void; close(): Promise<void> }>` using `node:http`, listening on `127.0.0.1` port `0`. `MockReply` = `{ chunks: string[] } | { status: number; body: string }`. Default reply streams `I went` and ` home.`. For a stream reply: status 200, `content-type: text/event-stream`, write each chunk as `data: {"choices":[{"delta":{"content":<json string>}}]}\n\n`, then `data: [DONE]\n\n`, end. Record each request's parsed JSON body. Answer CORS preflight (`OPTIONS`) with 204 and `access-control-allow-origin: *`, `access-control-allow-headers: *`, and add `access-control-allow-origin: *` to every reply. `@types/node` is installed, so `node:http`, `node:fs`, `node:os` and `node:path` typecheck.
3. `package.json`: change `"test:e2e"` to `"npm run build && playwright test"` (the options spec and this spec both need a fresh `dist/`).

## Spec setup (`extension.spec.ts`)
- Worker-scoped fixture: one mock server, one persistent context (fresh `fs.mkdtempSync` user data dir, removed after), and the service worker handle. Test-scoped: a new page per test, closed after. Before each test: `mock.reply(default)`, clear `mock.requests`, and write settings from the service worker:
  ```ts
  await sw.evaluate((url) => chrome.storage.local.set({ settings: {
    provider: 'openai-compatible', openaiBaseUrl: url, models: { 'openai-compatible': 'mock-model' },
  } }), mock.url + '/v1');
  ```
  then `page.goto('http://localhost:5179/')` and wait for `window.__lp?.draftText`.
- Helper `selectAllIn(page, selector)`: click the field, type the text with `page.keyboard.type`, press `ControlOrMeta+a`.
- Helper `sendOpenPopup(sw)`: `sw.evaluate(async () => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); await chrome.tabs.sendMessage(tab.id!, { type: 'open-popup' }); })`. Bring the page to front first (`page.bringToFront()`), and focus the field, since only the focused frame acts.

## Tests
1. **textarea via the floating button:** type `i has went home` in `#ta`, select all, wait for `.lp-fab`, click it → `.lp-diff` visible and contains `I went home.` → click Accept → `#ta` value `I went home.` and `.lp-popup` gone. Also assert the mock got one request whose `messages[0].content` starts with `Fix the grammar` and whose `messages[1].content` is `<text>\ni has went home\n</text>`, and `model` is `mock-model`.
2. **input:** same flow on `#inp`.
3. **contenteditable:** same flow on `#ce`; `innerText` trimmed equals `I went home.`.
4. **Draft.js:** same flow on `#draft .public-DraftEditor-content`; `draftText()` equals `I went home.`.
5. **shortcut with no selection uses the whole field:** type in `#ta`, leave only the caret (press `End`), `sendOpenPopup` → popup opens, Accept → value `I went home.`.
6. **mode switch:** open the popup on `#ta`, after the first answer click the `Shorter` tab → the mock got a second request whose system prompt starts with `Make the text`.
7. **server error:** `mock.reply({ status: 500, body: 'boom' })`, open the popup via the button → `.lp-error` contains `HTTP 500: boom`; Accept is disabled. Then `mock.reply(default)`, click Retry → diff shows and Accept works.
8. **blocklist:** write settings with `blocklist: ['localhost']` (plus the provider fields above) before `goto`. Select text in `#ta`, wait 500 ms → `.lp-fab` not visible. `sendOpenPopup` → the popup still opens (the shortcut works on blocklisted sites).
9. **options page Test connection:** open `chrome-extension://<id>/options.html`, click `Test connection` → text `Works. Got` appears (the background runs a tiny Fix through the mock).
10. **Esc does not reach the page:** add a `keydown` listener on `document` in the page via `page.evaluate` that records keys into `window.__keys`; open the popup, press Escape → popup gone and `__keys` does not include `Escape`.

Keep each test independent. Use web-first assertions (`expect(locator).toBeVisible()` etc.), no fixed sleeps except the 500 ms negative check in test 8.

## If Chromium cannot start in your sandbox
Your sandbox may block Chromium (in T5 it needed `--single-process`, which probably breaks extension service workers). Try the launch above first. If it fails for a sandbox reason (Mach port / permission errors), try once adding `--single-process`. If that still fails, stop trying: make sure the spec typechecks and lints, mark nothing as fixme, and report exactly which error you saw. The orchestrator will run it outside the sandbox. Do not spend more than a few attempts on this.
</task>

<verification_loop>
While working: `npm run build && npx playwright test tests/e2e/extension.spec.ts`.
Before finishing, all green (or the sandbox failure reported as above):
  npm run lint
  npm run typecheck
  npm test
  npm run test:e2e
Run `npm run format` once at the end, then `npx prettier --check .`.
</verification_loop>

<action_safety>
Only add `tests/e2e/extension.spec.ts`, `tests/e2e/mock-openai.ts`, and change the `test:e2e` script. Do not change `src/`, `bridge/`, `docs/`, other specs, the fixture pages or `playwright.config.ts`; if one of those seems to need a change, stop and report it with the reason. Write only comments that explain a non-obvious why. Do NOT run git add or git commit; leave the work uncommitted.
Follow the implement-plan skill in its light form: build, test, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass; the orchestrator reviews the diff.
</action_safety>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed and why
  2. Files touched
  3. Gate outcomes (paste counts, including Playwright)
  4. Any product bug the tests found (do not fix it; describe it with the failing step)
  5. Anything you deviated on, left open, or want a decision on
  6. Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
</structured_output_contract>
