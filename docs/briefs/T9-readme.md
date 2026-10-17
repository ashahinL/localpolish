<task>
Write the user docs for LocalPolish: `README.md` at the repo root and `docs/manual-checklist.md`. No code changes. Everything you need is below; only open source files to confirm a detail, and open at most the files named here.

## About the product (facts to use)
- LocalPolish is a Chrome extension (Manifest V3) that fixes or rewrites text you write in any web text field. Replacement for Grammarly-style fixing, but it uses the AI subscriptions you already pay for, through their command-line tools, so no API keys are needed. API-key providers are also supported.
- Use: select text in a text field → a small round button appears next to it → click it. Or press `Cmd+Shift+K` (Mac) / `Ctrl+Shift+K`; with nothing selected, the shortcut uses the whole focused field. A popup shows the modes Fix, Rephrase, Shorter, Tone (Polite, Formal, Casual, Angry but civil), streams the answer, then shows a red/green word diff. Buttons: Accept (puts the text in the field, keeps undo), Copy, Retry. Esc closes. `Cmd+Enter` / `Ctrl+Enter` accepts. Shorter shows a character count and warns over 280. A warning shows when links, @mentions, #hashtags, code or emojis were dropped, or when Arabic script was changed to another script.
- If a site does not accept the change, the popup copies the new text and asks you to paste it (`Cmd+V`).
- Providers (choose in the options page; right-click the extension icon → Options, or `chrome://extensions` → LocalPolish → Details → Extension options):
  | Provider | How it connects | Default model and effort |
  | Claude Code | bridge → `claude` CLI, your Claude subscription | `haiku`, effort `low` |
  | Codex | bridge → `codex` CLI, your ChatGPT subscription | `gpt-6-luna`, effort `none` |
  | Grok CLI | bridge → `grok` CLI, your SuperGrok subscription | CLI default (`grok-4.7`), effort `low` |
  | OpenAI-compatible API | HTTP with an optional API key: OpenAI, xAI, OpenRouter, LM Studio, Ollama | base URL `http://localhost:11434/v1` (Ollama), set a model |
  | Anthropic API | HTTP with an API key | `claude-haiku-5-5` |
  Model and thinking effort are dropdowns with presets plus Custom, changeable any time. Why these defaults: link to `docs/benchmarks/2026-10-17-fix-mode.md` (one sentence: cheapest setups that scored well on a Fix benchmark).
- The bridge: a small Node script Chrome starts through native messaging (`com.localpolish.bridge`). It runs the chosen CLI headless with your text on stdin, in an empty temp folder, with no tools, and streams the answer back. macOS only for now. Design reasons: `docs/adr/0001-cli-bridge-over-native-messaging.md`.
  - Install: `npm run bridge:install`. It writes a wrapper script `~/Library/Application Support/LocalPolish/localpolish-bridge` (with a fixed PATH, because Chrome starts native hosts with a minimal PATH) and the host manifest `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.localpolish.bridge.json`, allowed only for extension ID `ealpmjmaclnlpelpcacmbicmdipmbeei`. It prints which CLIs it found.
  - Re-run it after installing a new CLI, after moving the repo folder, or if Node moved. The wrapper runs `bridge/host.mjs` from this repo, so keep the folder.
  - Remove: `npm run bridge:uninstall`.
  - The options page shows the bridge status (each CLI's version or "not found") and a Test connection button.
- CLI logins (once, in a terminal):
  - Claude Code: run `claude` and log in (or `claude auth login`).
  - Grok CLI: `grok login`.
  - Codex needs its **own** login for LocalPolish, because the normal Codex home loads your personal `~/.codex/AGENTS.md` instructions into every rewrite: `CODEX_HOME="$HOME/Library/Application Support/LocalPolish/codex-home" codex login` (add `--device-auth` to log in with a code in the browser). Your normal Codex login is not touched.
- Ollama: it blocks requests from extensions unless allowed: `OLLAMA_ORIGINS=chrome-extension://* ollama serve` (or set it with `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"` and restart the Ollama app).
- Privacy: text is sent only to the provider you chose (your local CLI, or the API URL you set). Settings and API keys are stored in `chrome.storage.local` only, never synced, never logged.
- Site blocklist: options page → Sites. Hides the button on those hosts (subdomains included); the shortcut still works.
- Requirements: macOS, Google Chrome, Node.js 20 or newer, npm, and at least one of: `claude`, `codex`, `grok` CLI logged in, or an API key / local server.

## Error messages users can see (for a Troubleshooting section; quote them exactly)
- `The LocalPolish bridge is not installed. In the LocalPolish folder run: npm run bridge:install`
- `<cli> CLI not found. Install it, log in, then run "npm run bridge:install" again.`
- `Codex needs its own login for LocalPolish. In a terminal run: CODEX_HOME="..." codex login`
- `Timed out after 60 seconds.` (bridge) and `Timed out after 45 seconds.` (Test connection)
- `Cannot reach <url>. Is the server running?`
- `HTTP 403: ...` with the Ollama hint about `OLLAMA_ORIGINS`
- `Set a model name for the OpenAI-compatible provider in LocalPolish settings.`
- `Add your Anthropic API key in LocalPolish settings.`
- `LocalPolish was updated. Reload this page to use it.` (after reloading the extension, open tabs need a reload)

## `README.md` sections, in this order
1. Title + two-sentence intro.
2. **Setup** (numbered): clone; `npm install`; `npm run build` (output in `dist/`); Chrome → `chrome://extensions` → Developer mode → Load unpacked → pick `dist/`; `npm run bridge:install`; log in to the CLIs you want (the list above); open the options page, pick a provider, press Test connection.
3. **Using it** (the use facts above, short).
4. **Providers** (the table, the defaults link, the Ollama note, the API key note).
5. **The bridge** (what it is, install/re-run/remove, the two file paths, macOS only).
6. **Sites that need Copy instead of Accept**: explain the fallback; keep a table `| Site | Accept works | Notes |` with rows Gmail, X, LinkedIn, GitHub, Plain textarea, all marked `Not tested yet` (filled in by real-site testing later).
7. **Troubleshooting** (the messages above, each with its fix, as a short list).
8. **Privacy** (the privacy facts).
9. **Development**: scripts `npm run dev` (WXT dev mode with hot reload), `build`, `lint`, `typecheck`, `test` (Vitest unit tests), `test:e2e` (builds, then Playwright: fixture-page tests plus a test that loads `dist/` into Chromium with a mock OpenAI server), `format`. Playwright needs its Chromium once: `npx playwright install chromium`. Some sandboxed shells cannot start Chromium (Mach port errors); run e2e in a normal terminal. Project layout as a short tree: `src/core` (settings, prompts, cleanup, diff, tokens), `src/background` (providers, rewrite router), `src/content` (field capture and replace, popup, button), `src/options`, `src/entrypoints`, `bridge/`, `tests/e2e`, `docs/` (plan, ADR, benchmark, briefs). Link `docs/plan.md`.
10. **Not yet** (one line each): passive underlines while typing, per-site tone, rewrite history, Linux and Windows bridge installers.

## `docs/manual-checklist.md`
A checklist for testing by hand on real sites, one section each for: Gmail (compose body and subject), X (post composer and reply), LinkedIn (post composer and message box), GitHub (issue/PR comment textarea), and a plain `<textarea>` page. For each site, checkboxes for:
- the button appears on selection, and stays hidden on a blocklisted site;
- Fix → Accept replaces only the selection, and the site's own Undo (`Cmd+Z`) brings the old text back;
- the shortcut with no selection rewrites the whole field;
- the site still "knows" the new text (character counter updates / Post button state / draft saved);
- multi-line text keeps its lines;
- Esc closes the popup without closing the composer;
- Copy fallback: if Accept fails, the note shows and `Cmd+V` pastes the new text;
- the popup is readable in the site's dark mode.
Top of the file: "Never press Send, Post, Reply or Comment while testing. Use drafts and close them without sending." Bottom: a results table matching the README table.

## Style
Plain, simple English, short sentences, second person ("you"). No em dashes. No marketing words (seamless, leverage, powerful, effortless, delve). Use fenced `bash` blocks with one command per block. Keep the README under about 220 lines.
</task>

<verification_loop>
Before finishing: `npx prettier --check README.md docs/manual-checklist.md` (run `npx prettier --write` on those two files first). Prettier ignores `docs/`, so check the checklist renders as clean Markdown by reading it back once.
</verification_loop>

<action_safety>
Only create `README.md` and `docs/manual-checklist.md`. Do not change any other file. Do NOT run git add or git commit; leave the work uncommitted.
Follow the implement-plan skill in its light form: write, check, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass; the orchestrator reviews the diff.
</action_safety>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed and why
  2. Files touched
  3. Checks run
  4. Any fact above that you found to be wrong in the code (file and line)
  5. Anything you deviated on or want a decision on
  6. Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
</structured_output_contract>
