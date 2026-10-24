# T26f. Document editor

LocalPolish is a Chrome MV3 extension (WXT, TypeScript, Preact). Release 1.5.0 adds documents: a drafting board in the side panel, with the same Fix behavior as a web field, saved until the user deletes it. Storage (T26b), the shared Fix wiring (T26c), the new look (T26d) and the panel header plus two-list history (T26e) are done. This task builds the editor that replaces T26e's placeholder.

Follow the `implement-plan` skill in its light form: build, test, keep the plan file current, report. Skip the guard skills and the final review pass. **Do not commit.** The orchestrator reviews and commits.

Fix, chat and the bridge must behave exactly as in 1.4.0.

## Design source

- `docs/design/redesign/mockup.html`: the "Document, same side panel" frame (markup about lines 476–520, CSS `.d-tools`, `.d-body`, `.d-title`, `.d-text`, `.d-preview`, `.d-foot` about lines 222–235 and the `.d-foot` rule near them). Copy its icons. Token mapping as in T26e: `--surface` → `--card`, `--rule` → `--border`, `--ink` → `--text`, `--primary-bg` → `--accent`, `--primary-fg` → `--accent-text`. No new colors.
- `docs/design/redesign/notes.md`, section "Documents (new)". Every row there is the owner's decision.

## What exists already

- `src/core/documents.ts`: `SavedDocument { id, title, body, createdAt, updatedAt }`, `loadDocument(id)`, `saveDocument({ id?, title, body })` (returns the saved record; a new document gets its id here; throws `This document is over the 128 KiB save limit. Split it into two documents.`), `deleteDocument`, `listDocuments`.
- `src/chat/documentFix.ts`: `startDocumentFix(accepts: (el: HTMLElement) => boolean): Promise<() => void>`. It loads settings, wires idle Fix, the floating button, the diff popup, the default mode and the `polish` shortcut (both routes) through `src/content/fix.ts`, and follows `idleFix` and `languages`. Site hiding does not apply. **Important:** `createController`, `createIdleFix` and `createButton` add document listeners that are never removed. So call `startDocumentFix` **once per panel page**, never per mount.
- `src/chat/App.tsx`: `view` state (`{ kind: 'chat' } | { kind: 'document'; id?: string }`), `entry` (the pending entry the panel was opened for), and the placeholder `section.doc-placeholder` to replace.
- `src/chat/Conversation.tsx`: `CopyButton` and `InsertButton` (not exported yet). `src/chat/insert.ts`: `insertAnswer(sequence, text)`. `src/chat/pending.ts`: `readChatTarget(sequence)` returns a target with `fieldId` only when the panel knows the page field.
- `src/chat/MarkdownView.tsx`: the chat Markdown renderer.
- T26a spike result (in `docs/plans/redesign-1.5.md`, section "Spike result"): Fix works unchanged on a side-panel textarea; `execCommand('insertText')` keeps the undo stack; `chat.css` sizes every `textarea` to 32 px, so the document field needs its own class and size.

## Build

### 1. `src/chat/DocumentView.tsx` (new)

Props: `id?: string`, `insertSequence?: string`, `onSaved(id: string): void`, `onAskInChat(document: { title: string; body: string }): void`.

1. **Loading.** With an `id`, `loadDocument(id)`. While loading show nothing editable. If it is not found, open an empty new document and show a small `notice warn`: `That document is no longer saved.` Without an `id`, start empty.
2. **Layout** like the mockup:
   - `.d-tools` bar: an **Edit / Preview** segmented control (`.seg.sm`, `role="group"`, `aria-label="View"`, buttons with `aria-pressed`), then `.msg-actions` on the right with **Copy**, **Insert** and **Ask in chat** icon-and-text buttons.
   - `.d-body`: the title `input.d-title` (`aria-label="Title"`, `placeholder="Untitled"`, `dir="auto"`), then either the text area `textarea.d-text` (`aria-label="Document text"`, `dir="auto"`, `spellcheck` on) in Edit, or `MarkdownView` inside `.d-preview` (`dir="auto"`) in Preview. Preview is read-only.
   - `.d-foot`: the save note on the left, the word count on the right.
3. **The text area stays uncontrolled after load** so Fix's undo works: set its initial value once (use `key` on the editor so another document remounts it), read changes from `onInput`, never assign `.value` from state afterwards. The same applies to the title field. Switching to Preview and back must keep the text and the undo history: hide the textarea with the `hidden` attribute instead of unmounting it.
4. **Copy**: copies the body as plain text (the Markdown characters, no title). Same states as chat's Copy (`Copy` / `Copied` / `Copy failed`). Export and reuse `CopyButton` from `Conversation.tsx`.
5. **Insert**: shown only when `insertSequence` is set and `readChatTarget(insertSequence)` resolves to a target with a `fieldId` (check on mount and when `insertSequence` changes). It inserts the body with `insertAnswer`. Export and reuse `InsertButton`, adding a `label` prop (default `Insert into field`); the document passes `Insert`. Busy text stays `Inserting…`; success and error lines as in chat.
6. **Ask in chat**: saves first (flush, section 2), then calls `onAskInChat({ title, body })`. Disabled while the body is empty.
7. **Word count**: `body.trim().split(/\s+/u).filter(Boolean).length`, shown as `1 word` / `N words`.
8. **Save note**: `Saving…` while a save runs, `Saved` after, nothing for a new empty document, and on failure `Not saved: <message>` in `--error` with `role="alert"`.

### 2. Autosave

1. Save 800 ms after the last change to the title or the body (one timer, reset on each change).
2. Also save right away (flush) when the component unmounts (switching to a chat, opening another item, History), on `pagehide`, and on `visibilitychange` to `hidden`. A flush with no unsaved change does nothing.
3. A document whose title and body are both empty (after trim) is not saved, and is not created.
4. The first save of a new document creates it; call `onSaved(saved.id)` and keep the id for later saves, so there is only ever one record per document. Saves run one at a time; a change made during a save is saved after it.
5. Two windows editing the same document is not handled; the last save wins.

### 3. Fix in the text area

1. In `DocumentView.tsx`, a module-level `let fixStarted: Promise<unknown> | undefined;` and a function that starts it once: `fixStarted ??= startDocumentFix((el) => el instanceof HTMLTextAreaElement && el.classList.contains('d-text'))`. Call it from a `useEffect` in `DocumentView`. Never stop it.
2. Fix applies only to the document text, not the title and not the chat message box.
3. Do not change `src/content/**`, `src/chat/documentFix.ts` or `src/core/documents.ts`. If something there must change, stop and report why instead.
4. The Fix mark, floating button and diff popup must be fully visible next to the field at 320 px, 400 px and 640 px (the spike passed at 360 px).

### 4. `src/chat/App.tsx`

1. Replace the placeholder with `<DocumentView key={view.id ?? 'new'} id={view.id} insertSequence={entry?.sequence} onSaved={…} onAskInChat={…} />`. Careful with the `key`: when a new document gets its id from its first save, `onSaved` sets `view` to `{ kind: 'document', id }`, and that must **not** remount the editor (it would lose the undo history and focus). Use a key that stays the same for that editor, for example a counter bumped only when the user opens a different document or presses **+ Doc**.
2. `onAskInChat`: set the view to chat and `start({ text: body, title: title || 'Untitled', url: '' })`. Keep `entry` as it is.
3. **+ Doc** and opening a document from History keep `entry` as it is (change T26e's `setEntry(undefined)` in the + Doc handler), so Insert can target the field the panel was opened from.
4. The header title in the document view stays `Document`.

### 5. CSS (`src/chat/chat.css`)

Add the document rules from the mockup. Give `textarea.d-text` its own height rules so the global 32 px `textarea` rule does not apply: it fills the space between the title and the footer, with a 360 px minimum. Keep `:focus-visible` rings (`2px solid var(--focus)`) on buttons; the title and the text area themselves show no ring (as in the mockup), but the `.d-body` must not hide the Fix mark.

## Browser tests

Add `tests/e2e/documents.spec.ts`. Copy the fixture setup from the top of `tests/e2e/chat.spec.ts` (extension context, worker `sw`, `mock`, clipboard stub, `beforeEach` that writes settings with the mock URL, and `stored`). Also remove `documents` from storage in `beforeEach`. Open `chrome-extension://<id>/sidepanel.html` as a tab, as chat tests do, and press **+ Doc** (`getByRole('button', { name: 'New document' })`). For idle Fix patterns, see `test.describe('idle Fix'` in `tests/e2e/extension.spec.ts` (about line 864): type, wait for one request with `expect.poll(() => mock.requests.length, { timeout: 10_000 })`, the `.lp-mark` marker, and the Accept button in the popup. The mock's default Fix reply is `defaultReply` in `tests/e2e/mock-openai.ts`.

Tests:

1. **Idle Fix and Accept**: type a sentence with errors into the document text; one Fix request goes out; `.lp-mark` shows; clicking it opens the diff popup; Accept puts the fixed text into the document; the stored document (after autosave) has the fixed body.
2. **Undo**: after that Accept, `ControlOrMeta+z` once restores the text from before.
3. **Survives a reload**: type a title and body, wait for `Saved`, reload the page, open History → Documents, open the document; title and body are back.
4. **Ask in chat**: with a body, **Ask in chat** shows the chat view with the attachment card (`Attached`) holding the title and the body text.
5. **Fix while I type off**: with `idleFix: false` in settings, typing and pausing 4.5 s sends no request and shows no mark.
6. **Empty is not saved**: + Doc, type nothing, switch to + Chat; `documents` in storage stays empty.
7. **Preview**: Markdown `**bold**` shows as `strong` in Preview; back in Edit the text is unchanged.

Do not edit existing tests except where a T26e placeholder assertion exists (there should be none).

## How to check your work

1. `npm run build`.
2. Render `dist/sidepanel.html` with a stubbed `chrome` as in `/tmp/t26e/shots.mjs` (written in T26e; reuse it). Put helpers and pictures in `/tmp/t26f/`, not in the repo. Look at 320, 400 and 640 px, light and dark: an English document in Edit and in Preview, an Arabic document (title and text right to left), the save error note, and the Insert button present and absent.
3. Compare against the mockup's document frame.
4. If Chromium will not start, retry with `--single-process --disable-gpu` in your own script only.

## Gates

Once at the end: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx prettier --check .`. Then try `npm run test:e2e`. The delegate sandbox has blocked port 5179 before (`listen EPERM`); if so, report the exact error and stop. The orchestrator runs it. Note: `expect.poll` does not retry when its callback throws, so read nested stored values with `?.`.

## Plan file

In `docs/plans/redesign-1.5.md`, tick `- [ ] **T26f.` to `- [x]` and set the `Status:` line to `Status: T26a–T26f done. Next: T26g.` Do not edit the Handoff section.

## Report

- Files changed and what changed in each.
- How the editor key, autosave and the one-time Fix start work.
- Screenshots you looked at (paths in `/tmp/t26f/`), and anything that still does not match the mockup.
- The new browser tests by name, and whether you could run them.
- Gate results with exact commands and counts.
- Any decision this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
