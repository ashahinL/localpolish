<task>
LocalPolish is a Chrome MV3 extension (WXT, TypeScript strict, Preact, Playwright). The toolbar popup is built: `src/entrypoints/popup/` builds to `dist/popup.html`, and the components live in `src/popup/` (`App.tsx`, `Header.tsx`, `QuickToggles.tsx`, `Tabs.tsx`, `HomeTab.tsx`, `ProviderTab.tsx`, `SitesTab.tsx`, `AboutTab.tsx`). Add Playwright e2e tests for it. Read the components for the exact texts and roles; they are the source of truth. `tests/e2e/popup.spec.ts` already exists and tests the *in-page* rewrite popup, which is a different thing. Do not touch it. Every decision is made; do not reopen them.

## Changes

1. New `tests/e2e/action-popup.spec.ts`. Copy the harness of `tests/e2e/options.spec.ts` (lines 1-100): the shared-context `test` fixture, the `ORIGIN` route that serves `dist/`, and the `addInitScript` chrome stub with an in-memory `__store`. Then extend the stub:
   - `StubConfig` gets `tabUrl: string | undefined` (default `'https://mail.google.com/mail/u/0/'`), plus `bridge`, `test` and `shortcut` as in options.spec.
   - Stub `chrome.tabs.query` to resolve `[{ url: cfg.tabUrl }]`, and `chrome.tabs.create` to push `props.url` into `window.__opened`.
   - Stub `chrome.runtime.openOptionsPage` to push `'options'` into `window.__opened`, and `chrome.runtime.getManifest` to return `{ version: '1.2.3' }`.
   - Keep `runtime.sendMessage`, which answers `bridge-status` and `test-connection` (with a 300 ms delay), `commands.getAll` and `storage`.
   - `openPopup(page, overrides)` goes to `${ORIGIN}/popup.html` and waits for `getByRole('tab', { name: 'Home' })`. Add the helpers `stored(page)` (as options.spec) and `opened(page)` (reads `__opened`).

2. Tests. Use role and label locators. Each test is short and checks behavior through the UI and `__store`.
   - Home with default settings shows `Codex`, `GPT-6 Luna · Effort: None` and `Bridge ready`. `Change` selects the Provider tab.
   - The `Fix while I type` switch starts `aria-checked="true"`. Clicking it stores `idleFix: false` and flips `aria-checked`.
   - The site switch `Show on mail.google.com`: clicking it stores `blocklist: ['mail.google.com']` and shows `Hidden here`. Clicking again stores `[]`.
   - With `settings: { blocklist: ['google.com'] }`, the site switch is disabled and shows `Hidden by google.com.`. `Edit in Sites` selects the Sites tab.
   - With `tabUrl: 'chrome://extensions/'`, the site switch is disabled and shows `LocalPolish does not run on this page`.
   - With `bridge: { ok: false, message: 'The LocalPolish bridge is not installed. In the LocalPolish folder run: npm run bridge:install' }`, Home shows that message and the `npm run bridge:install` code line, and the Provider tab's accessible name contains `needs attention`.
   - Test connection success shows `Works. Got “Hello.” in 1.2 s`. With `test: { ok: false, message: 'Timed out after 45 seconds.' }` it shows `Test failed` and the message.
   - Provider tab: with `settings: { provider: 'claude-cli' }`, `Model` is `haiku` and `Thinking effort` is `low`. Pick `OpenAI-compatible` (the radio by its label): `Base URL`, `API key` (type password; `Show` turns it to text) and `Temperature` show, and `provider: 'openai-compatible'` is stored. Pick `Anthropic API`: `Model` is `claude-haiku-5-5`. Pick `Codex`: the Codex login note shows. One test is enough for this path. Use `{ exact: true }` labels as options.spec does.
   - Provider tab with a CLI provider shows the Bridge card rows (`Claude Code` with version, `Grok CLI` `not found` from `BRIDGE_OK`), and `Check again` asks again: count `bridge-status` calls in the stub, as a `window.__bridgeCalls` counter.
   - Sites tab: add `Example.com` → stored `['example.com']`, and the row shows. Adding `example.com` again shows `Already in the list`. `Remove example.com` stores `[]`. With the tab on `mail.google.com` and nothing hidden, `Hide on mail.google.com` stores `['mail.google.com']`, and the row shows the `This tab` tag.
   - Home default mode: click `Shorter` → stored `defaultMode: 'shorter'`.
   - About: the keys `⇧`, `⌘` and `K` show for shortcut `⇧⌘K` (`shortcutKeys` splits a string without `+` into characters). `Change shortcut` records `chrome://extensions/shortcuts` in `__opened`. `Open` and the header gear (`Open the full options page`) record `'options'`. The footer shows `LocalPolish 1.2.3`.
   - Tabs keyboard: focus the Home tab, press ArrowRight, and Provider is selected and focused. Press End, and About is selected.
   - The popup body is 360 px wide (`page.evaluate(() => document.body.getBoundingClientRect().width)` is 360).

3. `tests/e2e/extension.spec.ts` (the real built extension, with a mock OpenAI server): add one test next to 'options page Test connection' (line ~238), 'toolbar popup Test connection'. Go to `chrome-extension://${EXTENSION_ID}/popup.html`, click `Test connection`, and expect `Works. Got` to be visible. The beforeEach already points the settings at the mock server.

## Leave untouched
All source under `src/`, and the other specs (except the one added test in extension.spec.ts). If a test shows a real bug in the popup, do not fix the source: report it in section 4 with the failing assertion.

## Rules
- No task IDs in code or comments. Comments only for a non-obvious why.
- Do NOT run git add or git commit; leave the work in the working tree. Skip the guard skills and any final review pass.
- Chromium probably cannot start in your sandbox. Make the spec typecheck and lint. If `npx playwright test tests/e2e/action-popup.spec.ts` does run for you, make it pass. Otherwise say so; the orchestrator runs it.
</task>

<verification_loop>
At the end, all green: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npx prettier --write` on the files you touched and `npx prettier --check .`. Try `npx playwright test tests/e2e/action-popup.spec.ts` once after the build.
</verification_loop>

<structured_output_contract>
End with a report in this exact shape:
  1. The tests added (names)
  2. Files touched
  3. Gate outcomes (paste counts), and whether Playwright could run
  4. Anything you deviated on, any popup bug found, or anything you want a decision on
</structured_output_contract>
