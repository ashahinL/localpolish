# LocalPolish plan

Status: T0-T14 done.
Released follow-up: [1.1.0 audit fixes and release record](plans/next-release.md).
Current work: [1.3–1.4 feature plan](plans/features-1.3-1.4.md). Resume from the [1.4 machine handoff](handoff-1.4.md). The [performance plan](plans/performance.md) records completed earlier work.
Started: 2026-10-17
Current orchestrator: Codex. Choose fleet implementers by task size as the owner directed. The task assignments below are the original build history.

LocalPolish is a Chrome extension (Manifest V3) that fixes or rewrites text you write in any text field. It uses the AI subscriptions you already pay for, through their CLIs, so no API keys are needed. API-key providers stay as an option.

## Settled decisions

| Topic | Decision |
| --- | --- |
| Main AI path | A local **bridge**: a Node script Chrome starts through **native messaging**. It runs `claude`, `codex`, `grok` or `agy` headless on your subscriptions. See [ADR 0001](adr/0001-cli-bridge-over-native-messaging.md). |
| Other providers | OpenAI-compatible HTTP (OpenAI, xAI, OpenRouter, LM Studio, Ollama `/v1`) and Anthropic Messages API, with API keys. |
| Default provider | Codex CLI, model `gpt-6-luna` at `none` effort (since 2026-10-17: 19/21 on the Fix prompt test, Haiku about 9/21). Claude CLI `haiku` at `low`, Grok CLI default at `low`. All models and efforts are user settings. See the [benchmark](benchmarks/2026-10-17-fix-mode.md). |
| Build tool | WXT. It handles MV3 manifest, content script, service worker and options page builds, plus hot reload. Less config than CRXJS, and actively maintained. |
| UI | Preact for options, toolbar, the side panel and the in-page popup. Popup lives in a Shadow DOM. |
| Floating button | The Fix button shows only when text is selected inside an editable field. Source builds also have a separate page-selection chat sparkle. Hidden on blocklisted sites. |
| Shortcut | `Ctrl+Shift+K` / `Cmd+Shift+K`. Works on blocklisted sites too. With no selection, it uses the whole focused field. |
| Storage | Persistent settings, Usage and chat history use `chrome.storage.local`. Transient chat attachments and frame hints use `chrome.storage.session`. Nothing uses sync storage. Keys are never logged. |
| Extension ID | Fixed with a manifest `key`: `ealpmjmaclnlpelpcacmbicmdipmbeei`. The bridge only accepts this ID. |
| Platform | macOS and Windows for the bridge installer. Windows added on 2026-10-17 so T10 can run on a Windows PC. |
| Package manager | npm. |
| Repo | Private GitHub repo `localpolish`. One commit per task. |

## Architecture: rewrite path

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
   │                       └─ bridge/host.mjs spawns claude | codex | grok | agy, streams text back
   └── HTTP providers ─► fetch (OpenAI-compatible SSE, Anthropic SSE)
   │
   ▼  {type:"chunk"} … {type:"done", text: cleaned} | {type:"error"}
popup shows stream, then word diff → Accept / Copy / Retry / Close
```

## Contracts

### Current source contracts

The original duplicated interfaces and CLI command examples have been replaced by the source links below so this historical plan does not prescribe old behavior.

- [Settings](../src/core/settings.ts): six providers, checked defaults, language and selection-chat switches, and nested chat provider/models. The default Fix provider is Codex CLI.
- [Messages](../src/core/messages.ts): the `rewrite`, `test-connection`, and `chat` ports and their event types. Disconnecting a port cancels its request. The connection test uses its own port rather than an unowned runtime message.
- [Provider contract](../src/background/providers/types.ts): a system/user/assistant message list. Fix adapts its existing prompt pair to two messages. APIs send real message lists; CLI chats serialize turns with the system instruction kept separate.
- [Chat entries](../src/background/chatEntries.ts): page selection, context menu, shortcut, and toolbar entry points. Pending attachments and tab/frame ownership use browser-window-scoped session storage.
- [History](../src/core/chatHistory.ts): local saved chats, capped at 50 records, 30 days since update, and 128 KiB per record.
- [Bridge command builders](../bridge/lib.mjs) and [host](../bridge/host.mjs): four CLI names including `agy`, stdin-only prompts, provider lockdown, and cleanup. Native rewrite requests retain `system` and `user` fields, with optional `timeoutMs` up to 180000. The omitted timeout remains 60000.

The current chat behavior and limits are documented in the [README](../README.md#chat-in-source-builds-unreleased) and [privacy policy](../PRIVACY.md). T23f adds whole-field insertion with checked tab, frame, and field ownership. No 1.4.0 release has been made.

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
- [x] **T9b. Windows bridge** (Claude). The installer writes `%USERPROFILE%\AppData\Local\LocalPolish\localpolish-bridge.cmd`, the host manifest next to it, and the registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.localpolish.bridge`. `findOnPath` tries `.exe`, `.cmd`, `.bat`. npm `.cmd` shims run their script with Node (`resolveCommand`). Kill uses `taskkill /T /F`. The Codex home is `%USERPROFILE%\AppData\Local\LocalPolish\codex-home`.
- [x] **T10. Real-site testing** (Claude, via Claude in Chrome). Run the checklist on Gmail, X, LinkedIn, GitHub. Never press Send or Post. Fix what breaks, or fall back to Copy and note it in the README.
- [x] **T11. Hardening** (Claude). From two Sol reviews on 2026-10-17: a diff review of T9b-T10 and a full audit.
  - [x] **T11a. CLI tools off.** Codex had its shell; Grok's `--tools ""` removed nothing, so Grok could run commands as the user. Codex now turns off its shell, apps, plugins, browser and web features. Grok removes each local tool by name and denies shell, file, web and MCP tools. Checked live: no tool calls, normal Fix still works.
  - [x] **T11b. Page-started requests.** The shadow root drops untrusted clicks, and the popup's key handler ignores untrusted keys, so a page cannot start or retry a rewrite with `.click()`. The shadow root stays open for the tests; a page can still read a popup the user opened.
  - [x] **T11c. Diff-review fixes.** Collapse `

` only in editors made only of `<p>` blocks. Set `whole` only when no text sits outside the selection. Windows wrapper: `chcp 65001` and `%` escaped. Mount the UI in the dialog that holds the field. Codex login path in the docs and options matches the bridge.
  - [x] **T11d. From the audit** (split on 2026-10-17, Mac).
    - [x] **T11d-1. Bridge** (Claude). Kill the CLI's whole process group on macOS. Split a chunk over 100,000 characters, because Chrome drops a native message over 1 MB. Node 22+ in the README and `engines`.
    - [x] **T11d-2. HTTP and core** (Grok). Cut-off streams and error events become errors. A 60 s deadline for HTTP rewrites. Clear the API key when the base URL's origin changes. Refuse an API key over plain HTTP off loopback. A timeout on the word diff. Exact token matching.
    - [x] **T11d-3. Content script** (Grok). Field Accept never writes twice. The rich-editor success check compares before and after. Report a failed copy. `about:blank` frames. Skip email inputs. Exact multiline and tone e2e tests.

  - [x] **T11e. Speed and cost review** (2026-10-17, Windows and Mac). Benchmark scripts and results are in `bench/` (see `bench/README.md`). Found so far: the bridge sends `done` only when the CLI exits, which adds 2 to 3 s for Haiku; Codex sends about 13k input tokens and Grok about 10k for a one-line fix. Probe run on the Mac. Fixed: the bridge sends `done` at the final event (Haiku about 1.8 s instead of 4.5 s). Grok runs with its Claude, Codex and Cursor imports off, and Codex with our prompt as its base prompt. Sol reviewed it: fixed an early-success bug on a cut-off answer and two cleanup bugs. New Fix prompt (v2): Luna 19/21, up from 12/21; Haiku about 9/21 with any prompt. Details in `bench/README.md`.

- [x] **T12. Popup modes: one Rephrase tab with tones** (Claude Opus, art lane). Decided with the user on 2026-10-17:
  - Tabs become **Fix | Rephrase | Shorter**. The Tone tab goes away.
  - The Rephrase tab shows chips: **Keep tone** (today's Rephrase prompt), Polite, Formal, Casual, Angry but civil.
  - Clicking the Rephrase tab sends nothing. A chip click sends one request. Fix and Shorter still send on click.
  - Fix still runs when the popup opens.
  - Until a chip is picked, the last answer (usually Fix) stays in the body, and Accept still accepts it.
  - Each mode and tone keeps its answer for the life of the popup. Going back shows the saved answer with no new request. Retry asks again for the current one.
  - Remove the **default tone** setting from the options page and from `Settings` (stored values are ignored).
  - No new keyboard keys.
  - Built: the default mode setting keeps Fix, Rephrase (keep tone) and Shorter. A stored 'tone' default loads as Fix. The wire format did not change: Keep tone sends `mode: 'rephrase'`, a tone chip sends `mode: 'tone'`. Rephrase open with another answer shown adds a small "Showing: Fix" caption.

- [x] **T13. Idle Fix with a badge**. T13a logic and a plain marker (Grok, feature lane); T13b marker look and placement (Claude Opus, art lane). Decided with the user on 2026-10-18:
  - No dictionary of our own. The browser's spellcheck already underlines typos; our value is grammar.
  - When the user stops typing for 3 seconds and the field still has focus, run one Fix in the background. Send nothing if the text did not change since the last idle Fix.
  - On everywhere, with a block list (the Sites list, or its own list; decide at build time).
  - Only multi-line message fields: `<textarea>` and contenteditable. Never single-line `<input>` (search, login, email, URL, name). Also skip `role="searchbox"` or `role="combobox"`, `spellcheck="false"` and code editors (CodeMirror, Monaco). Skip text under 4 words.
  - Always send the whole field (changed 2026-10-18: a part lost the context of the rest of the post).
  - One idle request per field; different fields and tabs run in parallel. A new pause in the same field waits for that field's request.
  - Typing on while a request runs does not cancel it. The answer is kept, and the marker stays. When the field no longer matches the text that was sent, the marker dims. The next pause sends the whole field again.
  - Accept replaces the whole field.
  - Result, shown on the floating button near the end of the text:
    - Fixes found: a small yellow circle with the number of changes (from the word diff). A click opens the popup with that diff when the field is unchanged. When the field has changed, the click waits on one new Fix of the current text.
    - No fixes: nothing.
    - Request failed (bridge down, timeout, quota): a small red dot at the field's corner (like Grammarly; bottom right unless the user says otherwise). Click opens a popup with the error and how to fix it.
  - The manual flow (select, then button or shortcut) reuses a fresh idle Fix, or the in-flight request, when it is a Fix of that same whole field. Otherwise it cancels the idle request and sends its own. One field never has two requests at once.
  - [x] **T13a.** Logic and a plain marker.
  - Built: a 3 second pause in a message field runs one Fix, and a corner marker opens the popup with that diff or the error.
  - [x] **T13b.** Marker look and placement.
  - Built: a 16 px yellow count badge ("9+" above 9) and a 12 px red "!" dot, with a theme ring, shadow, hover, focus ring and a pop-in that reduced motion turns off. The marker sits 14 px in from the corner, left of a visible scrollbar, on the bottom edge of fields under 32 px tall, hides when the corner is off screen or the field has no size, and follows a field that grows or moves (rechecked every 250 ms while shown).
  - [x] **T13c.** Marker stays while typing, and the manual flow reuses the idle Fix.
  - Built: typing keeps the count and dims the marker when the text changed; a click or the button/shortcut reuses a fresh answer or the in-flight request, and one field never runs two requests at once.
  - [x] **T13d.** The marker stays until the issues are gone.
  - Built: opening, closing or copying from the popup keeps the marker; it goes when the field holds the fix (Accept or a pasted copy). Any Accept settles that text, so it never starts another idle request.
  - Built later: a grey spinning ring sits at the marker spot while a request runs; clicking it waits on that request.

- [x] **T14. Toolbar popup** (Grok, feature lane: grok-4.7 at high effort, one subtask after another). Decided with the user on 2026-10-18: the toolbar (browser action) popup holds every option from the options page, with layout Option A (tabs). The design is in [docs/design/popup/](design/popup/): `popup.html` is a clickable mockup, `notes.md` has the layout and the assumptions, and the PNGs show each tab and state.
  - Size 360 × 600. Always visible: a header (name, a "Saved" note, a gear that opens the full options page), two switches (**Fix while I type**, **Show on <this site>**), and the tabs **Home · Provider · Sites · About**.
  - Home: the provider, model and effort at a glance with a status pill, Test connection, the bridge error with `npm run bridge:install` when it is missing, and the default mode. Provider: a compact provider picker and every provider form (the options page components, shared). Sites: the blocklist. About: the shortcut, Change shortcut, a link to all options.
  - Same tokens, type and spacing as the options page, light and dark (`prefers-color-scheme`). The options page stays and is linked from the gear and About.
  - New setting `idleFix` (default on). A blocklisted site turns off the button and the idle Fix; the shortcut still works there.
  - The this-site switch adds or removes the exact hostname of the active tab in the blocklist. When a broader entry (such as `google.com` for `mail.google.com`) hides the site, the switch is disabled and says which entry, with a link to Sites.
  - Usage stats stay out of scope. The mockup's "Usage today" card with example data is **left out** of the build (fake numbers should not ship); it stays in Later.
  - [x] **T14a.** `idleFix` setting and the content script reads it. Brief: [T14a](briefs/T14a-idle-setting.md).
  - Built: `idleFix` (default `true`; a stored non-boolean loads as `true`). The idle Fix runs only when it is on and the site is not blocklisted; the button and shortcut ignore it. e2e: a pause sends one Fix; off or blocklisted sends nothing.
  - [x] **T14b.** Popup entrypoint, shared tokens, header, the two switches, tabs. Brief: [T14b](briefs/T14b-popup-shell.md).
  - Built: `src/entrypoints/popup/` (WXT sets it as `action.default_popup`, title LocalPolish), shared light and dark tokens in `src/options/tokens.css`, and `src/popup/` with `App`, `Header` (Saved flash, save error, gear opens the options page), `QuickToggles` (idle switch; the site switch adds or removes the exact host, a broader rule disables it with "Hidden by {rule}. Edit in Sites"), roving-focus `Tabs`, and `sites.ts` with tests. The panel is empty until T14c.
  - [x] **T14c.** Home tab. Brief: [T14c](briefs/T14c-popup-home.md).
  - Built: the Home tab with the status card (connection pill, provider line from `summary.ts`, the bridge error note for a CLI provider, Test connection) and the Default mode segmented control. `useBridge` and `useTest` live in `App`, so a tab switch keeps the bridge check and the test result; a provider change clears the result and drops a late answer. `PROVIDERS` and `isCli` are exported from the options page. No usage card.
  - [x] **T14d.** Provider tab with all five provider forms. Brief: [T14d](briefs/T14d-popup-provider.md).
  - Built: the Provider tab with the radio-chip picker (bridge and API groups), the options page's `CliDetails`, `OpenAiDetails` and `AnthropicDetails` (now exported, as is `CLIS`), a Bridge card with Check again for CLI providers, and Test connection. The Provider tab shows a red dot, with ", needs attention" for screen readers, when a CLI provider is picked and the bridge is down.
  - [x] **T14e.** Sites tab. Brief: [T14e](briefs/T14e-popup-sites.md).
  - Built: the Sites tab lists the blocklist with a count, a "This tab" tag and a remove button per entry, and an add field. `addSite` takes a hostname or a URL, lowercases it, and rejects empty, spaced or duplicate entries. When this tab's site is shown, a "Hide on {host}" card adds it.
  - [x] **T14f.** About tab and README. Brief: [T14f](briefs/T14f-popup-about.md).
  - Built: the About tab with the Polish shortcut (read again on focus, Change shortcut opens chrome://extensions/shortcuts), an Open button for the options page, How it works, and the version footer. The README points setup, Sites, providers, keys and the bridge status at the toolbar popup, and has a paragraph on Fix while I type.
  - [x] **T14g.** e2e tests for the toolbar popup in a new `tests/e2e/action-popup.spec.ts` (`popup.spec.ts` already covers the in-page rewrite popup). Brief: [T14g](briefs/T14g-popup-e2e.md).
  - Built: 16 stubbed tests in `tests/e2e/action-popup.spec.ts` (switches, unsupported page, bridge hint and Provider dot, Test connection, provider fields, bridge rows, Sites add/duplicate/remove, Hide on this tab, default mode, About, arrow keys, 360 px width) and a real-extension "toolbar popup Test connection" test in `extension.spec.ts`.
  - [x] **T14i.** Hover help instead of subtitles (asked for on 2026-10-18, runs before T14h). The header tagline and the plain-text descriptions under the two switches become a small custom tooltip on their labels. It shows after the pointer rests for 2 s (one named constant, `HOVER_DELAY_MS`), at once on keyboard focus, and closes on Escape. It stays the `aria-describedby` text. The "Hidden by {rule}. Edit in Sites" line stays visible because it holds a button. Brief: [T14i](briefs/T14i-popup-hover-help.md).
  - Built: `src/popup/Tooltip.tsx` (`HOVER_DELAY_MS = 2000`) on the header title (now a tab stop), the Fix while I type label and the site label. The tooltip stays in the DOM as the switch's `aria-describedby` text, opens at once when its switch gets keyboard focus, and closes on Escape or pointer leave. e2e: the 2 s hover test uses `page.clock`; the old subtitle checks now read the accessible description.
  - [x] **T14h.** Extension icon: the white nib on a royal-blue tile, picked by the user on 2026-10-18. The PNGs are in `public/icon/` and the SVG sources in [docs/design/icon/](design/icon/). Wire `icons` and `action.default_icon` in the manifest, replace the placeholder sparkle in the popup header with the nib, and fix the tab hover style. Brief: [T14h](briefs/T14h-extension-icon.md).
  - Built: `icons` (16, 32, 48, 128) and `action.default_icon` (16, 32) in `wxt.config.ts`; the popup header shows the nib icon as an inline SVG. A hovered tab keeps its underline, and the selected tab keeps its accent.

## Later (not MVP, keep the design open)

- Underlines on the fixed words (low priority; start with plain textareas).
- An on/off switch for the idle Fix. It belongs in a new extension UI (popup), not the options page; build that UI first. Planned as T14.
- Linux bridge installer (nice to have, low priority).
- Usage stats in the extension UI: how many requests ran today with each model, and their average speed. The T14 popup leaves room for a card on Home.
- Dropped on 2026-10-18: per-site default tone (Keep tone is the default; the user picks a chip) and a rewrite history (not a polishing feature).

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
- Selecting only part of a multi-line message in the LinkedIn message box can still fall back to Copy (the saved range collapses when LinkedIn swaps its paragraphs on focus). Not a priority (user, 2026-10-18).
- `npm run test:e2e` on Windows: Playwright's own Chromium fails to start on that PC ("side-by-side configuration is incorrect"). On the Mac (2026-10-17, 19:30 Cairo) the full suite passes: 41 e2e.

Fixed: Fix no longer adds a final period to a fragment (Fix prompt v2, T11e). Checked by the user with Luna low on 2026-10-18.
