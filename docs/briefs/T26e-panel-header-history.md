# T26e. Side panel: header, chat restyle and two-list history

LocalPolish is a Chrome MV3 extension (WXT, TypeScript, Preact). Release 1.5.0 gives it a new look and adds documents. T26d already rewrote the color tokens and shared control styles (`src/options/tokens.css`, `src/chat/chat.css`). This task changes the **side panel layout** to match the approved mockup, and adds the plumbing for documents. The document editor itself is the next task (T26f); here **+ Doc** opens a placeholder.

Follow the `implement-plan` skill in its light form: build, test, keep the plan file current, report. Skip the guard skills and the final review pass. **Do not commit.** The orchestrator reviews and commits.

Fix, chat and the bridge must behave exactly as in 1.4.0. No new chat features.

## Design source

Match these exactly. Open the mockup in a browser; the button at the top switches light and dark.

- `docs/design/redesign/mockup.html`: the "Chat side panel" frame (markup about lines 396–475, CSS about lines 181–220). Reuse its classes and values where they fit: `.c-head`, `.c-title`, `.c-new`, `.c-new.alt`, `.icon-btn`, `.attach`, `.msg-user`, `.msg-actions`, `.c-foot`, `.box`, `.box-row`, `.model-chip`, `.send`, `.pop`, `.history h4`, `.seg.sm`, `.hist-seg`. Copy the SVG icons from the mockup.
- `docs/design/redesign/notes.md`, section "Chat side panel".

Token names in the mockup map to the real ones like this: `--surface` → `--card`, `--rule` → `--border`, `--ink` → `--text`, `--primary-bg` → `--accent`, `--primary-fg` → `--accent-text`, `--user-bubble` → `--user`. `--hover`, `--faint`, `--mark`, `--mark-ink` and `--focus` exist already. Do not add new colors.

## Files you will touch

- `src/chat/App.tsx` (105 lines): header and view state.
- `src/chat/Composer.tsx` (67 lines): the message box.
- `src/chat/ModelPicker.tsx` (151 lines): becomes a chip plus a small panel.
- `src/chat/Conversation.tsx` (216 lines): answer actions and empty state.
- `src/chat/History.tsx` (125 lines): Chats / Documents switch.
- `src/chat/pending.ts` (130 lines) and `src/chat/pending.test.ts`.
- `src/background/chatEntries.ts` (432 lines) and `src/background/chatEntries.test.ts`.
- `src/chat/chat.css` (624 lines).
- `src/popup/icons.tsx` if you add icon components there (the panel already imports `LogoIcon` and `CloseIcon` from it).
- `tests/e2e/chat.spec.ts`: only the changes allowed under "Browser tests" below.

Do not touch `src/content/**`, `src/chat/documentFix.ts`, `src/core/documents.ts` or `src/chat/useChat.ts`.

## 1. View state and header (`src/chat/App.tsx`)

1. Add a view state: `type View = { kind: 'chat' } | { kind: 'document'; id?: string }`. Start with `{ kind: 'chat' }`.
2. Header, in this order, styled like the mockup's `.c-head`:
   - The logo (`LogoIcon`, as today, `aria-hidden`).
   - A title (`.c-title`, `dir="auto"`, ellipsis). In a chat with at least one user turn: `chatTitle(turns, attachment)` from `src/chat/useChat.ts` (already exported). In an empty chat: `New chat`. In the document view: `Document`. Keep an `h1` element for it (the current `h1.brand` "LocalPolish Chat" goes away).
   - **History**: an `.icon-btn` with the mockup's clock icon, `aria-label="History"`, `title="History"`, `aria-pressed={historyOpen}`, disabled while a chat runs (as today).
   - **+ Chat**: `.c-new`, plus icon and the visible text `Chat`, `aria-label="New chat"`. Same behavior as today's New chat button, and it also sets the view to chat.
   - **+ Doc**: `.c-new.alt`, plus icon and the visible text `Doc`, `aria-label="New document"`. Sets the view to `{ kind: 'document' }`, closes History, clears `entry` like New chat does.
3. When the view is a document and History is closed, render a placeholder in place of the conversation and composer: a `section.doc-placeholder` with `<p class="empty muted">The document editor comes in the next update.</p>`, and `data-document-id={view.id}` on the section. T26f replaces it with `DocumentView`. Do not build any editor.
4. The `ModelPicker` is no longer rendered in the header area; it moves into the composer (section 2). Settings errors that `ModelPicker` shows today (`notice error bar`) must still show, now just above the message box.

## 2. Composer and model chip (`Composer.tsx`, `ModelPicker.tsx`)

Match the mockup's `.c-foot` / `.box`:

1. The quick-ask chips (`CHAT_QUICK_ASKS`) **stay above the box, always shown**, as today. Browser tests click them during a run and after answers, so do not move them into the empty state. Restyle them as the mockup's `.chip`.
2. The box: a borderless textarea (`rows={2}`, placeholder `Ask a question` in an empty chat, `Ask a follow-up` once there are turns; keep `aria-label="Your question"` and the Enter / Shift+Enter behavior). Under it, `.box-row` with the model chip on the left and the send button on the right.
3. **Send**: the mockup's round `.send` icon button, `aria-label="Send"`, `type="submit"`, disabled when the draft is empty. While running it is replaced by a round Stop button with a square icon, `aria-label="Stop"`, same place and size. Behavior unchanged.
4. **Model chip** (`.model-chip`): text is `<provider title>, <model label>`, for example `Codex, GPT-6 Luna`. Provider title from `PROVIDERS`. Model label: the matching preset's `label` from `suggestions(provider)`; if no preset matches, the raw model value; if the value is empty, `CLI default` for CLI providers and `No model` otherwise. Add the effort label after a comma when the provider is a CLI and an effort is set (`Claude CLI, Opus 5.5, High`). The chip has `aria-expanded`, `aria-controls` pointing to the panel, `title="Chat model"`, and the up-chevron icon. Disabled while running.
5. Clicking the chip toggles a `.pop` panel shown above the box (inside `.c-foot`). It holds the same three controls as today's `.model-bar`, laid out like the mockup: a labelled **Provider** row, then **Model** and **Thinking** side by side (Thinking only when today's code shows it). Keep the exact `aria-label`s `Chat provider`, `Chat model`, `Chat thinking effort`, and the custom-input labels and `Custom…` option. Keep the `.model-bar` class on the element that wraps the controls. All `PresetChoice` behavior stays.
6. The panel closes on Escape (focus back to the chip), on a click outside the panel and chip, and when a send starts. It stays open while the user changes a value.
7. Structure: `ModelPicker` renders both the chip and the panel and takes an `onOpenChange` or similar only if you need it. `Composer` takes the picker as a prop (for example `picker: ComponentChildren`) and places it. `App` passes `<ModelPicker api={chatSettings} disabled={chat.running} />`.

## 3. Conversation (`Conversation.tsx`)

1. User turns use the mockup's `.msg-user` bubble look (keep the `turn user` classes; tests use them). Answers keep `turn answer`.
2. Under each answer, `.msg-actions` with small icon-and-text buttons, as in the mockup: **Copy** (copy icon) and **Insert into field** (down-arrow icon). Keep the exact visible texts and states: `Copy` / `Copied` / `Copy failed`, `Insert into field` / `Inserting…`, and the insert status / alert line.
3. **Retry** does not move under answers (that would be a new regenerate feature). It stays in the Stopped and failed notices, where it is today, drawn as the same small icon-and-text button with the mockup's retry icon. Same for "New chat with last answer" and the save-error "New chat" (text buttons in the same style, no icon needed).
4. The attachment card takes the mockup's dashed `.attach` look. Keep its content and controls (`Attached` / `Sent with this chat`, Remove, title, url, Show all text). Do not shrink it to one line.
5. Empty state: in an empty chat show `<h2>` "Ask about this page or anything else" (mockup `.empty h3` size) and under it the current muted line (`Ask about the attached text.` / `Ask anything. Nothing is sent until you ask.`). Both `dir="auto"` where user text can appear.

## 4. History (`History.tsx`)

1. Add a small segmented switch at the top (`.seg.sm.hist-seg`, `role="group"`, `aria-label="History lists"`), two buttons with `aria-pressed`: **Chats** and **Documents**. `History` gets a prop `initialList: 'chats' | 'documents'`; `App` passes `documents` when the current view is a document, otherwise `chats`.
2. **Chats list**: unchanged behavior (open, delete one, Delete all with confirm, help text "Saved in this browser only. Up to 50 chats, kept for 30 days.", "No saved chats yet.").
3. **Documents list**: `listDocuments()` from `src/core/documents.ts` (already sorted newest first). Each row shows `title || 'Untitled'` and the time, like a chat row, with `dir="auto"` on the title. Clicking a row calls a new prop `onOpenDocument(id)`; `App` sets the view to `{ kind: 'document', id }` and closes History.
   - Delete: the row's `.icon-btn` with `aria-label={`Delete ${title || 'Untitled'}`}`. It does **not** delete at once. It shows an inline `notice warn` with `role="alert"`: `Delete "<title or Untitled>"? This cannot be undone.` and buttons **Delete** (`sm danger-fill`) and **Cancel**. Only Delete calls `deleteDocument(id)`, then reloads the list and calls a new prop `onDocumentDeleted(id)`. In `App`, if that id is the open document, switch to a new empty chat.
   - No Delete all for documents.
   - Empty: `No documents yet.` Help: `Saved in this browser only. Kept until you delete them.`
   - Load or delete errors: same `notice error` pattern as chats (`Could not load documents: …`, `Could not delete: …`).
4. Both lists group rows under small headings like the mockup's `.history h4`: **Today** and **Earlier**, by calendar day in `Africa/Cairo` (the time formatter already uses that zone). Omit a heading whose group is empty.

## 5. Pending entry kind (`pending.ts`, `chatEntries.ts`)

1. `PendingChat` gets `kind: 'chat' | 'document'` and optional `documentId?: string`.
2. `checkedPending`: a missing `kind` means `'chat'` (old entries). Any other value than `'chat'` / `'document'` → `undefined`. `documentId`, if present, must be a non-empty string of at most 100 characters and is allowed only with `kind: 'document'`; otherwise `undefined`. Keep attachment checks as they are.
3. `src/background/chatEntries.ts`:
   - The selection entry (`chat-open-selection`) sends `kind: 'chat'`.
   - `chat-open-plain` (from the toolbar popup only, about line 400) accepts two optional message keys: `kind` (`'chat'` or `'document'`, default `'chat'`) and `documentId` (as above, only with `'document'`). Add them to the allowed-keys list for that message (about line 272). Invalid values get `{ ok: false, message: 'Invalid chat entry.' }`. Pass them into the delivered pending entry. The popup does not send them yet (T26g does).
4. `App.tsx`: in `watchPending`, a `kind: 'document'` entry sets `entry`, closes History and sets the view to `{ kind: 'document', id: pending.documentId }` without calling `start`. A chat entry does what it does today and sets the view to chat.
5. Unit tests, in the style of the existing ones:
   - `pending.test.ts`: no `kind` → chat; `kind: 'document'` with and without `documentId`; bad `kind`; `documentId` with `kind: 'chat'`; empty and too-long `documentId`.
   - `chatEntries.test.ts`: `chat-open-plain` with `kind: 'document'` and a `documentId` delivers both; with a bad `kind` is rejected; the selection entry delivers `kind: 'chat'`.

## 6. CSS (`src/chat/chat.css`)

- Restyle per the mockup. Remove rules that nothing uses any more (the old `.head` / `.brand` layout, the top `.model-bar` bar), but keep any rule a remaining element still needs.
- `chat.css` sets every `textarea` to 32 px tall. Scope that so the composer textarea follows the mockup's `.box textarea` (min-height 40 px, no border, no own focus ring; the `.box` gets `border-color: var(--focus)` on `:focus-within`).
- Keep `:focus-visible` outlines (`2px solid var(--focus)`, offset 2 px) on every button, including icon buttons and the chip.
- Dark mode: follow the mockup's dark values (filled buttons yellow with dark text through `--accent` / `--accent-text`).

## Browser tests (`tests/e2e/chat.spec.ts`)

The pickers are now inside the chip's panel, so tests that use `getByLabel('Chat provider' | 'Chat model' | 'Chat thinking effort')` must open it first. You may make **only** these edits:

1. Add one helper near the top, for example:
   ```ts
   async function openModels(page: Page): Promise<void> {
     const chip = page.getByRole('button', { name: 'Chat model' });
     if ((await chip.getAttribute('aria-expanded')) !== 'true') await chip.click();
   }
   ```
   (Match the real accessible name you give the chip. If the chip's name is its visible text, use a stable locator such as `.model-chip` instead.) Call it before the first picker use in each test, and again after any `page.reload()` or panel reopen that comes before a picker use.
2. Rewrite the one layout test `chat dropdowns stay on one row with custom inputs below at narrow and wide widths` (about line 295) for the new panel, at 320 and 640 px, light and dark: the panel's Provider select is above the Model and Thinking selects; Model and Thinking share a top; no select or custom input extends past the viewport's right edge; each custom input sits below the select it belongs to. Keep the test's name meaning, and rename it to `chat model panel fits at narrow and wide widths`.
3. Nothing else. Do not change any other assertion, timeout or test.

Do not add new browser tests in this task. Document tests come with T26f.

## How to check your work

1. `npm run build`.
2. Render `dist/sidepanel.html` with a stubbed `chrome`, the way `scripts/shots.mjs` renders the popup (route `https://localpolish.test/**` to `dist/`). Put any helper script and its pictures in `/tmp/t26e/`, not in the repo. Check, at 320, 400 and 640 px wide, light and dark:
   - Empty chat; a chat with an attachment, a user turn and a Markdown answer; the model panel open; History on Chats; History on Documents (stub `documents` in storage with an English and an Arabic title); the delete confirm for a document; the + Doc placeholder.
   - Arabic: a user turn and an answer in Arabic render right to left.
   - Compare each against the mockup's chat frame in the same theme.
3. If Chromium will not start, retry with `--single-process --disable-gpu` in your own script only.

## Gates

Once at the end: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx prettier --check .`. Then try `npm run test:e2e`; earlier delegates' sandboxes could not start Chromium or bind port 5179. If it fails for that reason, say so with the exact error and stop; the orchestrator runs it.

## Plan file

In `docs/plans/redesign-1.5.md`, tick `- [ ] **T26e.` to `- [x]` and set the `Status:` line to `Status: T26a–T26e done. Next: T26f.` Do not edit the Handoff section; the orchestrator does.

## Report

- Files changed and what changed in each.
- The chip label rules as built, and how the panel opens and closes.
- Screenshots you looked at (paths in `/tmp/t26e/`), and anything that still does not match the mockup.
- Every edit to `tests/e2e/chat.spec.ts`, listed by test name.
- Gate results with exact commands and counts.
- Any decision this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
