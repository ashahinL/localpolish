<task>
Build the options page of the LocalPolish Chrome extension (WXT 0.21 + TypeScript strict + Preact 11, MV3). LocalPolish fixes or rewrites selected text in any web text field. It talks to AI through either a local bridge that runs the user's own `claude`, `codex` or `grok` CLI (no API keys), or HTTP providers with API keys. The options page lets the user pick the provider, model and thinking effort, and change every other setting at any time.

Already there (read only these, do not change them):
- `src/core/settings.ts`: `Settings`, `ProviderId` (`claude-cli | codex-cli | grok-cli | openai-compatible | anthropic-api`), `CliProviderId`, `Mode`, `Tone`, `DEFAULT_SETTINGS`, `loadSettings()`, `saveSettings(patch)` (merges `models` and `efforts` per key, so a patch may carry the full records).
- `src/core/messages.ts`: `BridgeStatus` = `{ok:true, clis:{claude|codex|grok: {version}|null}}` | `{ok:false, message}`; `TestResult` = `{ok:true, sample, ms}` | `{ok:false, message}`.
- Background (already implemented): `chrome.runtime.sendMessage({type:'bridge-status'})` → `BridgeStatus`; `chrome.runtime.sendMessage({type:'test-connection'})` → `TestResult` (runs a tiny Fix through the current saved settings, up to 45 s).
- `src/entrypoints/options/index.html` and `main.tsx`: placeholder page. You replace `main.tsx`'s content.
- `@types/chrome` is not installed. Type the few `chrome.*` calls you use with a small local interface, the way `src/core/settings.ts` does.

## Files
- `src/entrypoints/options/main.tsx`: mounts `<App />`.
- `src/options/` (new): components, `options.css`, and `presets.ts`.
- Unit tests `src/options/*.test.ts` (Vitest, node environment, no DOM library installed: test pure functions only).

## Presets (`src/options/presets.ts`)
```ts
CLI model presets:
  claude-cli:  haiku (default), sonnet, opus
  codex-cli:   gpt-6-luna (default), gpt-6.1-sol
  grok-cli:    '' shown as "CLI default (grok-4.7)" (default), grok-4.7, grok-4.6
CLI effort presets:
  claude-cli:  low (default), medium, high, xhigh, max
  codex-cli:   none (default), low, medium, high, xhigh
  grok-cli:    low (default), medium, high
anthropic-api models: claude-haiku-5-5 (default), claude-sonnet-5-5, claude-opus-5-5
openai-compatible base URLs (label → url, model placeholder):
  Ollama     → http://localhost:11434/v1   (llama3.2)
  LM Studio  → http://localhost:1234/v1    (local-model)
  OpenAI     → https://api.openai.com/v1   (gpt-6-luna)
  xAI        → https://api.x.ai/v1         (grok-4.7)
  OpenRouter → https://openrouter.ai/api/v1 (anthropic/claude-haiku-5.5)
```
Every model, effort and base URL picker is a `<select>` with these presets plus a last option `Custom…`. Choosing Custom shows a text input next to it, prefilled with the current value. A stored value that is not a preset shows as Custom with that value. Write the "which option is selected" logic as a pure function and unit test it.

## Layout
One centered column, max width 720 px, sections as cards. Title "LocalPolish" with a one-line subtitle "Fix and rewrite text in any field, with the AI you already pay for."

1. **AI provider.** Five radio cards in a grid: `Claude Code` (subtitle "Your Claude subscription, via the bridge"), `Codex` ("Your ChatGPT subscription, via the bridge"), `Grok CLI` ("Your SuperGrok subscription, via the bridge"), `OpenAI-compatible API` ("OpenAI, xAI, OpenRouter, LM Studio, Ollama"), `Anthropic API` ("Claude with an API key"). Below the grid, the details of the selected provider only:
   - CLI providers: Model picker, Thinking effort picker, and a one-line help: "Lower effort is faster and cheaper. Low is enough for fixing text."
     - Codex only: a note with a copy button: `CODEX_HOME="$HOME/Library/Application Support/LocalPolish/codex-home" codex login` and the text "Codex needs its own login for LocalPolish, once. Run this in a terminal."
   - OpenAI-compatible: Base URL picker, Model text input (placeholder from the preset), API key (password input with a Show/Hide toggle; help "Leave empty for Ollama and LM Studio."), Temperature (number, 0 to 1, step 0.1).
     - When the base URL is Ollama: a note "Ollama must allow the extension: start it with OLLAMA_ORIGINS=chrome-extension://* ollama serve".
   - Anthropic API: Model picker, API key (password with Show/Hide), Temperature.
2. **Bridge** (shown for all providers, since it only matters for CLI ones put it right under the provider card). Ask `bridge-status` on load and on a "Check again" button. Show a row per CLI: name, a green dot + version, or a grey dot + "not found". If `{ok:false}`: a red note with the message, and "Install it from the LocalPolish folder:" + a copyable `npm run bridge:install`.
3. **Test connection.** A button. First save any pending edits, then send `test-connection`. While running: spinner + "Testing…" (button disabled). Result: green "Works. Got “<sample>” in 1.2 s" (ms → seconds, one decimal) or a red note with the message.
4. **Defaults.** Default mode select (Fix, Rephrase, Shorter, Tone) and default tone select (Polite, Formal, Casual, Angry but civil).
5. **Sites.** "Hide the button on these sites" textarea, one hostname per line (help: "The shortcut still works there."). Save as trimmed, non-empty lines.
6. **Shortcut.** Read the `polish` command with `chrome.commands.getAll()` and show its shortcut as key caps (or "Not set"). A button "Change shortcut" → `chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })`.

## Saving
- Load with `loadSettings()` on start. Show nothing editable until loaded.
- Auto-save: selects, radios and checkboxes save at once; text inputs save 400 ms after the last keystroke and on blur. Use `saveSettings` with only the changed fields (send the full `models` / `efforts` records when one entry changes).
- A small status at the top right of the page: "Saved" (fades after 1.5 s) or "Could not save: <message>".
- Listen to `chrome.storage.onChanged` and refresh the form when settings change elsewhere, but do not overwrite a field the user is typing in.
- API keys stay in `chrome.storage.local` only. Never log settings or keys.

## Look
Match the in-page popup, which uses: system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`), 14 px, line height 1.5, accent `#2563eb`, radius 10 px for cards and 6 px for controls, 1 px borders, light and dark themes via `@media (prefers-color-scheme: dark)` with CSS custom properties. The selected provider card has an accent border and a light accent background. Labels above inputs, help text in a muted color below. Copy buttons briefly show "Copied". Visible focus rings. No animation libraries.

## Checking your work visually
Build (`npm run build`), then load `dist/options.html` in Playwright with a stub `chrome` injected by `page.addInitScript` (storage in memory, `runtime.sendMessage` returning canned `BridgeStatus` and `TestResult`, `commands.getAll` returning the `polish` command, `storage.onChanged.addListener` no-op). `playwright.config.ts` already launches Chromium with `--single-process` because this Mac's sandbox blocks it otherwise; with that flag, closing a browser context exits the browser, so use one context. Screenshot light and dark, each provider selected, and the bridge error state, and check them yourself. You may commit this as `tests/e2e/options.spec.ts` with a few assertions (provider switch shows the right fields; Custom shows a text input; Test connection shows the result). Do not commit screenshots. Note: `tests/e2e` has a Vite web server on port 5179 for other tests; your spec can use `page.goto('file://' + absolute path to dist/options.html)` instead.

## Rules
- Do not change `src/core/`, `src/background/`, `bridge/`, `src/content/`, `src/entrypoints/background.ts`, `src/entrypoints/content.ts`, or `docs/`. Do not add npm dependencies. If something seems to require one, stop and report.
- Write only comments that explain a non-obvious why.
</task>

<verification_loop>
While working: `npx vitest run src/options`.
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
