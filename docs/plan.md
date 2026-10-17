# LocalPolish plan

Status: in progress (T0-T10 done, T11 hardening)
Started: 2026-10-17
Owner: Claude (orchestrator). Implementers: Grok (`feature` lane), Claude Opus (`art` lane, UI tasks).

LocalPolish is a Chrome extension (Manifest V3) that fixes or rewrites text you write in any text field. It uses the AI subscriptions you already pay for, through their CLIs, so no API keys are needed. API-key providers stay as an option.

## Settled decisions

| Topic | Decision |
| --- | --- |
| Main AI path | A local **bridge**: a Node script Chrome starts through **native messaging**. It runs `claude`, `codex` or `grok` headless on your subscriptions. See [ADR 0001](adr/0001-cli-bridge-over-native-messaging.md). |
| Other providers | OpenAI-compatible HTTP (OpenAI, xAI, OpenRouter, LM Studio, Ollama `/v1`) and Anthropic Messages API, with API keys. |
| Default provider | Claude CLI, model `haiku` at `low` effort, short prompts. Codex `gpt-6-luna` at `none`, Grok CLI default at `low`. All models and efforts are user settings. See the [benchmark](benchmarks/2026-10-17-fix-mode.md). |
| Build tool | WXT. It handles MV3 manifest, content script, service worker and options page builds, plus hot reload. Less config than CRXJS, and actively maintained. |
| UI | Preact for the options page and the in-page popup. Popup lives in a Shadow DOM. |
| Floating button | Shows only when text is selected inside an editable field. Hidden on blocklisted sites. |
| Shortcut | `Ctrl+Shift+K` / `Cmd+Shift+K`. Works on blocklisted sites too. With no selection, it uses the whole focused field. |
| Storage | Everything in `chrome.storage.local`. Nothing in sync storage. Keys never logged. |
| Extension ID | Fixed with a manifest `key`: `ealpmjmaclnlpelpcacmbicmdipmbeei`. The bridge only accepts this ID. |
| Platform | macOS and Windows for the bridge installer. Windows added on 2026-10-17 so T10 can run on a Windows PC. |
| Package manager | npm. |
| Repo | Private GitHub repo `localpolish`. One commit per task. |

## Architecture

```
page text field
   │  select text → floating button / Cmd+Shift+K
   ▼
content script (Shadow DOM popup, editable.ts)
   │  chrome.runtime port "rewrite": {mode, tone, text}
   ▼
background service worker
   │  builds {system, user} from prompts.ts, picks provider
   ├── CLI providers ──► chrome.runtime.connectNative("com.localpolish.bridge")
   │                       └─ bridge/host.mjs spawns claude | codex | grok, streams text back
   └── HTTP providers ─► fetch (OpenAI-compatible SSE, Anthropic SSE)
   │
   ▼  {type:"chunk"} … {type:"done", text: cleaned} | {type:"error"}
popup shows stream, then word diff → Accept / Copy / Retry / Close
```

## Contracts

### Settings (`src/core/settings.ts`)

```ts
type ProviderId = 'claude-cli' | 'codex-cli' | 'grok-cli' | 'openai-compatible' | 'anthropic-api';
type Mode = 'fix' | 'rephrase' | 'shorter' | 'tone';
type Tone = 'polite' | 'formal' | 'casual' | 'angry-civil';

interface Settings {
  provider: ProviderId;                 // default 'claude-cli'
  models: Record<ProviderId, string>;   // defaults: claude-cli 'haiku', codex-cli 'gpt-6-luna',
                                        // grok-cli '' (CLI default), openai-compatible '',
                                        // anthropic-api 'claude-haiku-5-5'
  openaiBaseUrl: string;                // default 'http://localhost:11434/v1'
  openaiApiKey: string;                 // default ''
  anthropicApiKey: string;              // default ''
  temperature: number;                  // default 0.3, HTTP providers only
  defaultMode: Mode;                    // default 'fix'
  defaultTone: Tone;                    // default 'polite'
  blocklist: string[];                  // hostnames, default []
}
```

### Content ↔ background

- Port name `rewrite`. Content sends `{mode, tone, text}` once. Background replies `{type:'chunk', text}` many times, then `{type:'done', text}` (cleaned) or `{type:'error', message}`. Content disconnecting the port aborts the request.
- `chrome.runtime.sendMessage({type:'test-connection'})` → `{ok:true, sample, ms}` or `{ok:false, message}`. Runs a tiny Fix request through the current provider.
- Command `polish` → background sends `{type:'open-popup'}` to the active tab.

### Background ↔ bridge (native messaging, one port per request)

- `→ {type:'rewrite', cli:'claude'|'codex'|'grok', model, system, user}`
- `← {type:'chunk', text}` …, then `{type:'done'}` or `{type:'error', message}`
- `→ {type:'ping'}` `← {type:'pong', clis:{claude:{version}|null, codex:…, grok:…}}`
- Port disconnect: host kills the child process and exits. Hard timeout 60 s.

### CLI commands (verified by hand on 2026-10-17)

User text always goes in through **stdin**. Each run uses a fresh empty temp dir as cwd.

- **claude**: `claude -p --model <m> --effort <effort> --system-prompt <system> --tools "" --setting-sources "" --strict-mcp-config --no-session-persistence --output-format stream-json --include-partial-messages --verbose`
- **grok**: `grok -p - [-m <m>] [--effort <effort>] --system-prompt-override <system> --tools "" --disable-web-search --output-format streaming-messages-json --include-partial-messages`
- **codex** (with `CODEX_HOME=~/Library/Application Support/LocalPolish/codex-home`, its own login, so `~/.codex/AGENTS.md` is not loaded): `codex exec - --skip-git-repo-check --ephemeral -s read-only [-m <m>] -c model_reasoning_effort=<effort> -c developer_instructions=<JSON-quoted system> --json`

Claude and Grok print NDJSON in the same shape. Text arrives in lines where `type == "stream_event"`, `event.type == "content_block_delta"` and `event.delta.type == "text_delta"`. Codex does not stream: the answer is in the line where `type == "item.completed"` and `item.type == "agent_message"` (`item.text`).

Measured: about 4 to 7 seconds per short fix on each CLI.

## Tasks

Each task is one commit. `[ ]` pending, `[~]` in progress, `[x]` done.

- [x] **T0. Repo and plan** (Claude). git init, private GitHub repo, this plan, ADR 0001, extension key.
- [x] **T1. Scaffold** (Grok). WXT + TypeScript + Preact, ESLint flat config, Prettier, Vitest. Manifest: name, `key`, permissions `storage`, `nativeMessaging`, `host_permissions: ["<all_urls>"]`, content script on `<all_urls>` with `all_frames`, command `polish`. Empty entrypoints. `npm run build` outputs a loadable extension at `dist/`. Gates: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- [x] **T2. Core logic** (Grok). `src/core/`: `settings.ts` (types, defaults, load/save), `prompts.ts` (system prompt per mode and tone, `buildPrompt`), `cleanup.ts` (`cleanOutput(raw, input)`), `tokens.ts` (`findMissingTokens(input, output)` for URLs, mentions, hashtags, code spans, emojis), `diff.ts` (`wordDiff` over the `diff` package). Unit tests for all.
- [x] **T3. Bridge** (Grok). `bridge/host.mjs`, `bridge/lib.mjs` (framing, CLI arg builders, stream parsers), `bridge/install.mjs` and `uninstall.mjs` (wrapper script with a fixed PATH, native host manifest in `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`). Tests: framing, arg builders, parsers, and a spawn test with a fake CLI.
- [x] **T4. Background** (Grok). Provider interface, `cli` provider over `connectNative`, OpenAI-compatible and Anthropic SSE providers, shared SSE parser, `rewrite` port router, `test-connection`, command handler. Tests with mocked `fetch`.
- [x] **T4b. Per-CLI model and effort** (Claude). From the [benchmark](benchmarks/2026-10-17-fix-mode.md): add `efforts: Record<'claude-cli'|'codex-cli'|'grok-cli', string>` to settings (defaults `low`, `none`, `low`), send `effort` in the bridge `rewrite` message, pass it as `--effort` (claude, grok) and `model_reasoning_effort` (codex).
- [x] **T5. Text field read and write** (Grok). `src/content/editable.ts`: `captureTarget()` and `applyReplacement(target, text)` for input, textarea and contenteditable (`execCommand('insertText')`, then synthetic paste, then report failure). Playwright tests on local fixture pages: textarea, input, plain contenteditable, Draft.js.
- [x] **T6. In-page popup and button** (Claude Opus, art lane). Floating button, Shadow DOM popup with modes and tones, streaming view, word diff, char counter for Shorter, missing-token warning, warning when `lostArabicScript()` is true, Accept / Copy / Retry / Close, Esc to close, copy fallback when Accept fails.
- [x] **T7. Options page** (Claude Opus, art lane). All settings. Per-CLI model and effort are dropdowns with presets plus a custom value (Claude efforts low to max, Codex none to xhigh, Grok low to high). OpenAI-compatible gets base URL presets for xAI, OpenAI, OpenRouter, LM Studio and Ollama. bridge status from `ping`, Test connection, shortcut hint with a button to open `chrome://extensions/shortcuts`.
- [x] **T8. End-to-end test** (Grok). Playwright loads the built extension, points it at a mock OpenAI-compatible server, and runs select → Fix → Accept on the fixture pages.
- [x] **T9. README and manual checklist** (Grok). Setup, bridge install, CLI login, Ollama and `OLLAMA_ORIGINS`, loading unpacked, per-site limits, a manual checklist for Gmail, X, LinkedIn, GitHub and a plain textarea.
- [x] **T9b. Windows bridge** (Claude). The installer writes `%LOCALAPPDATA%\LocalPolish\localpolish-bridge.cmd`, the host manifest next to it, and the registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.localpolish.bridge`. `findOnPath` tries `.exe`, `.cmd`, `.bat`. npm `.cmd` shims run their script with Node (`resolveCommand`). Kill uses `taskkill /T /F`. The Codex home is `%LOCALAPPDATA%\LocalPolish\codex-home`.
- [x] **T10. Real-site testing** (Claude, via Claude in Chrome). Run the checklist on Gmail, X, LinkedIn, GitHub. Never press Send or Post. Fix what breaks, or fall back to Copy and note it in the README.
- [ ] **T11. Hardening** (Claude). From two Sol reviews on 2026-10-17: a diff review of T9b-T10 and a full audit.
  - [x] **T11a. CLI tools off.** Codex had its shell; Grok's `--tools ""` removed nothing, so Grok could run commands as the user. Codex now turns off its shell, apps, plugins, browser and web features. Grok removes each local tool by name and denies shell, file, web and MCP tools. Checked live: no tool calls, normal Fix still works.
  - [x] **T11b. Page-started requests.** The shadow root drops untrusted clicks, and the popup's key handler ignores untrusted keys, so a page cannot start or retry a rewrite with `.click()`. The shadow root stays open for the tests; a page can still read a popup the user opened.
  - [ ] **T11c. Diff-review fixes.** Collapse `

` only in editors made only of `<p>` blocks. Set `whole` only when no text sits outside the selection. Windows wrapper: `chcp 65001` and `%` escaped. Mount the UI in the dialog that holds the field. Codex login path in the docs and options matches the bridge.
  - [ ] **T11d. Later, from the audit.** Treat cut-off API streams as errors (stop reasons, OpenAI error events). Clear the API key when the base URL's origin changes; require HTTPS off loopback. Deadline for HTTP rewrites. Field fallback must not write twice; rich success check must look at the right place. Limit the word diff. Split bridge output under 1 MB. Kill the process group on macOS. Check the clipboard result. Exact token matching. `about:blank` frames. Email inputs. Exact multiline and tone tests. Node 22+ in the README. Grok loads `~/.claude` rules into its prompt; find a way to stop that.

## Later (not MVP, keep the design open)

- Passive underlines while typing.
- Per-site default tone (add `siteTones: Record<host, Tone>` to settings).
- History of the last 20 rewrites (store in `chrome.storage.local`).
- Linux bridge installer.

## Handoff (2026-10-17, 12:15 Cairo, now done: see T10 progress below)

T0-T9 are done and pushed. Next is **T10, real-site testing** (Claude via Claude in Chrome, on a Mac):

1. `npm install`, then `npm run build`.
2. Chrome → `chrome://extensions` → Developer mode → Load unpacked → `dist/`. The ID must be `ealpmjmaclnlpelpcacmbicmdipmbeei` (fixed by the manifest `key`; the private key in the gitignored `.keys/` is only needed to pack a `.crx`).
3. `npm run bridge:install` on that Mac, and log in to the CLIs there. Codex needs its own login: `CODEX_HOME="$HOME/Library/Application Support/LocalPolish/codex-home" codex login --device-auth`. The bridge is macOS only.
4. Be logged in to Gmail, X, LinkedIn and GitHub. Follow `docs/manual-checklist.md`. Never press Send, Post, Reply or Comment.
5. Fill the README "Sites that need Copy" table and the checklist results; fix what breaks, or note the Copy fallback.

Notes for the orchestrator:
- Grok and Claude relay sandboxes cannot start Chromium (Mach port errors) or, for Claude, bind local ports. Implementers write the Playwright tests; the orchestrator runs `npm run test:e2e` in a normal shell.
- A Grok run can finish its report and then hang without exiting. If `events.jsonl` stops growing after the final report, read the report from the events and kill the `grok` process.
- On the original Mac, `~/.npm` is root-owned, so npm installs there used `--cache /tmp/npm-cache-localpolish`.

## T10 progress (2026-10-17, Windows, Brave)

Done in Brave with the Claude CLI: Accept, undo, line breaks and Esc on Gmail (body, subject), X (post composer, reply box), LinkedIn (post composer, message box), GitHub (issue description) and the plain textarea. Results are in the README table.

Fixed on the way:
- The popup now mounts inside an open modal `<dialog>` (LinkedIn's composer made the page inert).
- `<p>`-based editors no longer get an extra empty paragraph per break.
- The Windows installer registers the host for Chrome, Brave, Edge and Chromium. The browser needs a full restart after the first install.

- LinkedIn message box, shortcut with nothing selected: an empty box now says "Type some text first." With several lines, LinkedIn swaps its `<p>` elements during `focus()`, which collapsed the saved range and made Accept fall back to Copy. Accept now focuses the field first, then selects all of it again when the capture covered the whole field. `<p>` blocks are read as one line each, so a blank line no longer shows as three.
- The background reads `runtime.lastError` when the bridge exits after a finished rewrite, so Brave no longer logs "Unchecked runtime.lastError: Native host has exited."

Shortcut and **Sites** list checked by hand by the user.

Still open:
- Selecting only part of a multi-line message in the LinkedIn message box can still fall back to Copy (the saved range collapses when LinkedIn swaps its paragraphs on focus).
- `npm run test:e2e` here: Playwright's own Chromium fails to start on this PC ("side-by-side configuration is incorrect"). The editable tests pass when pointed at Brave. Run the full suite on a machine where Playwright's Chromium starts.

Quality notes for later: Fix adds a final period to a fragment or a subject line ("I have an apple. and she...").
