# LocalPolish 1.3.0 and 1.4.0 feature plan

Status: 1.3.0 released on 22 October 2026 (T21a, T21c, T21d, T22a-d, T24). OpenCode moved to the backlog. 1.4.0 started on 22 October 2026 (T23, chat). The version stays 1.3.0 until release day.
Baseline: `v1.2.0`, commit `a4ba7fc`.
Owner answers: the grill session on 22 October 2026. Each decision below is the owner's pick unless it says "default (Claude)".

## Releases

| Release | Contents                                                     | Why this order                                                                                                    |
| ------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 1.3.0   | Antigravity provider, language switches                      | Small, independent and close to done. Free models help right away. Antigravity ships only if its spike passes.     |
| 1.4.0   | The assistant chat                                           | The biggest feature, with new UI, storage and entry points. It ships on its own, so 1.3.0 doesn't wait for it.     |

Both are minor releases (see `RELEASING.md`). Nobody has to redo setup. Only people who want Antigravity run `npm run bridge:install` again, because the installer must add its folder to the wrapper's PATH.

If the Antigravity spike fails, 1.3.0 ships without it, and Antigravity moves to the backlog with the reason written down.

## How to run this plan

- Each task gets a brief in `docs/briefs/` before it is dispatched. Briefs are written just before dispatch, so the line numbers are current.
- Implementers follow the `implement-plan` skill in its light form: build, test, keep this file current, report. Skip the guard skills and the final review pass. The owner's orchestrator reviews each diff.
- One commit per task. Tick the task's box in this file in the same commit. Push after each task, with `git pull --rebase` first.
- Never use real drafts. Never press Send, Post, Reply or Comment. Tests use fake CLI scripts and the mock OpenAI server, never a real CLI or a paid provider.
- Fleet routing, updated by the owner on 22 October 2026: Codex is the orchestrator. Choose the implementer and effort by task size using the configured fleet. The model assignments beside tasks below are historical and do not control routing. Wait for delegates to finish without inspecting partial work. Spikes that run a real CLI use free models only.
- Keep the version unchanged until release day.

## 1.3.0, part 1: new CLI providers (T21)

### Decisions

- **Lockdown is the same as Claude, Codex and Grok.** No tools, no file reads, no web, no rule files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`), no saved sessions, our own system prompt. If a CLI can't be locked down, it doesn't ship.
- **OpenCode models (backlog):** the model box suggests the free Zen models (names ending in `-free`, plus `big-pickle`). Any `provider/model` that the user's OpenCode login supports can be typed in.
- **Free-model warning (backlog, OpenCode only):** when the chosen model is free, the Provider tab shows one line: free models may keep your text to train on. No extra clicks.
- **Antigravity models:** Gemini 3.8 Flash, GPT-OSS 120B, Claude Sonnet 4.6, and Claude Opus 4.6. Default: `gemini-3.8-flash` with effort `low`. Only Gemini offers an effort choice. Custom models allow model default, Low, Medium, High, or a typed effort.
- **Default OpenCode model** (backlog): picked by the spike, from the free models, by speed and Fix quality on the existing bench inputs.

### What we know (checked 22 October 2026)

- OpenCode 2.1.1 is at `~/.opencode/bin/opencode`. `opencode run --format json` prints one JSON event per line (`text`, `step_finish`, `error`, …). `--model provider/model`. There is no system-prompt flag, but an `--agent` flag exists, and agents are set up in config.
- `agy` 1.4.4 is at `~/.local/bin/agy`. `agy -p` with `--output-format stream-json` reads stdin. It has `--model`, `--effort`, `--sandbox`, `--mode plan` and `--agent`. There is no flag for a system prompt, for turning tools off, or for not saving the conversation. It saves to `~/.gemini/antigravity/conversations`.
- Both CLIs live outside the folders the installer adds to PATH today.

### Tasks

- [x] **T21a. Spike: lock down OpenCode and agy.** Result: [cli-spike.md](cli-spike.md). OpenCode free models fail (the free tier refuses requests with the file tools off). Antigravity passes, with a private home, a one-time login and per-run cleanup. Claude, free models only. For each CLI, find and prove:
  1. How to set our own system prompt.
  2. How to turn off every tool, so a prompt that asks it to read a file or run a command can't.
  3. How to stop it loading rule files from the user's home and the working folder.
  4. How to stop saved sessions, or point the CLI at a private home folder like Codex's `codex-home`.
  5. Its streaming events, for `parseLine`, and how errors and rate limits look.
  6. Time to first text and total time for a short Fix on two free models.

  Output: `docs/plans/cli-spike.md`, with exact commands and a pass or fail for each CLI. Depends on: nothing.
- **T21b. OpenCode provider.** Dropped from 1.3.0 by the owner on 22 October 2026, because the free tier can't be locked down. See the backlog below.
- [x] **T21c. Antigravity provider.** Sol medium. Depends on: T21a (passed). It no longer waits for T21b. Brief: [T21c-antigravity.md](../briefs/T21c-antigravity.md).
  - Bridge: `buildCommand`, `parseLine`, `CLI_NAMES`, the ping, and the installer's PATH list. A private home at `LocalPolish/agy-home` and a per-run `.agents/agents/localpolish.md` agent file in the temp working folder. The prompt goes on stdin as stream-json. The conversation files are deleted by id after each run. Fake-CLI tests like Grok's.
  - Extension: a new `antigravity-cli` provider id in settings, the providers index, the toolbar Provider picker and options, and the model suggestions.
  - Docs: the README setup steps, with the one-time login command, and `PRIVACY.md`.
  - Live check, 22 October 2026: after the owner's login, three real Fixes ran through the installed bridge wrapper (`gemini-3.8-flash-low`, 5.6 to 13 s each). The ping reports agy 1.4.4. The conversation and brain files were deleted after each run, and no draft text was left anywhere in the agy home. The check found two leftovers, both now fixed: a generated title row per run in `conversation_summaries.db`, and one 26 KB log per run. The bridge now deletes the row (needs `node:sqlite`, Node 22.13 or later) and keeps the 5 newest logs. Quality note: the model left "two apple" unfixed in all three runs. Second hand check: macOS showed a "Keychain Not Found" dialog, because agy looked for the login keychain under the private `HOME`. Each run then waited on it (28 s against 5 s). The bridge now sets `SSH_TTY`, so agy keeps its login in the private home's file (its log says "Using file-based token storage because SSH session detected"). The login command sets it too.

- [x] **T21d. Antigravity model and effort.** Sol medium. Brief: [T21d-agy-model-effort.md](../briefs/T21d-agy-model-effort.md).

## 1.3.0, part 2: language switches (T22)

### Decisions

- **Off means idle Fix skips it.** No idle marks or automatic checks for that language. The sparkle button and manual Fix still work when you ask.
- **The main language decides.** If most of the text is in a language that is off, idle Fix skips it. If most is in a language that is on, idle Fix checks it and tells the model to leave the parts in off languages as they are.
- **Franco-Arabic gets its own switch.** Detection uses Chrome's built-in detector (`chrome.i18n.detectLanguage`) plus a small Franco check: digits like 2, 3, 5, 7 inside Latin words, and a short list of common Franco words. It won't be perfect, and the docs say so.
- **The list:** English, Arabic, Franco-Arabic, and "Other languages" as one switch.
- **Default (Claude):** all switches start on, so nothing changes after an update until you turn one off.
- **Default (Claude):** very short text (under about 3 words) uses the last language seen in that field. If there is none, it counts as on, because detectors guess badly on tiny text.

### Tasks

- [x] **T22a. Language detector.** Sol medium. A pure module `src/content/language.ts` with: main language (`en`, `ar`, `franco` or `other`), plus which other languages appear. Chrome's detector is passed in, so unit tests use a fake. Table tests with English, Arabic, Franco, mixed and very short samples, using made-up text only. It must stay fast: one detection per idle pass, never per keystroke. Depends on: nothing.
- [x] **T22b. Settings and the idle skip.** Sol medium. Depends on: T22a.
  - Bench check of the keep line: pending, the owner schedules it (paid run).
  - A `languages` setting with checked reads (like `idleFix`), included in `pageSettings`.
  - Idle Fix skips text whose main language is off, and clears its marks.
  - When the main language is on and other parts are off, the idle request adds one line telling the model to leave those parts as they are. Bench-check this line with the existing Fix inputs before merging, because the Fix prompt is kept short on purpose (see `docs/benchmarks/2026-10-17-fix-mode.md`).
  - e2e: an Arabic draft with Arabic off gets no idle request, but manual Fix still sends one.
- [x] **T22c. Language switches in the UI.** Art lane (Claude Opus). Brief: [T22c-language-ui.md](../briefs/T22c-language-ui.md). Four switches in options, under idle Fix, and the same four in the toolbar popup's Home tab if they fit. Depends on: T22b.

- [x] **T22d. Popup polish** (owner's hand check, 22 October 2026). Claude, with the `impeccable` skill, at the owner's request. The popup is 400 px wide, up from 360. The provider chips use an even 2-column grid, so no name wraps. The language pills became a labeled multi-select segmented control that matches "Default mode", with a check mark on each language that is on. Screenshots retaken.

## 1.3.0 release (T24)

- [x] **T24. Release 1.3.0.** Follow `RELEASING.md`. The notes say: run `npm run bridge:install` again only if you want Antigravity. The owner hand-checks Fix with Antigravity and an Arabic draft with Arabic off.

## 1.4.0: the assistant chat (T23)

### Decisions

- **Place:** Chrome's side panel. It stays open across scrolling and tab switches, and page CSS can't touch it.
- **Ways to start it:** all four.
  1. A sparkle next to selected page text, outside text fields.
  2. "Ask LocalPolish about this" in the right-click menu.
  3. A keyboard shortcut.
  4. A button in the toolbar popup, for a plain chat with no selection.
- **Turns:** multi-turn, with saved history.
- **History:** the last 50 chats, for 30 days at most. Older ones are deleted on their own. Each chat has a delete button, and there is a "Delete all". Stored in this browser only, in `chrome.storage.local`.
- **Model:** the chat has its own provider and model setting. It starts as a copy of Fix's.
- **What is sent:** only the selected text, plus the page title and web address. The panel shows exactly what is attached.
- **Quick asks:** Summarize, Explain, Translate, Draft a reply. One click fills in and sends the request. You can still type your own.
- **Answers:** shown as formatted Markdown, with Copy and with Insert into the last text field you typed in on that tab. Insert uses the same paste-first path as Accept.
- **Default (Claude):** the selection sparkle shows for selections of 2 words or more, never inside text fields, and never on blocked sites. A setting turns it off. On blocked sites, the right-click menu, shortcut and toolbar button still work, because you asked for them directly.
- **Default (Claude):** shortcut `Alt+Shift+L` (Mac `Option+Shift+L`), if it doesn't clash. Users can change it at `chrome://extensions/shortcuts`.
- **Default (Claude):** CLI chats send the whole conversation each turn, because the CLIs are one-shot. A chat turn may take up to 180 seconds. Fix keeps its 60 seconds.
- **Default (Claude):** chat requests count in Usage, under their provider and model, like Fix.
- **Default (Claude):** the existing 256 KiB input limit applies to the whole conversation sent in one turn. When a chat grows past it, the panel says so and offers to start a new chat with the last answer.

### Risks to check first

- **`chrome.sidePanel.open()` needs a user gesture.** It is not certain that a click in a content script still counts as a gesture after a message to the background. T23a checks this first. If it fails, the page sparkle opens the panel through the context-menu-style path, or shows "Press the shortcut to open the chat".
- **The chat prompt must not let page text take over.** Selected text goes inside tags, and the system prompt says to treat it as data. Chat CLIs keep the same no-tools lockdown, so the worst case is a bad answer, not an action.

### Tasks

- [x] **T23a. Spike: open the side panel from each entry point.** Completed on a throwaway branch. Brief: [T23a-side-panel.md](../briefs/T23a-side-panel.md).
  - Verified on 22 October 2026, about 04:54 Cairo time, in headed Playwright Chromium `156.0.8078.4`, using a temporary profile and made-up text. Claude built the disposable harness. Its sandbox blocked browser launch, so the orchestrator ran it outside that sandbox and checked the native browser UI.
  - All four paths opened the panel. A content-script button click sent a runtime message to the worker. The native selection context menu and real `Option+Shift+L` shortcut also opened it. Each delivered the selected sentence, `Fixture article` title, and `http://localhost/fixture` URL. The toolbar popup's Chat button opened a plain chat with empty text, title, and URL. The panel also received a second selection while already open.
  - T23e can use `sidePanel.open({ tabId })` immediately in the worker's message, context-menu, and command handlers. Start the open call before awaiting selection reads or storage writes. The popup can fetch its window id when it loads and call `sidePanel.open({ windowId })` directly inside its button handler. Close the popup after the click so the panel is visible.
  - The harness passed attachments through `chrome.storage.session`: write the payload with a sequence number, read it when the panel starts, and follow `storage.onChanged` for later selections. This worked for the cold panel and the open panel. Production tab-switch handling still belongs to T23e.
  - Reproduction artifact on this Mac: `/private/tmp/localpolish-t23a-spike/`, extension in `ext/`, runner `run.mjs`. Run `HEADED=1 MANUAL=1 node /private/tmp/localpolish-t23a-spike/run.mjs`. It tests the page button and second selection, then allows five minutes for the native context menu, shortcut, and toolbar checks. Its CDP shortcut check fails because that input does not trigger Chrome's extension command here. The real shortcut passed through native UI input. The runner exits zero even when checks fail, so inspect the printed results and the panel. This temporary harness is not shipped.
  - Scope: macOS Chromium only. No real providers were called. No production code or version changed. All temporary browser processes were stopped.
- [x] **T23b. Chat messages through every provider.** Reviewed and verified on top of `04077db`. Brief: [T23b-chat-providers.md](../briefs/T23b-chat-providers.md).
  - The provider contract takes a message list (`ModelMessage` in `src/core/messages.ts`). Fix still builds its prompt pair and `runRewrite` turns that pair into a system message and a user message.
  - OpenAI sends the list as `messages`. Anthropic sends the first system message as `system` and the later turns in order. A two-message Fix exchange is sent unchanged. Longer CLI turns keep the system text separate and put a JSON turn array inside `<conversation>` tags, with `<` escaped so page text cannot close the tag.
  - The bridge reads optional `timeoutMs` (`readTimeoutMs` in `bridge/lib.mjs`). The default stays 60 seconds. Only a positive whole number up to 180000 is accepted. A larger or invalid value is an error before any CLI starts. The timeout error names the duration that was used.
  - Chat prompts live beside the Fix prompts: system prompt, Summarize, Explain, Translate, Draft a reply, and `buildChatMessages`. The selection, title and URL are JSON inside one `<attachment>` tag on the first user turn. An oversized chat tells the user to start a new chat with the last answer. `CHAT_TIMEOUT_MS` is 180000. No chat runtime handler.
  - Settings gain `chat.provider` and `chat.models`. A first load with no saved chat copies the normalized Fix provider and models. Later Fix saves do not move a saved chat. Keys, credentials and CLI efforts stay shared. `pageSettings` is still the same four fields.
  - Review fixed the CLI input size check to include the system prompt and removed a test that only repeated constants. The orchestrator verified lint, typecheck, 692 unit tests passed with 2 skipped, formatting, build, and 208 e2e tests on 22 October 2026. No real providers were called. Package version stays 1.3.0.
- [ ] **T23c. Chat history store.** Sol medium. Depends on: nothing. Save, list, open, delete one, delete all. Prune to 50 chats and 30 days on every save and on browser start. A size cap per chat, so one huge selection can't fill storage. Unit tests with a fake storage.
- [ ] **T23d. Side panel chat UI.** Art lane (Claude Opus). Depends on: T23a, T23b, T23c.
  - The panel layout: the attached selection, the messages, the quick asks, the input box, and the history list.
  - Markdown rendering with no raw HTML. Use a small, well-known Markdown library and sanitize, or render a safe subset.
  - Copy and Insert on each answer. The chat provider picker.
- [ ] **T23e. Entry points.** Sol medium. Depends on: T23a, T23d.
  - The selection sparkle in the content script. Reuse `FloatingButton`. Skip blocked sites, text fields and short selections.
  - The context menu, the shortcut and the toolbar popup button.
  - The manifest permissions: `sidePanel` and `contextMenus`. Chrome shows no new warning for these.
- [ ] **T23f. Insert into the last text field.** Sol medium. Depends on: T23d. The content script remembers the last focused editable field. Insert reuses `applyReplacement`, and it reports clearly when that field is gone or the tab changed. e2e on the fixture page.
- [ ] **T23g. Chat docs and e2e.** Sol medium. Depends on: T23e, T23f. Update the README, `PRIVACY.md` (history is stored locally, what is sent) and `docs/manual-checklist.md`. Add an e2e test for selection → chat → mock answer → Copy and Insert.

## 1.4.0 release (T25)

- [ ] **T25. Release 1.4.0.** Follow `RELEASING.md`. New toolbar screenshots, because the popup gains a chat button. The owner hand-checks the chat on a long article, with a CLI provider and an API provider.

## Backlog

- **OpenCode provider** (was T21b). Free models can't be locked down ([cli-spike.md](cli-spike.md)). Revisit for paid and own-key models only, after one paid test run, or if OpenCode lets its free tier run without file tools.

## Order of work

1. T21a (spike) and T22a (detector) at the same time. T23b can start too, because it touches different files.
2. T22b, then T21c, then T22c. One writer at a time, because T22b and T21c both change `src/core/settings.ts`.
3. T24: release 1.3.0.
4. T23a, then T23b, T23c, T23d, T23e, T23f and T23g.
5. T25: release 1.4.0.

## Handoff

- Current base commit: `04077db` (T23a evidence). T23b and this handoff are in the following task commit. Released version: `v1.3.0`.
- Released: [LocalPolish 1.3.0](https://github.com/ashahinL/localpolish/releases/tag/v1.3.0), zip SHA-256 `f14d71e0…c3`. Notes: [docs/releases/1.3.0.md](../releases/1.3.0.md).
- Finished: T21a, T21c, T21d, T22a, T22b, T22c, T22d, T24, T23a, T23b. T21b (OpenCode) is in the Backlog.
- Last checks: T23b full local gates passed on 22 October 2026: lint, typecheck, 692 unit tests passed with 2 skipped, formatting, build, and 208 e2e tests. Code, tests, and docs were reviewed. Comment Sicko was skipped because this session cannot launch that named reviewer.
- Still the owner's to schedule: the paid bench check of the keep line, and the Windows agy login (not verified).
- 1.4.0 in progress. T23a passed all four entry points. T23b is the provider, prompt and settings foundation for chat. History, panel UI, entry points and insertion are not started.
- Next task: T23c. T23d waits for T23b and T23c. Choose fleet routing by task size, not the historical model labels.
- Checks for every task: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, `npm run test:e2e`.
- Active processes: none. The disposable T23a harness remains in `/private/tmp/localpolish-t23a-spike/` and may disappear after a reboot.
