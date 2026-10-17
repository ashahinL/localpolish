# LocalPolish plan

Status: in progress (T0-T2 done)
Started: 2026-10-17
Owner: Claude (orchestrator). Implementers: Grok (`feature` lane), Claude Opus (`art` lane, UI tasks).

LocalPolish is a Chrome extension (Manifest V3) that fixes or rewrites text you write in any text field. It uses the AI subscriptions you already pay for, through their CLIs, so no API keys are needed. API-key providers stay as an option.

## Settled decisions

| Topic | Decision |
| --- | --- |
| Main AI path | A local **bridge**: a Node script Chrome starts through **native messaging**. It runs `claude`, `codex` or `grok` headless on your subscriptions. See [ADR 0001](adr/0001-cli-bridge-over-native-messaging.md). |
| Other providers | OpenAI-compatible HTTP (OpenAI, xAI, OpenRouter, LM Studio, Ollama `/v1`) and Anthropic Messages API, with API keys. |
| Default provider | Claude CLI, model `haiku`. |
| Build tool | WXT. It handles MV3 manifest, content script, service worker and options page builds, plus hot reload. Less config than CRXJS, and actively maintained. |
| UI | Preact for the options page and the in-page popup. Popup lives in a Shadow DOM. |
| Floating button | Shows only when text is selected inside an editable field. Hidden on blocklisted sites. |
| Shortcut | `Ctrl+Shift+K` / `Cmd+Shift+K`. Works on blocklisted sites too. With no selection, it uses the whole focused field. |
| Storage | Everything in `chrome.storage.local`. Nothing in sync storage. Keys never logged. |
| Extension ID | Fixed with a manifest `key`: `ealpmjmaclnlpelpcacmbicmdipmbeei`. The bridge only accepts this ID. |
| Platform | macOS only for the bridge installer (MVP). |
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

- **claude**: `claude -p --model <m> --effort low --system-prompt <system> --tools "" --setting-sources "" --strict-mcp-config --no-session-persistence --output-format stream-json --include-partial-messages --verbose`
- **grok**: `grok -p - [-m <m>] --system-prompt-override <system> --tools "" --disable-web-search --output-format streaming-messages-json --include-partial-messages`
- **codex**: `codex exec - --skip-git-repo-check --ephemeral -s read-only [-m <m>] -c model_reasoning_effort=low -c developer_instructions=<JSON-quoted system> --json`

Claude and Grok print NDJSON in the same shape. Text arrives in lines where `type == "stream_event"`, `event.type == "content_block_delta"` and `event.delta.type == "text_delta"`. Codex does not stream: the answer is in the line where `type == "item.completed"` and `item.type == "agent_message"` (`item.text`).

Measured: about 4 to 7 seconds per short fix on each CLI.

## Tasks

Each task is one commit. `[ ]` pending, `[~]` in progress, `[x]` done.

- [x] **T0. Repo and plan** (Claude). git init, private GitHub repo, this plan, ADR 0001, extension key.
- [x] **T1. Scaffold** (Grok). WXT + TypeScript + Preact, ESLint flat config, Prettier, Vitest. Manifest: name, `key`, permissions `storage`, `nativeMessaging`, `host_permissions: ["<all_urls>"]`, content script on `<all_urls>` with `all_frames`, command `polish`. Empty entrypoints. `npm run build` outputs a loadable extension at `dist/`. Gates: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- [x] **T2. Core logic** (Grok). `src/core/`: `settings.ts` (types, defaults, load/save), `prompts.ts` (system prompt per mode and tone, `buildPrompt`), `cleanup.ts` (`cleanOutput(raw, input)`), `tokens.ts` (`findMissingTokens(input, output)` for URLs, mentions, hashtags, code spans, emojis), `diff.ts` (`wordDiff` over the `diff` package). Unit tests for all.
- [~] **T3. Bridge** (Grok). `bridge/host.mjs`, `bridge/lib.mjs` (framing, CLI arg builders, stream parsers), `bridge/install.mjs` and `uninstall.mjs` (wrapper script with a fixed PATH, native host manifest in `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`). Tests: framing, arg builders, parsers, and a spawn test with a fake CLI.
- [ ] **T4. Background** (Grok). Provider interface, `cli` provider over `connectNative`, OpenAI-compatible and Anthropic SSE providers, shared SSE parser, `rewrite` port router, `test-connection`, command handler. Tests with mocked `fetch`.
- [ ] **T5. Text field read and write** (Grok). `src/content/editable.ts`: `captureTarget()` and `applyReplacement(target, text)` for input, textarea and contenteditable (`execCommand('insertText')`, then synthetic paste, then report failure). Playwright tests on local fixture pages: textarea, input, plain contenteditable, Draft.js.
- [ ] **T6. In-page popup and button** (Claude Opus, art lane). Floating button, Shadow DOM popup with modes and tones, streaming view, word diff, char counter for Shorter, missing-token warning, Accept / Copy / Retry / Close, Esc to close, copy fallback when Accept fails.
- [ ] **T7. Options page** (Claude Opus, art lane). All settings, bridge status from `ping`, Test connection, shortcut hint with a button to open `chrome://extensions/shortcuts`.
- [ ] **T8. End-to-end test** (Grok). Playwright loads the built extension, points it at a mock OpenAI-compatible server, and runs select → Fix → Accept on the fixture pages.
- [ ] **T9. README and manual checklist** (Grok). Setup, bridge install, CLI login, Ollama and `OLLAMA_ORIGINS`, loading unpacked, per-site limits, a manual checklist for Gmail, X, LinkedIn, GitHub and a plain textarea.
- [ ] **T10. Real-site testing** (Claude, via Claude in Chrome). Run the checklist on Gmail, X, LinkedIn, GitHub. Never press Send or Post. Fix what breaks, or fall back to Copy and note it in the README.

## Later (not MVP, keep the design open)

- Passive underlines while typing.
- Per-site default tone (add `siteTones: Record<host, Tone>` to settings).
- History of the last 20 rewrites (store in `chrome.storage.local`).
- Linux and Windows bridge installers.
