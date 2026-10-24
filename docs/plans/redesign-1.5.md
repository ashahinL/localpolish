# LocalPolish 1.5.0 plan: new look and documents

Status: T26a–T26g done. Next: T26h.
Baseline: `v1.4.0`, commit `76b1448`.
Design: [mockup](../design/redesign/mockup.html) and [decisions](../design/redesign/notes.md). The owner approved both on 24 October 2026, after a grill session. Each decision in the notes is the owner's pick. The ones below marked "default (Claude)" are not.

## Goal

1. A new look for the toolbar popup, the side panel and the options page.
2. A new layout for the popup: **New chat** and **New document** at the top, the quick switches moved into Sites, About renamed More.
3. Documents: a drafting board in the side panel, with the same Fix behavior as a web field, saved until the owner deletes it.

No other features. Fix, chat and the bridge behave as in 1.4.0.

## How to run this plan

- Orchestrator: Claude. Implementers by the fleet rules in the owner's `CLAUDE.md`. Logic tasks go to the `feature` lane. For the 24 October 2026 session only, the owner allowed Grok's fast model: `--lane feature --model grok-4.7-build-fast`. UI tasks go to the `art` lane (Claude Opus). Small tasks (under about 50 lines) Claude does directly.
- Each delegated task gets a brief in `docs/briefs/` just before dispatch, so line numbers are current. Implementers follow `implement-plan` in its light form: build, test, keep this file current, report. Skip the guard skills and the final review pass.
- One commit per task. Tick the task's box here in the same commit. `git pull --rebase`, then push, after each task.
- Tests use fake CLIs and the mock OpenAI server only. Never real drafts, never Send or Post.
- Gates before each commit: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx prettier --check .`. The full browser suite (`npm run test:e2e`) runs for every task that touches `src/content`, `src/chat`, the background or the popup.
- UI tasks are checked in a real browser at 400 px popup width and at 320, 400 and 640 px panel width, light and dark, with Arabic text.
- Keep the version at 1.4.0 until release day.

## Decisions added while planning

- **Default (Claude): add the `unlimitedStorage` permission.** `chrome.storage.local` holds 10 MB by default. Chats alone can reach 6.4 MB (50 × 128 KB), and documents are kept forever. This permission shows no install warning.
- **Default (Claude): Fix runs only in the document text.** Not in the document title, and not in the chat message box. The chat box can get Fix later if the owner wants it.
- **Default (Claude): autosave** 800 ms after the last change, and again when the panel closes or switches item. A document with an empty title and empty text is not saved.
- **Default (Claude): emptying a saved document saves it empty** (T26f). Only a new, never-saved document is skipped when empty. Otherwise the old text would come back on reopen.
- **Default (Claude): + Doc and opening a document keep the page field the panel was opened from** (T26f), so Insert works from a document. Ask in chat also keeps it. If the save before Ask in chat fails, the panel stays on the document and shows the error.
- **Default (Claude): on the Provider tab the popup's top area hides Change, Test and the status line** (T26g), because that tab shows its own Test connection and bridge status. The space stays, so the tabs do not move. The "Hide on this site" button left Sites, since the site switch now sits on the same tab.
- **Default (Claude): two windows editing the same document** is not handled: the last save wins.
- **Default (Claude): the popup's New chat and New document** reuse the existing `chat-open-plain` path, with a new `kind` field. So Insert works from a document exactly as it works from a plain chat today.
- **Default (Claude): Retry stays in the Stopped and failed notices** (T26e). The mockup shows it under every answer, but that would be a new "regenerate answer" feature. The quick-ask chips also stay above the message box, because browser tests click them during and after answers.
- **Default (Claude): shortcut routing, both ways.** Headless Chromium cannot press extension shortcuts, so no automated test can show whether Chrome delivers the `polish` shortcut to the side panel. So the panel handles both cases, and only one can fire: (1) the background's `polish` handler also sends `{ type: 'open-popup' }` with `runtime.sendMessage`, and the document page acts on it only while `document.hasFocus()`; (2) the document page also listens for the same keys itself (shortcut read from `chrome.commands.getAll()`), for the case where Chrome passes the keys to the page instead. The owner checks it by hand in T26j.

## Risks

1. **The `polish` shortcut in the side panel.** Handled both ways (see above). Checked by hand only.
2. **In-page Fix inside an extension page.** Resolved by T26a: it works unchanged. See "Spike result".

## Tasks

- [x] **T26a. Spike: Fix in the side panel.** Grok (`feature` lane), in a throwaway worktree. Brief: [T26a-spike.md](../briefs/T26a-spike.md). Mount the controller, idle Fix and button on a plain textarea in the side panel, using the real rewrite port and the mock OpenAI server. Answer the two risks above, plus: does Ctrl+Z / ⌘Z undo an Accept? Output: a short "Spike result" section in this file, with pass or fail for each question and the fallback chosen. Depends on: nothing.

- [x] **T26b. Document storage.** `feature` lane. Depends on: nothing.
  - New `src/core/documents.ts`, modelled on `src/core/chatHistory.ts`: `SavedDocument { id, title, body, createdAt, updatedAt }`, with `listDocuments()`, `loadDocument(id)`, `saveDocument(input)`, `deleteDocument(id)`. Storage key `documents`. Its own lock name. Rejects a record over 128 KB with a clear message. No count limit and no age limit. Sorted by `updatedAt`, newest first.
  - Add `unlimitedStorage` to `permissions` in `wxt.config.ts`.
  - Unit tests like `chatHistory.test.ts`: save, update, list order, delete, size limit, bad stored data ignored, nothing expires.

- [x] **T26c. Shared Fix wiring and shortcut routing.** `feature` lane. Depends on: T26a.
  - Move the Fix setup out of `start()` in `src/entrypoints/content.ts` into `src/content/fix.ts`, as one function that takes: how to connect, how to read settings, `isEnabled`, `isIdleEnabled`, and which elements Fix may attach to. `content.ts` calls it with today's behavior, unchanged.
  - The `polish` command handler in `src/entrypoints/background.ts` (about line 405) also sends `{ type: 'open-popup' }` through `runtime.sendMessage`, as decided above.
  - The idle site check in the rewrite port (`src/entrypoints/background.ts`, about lines 343–357) skips the blocklist when the sender is the extension's own side panel (`isPanelSender`, about line 179), so a blocklist entry can never turn Fix off in documents. `idleFix` still applies.
  - Settings in the side panel are loaded before `createIdleFix` is built, and reloaded on `onSettingsChanged` (the background sends `page-settings-changed` only to tabs).
  - The full browser suite must pass unchanged. This proves web pages still behave the same.

- [x] **T26d. New look: tokens and shared styles.** `art` lane. Depends on: nothing.
  - Rewrite `src/options/tokens.css` with the mockup's tokens: ink `#18213a`, highlighter `#ffe45c`, surfaces, rules, ok and error, focus, and the dark set. Keep the existing token names where a meaning stays the same, so `popup.css`, `chat.css` and `options.css` keep working.
  - Shared pieces used by all three pages: buttons (filled ink, light, text), the segmented control, switches, chips, list rows, section headings in sentence case, and the highlighter tab mark.
  - The in-page Fix popup (`src/content/ui/popup.css`) is not changed in this release.

- [x] **T26e. Side panel: header, chat restyle and two-list history.** `art` lane. Depends on: T26b, T26d.
  - Header: title, History, **+ Chat**, **+ Doc** (`src/chat/App.tsx`). The panel holds either a chat or a document. **+ Doc** opens an empty document view (the editor itself comes in T26f; until then a placeholder is fine on the branch).
  - The provider, model and thinking pickers move from the top bar into a chip inside the message box, which opens them in a small panel (`src/chat/ModelPicker.tsx`, `src/chat/Composer.tsx`).
  - Copy, Insert into field and Retry become small icon buttons (`src/chat/Conversation.tsx`).
  - History gets a Chats / Documents switch (`src/chat/History.tsx`). Deleting a document asks for confirmation first.
  - The pending entry from the background gets `kind: 'chat' | 'document'` and an optional `documentId` (`src/chat/pending.ts`, `src/background/chatEntries.ts`). Old pending entries without `kind` mean chat.

- [x] **T26f. Document editor.** `art` lane. Depends on: T26a, T26b, T26c, T26e.
  - New `src/chat/DocumentView.tsx`: title field, Markdown text area, Edit / Preview switch (Preview uses `MarkdownView`), **Copy** (plain text), **Insert** (same path as chat's `insertAnswer`, shown only when the panel knows the page field), **Ask in chat** (starts a new chat with the document attached as `{ text: body, title, url: '' }`), "Saved" note and word count.
  - Fix in the text area through `src/content/fix.ts`: Fix while I type with the whole document, the floating button, the shortcut, and the default mode. It follows the `idleFix` and `languages` settings. Site hiding does not apply.
  - Autosave as decided above. Both text fields use `dir="auto"`.
  - Browser tests with the mock provider: idle Fix proposes a change and Accept applies it; Ctrl+Z undoes it; the document survives a panel reload; Ask in chat opens a chat with it attached; Fix while I type off means no idle request.

- [x] **T26g. Popup layout.** `art` lane. Depends on: T26d, T26e.
  - Top: **New chat** and **New document** buttons, then the provider line with **Change** and **Test** (`src/popup/HomeTab.tsx`, `src/popup/App.tsx`).
  - Tabs: Home, Provider, Sites, More (`src/popup/Tabs.tsx`). `QuickToggles` moves into Sites, above the hidden-sites list. About becomes More, and Usage moves there.
  - Home: recent documents (the last 3, each opens that document in the panel) and the Fix / Rephrase / Shorter choice.
  - Provider: the radio list from the mockup (`src/popup/ProviderPicker.tsx`).
  - Update `scripts/shots.mjs` for the new tabs and retake `docs/screenshots/`.

- [ ] **T26h. Options page restyle.** `art` lane. Depends on: T26d. Same sections and order (`src/options/App.tsx`), in the new look. No behavior changes.

- [ ] **T26i. Docs and checklist.** `feature` lane, or Claude if small. Depends on: T26f, T26g.
  - README: the new popup, documents, where they are stored.
  - `PRIVACY.md`: documents stay in this browser's local storage until deleted, and their text goes to the chosen provider only when Fix runs or when attached to a chat.
  - `docs/manual-checklist.md`: a document section (write, idle Fix, Accept, undo, Insert, Ask in chat, delete).
  - `CHANGELOG.md` entry for 1.5.0.

- [ ] **T26j. Release 1.5.0.** Claude. Follow `RELEASING.md`. The owner hand-checks: the popup in both themes, writing and fixing a real document in English and Arabic, Insert into a real field (without sending), and Ask in chat.

## Order

T26a and T26b and T26d can start at once. Then T26c, T26e, T26f, T26g, T26h, T26i, T26j.

## Handoff (24 October 2026, 13:50 Cairo)

- Current commit: the T26g commit on `main`. Everything is pushed. No delegate, dev server or test browser is running.
- Done: T26a–T26g. T26g rebuilt the toolbar popup (top area with New chat, New document, provider line with Change and Test; tabs Home, Provider, Sites, More; recent documents on Home), added `src/core/when.ts` (short times, also used by the panel history), fixed the old icons' stroke attributes, and retook `docs/screenshots/` (`about.png` is now `more.png`). The browser suite has 266 tests.
- Next: T26h (options page restyle), `art` lane. Same sections and order in `src/options/App.tsx`, the new look, no behavior changes. Note that `src/setup/setup.css` now holds the card and row styles the setup page used to take from `popup.css`.
- Then T26i (docs and checklist), then T26j (release, needs the owner's hand checks).
- Required checks per task: lint, typecheck, `npm test`, build, Prettier; the full browser suite for anything touching `src/content`, `src/chat`, the background, the popup or the options page. Delegates' sandboxes cannot start Chromium or bind port 5179, so the orchestrator runs `npm run test:e2e` itself.
- Visual checks: `npm run shots` renders the popup tabs. Opus's helpers in `/tmp/t26e/`, `/tmp/t26f/` and `/tmp/t26g/` render the side panel and popup scenes with a stubbed `chrome` (not in the repo; they need `--single-process --disable-gpu` in the delegate sandbox). Each UI task rebuilt one; saving one as `scripts/shots-all.mjs` is still open.
- Known gaps against the mockup: in the side panel the model panel floats over the quick-ask chips; the document toolbar wraps Insert to a second row at 320 px; the popup's Provider tab shows an empty band where the status line would be.
- Decided by the owner on 24 October 2026: the in-page Fix popup and floating button on web pages (`src/content/ui/popup.css`, `--lp-accent`) keep their current blue look in 1.5.0. The icon is yellow everywhere.
- Grok fast mode (`--model grok-4.7-build-fast`) was allowed for the 24 October session only. Use the normal `feature` lane unless the owner says otherwise.

## Spike result

T26a ran on 24 October 2026 (Grok 4.7, 25 minutes). The orchestrator re-ran both spike tests and they passed. The spike wired `createController`, `createIdleFix` and `createButton` to a textarea on `sidepanel.html#spike`, with the real rewrite port and the mock OpenAI server, at 360 × 700.

| Check | Result |
| --- | --- |
| Idle Fix: one request after the pause, `.lp-mark` shows, diff popup opens, Accept applies | Pass |
| ⌘Z / Ctrl+Z once after Accept restores the text from before | Pass (`execCommand('insertText')` keeps the undo stack) |
| Floating button on a selection opens the diff, Accept applies | Pass |
| Mark, button and popup fully visible next to the field at 360 px | Pass |
| Changes needed in `src/content/**` | None |

What the real editor must do differently from `start()` in `src/entrypoints/content.ts`:

- Load settings with `pageSettings((await chrome.storage.local.get('settings')).settings)` before building `createIdleFix`, and reload them in `onSettingsChanged`, then call `idle.refresh()` and `button.refresh()`.
- `isEnabled = () => true`; idle uses `settings.idleFix` only.
- Leave out `createChatInsert`, `createSelectionChat` and the `runtime.onMessage` `page-settings-changed` listener.
- `src/chat/chat.css` sets every `textarea` to 32 px. The document field needs its own class and size.
- Headless e2e may need `--single-process` in some sandboxes; `launchExtension()` stays as it is.
