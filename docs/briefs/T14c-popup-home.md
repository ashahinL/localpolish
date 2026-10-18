<task>
LocalPolish is a Chrome MV3 extension (WXT, TypeScript strict, Preact, Vitest, Playwright). The toolbar popup shell exists: `src/entrypoints/popup/`, and `src/popup/` with `App.tsx` (holds `tab: TabId` and the active `host`, renders `Header`, `QuickToggles`, `Tabs` and an empty `<main class="panel" id="panel" role="tabpanel">`), `chrome.ts`, `sites.ts`, `icons.tsx` (`AlertIcon` and others), `Switch.tsx`, `Tabs.tsx` and `popup.css`. Fill the **Home** tab. Every decision is made; do not reopen them.

The design is `docs/design/popup/popup.html` (the `HomeTab()`, `ConnPill()`, `providerDetailLine()`, `TestControl()`, `TestNote()` and `BridgeErrorNote()` functions around lines 331-410, and the CSS sections "Status card", "Notes" and "Segmented control"). The screenshots are `docs/design/popup/home-light.png`, `bridge-error-light.png`, `test-running-light.png`, `test-success-light.png` and `test-failure-light.png`. **Leave out the "Usage today" card**: usage stats are not built, and the mockup's numbers are fake.

## Changes

1. Shared data from the options page. In `src/options/ProviderSection.tsx`, add `export` to `PROVIDERS` (line ~14) and `isCli` (line ~35). Change nothing else there.

2. `src/popup/summary.ts` (pure) and `src/popup/summary.test.ts`:
   - `providerSummary(settings: Settings): { title: string; mark: string; detail: string }`.
     - `title` is the `PROVIDERS` title, except `'OpenAI-compatible API'` shortens to `'OpenAI-compatible'`.
     - `mark` is `CC`, `Cx`, `Gk`, `AI` or `An` for claude-cli, codex-cli, grok-cli, openai-compatible and anthropic-api.
     - `detail` for a CLI provider is `{model label} · Effort: {effort label}`. The labels come from `CLI_MODELS[provider]` and `CLI_EFFORTS[provider]` in `src/options/presets.ts`. When the value is not a preset, use the raw value. Example: codex defaults give `GPT-6 Luna · Effort: None`, and grok defaults give `CLI default (grok-4.7) · Effort: Low`.
     - `detail` for openai-compatible is `{model or 'No model set'} · {label of baseUrlPreset(url), or the URL's host}`.
     - `detail` for anthropic-api is `{ANTHROPIC_MODELS label or raw} · Temperature {temperature}`.
   - `type Connection = { tone: 'ok' | 'error' | 'neutral'; label: string }`, and `connection(settings: Settings, bridge: BridgeStatus | null): Connection`. `BridgeStatus` is from `src/core/messages.ts`.
     - CLI provider, `bridge === null`: neutral `Checking…`.
     - CLI provider, `!bridge.ok`: error `No bridge`.
     - CLI provider, the CLI is missing (`bridge.clis[cliKey] === null`, where claude-cli maps to `claude` and so on): error `{Claude Code | Codex | Grok CLI} not found`.
     - CLI provider, the CLI is there: ok `Bridge ready`.
     - anthropic-api: ok `Key saved` when `anthropicApiKey` is not empty, else error `No API key`.
     - openai-compatible: ok `Key saved` when `openaiApiKey` is not empty. Otherwise neutral `Local server` when the base URL host is `localhost`, `127.0.0.1` or `[::1]`, else error `No API key`.
   - Tests cover every branch above, with `DEFAULT_SETTINGS` plus overrides.

3. App-level hooks, so results survive tab switches:
   - `src/popup/useBridge.ts`: `useBridge(): { status: BridgeStatus | null; checking: boolean; check(): void }`. Same logic as `BridgeSection` in `src/options/sections.tsx` (lines ~21-35): it uses `bridgeStatus()` from `src/options/chrome.ts` and checks once on mount.
   - `src/popup/useTest.ts`: `useTest(): { running: boolean; result: TestResult | null; run(): void }`. Same as `TestSection` (lines ~72-85): `await flush()` from `useSettingsApi()` first, then `testConnection()` from `src/options/chrome.ts`. Clear `result` when `settings.provider` changes.
   - `App` calls both once (inside the settings provider) and passes them to the tabs that need them.

4. Components in `src/popup/`:
   - `BridgeErrorNote.tsx` (props: `message: string`): `Note` with tone `error` (from `src/options/controls.tsx`). Inside, `<p class="nhead"><AlertIcon /><span>{message}</span></p>`, then `<p>Install it from the LocalPolish folder:</p>`, then `<CodeLine text="npm run bridge:install" />`. The Provider tab reuses it later.
   - `TestConnection.tsx` (props: `test` from `useTest`, `wide?: boolean`):
     - a `.test-row` with `<button type="button" class="primary">Test connection</button>`, disabled while running and full width when `wide`;
     - while running, `<span class="testing" role="status"><span class="spinner" aria-hidden="true" />Testing…</span>`;
     - on success, `Note` ok: `Works. Got “{sample}” in {formatSeconds(ms)} s` (`formatSeconds` is in `src/options/form.ts`);
     - on failure, `Note` error with `<p class="nhead"><AlertIcon /><span>Test failed</span></p><p>{message}</p>`.
   - `HomeTab.tsx` (props: `settings`, `bridge` from `useBridge`, `test`, `onOpenProvider(): void`) renders two cards:
     - Status card, `<section class="card stack" aria-labelledby="status-h">`:
       - header row: `<h2 id="status-h">Using</h2>` and a `.pill` with class `ok`, `err` or nothing for the `connection()` tone, a dot and the label;
       - `.prov-line`: `.pmark` with `mark`, `<b>` title, `<span>` detail, and `<button type="button" class="link">Change</button>` → `onOpenProvider()`;
       - then `BridgeErrorNote` with `bridge.message` when the provider is a CLI and `bridge?.ok === false`;
       - then `TestConnection`.
     - Default mode card, `<section class="card stack" aria-labelledby="mode-h">`:
       - `<h2 id="mode-h">Default mode</h2>`;
       - a `.seg` `role="radiogroup" aria-labelledby="mode-h"` made of three native radios, `<label class={on ? 'on' : ''}><input type="radio" name="default-mode" value=… checked=… onChange=… />Fix</label>`. The labels are Fix, Rephrase (with `title="Rephrase (keep tone)"`) and Shorter, and the values are `DefaultMode` from `src/core/settings.ts`. `change({ defaultMode })` saves;
       - a `.help` line: Fix `Corrects spelling and grammar, keeps your words.`, Rephrase `Rewrites for clarity and keeps your tone.`, Shorter `Trims the text and keeps the meaning.`.
   - `App.tsx`: render `HomeTab` in the panel when `tab === 'home'`, with `onOpenProvider={() => setTab('provider')}`. The other tabs stay empty.

5. `src/popup/popup.css`: port the mockup's "Status card", "Notes" and "Segmented control" sections.
   - The segmented control uses native radios here, not buttons: hide the input (`position:absolute; opacity:0; pointer-events:none`), style `.seg label` like the mockup's `.seg button`, `.seg label.on` like `[aria-checked=true]`, and show the focus ring on `.seg label:has(input:focus-visible)`.
   - Add `.code-line`, `.code-line code` and `button.copy` sizes from the mockup ("Notes" section) so `CodeLine` fits 360 px.
   - Keep `prefers-reduced-motion` slowing the spinner.

## Leave untouched
`src/options/` except the two `export` keywords. `src/core/`, `src/content/`, `src/background/`, `tests/`, `docs/`. The tab and switch components from the previous task, unless a prop has to be added.

## Rules
- UI matches the mockup screenshots, light and dark (`prefers-color-scheme`). Accessible names on every control. Visible focus rings.
- Write comments only for a non-obvious why. No task IDs in code or comments.
- Do NOT run git add or git commit; leave the work in the working tree. Skip the guard skills and any final review pass; the orchestrator reviews the diff and checks the popup visually.
</task>

<verification_loop>
While working: `npx vitest run src/popup`.
At the end, all green: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npx prettier --write` on the files you touched and `npx prettier --check .`.
Do not run `npm run test:e2e`; the orchestrator runs it.
</verification_loop>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed, per numbered change above
  2. Files touched
  3. Gate outcomes (paste counts)
  4. Anything you deviated on or want a decision on
</structured_output_contract>
